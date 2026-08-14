import { err, ok } from '@openrunic/types';
import type { Result } from '@openrunic/types';

import { freezeDeep } from './canonical.js';
import type { CompileOptions, CompiledCondition, CompiledField, CompiledForm } from './compiled.js';
import { conditionDependencies, hasEmptyCombinator } from './conditions.js';
import { isAnswerableFieldType } from './definition.js';
import type { FormDefinition, FormField } from './definition.js';
import type { FormCompileError } from './errors.js';
import { buildPrintLayout } from './print-layout.js';
import { buildPromotionManifest, isPromoted, promotedFieldTypeFor } from './promotion.js';
import { buildQuestionnaire } from './questionnaire.js';
import { buildRenderTree } from './render-tree.js';
import { buildValuesSchema } from './schema.js';

/**
 * The compiler: one definition in, five artifacts out, every refusal reported.
 *
 * It runs at publish time and never per request. Two things follow from that,
 * and both are the reason the package is shaped this way. The obvious one is
 * cost: a form is compiled once and rendered thousands of times. The one that
 * matters more is stability. Because the artifacts are pinned to an immutable
 * definition, "does this submission validate" has the same answer next year as
 * it does today, on whatever engine version happens to be deployed. If the
 * schema were derived per request, a deploy could start rejecting submissions
 * that were accepted an hour earlier, and the only evidence would be a support
 * ticket.
 *
 * Every error is collected rather than thrown at the first one, because the
 * caller is a form builder showing an administrator what is wrong with the form
 * they just drew, and a list of one is a bad answer to that question.
 */

/**
 * Field keys are identifiers, not free text. They become JSON object keys, FHIR
 * `linkId`s and a column value in an indexed table, so restricting them here
 * means none of those three places needs an escaping story.
 */
const FIELD_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

function checkFieldShape(
  field: FormField,
  groupKey: string | undefined,
  errors: FormCompileError[]
): void {
  if (!FIELD_KEY_PATTERN.test(field.key)) {
    errors.push({
      code: 'invalidFieldKey',
      fieldKey: field.key,
      message:
        'A field key must start with a letter and contain only letters, digits and underscores, up to 64 characters.',
    });
  }

  switch (field.type) {
    case 'singleSelect':
    case 'multiSelect': {
      if (field.options.length === 0) {
        errors.push({
          code: 'emptyOptionList',
          fieldKey: field.key,
          message: 'A select with no options is a question nobody can answer.',
        });
      }
      const seen = new Set<string>();
      for (const option of field.options) {
        if (seen.has(option.value)) {
          errors.push({
            code: 'duplicateOptionValue',
            fieldKey: field.key,
            optionValue: option.value,
            message: 'Two options share a value, so a stored answer would be ambiguous.',
          });
        }
        seen.add(option.value);
      }
      break;
    }
    case 'codedValue':
      if (field.system.trim() === '') {
        errors.push({
          code: 'missingCodeSystem',
          fieldKey: field.key,
          message: 'A coded field must bind a terminology system, or its codes cannot be resolved.',
        });
      }
      break;
    case 'scale':
      if (field.min >= field.max) {
        errors.push({
          code: 'invalidScaleRange',
          fieldKey: field.key,
          message: 'A scale needs min < max, otherwise it has no positions.',
        });
      }
      break;
    case 'repeatingGroup':
      if (field.fields.length === 0) {
        errors.push({
          code: 'emptyRepeatingGroup',
          fieldKey: field.key,
          message: 'A repeating group with no fields repeats nothing.',
        });
      }
      break;
    default:
      break;
  }

  if (!isPromoted(field)) {
    return;
  }
  if (promotedFieldTypeFor(field) === undefined) {
    errors.push({
      code: 'unpromotableField',
      fieldKey: field.key,
      fieldType: field.type,
      message: 'This field type has no indexed value column, so it cannot be promoted.',
    });
    return;
  }
  if (field.type === 'multiSelect' && groupKey !== undefined) {
    errors.push({
      code: 'unpromotableField',
      fieldKey: field.key,
      fieldType: field.type,
      message:
        'A multi-select inside a repeating group promotes to a list of lists, which has no single indexed row.',
    });
  }
}

