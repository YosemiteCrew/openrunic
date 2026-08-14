import { err, ok } from '@openrunic/types';
import type { Result } from '@openrunic/types';

import { dropUndefined } from './canonical.js';
import type { CompileOptions, CompiledField, CompiledForm } from './compiled.js';
import type {
  ConditionNode,
  ConditionScalar,
  FieldType,
  FormDefinition,
  FormSubmissionStatus,
  FormValues,
} from './definition.js';
import type { FormValidationError } from './errors.js';

/**
 * The FHIR R4 Questionnaire / QuestionnaireResponse mapping.
 *
 * This is the seam that stops the form engine from being a private format. A
 * practice that leaves must be able to take its forms and its answers with it,
 * a certification harness has to be able to read both, and a referral has to be
 * able to arrive as a Questionnaire from a system that never heard of this one.
 *
 * The structural types are declared here rather than pulled from the FHIR
 * package on purpose. This package emits a handful of Questionnaire elements and
 * consumes a handful more; depending on the whole resource surface to describe
 * that would couple the compiler's release cycle to the FHIR package's, for no
 * type safety that these declarations do not already give. If the API boundary
 * needs the full resource, it maps this shape into it there.
 *
 * What the mapping cannot carry it says out loud, as {@link QuestionnaireGap}
 * entries. FHIR's `enableWhen` is a flat clause list joined by one behaviour, so
 * a nested boolean tree has no representation, and FHIR has no conditional
 * requirement at all. Emitting a Questionnaire that quietly behaves differently
 * from the form the patient filled in would be worse than emitting one that
 * admits the difference.
 */

/** Canonical base for emitted resources. Overridable for self-hosted deployments. */
export const DEFAULT_QUESTIONNAIRE_BASE_URL = 'https://openrunic.org/fhir';

/** UCUM, the code system every quantity unit in the catalogue is drawn from. */
export const UCUM_SYSTEM = 'http://unitsofmeasure.org';

export type QuestionnaireStatus = 'draft' | 'active' | 'retired' | 'unknown';

export type QuestionnaireItemType =
  | 'group'
  | 'display'
  | 'boolean'
  | 'decimal'
  | 'integer'
  | 'date'
  | 'dateTime'
  | 'string'
  | 'text'
  | 'choice'
  | 'attachment'
  | 'quantity';

export interface FhirCoding {
  readonly system?: string;
  readonly code?: string;
  readonly display?: string;
}

export interface FhirQuantity {
  readonly value?: number;
  readonly unit?: string;
  readonly system?: string;
  readonly code?: string;
}

export interface FhirAttachment {
  readonly url?: string;
  readonly title?: string;
}

export interface QuestionnaireAnswerOption {
  readonly valueString?: string;
  readonly valueCoding?: FhirCoding;
}

export type QuestionnaireEnableOperator = 'exists' | '=' | '!=' | '>' | '<' | '>=' | '<=';

export interface QuestionnaireEnableWhen {
  readonly question: string;
  readonly operator: QuestionnaireEnableOperator;
  readonly answerBoolean?: boolean;
  readonly answerDecimal?: number;
  readonly answerInteger?: number;
  readonly answerDate?: string;
  readonly answerDateTime?: string;
  readonly answerString?: string;
  readonly answerCoding?: FhirCoding;
}

export interface QuestionnaireItem {
  readonly linkId: string;
  readonly text?: string;
  readonly type: QuestionnaireItemType;
  readonly required?: boolean;
  readonly repeats?: boolean;
  readonly maxLength?: number;
  readonly answerOption?: readonly QuestionnaireAnswerOption[];
  readonly enableWhen?: readonly QuestionnaireEnableWhen[];
  readonly enableBehavior?: 'all' | 'any';
  readonly item?: readonly QuestionnaireItem[];
}

export interface Questionnaire {
  readonly resourceType: 'Questionnaire';
  readonly url: string;
  readonly version: string;
  readonly name: string;
  readonly title: string;
  readonly description?: string;
  readonly status: QuestionnaireStatus;
  readonly subjectType: readonly string[];
  readonly item: readonly QuestionnaireItem[];
}

export type QuestionnaireResponseStatus =
  'in-progress' | 'completed' | 'amended' | 'entered-in-error' | 'stopped';

