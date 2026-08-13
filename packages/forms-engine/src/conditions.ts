import type { CompiledField, CompiledForm, FieldState, FieldStateMap } from './compiled.js';
import type { ConditionNode, ConditionScalar, FormValues } from './definition.js';

/**
 * The condition interpreter: pure, total, and single pass.
 *
 * There is no expression language here and there never will be. A form is
 * authored by an administrator and executed in a patient's browser, so anything
 * a definition could express, a definition could be made to express by whoever
 * can reach the form builder. A closed grammar of ten operators and three
 * combinators means the worst outcome of a hostile definition is a form that
 * shows the wrong question.
 *
 * Four guarantees hold, and each of them is a test:
 *
 *   1. Deterministic order. State is computed once per field, walking
 *      `compiled.evaluationOrder`, which is a topological sort of the condition
 *      graph produced at compile time. A condition therefore never reads a
 *      field whose own state has not settled, and the result does not depend on
 *      the order the author happened to list the fields in.
 *   2. Hidden fields read as unanswered. When field B tests field A's answer and
 *      A is itself hidden, B sees nothing rather than seeing A's retained
 *      answer. Otherwise closing a branch of the form would leave the questions
 *      further down it stuck open on the strength of an answer the respondent
 *      can no longer see. This is the reason ordering is load-bearing rather
 *      than a nicety.
 *   3. Hidden implies not required. A hidden field is never required, whatever
 *      its `require` rules say, so a respondent can never be blocked by a
 *      question that is not on the screen.
 *   4. Cycles cannot reach this function. They are rejected at compile time, so
 *      evaluation is a bounded walk over a list and cannot hang.
 *
 * Hidden answers are retained in the stored document, not cleared. Clearing
 * them would destroy data on a mis-click: a patient who ticks "currently
 * pregnant", fills in three follow-up questions, then unticks it, would lose
 * those answers permanently rather than getting them back when they re-tick.
 * The cost of retaining is that a stored document can hold answers nobody can
 * currently see, so validation and promotion both ignore hidden answers, which
 * is exactly where the harm would otherwise be: an unreachable answer must
 * never block a submission, and must never reach a flowsheet.
 */

/**
 * The three shapes that mean "no answer": absent, null, and empty. An empty
 * multi-select list is unanswered for the same reason an empty string is, and
 * treating it as answered would let a respondent satisfy a required question by
 * opening and closing a picker.
 */
export function isBlank(value: unknown): boolean {
  if (value === null || value === undefined || value === '') {
    return true;
  }
  return Array.isArray(value) && value.length === 0;
}

/**
 * Reduces an answer to the scalar a condition compares against. A coded answer
 * compares by its `code`, because that is the part an author reasons about when
 * they write "show this when the diagnosis is E11.9".
 */
function comparable(answer: unknown): unknown {
  if (answer !== null && typeof answer === 'object' && !Array.isArray(answer)) {
    const record = answer as Record<string, unknown>;
    return typeof record.code === 'string' ? record.code : answer;
  }
  return answer;
}

/** Equality, with list answers testing membership. See {@link ConditionLeaf}. */
function answerMatches(answer: unknown, value: ConditionScalar): boolean {
  const target = comparable(answer);
  if (Array.isArray(target)) {
    return target.some((entry) => comparable(entry) === value);
  }
  return target === value;
}

/**
 * Three-way comparison, or `undefined` when the pair is not orderable. Numbers
 * compare numerically and strings lexicographically, which is chronological for
 * ISO-8601. A mixed pair has no defined order, so the test is simply false
 * rather than coerced into one.
 */
function compareOrder(answer: unknown, value: number | string): number | undefined {
  const left = comparable(answer);
  if (typeof left === 'number' && typeof value === 'number') {
    return left - value;
  }
  if (typeof left === 'string' && typeof value === 'string') {
    return left < value ? -1 : left > value ? 1 : 0;
  }
  return undefined;
}

/** Reads an answer for a referenced field key, already filtered for visibility. */
type AnswerResolver = (fieldKey: string) => unknown;

/** Evaluates one condition tree. Terminates by structural induction on the tree. */
function evaluateNode(node: ConditionNode, resolve: AnswerResolver): boolean {
  switch (node.kind) {
    case 'all':
      return node.of.every((child) => evaluateNode(child, resolve));
    case 'any':
      return node.of.some((child) => evaluateNode(child, resolve));
    case 'not':
      return !evaluateNode(node.of, resolve);
    case 'compare': {
      const matched = answerMatches(resolve(node.field), node.value);
      return node.operator === 'equals' ? matched : !matched;
    }
    case 'membership': {
      const answer = resolve(node.field);
      const matched = node.values.some((candidate) => answerMatches(answer, candidate));
      return node.operator === 'in' ? matched : !matched;
    }
    case 'ordering': {
      const order = compareOrder(resolve(node.field), node.value);
      if (order === undefined || Number.isNaN(order)) {
        return false;
      }
      switch (node.operator) {
        case 'greaterThan':
          return order > 0;
        case 'greaterThanOrEqual':
          return order >= 0;
        case 'lessThan':
          return order < 0;
        default:
          return order <= 0;
      }
    }
    case 'presence': {
      const empty = isBlank(resolve(node.field));
      return node.operator === 'isEmpty' ? empty : !empty;
    }
  }
}

