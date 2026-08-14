import { uuidv7 } from './uuid.js';

/**
 * The form engine's promotion step: projecting selected answers out of a
 * FormSubmission's JSONB `values` document into indexed FormPromotedValue rows.
 *
 * This is the mechanism that lets an admin add a graphable field to a form
 * without a migration, while keeping every query a single indexed scan. It is
 * deliberately NOT entity-attribute-value: the submission itself stays one row
 * with one JSON document, and promotion is a derived, rebuildable projection of
 * the subset of fields somebody actually wants to search, graph or report on.
 *
 * The rule, in full:
 *
 *   1. A field is promoted if and only if the published definition's promotion
 *      manifest lists it. Authors opt in per field by marking it graphable,
 *      searchable or reportable; nothing is promoted implicitly.
 *   2. Promotion runs on write, in the same transaction as the submission
 *      upsert. Rows for a submission are replaced wholesale on every save, so a
 *      re-save can never leave a stale value behind. Because the projection is
 *      pure, it can also be rebuilt from scratch at any time.
 *   3. Exactly one row per (submission, fieldKey, repeatIndex). A field inside a
 *      repeating group produces one row per repetition, indexed from 0.
 *   4. Exactly one typed value column is populated, chosen by the field's
 *      declared type. Quantity fields also populate `valueUnit`; coded fields
 *      also populate `valueCodeSystem`.
 *   5. Null, undefined and empty-string answers produce no row at all, so
 *      "unanswered" and "answered blank" stay distinguishable and the table
 *      stays sparse.
 *   6. `effectiveAt` is copied from the submission, so graphing a promoted field
 *      over time is one index scan and never an EAV join tree.
 *
 * A value that is present but the wrong shape is an error, never a silent
 * skip: a number field that received a string means the compiled zod validator
 * and the manifest disagree, and quietly dropping the value would put a hole in
 * a clinical flowsheet.
 */

/** The promotable subset of the form engine's field-type catalogue. */
export const PROMOTED_FIELD_TYPES = [
  'text',
  'number',
  'date',
  'boolean',
  'code',
  'quantity',
] as const;

export type PromotedFieldType = (typeof PROMOTED_FIELD_TYPES)[number];

export interface PromotedFieldSpec {
  /** Field key within the definition, unique per definition. */
  fieldKey: string;
  type: PromotedFieldType;
  /** Coded fields carry their system so the stored code stays resolvable. */
  codeSystem?: string;
  /** Fallback unit for quantity fields whose answer omits one. */
  unit?: string;
  /** True when the field sits inside a repeating group. */
  repeating?: boolean;
}

/** Emitted by the form compiler at publish time into `FormDefinition.promotionManifest`. */
export interface PromotionManifest {
  definitionKey: string;
  definitionVersion: number;
  fields: readonly PromotedFieldSpec[];
}

/** The parts of a FormSubmission that promotion reads. */
export interface PromotableSubmission {
  id: string;
  tenantId: string;
  formDefinitionId: string;
  patientId: string;
  effectiveAt: Date;
  values: Readonly<Record<string, unknown>>;
}

/** One FormPromotedValue row, ready to hand to `createMany`. */
export interface PromotedValueRow {
  id: string;
  tenantId: string;
  formSubmissionId: string;
  formDefinitionId: string;
  patientId: string;
  definitionKey: string;
  definitionVersion: number;
  fieldKey: string;
  repeatIndex: number;
  valueText: string | null;
  valueNumber: number | null;
  valueDate: Date | null;
  valueBoolean: boolean | null;
  valueCode: string | null;
  valueCodeSystem: string | null;
  valueQuantity: number | null;
  valueUnit: string | null;
  effectiveAt: Date;
}

/** Raised when an answer is present but cannot be promoted as its declared type. */
export class FormPromotionError extends Error {
  constructor(
    readonly fieldKey: string,
    readonly repeatIndex: number,
    message: string
  ) {
    super(`promoteSubmission: ${fieldKey}[${repeatIndex}]: ${message}`);
    this.name = 'FormPromotionError';
  }
}

export interface PromoteOptions {
  /** Id source, injectable so seeds and tests are reproducible. */
  generateId?: () => string;
}

type TypedValue = Pick<
  PromotedValueRow,
  | 'valueText'
  | 'valueNumber'
  | 'valueDate'
  | 'valueBoolean'
  | 'valueCode'
  | 'valueCodeSystem'
  | 'valueQuantity'
  | 'valueUnit'
>;

const EMPTY_TYPED_VALUE: TypedValue = {
  valueText: null,
  valueNumber: null,
  valueDate: null,
  valueBoolean: null,
  valueCode: null,
  valueCodeSystem: null,
  valueQuantity: null,
  valueUnit: null,
};

/** True for the three shapes that mean "the patient did not answer". */
function isBlank(value: unknown): boolean {
  return value === null || value === undefined || value === '';
}