export interface QuestionnaireResponseAnswer {
  readonly valueBoolean?: boolean;
  readonly valueDecimal?: number;
  readonly valueInteger?: number;
  readonly valueDate?: string;
  readonly valueDateTime?: string;
  readonly valueString?: string;
  readonly valueCoding?: FhirCoding;
  readonly valueQuantity?: FhirQuantity;
  readonly valueAttachment?: FhirAttachment;
}

export interface QuestionnaireResponseItem {
  readonly linkId: string;
  readonly text?: string;
  readonly answer?: readonly QuestionnaireResponseAnswer[];
  readonly item?: readonly QuestionnaireResponseItem[];
}

export interface QuestionnaireResponse {
  readonly resourceType: 'QuestionnaireResponse';
  /** Canonical reference with version, e.g. `.../Questionnaire/intake|3`. */
  readonly questionnaire: string;
  readonly status: QuestionnaireResponseStatus;
  readonly authored?: string;
  readonly subject?: { readonly reference: string };
  readonly item: readonly QuestionnaireResponseItem[];
}

/** Something the Questionnaire mapping could not express, named rather than dropped. */
export type QuestionnaireGap =
  | {
      readonly kind: 'conditionNotRepresentable';
      readonly fieldKey: string;
      readonly reason: string;
    }
  | {
      readonly kind: 'conditionalRequirement';
      readonly fieldKey: string;
      readonly reason: string;
    };

/** The parts of a FormSubmission that the QuestionnaireResponse mapping reads. */
export interface FormSubmissionView {
  readonly values: FormValues;
  readonly status?: FormSubmissionStatus;
  /** ISO-8601 instant the submission was authored. */
  readonly authored?: string;
  /** Reference to the subject, e.g. `Patient/0f2a...`. */
  readonly subjectReference?: string;
}

// ---------------------------------------------------------------------------
// Questionnaire
// ---------------------------------------------------------------------------

function itemTypeFor(type: FieldType, hasUnit: boolean): QuestionnaireItemType {
  switch (type) {
    case 'shortText':
      return 'string';
    case 'longText':
      return 'text';
    case 'number':
      return hasUnit ? 'quantity' : 'decimal';
    case 'date':
      return 'date';
    case 'datetime':
      return 'dateTime';
    case 'singleSelect':
    case 'multiSelect':
    case 'codedValue':
      return 'choice';
    case 'boolean':
      return 'boolean';
    case 'scale':
      return 'integer';
    case 'signature':
    case 'fileReference':
      return 'attachment';
    case 'repeatingGroup':
      return 'group';
    default:
      return 'display';
  }
}

function answerOptionsFor(field: CompiledField): readonly QuestionnaireAnswerOption[] | undefined {
  const source = field.field;
  if (source.type === 'singleSelect' || source.type === 'multiSelect') {
    return source.options.map((option) => ({ valueString: option.value }));
  }
  if (source.type === 'codedValue' && source.options !== undefined) {
    return source.options.map((option) => ({
      valueCoding: { system: source.system, code: option.value, display: option.label },
    }));
  }
  return undefined;
}

/** One `enableWhen` clause before the answer type has been resolved. */
interface EnableLeaf {
  readonly field: string;
  readonly operator: QuestionnaireEnableOperator;
  readonly value: ConditionScalar;
}

interface EnableClause {
  readonly mode: 'all' | 'any';
  readonly leaves: readonly EnableLeaf[];
}

type OrderingOperator = 'greaterThan' | 'greaterThanOrEqual' | 'lessThan' | 'lessThanOrEqual';

const NEGATED_ORDERING: Record<OrderingOperator, QuestionnaireEnableOperator> = {
  greaterThan: '<=',
  greaterThanOrEqual: '<',
  lessThan: '>=',
  lessThanOrEqual: '>',
};

const ORDERING: Record<OrderingOperator, QuestionnaireEnableOperator> = {
  greaterThan: '>',
  greaterThanOrEqual: '>=',
  lessThan: '<',
  lessThanOrEqual: '<=',
};

/**
 * Flattens a condition tree into a single FHIR clause list, or `undefined` when
 * it does not fit. Negation is pushed down to the leaves rather than wrapped,
 * because FHIR has no `not`: every leaf operator has an inverse, so a `hide`
 * rule becomes a `show` clause list over inverted operators.
 */