const HIDDEN_STATE: FieldState = { visible: false, required: false };

/** Applies one field's rules. See {@link FormConditionRule} for the resolution order. */
function computeFieldState(field: CompiledField, resolve: AnswerResolver): FieldState {
  let visible = true;
  let required = field.required;
  for (const rule of field.conditions) {
    const met = evaluateNode(rule.when, resolve);
    switch (rule.effect) {
      case 'show':
        visible = visible && met;
        break;
      case 'hide':
        visible = visible && !met;
        break;
      case 'require':
        required = met || required;
        break;
      case 'optional':
        required = required && !met;
        break;
    }
  }
  return { visible, required: visible && required };
}

/**
 * How many repetitions a group currently has: the longest of its children's
 * answer arrays. Derived rather than stored, so there is no second source of
 * truth to fall out of step with the answers themselves. An empty repetition is
 * an explicit `null` at that index; see {@link FormValues}.
 */
function repeatCounts(compiled: CompiledForm, values: FormValues): Map<string, number> {
  const counts = new Map<string, number>();
  for (const field of compiled.fields) {
    if (field.type === 'repeatingGroup') {
      counts.set(field.key, 0);
    }
  }
  for (const field of compiled.fields) {
    const groupKey = field.groupKey;
    const answers = values[field.key];
    if (groupKey === undefined || !Array.isArray(answers)) {
      continue;
    }
    counts.set(groupKey, Math.max(counts.get(groupKey) ?? 0, answers.length));
  }
  return counts;
}

/**
 * Resolves every field's visibility and requirement for one set of answers.
 *
 * Pure: same compiled form and same answers, same result, no clock and no
 * database. That is what lets the same function decide what the browser draws
 * and what the server accepts, with no risk of the two disagreeing.
 */
export function evaluateConditions(compiled: CompiledForm, values: FormValues): FieldStateMap {
  const byKey = new Map<string, CompiledField>();
  for (const field of compiled.fields) {
    byKey.set(field.key, field);
  }
  const ordered = compiled.evaluationOrder
    .map((key) => byKey.get(key))
    .filter((field): field is CompiledField => field !== undefined);

  const counts = repeatCounts(compiled, values);
  const fields: Record<string, FieldState> = {};
  const repeats: Record<string, FieldState[]> = {};

  const topLevelAnswer: AnswerResolver = (key) => {
    const state = fields[key];
    return state !== undefined && state.visible ? values[key] : undefined;
  };

  for (const field of ordered) {
    const groupKey = field.groupKey;
    if (groupKey === undefined) {
      fields[field.key] = computeFieldState(field, topLevelAnswer);
      continue;
    }

    const groupState = fields[groupKey] ?? HIDDEN_STATE;
    const count = counts.get(groupKey) ?? 0;
    const states: FieldState[] = [];
    for (let index = 0; index < count; index += 1) {
      // A condition inside a repetition reads that same repetition's answers for
      // sibling fields, and top-level answers for everything else. It can never
      // read another repetition: rows of a medication list are independent, and
      // a rule that could reach across them would make row order meaningful.
      const resolve: AnswerResolver = (key) => {
        const referenced = byKey.get(key);
        if (referenced === undefined || referenced.groupKey !== groupKey) {
          return topLevelAnswer(key);
        }
        const siblingState = (repeats[key] ?? [])[index];
        const answers = values[key];
        return siblingState !== undefined && siblingState.visible && Array.isArray(answers)
          ? answers[index]
          : undefined;
      };
      const state = computeFieldState(field, resolve);
      states.push(groupState.visible ? state : HIDDEN_STATE);
    }
    repeats[field.key] = states;
  }

  return { fields, repeats };
}

/**
 * Reads one entry out of a {@link FieldStateMap} without the caller needing to
 * know which of the two maps a field lives in. Renderers ask this question on
 * every field of every row, and getting it wrong shows a patient a question the
 * form meant to hide.
 */
export function fieldStateFor(
  states: FieldStateMap,
  fieldKey: string,
  repeatIndex?: number
): FieldState | undefined {
  if (repeatIndex === undefined) {
    return states.fields[fieldKey];
  }
  return (states.repeats[fieldKey] ?? [])[repeatIndex];
}

/** Every field key a condition tree reads, deduplicated, in first-seen order. */
export function conditionDependencies(node: ConditionNode): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const walk = (current: ConditionNode): void => {
    switch (current.kind) {
      case 'all':
      case 'any':
        current.of.forEach(walk);
        return;
      case 'not':
        walk(current.of);
        return;
      default:
        if (!seen.has(current.field)) {
          seen.add(current.field);
          found.push(current.field);
        }
    }
  };
  walk(node);
  return found;
}

/** Every `all`/`any` node in a tree that has no children, which is never intentional. */
export function hasEmptyCombinator(node: ConditionNode): boolean {
  switch (node.kind) {
    case 'all':
    case 'any':
      return node.of.length === 0 || node.of.some(hasEmptyCombinator);
    case 'not':
      return hasEmptyCombinator(node.of);
    default:
      return false;
  }
}
