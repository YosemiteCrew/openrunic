import { err, ok } from '@openrunic/types';
import type { Result } from '@openrunic/types';

import type { CompiledField, CompiledForm } from './compiled.js';
import { evaluateConditions, isBlank } from './conditions.js';
import type { FormField, FormValues } from './definition.js';
import type { FormPromotionError } from './errors.js';

/**
 * Promotion: projecting selected answers out of the one JSONB document into
 * indexed, typed rows.
 *
 * The manifest emitted here is consumed verbatim by `@openrunic/database`'s
 * `promoteSubmission`, which turns it into `FormPromotedValue` rows. The two
 * shapes are identical on purpose, and the seam between them is drawn exactly
 * once:
 *
 *   - This package owns what gets promoted and what the typed value is. It is
 *     the only place that knows the definition, the conditions and the field
 *     types, so it is the only place that can answer either question.
 *   - The database package owns row identity: `id`, `tenantId`,
 *     `formSubmissionId`, `formDefinitionId`, `patientId` and `effectiveAt`.
 *     Those are facts about a write, not about a form, and inventing them here
 *     would mean this package had opinions about transactions.
 *
 * One asymmetry is deliberate and matters. `promoteSubmission` is intentionally
 * dumb: it promotes whatever the document contains, because a projection that
 * re-ran the condition interpreter inside a database write would be a second
 * implementation of it. {@link promote} is not dumb, because it can see the
 * conditions, and it drops answers to hidden fields. The two therefore agree
 * only when the caller feeds the database the `promotableValues` projection
 * that {@link validateResponse} returns, which is the documented write path. A
 * caller that skips validation and writes raw answers gets a flowsheet with
 * values from branches the respondent closed, which is precisely the bug this
 * arrangement exists to make hard.
 */

/** The promotable subset of the catalogue, matching the database package exactly. */
export const PROMOTED_FIELD_TYPES = [
  'text',
  'number',
  'date',
  'boolean',
  'code',
  'quantity',
] as const;

export type PromotedFieldType = (typeof PROMOTED_FIELD_TYPES)[number];

/** One manifest entry. Structurally identical to the database package's type. */
export interface PromotedFieldSpec {
  readonly fieldKey: string;
  readonly type: PromotedFieldType;
  /** Coded fields carry their system so the stored code stays resolvable. */
  readonly codeSystem?: string;
  /** Fallback unit for quantity fields whose answer omits one. */
  readonly unit?: string;
  /** True when one answer produces several rows: a group child, or a multi-select. */
  readonly repeating?: boolean;
}

/** Lands in `FormDefinition.promotionManifest` at publish time. */
export interface PromotionManifest {
  readonly definitionKey: string;
  readonly definitionVersion: number;
  readonly fields: readonly PromotedFieldSpec[];
}

/**
 * One projected value: the field it came from, which repetition it came from,
 * and exactly one populated typed slot. Row identity is added by the database
 * package; see the seam described above.
 */
export interface PromotedValue {
  readonly fieldKey: string;
  readonly repeatIndex: number;
  readonly valueText: string | null;
  readonly valueNumber: number | null;
  readonly valueDate: Date | null;
  readonly valueBoolean: boolean | null;
  readonly valueCode: string | null;
  readonly valueCodeSystem: string | null;
  readonly valueQuantity: number | null;
  readonly valueUnit: string | null;
}

const EMPTY_VALUE = {
  valueText: null,
  valueNumber: null,
  valueDate: null,
  valueBoolean: null,
  valueCode: null,
  valueCodeSystem: null,
  valueQuantity: null,
  valueUnit: null,
} as const;

/**
 * Which typed column a field's answers land in, or `undefined` when the type
 * has no sensible indexed projection.
 *
 * Signatures and file references are unpromotable because the answer is a
 * storage handle: indexing it would let somebody graph an opaque key, which
 * answers no clinical question. A number becomes a quantity exactly when the
 * field declares a unit, so a flowsheet axis is labelled from the definition
 * rather than guessed from the data.
 */
export function promotedFieldTypeFor(field: FormField): PromotedFieldType | undefined {
  switch (field.type) {
    case 'shortText':
    case 'longText':
    case 'singleSelect':
    case 'multiSelect':
      return 'text';
    case 'number':
      return field.unit === undefined ? 'number' : 'quantity';
    case 'scale':
      return 'number';
    case 'date':
    case 'datetime':
      return 'date';
    case 'boolean':
      return 'boolean';
    case 'codedValue':
      return 'code';
    default:
      return undefined;
  }
}

/** True when an author asked for this field to be indexed. */
export function isPromoted(field: FormField): boolean {
  if (field.type === 'sectionHeader' || field.type === 'staticText') {
    return false;
  }
  if (field.type === 'repeatingGroup') {
    return false;
  }
  const flags = field.promote;
  if (flags === undefined) {
    return false;
  }
  return flags.graphable === true || flags.searchable === true || flags.reportable === true;
}

function specFor(field: CompiledField, type: PromotedFieldType): PromotedFieldSpec {
  const source = field.field;
  const repeating = field.groupKey !== undefined || source.type === 'multiSelect';
  const spec: {
    fieldKey: string;
    type: PromotedFieldType;
    codeSystem?: string;
    unit?: string;
    repeating?: boolean;
  } = { fieldKey: field.key, type };
  if (source.type === 'codedValue') {
    spec.codeSystem = source.system;
  }
  if (source.type === 'number' && source.unit !== undefined) {
    spec.unit = source.unit;
  }
  if (repeating) {
    spec.repeating = true;
  }
  return spec;
}