function flattenClause(node: ConditionNode, negate: boolean): EnableClause | undefined {
  switch (node.kind) {
    case 'not':
      return flattenClause(node.of, !negate);
    case 'all':
      return combine(node.of, negate, negate ? 'any' : 'all');
    case 'any':
      return combine(node.of, negate, negate ? 'all' : 'any');
    case 'compare': {
      const equals = node.operator === 'equals' ? !negate : negate;
      return {
        mode: 'all',
        leaves: [{ field: node.field, operator: equals ? '=' : '!=', value: node.value }],
      };
    }
    case 'membership': {
      const isIn = node.operator === 'in' ? !negate : negate;
      const operator: QuestionnaireEnableOperator = isIn ? '=' : '!=';
      return {
        mode: isIn ? 'any' : 'all',
        leaves: node.values.map((value) => ({ field: node.field, operator, value })),
      };
    }
    case 'ordering': {
      const table = negate ? NEGATED_ORDERING : ORDERING;
      return {
        mode: 'all',
        leaves: [{ field: node.field, operator: table[node.operator], value: node.value }],
      };
    }
    case 'presence': {
      const exists = node.operator === 'isNotEmpty' ? !negate : negate;
      return { mode: 'all', leaves: [{ field: node.field, operator: 'exists', value: exists }] };
    }
  }
}

/**
 * Merges child clauses under one behaviour. A child that is itself a multi-leaf
 * clause of the other behaviour cannot be merged, because FHIR carries exactly
 * one `enableBehavior` per item and there is nowhere to put the inner one.
 */
function combine(
  children: readonly ConditionNode[],
  negate: boolean,
  mode: 'all' | 'any'
): EnableClause | undefined {
  const leaves: EnableLeaf[] = [];
  for (const child of children) {
    const clause = flattenClause(child, negate);
    if (clause === undefined) {
      return undefined;
    }
    if (clause.mode !== mode && clause.leaves.length > 1) {
      return undefined;
    }
    leaves.push(...clause.leaves);
  }
  return { mode, leaves };
}

function answerPayload(
  referenced: CompiledField | undefined,
  value: ConditionScalar
): Partial<QuestionnaireEnableWhen> {
  if (typeof value === 'boolean') {
    return { answerBoolean: value };
  }
  const source = referenced === undefined ? undefined : referenced.field;
  if (typeof value === 'number') {
    return source !== undefined && source.type === 'scale'
      ? { answerInteger: value }
      : { answerDecimal: value };
  }
  if (source === undefined) {
    return { answerString: value };
  }
  switch (source.type) {
    case 'date':
      return { answerDate: value };
    case 'datetime':
      return { answerDateTime: value };
    case 'codedValue':
      return { answerCoding: { system: source.system, code: value } };
    default:
      return { answerString: value };
  }
}

interface EnableResult {
  readonly enableWhen?: readonly QuestionnaireEnableWhen[];
  readonly enableBehavior?: 'all' | 'any';
  readonly gaps: readonly QuestionnaireGap[];
}

function deriveEnableWhen(
  field: CompiledField,
  byKey: ReadonlyMap<string, CompiledField>
): EnableResult {
  const gaps: QuestionnaireGap[] = [];
  const clauses: EnableClause[] = [];
  let representable = true;

  for (const rule of field.conditions) {
    if (rule.effect === 'require' || rule.effect === 'optional') {
      gaps.push({
        kind: 'conditionalRequirement',
        fieldKey: field.key,
        reason: 'FHIR Questionnaire has no representation for a conditionally required item.',
      });
      continue;
    }
    const clause = flattenClause(rule.when, rule.effect === 'hide');
    if (clause === undefined) {
      representable = false;
      continue;
    }
    clauses.push(clause);
  }

  const disjunctions = clauses.filter(
    (clause) => clause.mode === 'any' && clause.leaves.length > 1
  );
  const mergeable = disjunctions.length === 0 || clauses.length === 1;
  if (!representable || !mergeable) {
    gaps.push({
      kind: 'conditionNotRepresentable',
      fieldKey: field.key,
      reason:
        'The condition is a nested or mixed boolean tree; FHIR enableWhen carries one flat clause list.',
    });
    return { gaps };
  }

  const leaves = clauses.flatMap((clause) => clause.leaves);
  if (leaves.length === 0) {
    return { gaps };
  }
  const enableWhen = leaves.map((leaf) =>
    dropUndefined<QuestionnaireEnableWhen>({
      question: leaf.field,
      operator: leaf.operator,
      ...answerPayload(byKey.get(leaf.field), leaf.value),
    })
  );
  return {
    enableWhen,
    enableBehavior: leaves.length > 1 ? (disjunctions.length > 0 ? 'any' : 'all') : undefined,
    gaps,
  };
}