function asFiniteNumber(value: unknown, field: string, index: number, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new FormPromotionError(
      field,
      index,
      `expected a finite ${label}, received ${typeof value}`
    );
  }
  return value;
}

function asDate(value: unknown, field: string, index: number): Date {
  const date = value instanceof Date ? value : typeof value === 'string' ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) {
    throw new FormPromotionError(field, index, 'expected a Date or an ISO date string');
  }
  return date;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function typedValue(spec: PromotedFieldSpec, value: unknown, index: number): TypedValue {
  switch (spec.type) {
    case 'text': {
      if (typeof value !== 'string') {
        throw new FormPromotionError(
          spec.fieldKey,
          index,
          `expected a string, received ${typeof value}`
        );
      }
      return { ...EMPTY_TYPED_VALUE, valueText: value };
    }
    case 'number': {
      return {
        ...EMPTY_TYPED_VALUE,
        valueNumber: asFiniteNumber(value, spec.fieldKey, index, 'number'),
      };
    }
    case 'date': {
      return { ...EMPTY_TYPED_VALUE, valueDate: asDate(value, spec.fieldKey, index) };
    }
    case 'boolean': {
      if (typeof value !== 'boolean') {
        throw new FormPromotionError(
          spec.fieldKey,
          index,
          `expected a boolean, received ${typeof value}`
        );
      }
      return { ...EMPTY_TYPED_VALUE, valueBoolean: value };
    }
    case 'code': {
      // Accepts either a bare code, which inherits the field's bound system, or
      // a { code, system } pair from a value-set picker.
      if (typeof value === 'string') {
        return {
          ...EMPTY_TYPED_VALUE,
          valueCode: value,
          valueCodeSystem: spec.codeSystem ?? null,
        };
      }
      if (isRecord(value) && typeof value.code === 'string') {
        const system = value.system ?? spec.codeSystem ?? null;
        if (system !== null && typeof system !== 'string') {
          throw new FormPromotionError(spec.fieldKey, index, 'coded system must be a string');
        }
        return { ...EMPTY_TYPED_VALUE, valueCode: value.code, valueCodeSystem: system };
      }
      throw new FormPromotionError(spec.fieldKey, index, 'expected a code or a { code, system }');
    }
    case 'quantity': {
      if (typeof value === 'number') {
        return {
          ...EMPTY_TYPED_VALUE,
          valueQuantity: asFiniteNumber(value, spec.fieldKey, index, 'quantity'),
          valueUnit: spec.unit ?? null,
        };
      }
      if (isRecord(value)) {
        const unit = value.unit ?? spec.unit ?? null;
        if (unit !== null && typeof unit !== 'string') {
          throw new FormPromotionError(spec.fieldKey, index, 'quantity unit must be a string');
        }
        return {
          ...EMPTY_TYPED_VALUE,
          valueQuantity: asFiniteNumber(value.value, spec.fieldKey, index, 'quantity'),
          valueUnit: unit,
        };
      }
      throw new FormPromotionError(spec.fieldKey, index, 'expected a number or a { value, unit }');
    }
  }
}

/**
 * Projects a submission into its FormPromotedValue rows.
 *
 * Pure: same inputs, same rows, no clock and no database. Rows come back in
 * manifest order, then repetition order, which keeps `createMany` inserts and
 * test snapshots stable.
 */
export function promoteSubmission(
  manifest: PromotionManifest,
  submission: PromotableSubmission,
  options: PromoteOptions = {}
): PromotedValueRow[] {
  const generateId = options.generateId ?? uuidv7;
  const rows: PromotedValueRow[] = [];
  const seen = new Set<string>();

  for (const spec of manifest.fields) {
    if (seen.has(spec.fieldKey)) {
      throw new FormPromotionError(spec.fieldKey, 0, 'appears twice in the promotion manifest');
    }
    seen.add(spec.fieldKey);

    const answer = submission.values[spec.fieldKey];
    if (isBlank(answer)) continue;

    if (!spec.repeating && Array.isArray(answer)) {
      throw new FormPromotionError(
        spec.fieldKey,
        0,
        'received a list for a field the manifest does not mark as repeating'
      );
    }

    const answers = spec.repeating && Array.isArray(answer) ? answer : [answer];

    answers.forEach((entry, repeatIndex) => {
      if (isBlank(entry)) return;
      rows.push({
        id: generateId(),
        tenantId: submission.tenantId,
        formSubmissionId: submission.id,
        formDefinitionId: submission.formDefinitionId,
        patientId: submission.patientId,
        definitionKey: manifest.definitionKey,
        definitionVersion: manifest.definitionVersion,
        fieldKey: spec.fieldKey,
        repeatIndex,
        ...typedValue(spec, entry, repeatIndex),
        effectiveAt: submission.effectiveAt,
      });
    });
  }

  return rows;
}