function compileConditions(field: FormField): CompiledCondition[] {
  return (field.conditions ?? []).map((rule, index) => ({
    id: `${field.key}#${index}`,
    fieldKey: field.key,
    effect: rule.effect,
    when: rule.when,
    dependsOn: conditionDependencies(rule.when),
  }));
}

function toCompiledField(field: FormField, groupKey: string | undefined): CompiledField {
  return {
    key: field.key,
    type: field.type,
    label: field.label,
    ...(groupKey === undefined ? {} : { groupKey }),
    answerable: isAnswerableFieldType(field.type),
    required: 'required' in field && field.required === true,
    conditions: compileConditions(field),
    field,
  };
}

/** Flattens the definition tree, rejecting duplicate keys and nested groups. */
function flatten(definition: FormDefinition, errors: FormCompileError[]): CompiledField[] {
  const fields: CompiledField[] = [];
  const seen = new Set<string>();

  const register = (field: FormField, groupKey: string | undefined): void => {
    if (seen.has(field.key)) {
      errors.push({
        code: 'duplicateFieldKey',
        fieldKey: field.key,
        message: 'Field keys must be unique across the whole definition, groups included.',
      });
      return;
    }
    seen.add(field.key);
    checkFieldShape(field, groupKey, errors);
    fields.push(toCompiledField(field, groupKey));
  };

  for (const field of definition.fields) {
    register(field, undefined);
    if (field.type !== 'repeatingGroup') {
      continue;
    }
    for (const child of field.fields) {
      if (child.type === 'repeatingGroup') {
        errors.push({
          code: 'nestedRepeatingGroup',
          fieldKey: child.key,
          groupKey: field.key,
          message:
            'A repeating group may not contain another one; repeatIndex would have to become a path.',
        });
        continue;
      }
      register(child, field.key);
    }
  }

  return fields;
}

/**
 * Checks every condition reference. Three things can be wrong with one, and all
 * three are the sort of mistake a form builder makes by renaming a field:
 * pointing at nothing, pointing at a heading, or reaching across repetitions.
 */
function checkConditions(
  fields: readonly CompiledField[],
  byKey: ReadonlyMap<string, CompiledField>,
  errors: FormCompileError[]
): void {
  for (const field of fields) {
    for (const condition of field.conditions) {
      if (hasEmptyCombinator(condition.when)) {
        errors.push({
          code: 'emptyConditionGroup',
          fieldKey: field.key,
          message: 'An all/any node with no children is vacuously true or false, never intended.',
        });
      }
      for (const referencedKey of condition.dependsOn) {
        const referenced = byKey.get(referencedKey);
        if (referenced === undefined) {
          errors.push({
            code: 'unknownConditionField',
            fieldKey: field.key,
            referencedKey,
            message: 'The condition reads a field this definition does not declare.',
          });
          continue;
        }
        if (!referenced.answerable) {
          errors.push({
            code: 'conditionTargetHasNoAnswer',
            fieldKey: field.key,
            referencedKey,
            referencedType: referenced.type,
            message: 'The condition reads a field that carries no answer.',
          });
          continue;
        }
        if (referenced.groupKey !== undefined && referenced.groupKey !== field.groupKey) {
          errors.push({
            code: 'crossRepeatReference',
            fieldKey: field.key,
            referencedKey,
            message:
              'A condition may read top-level fields and its own repetition, never another repetition.',
          });
        }
      }
    }
  }
}

type TopologicalResult =
  | { readonly order: readonly string[] }
  | { readonly fieldKey: string; readonly cycle: readonly string[] };