function questionnaireItem(
  field: CompiledField,
  children: readonly QuestionnaireItem[] | undefined,
  byKey: ReadonlyMap<string, CompiledField>,
  gaps: QuestionnaireGap[]
): QuestionnaireItem {
  const source = field.field;
  const enable = deriveEnableWhen(field, byKey);
  gaps.push(...enable.gaps);
  const hasUnit = source.type === 'number' && source.unit !== undefined;
  const maxLength =
    source.type === 'shortText' || source.type === 'longText' ? source.maxLength : undefined;
  return dropUndefined<QuestionnaireItem>({
    linkId: field.key,
    text: field.label,
    type: itemTypeFor(field.type, hasUnit),
    required: field.answerable ? field.required : undefined,
    repeats: source.type === 'multiSelect' || source.type === 'repeatingGroup' ? true : undefined,
    maxLength,
    answerOption: answerOptionsFor(field),
    enableWhen: enable.enableWhen,
    enableBehavior: enable.enableBehavior,
    item: children,
  });
}

/** Compiles the definition into a Questionnaire plus the list of what was lost. */
export function buildQuestionnaire(
  definition: FormDefinition,
  fields: readonly CompiledField[],
  options: CompileOptions
): { readonly questionnaire: Questionnaire; readonly gaps: readonly QuestionnaireGap[] } {
  const byKey = new Map<string, CompiledField>();
  for (const field of fields) {
    byKey.set(field.key, field);
  }

  const gaps: QuestionnaireGap[] = [];
  const items: QuestionnaireItem[] = [];
  for (const field of fields) {
    if (field.groupKey !== undefined) {
      continue;
    }
    const children =
      field.field.type === 'repeatingGroup'
        ? fields
            .filter((child) => child.groupKey === field.key)
            .map((child) => questionnaireItem(child, undefined, byKey, gaps))
        : undefined;
    items.push(questionnaireItem(field, children, byKey, gaps));
  }

  const baseUrl = options.baseUrl ?? DEFAULT_QUESTIONNAIRE_BASE_URL;
  const questionnaire = dropUndefined<Questionnaire>({
    resourceType: 'Questionnaire',
    url: `${baseUrl}/Questionnaire/${definition.key}`,
    version: String(definition.version),
    name: definition.key,
    title: definition.title,
    description: definition.description,
    status: options.status ?? 'active',
    subjectType: ['Patient'],
    item: items,
  });

  return { questionnaire, gaps };
}

// ---------------------------------------------------------------------------
// QuestionnaireResponse
// ---------------------------------------------------------------------------

const RESPONSE_STATUS: Readonly<Record<FormSubmissionStatus, QuestionnaireResponseStatus>> = {
  IN_PROGRESS: 'in-progress',
  COMPLETED: 'completed',
  // A signed submission is complete; the signature itself travels as a
  // Provenance resource, not as a QuestionnaireResponse status.
  SIGNED: 'completed',
  AMENDED: 'amended',
  ENTERED_IN_ERROR: 'entered-in-error',
};

function encodeAnswer(
  field: CompiledField,
  value: unknown
): QuestionnaireResponseAnswer | undefined {
  const source = field.field;
  switch (source.type) {
    case 'shortText':
    case 'longText':
    case 'singleSelect':
    case 'multiSelect':
      return typeof value === 'string' ? { valueString: value } : undefined;
    case 'number':
      if (typeof value !== 'number') {
        return undefined;
      }
      return source.unit === undefined
        ? { valueDecimal: value }
        : {
            valueQuantity: {
              value,
              unit: source.unit,
              system: UCUM_SYSTEM,
              code: source.unit,
            },
          };
    case 'date':
      return typeof value === 'string' ? { valueDate: value } : undefined;
    case 'datetime':
      return typeof value === 'string' ? { valueDateTime: value } : undefined;
    case 'boolean':
      return typeof value === 'boolean' ? { valueBoolean: value } : undefined;
    case 'scale':
      return typeof value === 'number' ? { valueInteger: value } : undefined;
    case 'signature':
    case 'fileReference':
      return typeof value === 'string' ? { valueAttachment: { url: value } } : undefined;
    case 'codedValue': {
      if (value === null || typeof value !== 'object') {
        return undefined;
      }
      const record = value as Record<string, unknown>;
      if (typeof record.code !== 'string') {
        return undefined;
      }
      const system = typeof record.system === 'string' ? record.system : source.system;
      const display = typeof record.display === 'string' ? record.display : undefined;
      return { valueCoding: dropUndefined<FhirCoding>({ system, code: record.code, display }) };
    }
    default:
      return undefined;
  }
}

