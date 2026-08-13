import { dropUndefined } from './canonical.js';
import type { CompiledCondition, CompiledField } from './compiled.js';
import type {
  DensityHint,
  FieldType,
  FormBinding,
  FormDefinition,
  SelectOption,
} from './definition.js';

/**
 * The render tree: what a UI walks to draw a form.
 *
 * It is plain JSON and nothing else. No functions, no class instances, no
 * closures over the definition, because this artifact is persisted in
 * `FormDefinition.compiled` and read back by a process that never saw the
 * compiler run. A single function slipping into this tree would serialize to
 * `undefined` and the form would silently lose a control in production while
 * every in-memory test kept passing, so a serializability assertion is part of
 * the suite rather than a convention.
 *
 * The tree carries everything a renderer needs and nothing it can derive: the
 * control type, its labels and options, its layout hints, and the ids of the
 * conditions that govern it. It does not carry the conditions' current answers,
 * because those change on every keystroke; the renderer calls
 * {@link evaluateConditions} for that and looks the field up by key.
 */

/** Twelve-column grid, matching the layout primitives in the UI package. */
export const RENDER_GRID_COLUMNS = 12;

/** An answerable or presentation control. */
export interface RenderFieldNode {
  readonly nodeType: 'field';
  readonly key: string;
  readonly type: FieldType;
  readonly label: string;
  readonly helpText?: string;
  /** The base requirement. Conditions can move it; ask the state map at runtime. */
  readonly required: boolean;
  readonly layout: RenderLayout;
  /** Ids of the {@link CompiledCondition}s that govern this node. */
  readonly conditionIds: readonly string[];
  readonly options?: readonly SelectOption[];
  readonly placeholder?: string;
  readonly maxLength?: number;
  readonly rows?: number;
  readonly unit?: string;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly integer?: boolean;
  readonly minSelected?: number;
  readonly maxSelected?: number;
  readonly minLabel?: string;
  readonly maxLabel?: string;
  readonly signerRole?: string;
  readonly accept?: readonly string[];
  readonly codeSystem?: string;
  readonly valueSet?: string;
  readonly level?: number;
  readonly text?: string;
}

/** A repeating group and the row of controls it repeats. */
export interface RenderGroupNode {
  readonly nodeType: 'group';
  readonly key: string;
  readonly type: 'repeatingGroup';
  readonly label: string;
  readonly helpText?: string;
  readonly minRepeats: number;
  readonly maxRepeats?: number;
  readonly layout: RenderLayout;
  readonly conditionIds: readonly string[];
  readonly children: readonly RenderFieldNode[];
}

export type RenderNode = RenderFieldNode | RenderGroupNode;

/** Resolved layout hints. Always present, so a renderer never has to default. */
export interface RenderLayout {
  readonly columnSpan: number;
  readonly density: DensityHint;
}

export interface RenderTree {
  readonly key: string;
  readonly version: number;
  readonly title: string;
  readonly description?: string;
  readonly bindTo: FormBinding;
  readonly nodes: readonly RenderNode[];
  /** Every condition in the form, referenced by node `conditionIds`. */
  readonly conditions: readonly CompiledCondition[];
}

/**
 * Clamps an authored span into the grid. An out-of-range span is an author
 * mistake rather than a reason to refuse to publish a whole form, and a
 * renderer given a span of 40 would blow out the page instead of degrading.
 */
function resolveLayout(field: CompiledField): RenderLayout {
  const layout = field.field.layout;
  const span = layout?.columnSpan ?? RENDER_GRID_COLUMNS;
  return {
    columnSpan: Math.min(Math.max(Math.round(span), 1), RENDER_GRID_COLUMNS),
    density: layout?.density ?? 'comfortable',
  };
}

function optionsFor(field: CompiledField): readonly SelectOption[] | undefined {
  const source = field.field;
  switch (source.type) {
    case 'singleSelect':
    case 'multiSelect':
    case 'codedValue':
      return source.options;
    default:
      return undefined;
  }
}

/**
 * The optional, type-specific half of a render node. Kept as a `Pick` of the
 * optional keys so the spread below can never overwrite a required one.
 */
type RenderConstraints = Pick<
  RenderFieldNode,
  | 'maxLength'
  | 'placeholder'
  | 'rows'
  | 'unit'
  | 'min'
  | 'max'
  | 'step'
  | 'integer'
  | 'minSelected'
  | 'maxSelected'
  | 'minLabel'
  | 'maxLabel'
  | 'signerRole'
  | 'accept'
  | 'codeSystem'
  | 'valueSet'
  | 'level'
  | 'text'
>;

/** Type-specific hints, flattened so a renderer reads one object per control. */
function constraintsFor(field: CompiledField): RenderConstraints {
  const source = field.field;
  switch (source.type) {
    case 'shortText':
      return { maxLength: source.maxLength, placeholder: source.placeholder };
    case 'longText':
      return { maxLength: source.maxLength, rows: source.rows };
    case 'number':
      return {
        unit: source.unit,
        min: source.min,
        max: source.max,
        step: source.step,
        integer: source.integer,
      };
    case 'multiSelect':
      return { minSelected: source.minSelected, maxSelected: source.maxSelected };
    case 'scale':
      return {
        min: source.min,
        max: source.max,
        step: source.step,
        minLabel: source.minLabel,
        maxLabel: source.maxLabel,
      };
    case 'signature':
      return { signerRole: source.signerRole };
    case 'fileReference':
      return { accept: source.accept };
    case 'codedValue':
      return { codeSystem: source.system, valueSet: source.valueSet };
    case 'sectionHeader':
      return { level: source.level ?? 2 };
    case 'staticText':
      return { text: source.text };
    default:
      return {};
  }
}

function fieldNode(field: CompiledField): RenderFieldNode {
  return dropUndefined<RenderFieldNode>({
    nodeType: 'field',
    key: field.key,
    type: field.type,
    label: field.label,
    helpText: field.field.helpText,
    required: field.required,
    layout: resolveLayout(field),
    conditionIds: field.conditions.map((condition) => condition.id),
    options: optionsFor(field),
    ...constraintsFor(field),
  });
}

/** Builds the tree. Groups appear once, with their children nested inside them. */
export function buildRenderTree(
  definition: FormDefinition,
  fields: readonly CompiledField[],
  conditions: readonly CompiledCondition[]
): RenderTree {
  const nodes: RenderNode[] = [];
  for (const field of fields) {
    if (field.groupKey !== undefined) {
      continue;
    }
    if (field.field.type !== 'repeatingGroup') {
      nodes.push(fieldNode(field));
      continue;
    }
    const source = field.field;
    nodes.push(
      dropUndefined<RenderGroupNode>({
        nodeType: 'group',
        key: field.key,
        type: 'repeatingGroup',
        label: field.label,
        helpText: source.helpText,
        minRepeats: source.minRepeats ?? 0,
        maxRepeats: source.maxRepeats,
        layout: resolveLayout(field),
        conditionIds: field.conditions.map((condition) => condition.id),
        children: fields
          .filter((child) => child.groupKey === field.key)
          .map((child) => fieldNode(child)),
      })
    );
  }

  return dropUndefined<RenderTree>({
    key: definition.key,
    version: definition.version,
    title: definition.title,
    description: definition.description,
    bindTo: definition.bindTo,
    nodes,
    conditions,
  });
}