/**
 * Emits the manifest from already-flattened fields. Manifest order is definition
 * order, which is what keeps inserted rows and test snapshots stable across
 * compiles.
 */
export function buildPromotionManifest(
  definitionKey: string,
  definitionVersion: number,
  fields: readonly CompiledField[]
): PromotionManifest {
  const specs: PromotedFieldSpec[] = [];
  for (const field of fields) {
    const type = promotedFieldTypeFor(field.field);
    if (!isPromoted(field.field) || type === undefined) {
      continue;
    }
    specs.push(specFor(field, type));
  }
  return { definitionKey, definitionVersion, fields: specs };
}

/**
 * The manifest for a compiled form, which is exactly what
 * `@openrunic/database` reads. Already present on {@link CompiledForm}; exported
 * separately because the write path names it explicitly, and a caller reading
 * `toPromotionManifest(compiled)` at the call site does not have to know that
 * the compiler cached it.
 */
export function toPromotionManifest(compiled: CompiledForm): PromotionManifest {
  return buildPromotionManifest(compiled.key, compiled.version, compiled.fields);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

type TypedSlots = Omit<PromotedValue, 'fieldKey' | 'repeatIndex'>;

function typedValue(
  spec: PromotedFieldSpec,
  value: unknown
): { readonly slots: TypedSlots } | { readonly reason: string } {
  switch (spec.type) {
    case 'text':
      return typeof value === 'string'
        ? { slots: { ...EMPTY_VALUE, valueText: value } }
        : { reason: `expected a string, received ${typeof value}` };
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
        ? { slots: { ...EMPTY_VALUE, valueNumber: value } }
        : { reason: `expected a finite number, received ${typeof value}` };
    case 'boolean':
      return typeof value === 'boolean'
        ? { slots: { ...EMPTY_VALUE, valueBoolean: value } }
        : { reason: `expected a boolean, received ${typeof value}` };
    case 'date': {
      const date = typeof value === 'string' ? new Date(value) : value;
      return date instanceof Date && !Number.isNaN(date.getTime())
        ? { slots: { ...EMPTY_VALUE, valueDate: date } }
        : { reason: 'expected a Date or an ISO date string' };
    }
    case 'code': {
      if (typeof value === 'string') {
        return {
          slots: { ...EMPTY_VALUE, valueCode: value, valueCodeSystem: spec.codeSystem ?? null },
        };
      }
      if (isRecord(value) && typeof value.code === 'string') {
        const system = typeof value.system === 'string' ? value.system : spec.codeSystem;
        return {
          slots: { ...EMPTY_VALUE, valueCode: value.code, valueCodeSystem: system ?? null },
        };
      }
      return { reason: 'expected a code or a { code, system }' };
    }
    case 'quantity': {
      if (typeof value === 'number' && Number.isFinite(value)) {
        return {
          slots: { ...EMPTY_VALUE, valueQuantity: value, valueUnit: spec.unit ?? null },
        };
      }
      if (isRecord(value) && typeof value.value === 'number' && Number.isFinite(value.value)) {
        const unit = typeof value.unit === 'string' ? value.unit : spec.unit;
        return {
          slots: { ...EMPTY_VALUE, valueQuantity: value.value, valueUnit: unit ?? null },
        };
      }
      return { reason: 'expected a number or a { value, unit }' };
    }
  }
}

/**
 * Projects a validated document into its promoted values.
 *
 * Pure and total: same compiled form and same answers, same rows, no clock and
 * no database. Rows come back in manifest order and then repetition order.
 *
 * Blank answers produce no row at all, so "not answered" and "answered blank"
 * stay distinguishable and the promoted table stays sparse. An answer that is
 * present but the wrong shape is an error rather than a skip, because a silently
 * dropped value reads downstream as "not measured".
 */
export function promote(
  compiled: CompiledForm,
  values: FormValues
): Result<PromotedValue[], FormPromotionError[]> {
  const states = evaluateConditions(compiled, values);
  const manifest = compiled.promotionManifest;
  const byKey = new Map<string, CompiledField>();
  for (const field of compiled.fields) {
    byKey.set(field.key, field);
  }

  const rows: PromotedValue[] = [];
  const errors: FormPromotionError[] = [];

  for (const spec of manifest.fields) {
    const field = byKey.get(spec.fieldKey);
    const groupKey = field === undefined ? undefined : field.groupKey;
    const answer = values[spec.fieldKey];
    if (isBlank(answer)) {
      continue;
    }
    if (spec.repeating !== true && Array.isArray(answer)) {
      errors.push({
        code: 'unexpectedList',
        fieldKey: spec.fieldKey,
        message: 'Received a list for a field the manifest does not mark as repeating.',
      });
      continue;
    }

    const answers = spec.repeating === true && Array.isArray(answer) ? answer : [answer];
    answers.forEach((entry, repeatIndex) => {
      if (isBlank(entry)) {
        return;
      }
      // A hidden answer is retained in the document but never promoted; see the
      // note on evaluateConditions for why it is kept rather than cleared.
      const state =
        groupKey === undefined
          ? states.fields[spec.fieldKey]
          : (states.repeats[spec.fieldKey] ?? [])[repeatIndex];
      if (state !== undefined && !state.visible) {
        return;
      }
      const typed = typedValue(spec, entry);
      if ('reason' in typed) {
        errors.push({
          code: 'unpromotableValue',
          fieldKey: spec.fieldKey,
          repeatIndex,
          message: typed.reason,
        });
        return;
      }
      rows.push({ fieldKey: spec.fieldKey, repeatIndex, ...typed.slots });
    });
  }

  return errors.length > 0 ? err(errors) : ok(rows);
}