function responseItem(field: CompiledField, value: unknown): QuestionnaireResponseItem | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (field.field.type === 'multiSelect') {
    if (!Array.isArray(value) || value.length === 0) {
      return undefined;
    }
    const answers = value
      .map((entry) => encodeAnswer(field, entry))
      .filter((answer): answer is QuestionnaireResponseAnswer => answer !== undefined);
    return answers.length === 0
      ? undefined
      : { linkId: field.key, text: field.label, answer: answers };
  }
  const answer = encodeAnswer(field, value);
  return answer === undefined
    ? undefined
    : { linkId: field.key, text: field.label, answer: [answer] };
}

/**
 * Exports a stored submission as a QuestionnaireResponse.
 *
 * Every present answer is exported, including answers to fields that conditions
 * currently hide. That is deliberate: this resource is a faithful copy of the
 * stored document, and the accompanying Questionnaire's `enableWhen` already
 * tells a consumer which items are enabled. Validation and promotion are the
 * two places hidden answers drop out, because those are the two places where
 * acting on an unreachable answer would do harm.
 *
 * Expects a document that has passed {@link validateResponse}. An answer whose
 * shape does not match its field is omitted rather than exported as a wrong
 * FHIR type, since a `valueString` in a `decimal` item is a resource no
 * conformant consumer can read.
 */
export function toQuestionnaireResponse(
  compiled: CompiledForm,
  submission: FormSubmissionView
): QuestionnaireResponse {
  const items: QuestionnaireResponseItem[] = [];
  for (const field of compiled.fields) {
    if (field.groupKey !== undefined) {
      continue;
    }
    if (field.field.type !== 'repeatingGroup') {
      const item = responseItem(field, submission.values[field.key]);
      if (item !== undefined) {
        items.push(item);
      }
      continue;
    }
    const children = compiled.fields.filter((child) => child.groupKey === field.key);
    let count = 0;
    for (const child of children) {
      const answers = submission.values[child.key];
      if (Array.isArray(answers)) {
        count = Math.max(count, answers.length);
      }
    }
    for (let index = 0; index < count; index += 1) {
      const nested: QuestionnaireResponseItem[] = [];
      for (const child of children) {
        const answers = submission.values[child.key];
        const item = responseItem(child, Array.isArray(answers) ? answers[index] : undefined);
        if (item !== undefined) {
          nested.push(item);
        }
      }
      items.push({ linkId: field.key, text: field.label, item: nested });
    }
  }

  const status = submission.status === undefined ? 'completed' : RESPONSE_STATUS[submission.status];
  return dropUndefined<QuestionnaireResponse>({
    resourceType: 'QuestionnaireResponse',
    questionnaire: `${compiled.questionnaire.url}|${compiled.questionnaire.version}`,
    status,
    authored: submission.authored,
    subject:
      submission.subjectReference === undefined
        ? undefined
        : { reference: submission.subjectReference },
    item: items,
  });
}

function decodeAnswer(
  field: CompiledField,
  answer: QuestionnaireResponseAnswer
): { readonly value: unknown } | undefined {
  const source = field.field;
  switch (source.type) {
    case 'shortText':
    case 'longText':
    case 'singleSelect':
    case 'multiSelect':
      return answer.valueString === undefined ? undefined : { value: answer.valueString };
    case 'number':
      if (source.unit === undefined) {
        return answer.valueDecimal === undefined ? undefined : { value: answer.valueDecimal };
      }
      return answer.valueQuantity?.value === undefined
        ? undefined
        : { value: answer.valueQuantity.value };
    case 'date':
      return answer.valueDate === undefined ? undefined : { value: answer.valueDate };
    case 'datetime':
      return answer.valueDateTime === undefined ? undefined : { value: answer.valueDateTime };
    case 'boolean':
      return answer.valueBoolean === undefined ? undefined : { value: answer.valueBoolean };
    case 'scale':
      return answer.valueInteger === undefined ? undefined : { value: answer.valueInteger };
    case 'signature':
    case 'fileReference':
      return answer.valueAttachment?.url === undefined
        ? undefined
        : { value: answer.valueAttachment.url };
    case 'codedValue': {
      const coding = answer.valueCoding;
      if (coding === undefined || coding.code === undefined) {
        return undefined;
      }
      return {
        value: dropUndefined({
          code: coding.code,
          system: coding.system ?? source.system,
          display: coding.display,
        }),
      };
    }
    default:
      return undefined;
  }
}

