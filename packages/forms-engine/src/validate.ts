import { err, ok } from '@openrunic/types';
import type { Result } from '@openrunic/types';

import type { CompiledField, CompiledForm, FieldStateMap } from './compiled.js';
import { evaluateConditions, fieldStateFor, isBlank } from './conditions.js';
import type { FormValues } from './definition.js';
import type { FormValidationError } from './errors.js';

/**
 * Validation in two stages, in this order and for this reason.
 *
 * Stage one is the compiled zod schema, which settles everything that depends
 * only on the definition: types, bounds, option membership, date formats,
 * unrecognized keys. Stage two is the conditional pass, which settles what
 * depends on the other answers: which fields are actually on the page, and
 * which of those actually demand an answer.
 *
 * The two stages are not independent, and the join between them is the point.
 * A schema violation on a field that conditions have hidden is discarded, not
 * reported. A respondent must never be blocked by a question they cannot see,
 * and a retained answer from a branch they closed is exactly such a question:
 * it stays in the document so that re-opening the branch gives the answers back,
 * and it is ignored everywhere acting on it would do harm. This is the second
 * such place; promotion is the first.
 */

/** A document that passed both stages, with the state that decided it. */
export interface ValidatedResponse {
  /** The document exactly as submitted, hidden answers retained. */
  readonly values: FormValues;
  /**
   * The same document with hidden answers removed, which is what the write path
   * hands to `@openrunic/database` for promotion. The database's promotion
   * executor cannot see conditions by design, so this projection is where the
   * condition rules are applied on the way to the indexed table.
   */
  readonly promotableValues: FormValues;
  readonly fieldStates: FieldStateMap;
}

function repeatCountOf(compiled: CompiledForm, groupKey: string, values: FormValues): number {
  let count = 0;
  for (const field of compiled.fields) {
    if (field.groupKey !== groupKey) {
      continue;
    }
    const answers = values[field.key];
    if (Array.isArray(answers)) {
      count = Math.max(count, answers.length);
    }
  }
  return count;
}

function collectSchemaErrors(
  compiled: CompiledForm,
  values: FormValues,
  states: FieldStateMap,
  byKey: ReadonlyMap<string, CompiledField>,
  errors: FormValidationError[]
): void {
  const parsed = compiled.schema.safeParse(values);
  if (parsed.success) {
    return;
  }
  for (const issue of parsed.error.issues) {
    // An unrecognized key at the root is a field the definition version does
    // not declare. One nested inside an answer, which only a coded answer can
    // be, is a malformed answer to a field that does exist, so it falls through
    // to the ordinary mapping below and lands on that field.
    if (issue.code === 'unrecognized_keys' && issue.path.length === 0) {
      for (const key of issue.keys) {
        errors.push({
          code: 'unknownField',
          fieldKey: key,
          message: 'The document answers a field this definition version does not declare.',
        });
      }
      continue;
    }
    const [head, second] = issue.path;
    const fieldKey = typeof head === 'string' ? head : '';
    const field = byKey.get(fieldKey);
    const inGroup = field !== undefined && field.groupKey !== undefined;
    const repeatIndex = inGroup && typeof second === 'number' ? second : undefined;
    const state = fieldStateFor(states, fieldKey, repeatIndex);
    if (state !== undefined && !state.visible) {
      continue;
    }
    // A key the schema demands and the document omits is reported once, by the
    // requirement pass, which is the stage that can say whether the field was
    // on the page at all. Reporting it twice would put two messages on one
    // empty box.
    if (repeatIndex === undefined && values[fieldKey] === undefined) {
      continue;
    }
    errors.push({
      code: 'schemaViolation',
      fieldKey,
      ...(repeatIndex === undefined ? {} : { repeatIndex }),
      message: issue.message,
    });
  }
}

function collectRequirementErrors(
  compiled: CompiledForm,
  values: FormValues,
  states: FieldStateMap,
  errors: FormValidationError[]
): void {
  for (const field of compiled.fields) {
    if (!field.answerable) {
      continue;
    }
    if (field.groupKey === undefined) {
      const state = states.fields[field.key];
      if (state !== undefined && state.required && isBlank(values[field.key])) {
        errors.push({
          code: 'requiredMissing',
          fieldKey: field.key,
          message: 'This field is required and has no answer.',
        });
      }
      continue;
    }
    const answers = values[field.key];
    (states.repeats[field.key] ?? []).forEach((state, repeatIndex) => {
      const answer = Array.isArray(answers) ? answers[repeatIndex] : undefined;
      if (state.required && isBlank(answer)) {
        errors.push({
          code: 'requiredMissing',
          fieldKey: field.key,
          repeatIndex,
          message: 'This field is required in this repetition and has no answer.',
        });
      }
    });
  }
}

function collectRepeatCountErrors(
  compiled: CompiledForm,
  values: FormValues,
  states: FieldStateMap,
  errors: FormValidationError[]
): void {
  for (const field of compiled.fields) {
    const source = field.field;
    if (source.type !== 'repeatingGroup') {
      continue;
    }
    const state = states.fields[field.key];
    if (state !== undefined && !state.visible) {
      continue;
    }
    const count = repeatCountOf(compiled, field.key, values);
    const min = source.minRepeats ?? 0;
    if (count < min) {
      errors.push({
        code: 'repeatCountOutOfRange',
        fieldKey: field.key,
        message: `This group needs at least ${min} entries and has ${count}.`,
      });
    }
    if (source.maxRepeats !== undefined && count > source.maxRepeats) {
      errors.push({
        code: 'repeatCountOutOfRange',
        fieldKey: field.key,
        message: `This group allows at most ${source.maxRepeats} entries and has ${count}.`,
      });
    }
  }
}

function projectPromotable(
  compiled: CompiledForm,
  values: FormValues,
  states: FieldStateMap
): FormValues {
  const promotable: Record<string, unknown> = {};
  for (const field of compiled.fields) {
    if (!field.answerable) {
      continue;
    }
    if (field.groupKey === undefined) {
      const state = states.fields[field.key];
      const answer = values[field.key];
      if (answer !== undefined && state !== undefined && state.visible) {
        promotable[field.key] = answer;
      }
      continue;
    }
    const answers = values[field.key];
    if (!Array.isArray(answers)) {
      continue;
    }
    const rowStates = states.repeats[field.key] ?? [];
    promotable[field.key] = answers.map((entry, index) => {
      const state = rowStates[index];
      return state !== undefined && state.visible ? entry : null;
    });
  }
  return promotable;
}

/**
 * Validates one submission against its compiled definition.
 *
 * Pure and total: no clock, no database, no network, so the browser and the
 * server can run it on the same inputs and get the same answer. Every error is
 * collected, never thrown, because the caller is a form a person is filling in
 * and reporting one problem at a time is how a five-minute intake becomes a
 * twenty-minute one.
 */
export function validateResponse(
  compiled: CompiledForm,
  values: FormValues
): Result<ValidatedResponse, FormValidationError[]> {
  const byKey = new Map<string, CompiledField>();
  for (const field of compiled.fields) {
    byKey.set(field.key, field);
  }

  const states = evaluateConditions(compiled, values);
  const errors: FormValidationError[] = [];
  collectSchemaErrors(compiled, values, states, byKey, errors);
  collectRequirementErrors(compiled, values, states, errors);
  collectRepeatCountErrors(compiled, values, states, errors);

  if (errors.length > 0) {
    return err(errors);
  }

  return ok({
    values,
    promotableValues: projectPromotable(compiled, values, states),
    fieldStates: states,
  });
}