/**
 * Orders fields so that every field a condition reads settles before the field
 * it governs, and reports a cycle instead of looping forever.
 *
 * A cycle is a compile error rather than a runtime guard because there is no
 * correct answer to "A shows when B is answered, B shows when A is answered".
 * Catching it at publish means the interpreter is a plain walk over a list with
 * no visited set, no iteration cap, and no way to hang while a patient waits.
 */
function topologicalOrder(
  fields: readonly CompiledField[],
  byKey: ReadonlyMap<string, CompiledField>
): TopologicalResult {
  const edges = new Map<string, CompiledField[]>();
  for (const field of fields) {
    const keys: string[] = [];
    if (field.groupKey !== undefined) {
      keys.push(field.groupKey);
    }
    for (const condition of field.conditions) {
      keys.push(...condition.dependsOn);
    }
    edges.set(
      field.key,
      keys.map((key) => byKey.get(key)).filter((dep): dep is CompiledField => dep !== undefined)
    );
  }

  const order: string[] = [];
  const done = new Set<string>();
  const path: string[] = [];
  const onPath = new Set<string>();
  let cycle: { readonly fieldKey: string; readonly cycle: readonly string[] } | undefined;

  const visit = (field: CompiledField): void => {
    if (cycle !== undefined || done.has(field.key)) {
      return;
    }
    if (onPath.has(field.key)) {
      const start = path.indexOf(field.key);
      cycle = { fieldKey: field.key, cycle: [...path.slice(start), field.key] };
      return;
    }
    onPath.add(field.key);
    path.push(field.key);
    for (const dependency of edges.get(field.key) ?? []) {
      visit(dependency);
    }
    path.pop();
    onPath.delete(field.key);
    done.add(field.key);
    order.push(field.key);
  };

  for (const field of fields) {
    visit(field);
  }

  return cycle === undefined ? { order } : cycle;
}

/**
 * Compiles a definition into everything the product needs to run it.
 *
 * The definition is cloned before anything touches it, so the frozen snapshot on
 * the result is independent of the draft the caller passed in; a builder can go
 * on editing its draft without mutating a form somebody already published.
 */
export function compileDefinition(
  definition: FormDefinition,
  options: CompileOptions = {}
): Result<CompiledForm, FormCompileError[]> {
  const source = structuredClone(definition);
  const errors: FormCompileError[] = [];
  const fields = flatten(source, errors);

  const byKey = new Map<string, CompiledField>();
  for (const field of fields) {
    byKey.set(field.key, field);
  }
  checkConditions(fields, byKey, errors);

  if (errors.length > 0) {
    return err(errors);
  }

  const sorted = topologicalOrder(fields, byKey);
  if ('cycle' in sorted) {
    return err([
      {
        code: 'conditionCycle',
        fieldKey: sorted.fieldKey,
        cycle: sorted.cycle,
        message: `Conditions form a cycle: ${sorted.cycle.join(' -> ')}.`,
      },
    ]);
  }

  const conditions = fields.flatMap((field) => field.conditions);
  const renderTree = buildRenderTree(source, fields, conditions);
  const printLayout = buildPrintLayout(source, fields);
  const questionnaireResult = buildQuestionnaire(source, fields, options);
  const promotionManifest = buildPromotionManifest(source.key, source.version, fields);

  freezeDeep(source);
  freezeDeep(fields);
  freezeDeep(renderTree);
  freezeDeep(printLayout);
  freezeDeep(questionnaireResult.questionnaire);
  freezeDeep(questionnaireResult.gaps);
  freezeDeep(promotionManifest);
  freezeDeep(sorted.order);

  // Shallow, never deep: the zod schema builds parts of itself lazily on first
  // parse, so freezing its internals would break the first submission.
  return ok(
    Object.freeze({
      key: source.key,
      version: source.version,
      definition: source,
      fields,
      conditions,
      evaluationOrder: sorted.order,
      schema: buildValuesSchema(fields),
      renderTree,
      printLayout,
      questionnaire: questionnaireResult.questionnaire,
      questionnaireGaps: questionnaireResult.gaps,
      promotionManifest,
    })
  );
}