function decodeItem(
  field: CompiledField,
  item: QuestionnaireResponseItem,
  errors: FormValidationError[]
): { readonly value: unknown } | undefined {
  const answers = item.answer ?? [];
  if (answers.length === 0) {
    return undefined;
  }
  if (field.field.type === 'multiSelect') {
    const values: unknown[] = [];
    for (const answer of answers) {
      const decoded = decodeAnswer(field, answer);
      if (decoded === undefined) {
        errors.push({
          code: 'schemaViolation',
          fieldKey: field.key,
          message: 'Answer does not carry a value of the type this field expects.',
        });
        return undefined;
      }
      values.push(decoded.value);
    }
    return { value: values };
  }
  const first = answers[0];
  const decoded = first === undefined ? undefined : decodeAnswer(field, first);
  if (decoded === undefined) {
    errors.push({
      code: 'schemaViolation',
      fieldKey: field.key,
      message: 'Answer does not carry a value of the type this field expects.',
    });
  }
  return decoded;
}

/**
 * Reads a QuestionnaireResponse back into a submission document.
 *
 * The inverse of {@link toQuestionnaireResponse}, which is what makes the FHIR
 * surface a real import path rather than an export-only courtesy. Round trip is
 * exact for a normalized document; two normalizations apply, and both collapse
 * two encodings of the same fact into one:
 *
 *   1. A repeating child with no answer in any repetition is omitted, rather
 *      than stored as a list of nulls.
 *   2. A coded answer comes back carrying an explicit `system`, taken from the
 *      field's binding when the resource did not state one.
 *
 * A repetition is one group item in the response, in document order, so a child
 * that was skipped in one repetition comes back as an explicit `null` at that
 * index and the columnar layout stays aligned.
 */
export function fromQuestionnaireResponse(
  compiled: CompiledForm,
  response: QuestionnaireResponse
): Result<FormValues, FormValidationError[]> {
  const errors: FormValidationError[] = [];
  const expected = `${compiled.questionnaire.url}|${compiled.questionnaire.version}`;
  if (response.questionnaire !== expected) {
    return err([
      {
        code: 'questionnaireMismatch',
        message: `Response answers ${response.questionnaire}, expected ${expected}.`,
      },
    ]);
  }

  const byKey = new Map<string, CompiledField>();
  for (const field of compiled.fields) {
    byKey.set(field.key, field);
  }

  const values: Record<string, unknown> = {};
  const groupItems = new Map<string, QuestionnaireResponseItem[]>();

  for (const item of response.item) {
    const field = byKey.get(item.linkId);
    if (field === undefined) {
      errors.push({
        code: 'unknownField',
        fieldKey: item.linkId,
        message: 'The response answers an item this form does not declare.',
      });
      continue;
    }
    if (field.field.type === 'repeatingGroup') {
      const repetitions = groupItems.get(field.key) ?? [];
      repetitions.push(item);
      groupItems.set(field.key, repetitions);
      continue;
    }
    if (!field.answerable) {
      continue;
    }
    const decoded = decodeItem(field, item, errors);
    if (decoded !== undefined) {
      values[field.key] = decoded.value;
    }
  }

  for (const [groupKey, repetitions] of groupItems) {
    const children = compiled.fields.filter((child) => child.groupKey === groupKey);
    const columns = new Map<string, unknown[]>();
    for (const child of children) {
      columns.set(child.key, new Array<unknown>(repetitions.length).fill(null));
    }
    repetitions.forEach((repetition, index) => {
      for (const nested of repetition.item ?? []) {
        const child = byKey.get(nested.linkId);
        const column = columns.get(nested.linkId);
        if (child === undefined || column === undefined) {
          errors.push({
            code: 'unknownField',
            fieldKey: nested.linkId,
            message: `The response answers an item the group ${groupKey} does not declare.`,
          });
          continue;
        }
        const decoded = decodeItem(child, nested, errors);
        if (decoded !== undefined) {
          column[index] = decoded.value;
        }
      }
    });
    for (const [childKey, column] of columns) {
      if (column.some((entry) => entry !== null)) {
        values[childKey] = column;
      }
    }
  }

  return errors.length > 0 ? err(errors) : ok(values);
}
