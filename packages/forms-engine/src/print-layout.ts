import { dropUndefined } from './canonical.js';
import type { CompiledField } from './compiled.js';
import type { FieldType, FormDefinition } from './definition.js';

/**
 * The print layout: an ordered block list for paper and PDF.
 *
 * A printed form is not a screenshot of the screen form, which is why this is a
 * separate artifact rather than a CSS media query. Three differences make it
 * so, and each one is a block type here:
 *
 *   1. Paper has pages. A consent whose signature line lands alone on page
 *      three is a consent somebody has to re-print, so page breaks are authored
 *      on the field and emitted as explicit blocks rather than left to a
 *      browser's widow handling.
 *   2. Paper has no inputs. A signature on paper is a ruled line and a date
 *      line, not a canvas; rendering an empty input box invites somebody to
 *      sign inside a border that will not print.
 *   3. Repeating groups print as a table with a fixed column per child field,
 *      because a stack of repeated label-value pairs is unreadable at three
 *      medications and unusable at ten.
 *
 * Like the render tree, this is plain JSON persisted in `FormDefinition.compiled`.
 */

/** A section heading. `level` mirrors the authored heading level. */
export interface PrintHeadingBlock {
  readonly blockType: 'heading';
  readonly key: string;
  readonly text: string;
  readonly level: number;
}

/** Instructions or a legal paragraph, printed as body copy. */
export interface PrintParagraphBlock {
  readonly blockType: 'paragraph';
  readonly key: string;
  readonly text: string;
}

/**
 * How wide a printed answer needs to be. `inline` puts label and value on one
 * line, `block` gives the answer its own lines, and `checkbox` prints a tick
 * box rather than the word "true".
 */
export type PrintValueStyle = 'inline' | 'block' | 'checkbox' | 'list';

/** A read-only slot where one answer is printed. */
export interface PrintValueSlotBlock {
  readonly blockType: 'valueSlot';
  readonly key: string;
  readonly label: string;
  readonly fieldType: FieldType;
  readonly valueStyle: PrintValueStyle;
  readonly unit?: string;
  readonly conditionIds: readonly string[];
}

/** A ruled signature line with a matching date line. Never an input. */
export interface PrintSignatureBlock {
  readonly blockType: 'signature';
  readonly key: string;
  readonly label: string;
  readonly signerRole?: string;
  readonly conditionIds: readonly string[];
}

/** One repeating group, printed as a table with a column per child field. */
export interface PrintRepeatTableBlock {
  readonly blockType: 'repeatTable';
  readonly key: string;
  readonly label: string;
  readonly columns: readonly PrintTableColumn[];
  /** Blank rows printed when the form goes out empty, for handwritten entry. */
  readonly blankRows: number;
  readonly conditionIds: readonly string[];
}

export interface PrintTableColumn {
  readonly key: string;
  readonly label: string;
  readonly fieldType: FieldType;
  readonly unit?: string;
}

/** An explicit page break, emitted from `layout.pageBreakBefore`. */
export interface PrintPageBreakBlock {
  readonly blockType: 'pageBreak';
  readonly key: string;
}

export type PrintBlock =
  | PrintHeadingBlock
  | PrintParagraphBlock
  | PrintValueSlotBlock
  | PrintSignatureBlock
  | PrintRepeatTableBlock
  | PrintPageBreakBlock;

export interface PrintLayout {
  readonly key: string;
  readonly version: number;
  readonly title: string;
  readonly description?: string;
  readonly blocks: readonly PrintBlock[];
}

/** Blank rows printed for an unfilled repeating group. */
const DEFAULT_BLANK_ROWS = 3;

function valueStyleFor(type: FieldType): PrintValueStyle {
  switch (type) {
    case 'boolean':
      return 'checkbox';
    case 'longText':
      return 'block';
    case 'multiSelect':
      return 'list';
    default:
      return 'inline';
  }
}

function unitFor(field: CompiledField): string | undefined {
  return field.field.type === 'number' ? field.field.unit : undefined;
}

function answerBlock(field: CompiledField): PrintBlock {
  const conditionIds = field.conditions.map((condition) => condition.id);
  if (field.field.type === 'signature') {
    return dropUndefined<PrintSignatureBlock>({
      blockType: 'signature',
      key: field.key,
      label: field.label,
      signerRole: field.field.signerRole,
      conditionIds,
    });
  }
  return dropUndefined<PrintValueSlotBlock>({
    blockType: 'valueSlot',
    key: field.key,
    label: field.label,
    fieldType: field.type,
    valueStyle: valueStyleFor(field.type),
    unit: unitFor(field),
    conditionIds,
  });
}

/** Builds the layout. Document order, one block per top-level field. */
export function buildPrintLayout(
  definition: FormDefinition,
  fields: readonly CompiledField[]
): PrintLayout {
  const blocks: PrintBlock[] = [];
  for (const field of fields) {
    if (field.groupKey !== undefined) {
      continue;
    }
    if (field.field.layout?.pageBreakBefore === true) {
      blocks.push({ blockType: 'pageBreak', key: `${field.key}#break` });
    }
    const source = field.field;
    switch (source.type) {
      case 'sectionHeader':
        blocks.push({
          blockType: 'heading',
          key: field.key,
          text: field.label,
          level: source.level ?? 2,
        });
        break;
      case 'staticText':
        blocks.push({ blockType: 'paragraph', key: field.key, text: source.text });
        break;
      case 'repeatingGroup':
        blocks.push({
          blockType: 'repeatTable',
          key: field.key,
          label: field.label,
          columns: fields
            .filter((child) => child.groupKey === field.key)
            .map((child) =>
              dropUndefined<PrintTableColumn>({
                key: child.key,
                label: child.label,
                fieldType: child.type,
                unit: unitFor(child),
              })
            ),
          blankRows: Math.max(source.minRepeats ?? 0, DEFAULT_BLANK_ROWS),
          conditionIds: field.conditions.map((condition) => condition.id),
        });
        break;
      default:
        blocks.push(answerBlock(field));
    }
  }

  return dropUndefined<PrintLayout>({
    key: definition.key,
    version: definition.version,
    title: definition.title,
    description: definition.description,
    blocks,
  });
}
