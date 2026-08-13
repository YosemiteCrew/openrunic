import { z } from 'zod';
import { err, ok } from '@openrunic/types';
import type { Result } from '@openrunic/types';

import type { TerminologyConcept } from './service.js';

/**
 * The value-set model: which codes a particular field will accept.
 *
 * A value set is DATA, never code. It is a small JSON document a deployment
 * stores next to its other configuration, and every implementation in this
 * package evaluates the same document the same way. That matters more here than
 * almost anywhere else in the product: "which diagnoses may this order form
 * take" is a clinical decision made by the practice, and a practice cannot
 * deploy a TypeScript function. Keeping the model declarative also means a
 * value set can be validated before it is saved, diffed between environments,
 * and, for `validate`, evaluated against a single concept without expanding
 * anything.
 *
 * Two rule shapes cover essentially every local value set worth writing:
 *
 *   * an explicit list of codes ("these nine visit types"), and
 *   * everything in a system, optionally narrowed to one parent ("every child
 *     of the ankle-injury heading").
 *
 * `parentCode` matches the publisher's parent link exactly, which is one level
 * of hierarchy and not a transitive descendant walk. That limit is deliberate:
 * a descendant walk needs a recursive query, the narrow store port in
 * `store.ts` deliberately does not expose one, and a value set built from a
 * recursive walk would silently change shape whenever a publisher reorganizes
 * its hierarchy. Deeper selections are written as more rules.
 *
 * Exclusions are the same rule shape applied in reverse, evaluated after the
 * includes. They never need a query of their own: exclusion is a predicate over
 * concepts that are already in hand.
 */

/**
 * One selection rule. Every field beyond `system` narrows the selection, so a
 * rule with only a system means "the whole system".
 */
export interface ValueSetRule {
  /** Canonical system URI the rule selects from. */
  readonly system: string;
  /** Explicit member codes. Omit to take the whole system, subject to the fields below. */
  readonly codes?: readonly string[];
  /** Take only the direct children of this code. */
  readonly parentCode?: string;
  /** Pin the rule to one loaded release. Omit to accept every release loaded for the system. */
  readonly version?: string;
}

/**
 * A named set of codes, identified by a canonical URL so that a form field, an
 * API request and an audit entry can all refer to the same set by one string.
 */
export interface ValueSetDefinition {
  /** Canonical identifier. This is the string callers pass to `expandValueSet` and `validate`. */
  readonly url: string;
  readonly name?: string;
  readonly description?: string;
  /** At least one rule. A concept is a candidate if any include rule selects it. */
  readonly include: readonly ValueSetRule[];
  /** Applied after the includes. A concept selected by any exclude rule is out, whatever the includes said. */
  readonly exclude?: readonly ValueSetRule[];
  /**
   * Admit retired codes. Off by default so a picker never offers one. Turn it
   * on for a set whose whole job is to describe historical data, such as a
   * reporting cohort that has to keep matching notes written years ago.
   */
  readonly includeRetired?: boolean;
}

const valueSetRuleSchema = z.strictObject({
  system: z.string().min(1),
  codes: z.array(z.string().min(1)).min(1).optional(),
  parentCode: z.string().min(1).optional(),
  version: z.string().optional(),
});

/**
 * Runtime shape of a {@link ValueSetDefinition}.
 *
 * Exported because definitions arrive as untrusted JSON from a settings screen
 * or a configuration file, and the type system cannot check those. Unknown keys
 * are rejected rather than ignored: a misspelled `parentcode` that silently
 * widened a value set to an entire code system would be discovered by a
 * clinician, not by an operator.
 */
export const valueSetDefinitionSchema = z.strictObject({
  url: z.string().min(1),
  name: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  include: z.array(valueSetRuleSchema).min(1),
  exclude: z.array(valueSetRuleSchema).optional(),
  includeRetired: z.boolean().optional(),
});

/** Why a candidate definition was rejected, with one entry per problem so a settings screen can list them all. */
export interface InvalidValueSetError {
  readonly kind: 'invalid_value_set';
  readonly message: string;
  readonly issues: readonly string[];
}

/**
 * Parses a definition that came from configuration.
 *
 * The service factories take already-typed definitions, so this is the gate a
 * caller puts in front of them when the definitions come from anywhere the
 * compiler cannot see. Returning a `Result` rather than throwing keeps a bad
 * tenant configuration a reportable condition instead of a crashed request.
 */
export function parseValueSetDefinition(
  input: unknown
): Result<ValueSetDefinition, InvalidValueSetError> {
  const parsed = valueSetDefinitionSchema.safeParse(input);
  if (parsed.success) {
    return ok(parsed.data);
  }
  const issues = parsed.error.issues.map((issue) => {
    const path = issue.path.map(String).join('.');
    return path === '' ? issue.message : `${path}: ${issue.message}`;
  });
  return err({
    kind: 'invalid_value_set',
    message: `Value set definition is not usable: ${issues.join('; ')}`,
    issues,
  });
}

/**
 * True when a rule selects a concept.
 *
 * Purely structural: status plays no part here. Whether a retired concept
 * belongs is a property of the definition (`includeRetired`) or of the request
 * (`allowInactive`), never of an individual rule, so that the same rule means
 * the same thing in an expansion and in a validation.
 */
export function conceptMatchesRule(concept: TerminologyConcept, rule: ValueSetRule): boolean {
  if (concept.system !== rule.system) {
    return false;
  }
  if (rule.version !== undefined && concept.version !== rule.version) {
    return false;
  }
  if (rule.codes !== undefined && !rule.codes.includes(concept.code)) {
    return false;
  }
  if (rule.parentCode !== undefined && concept.parentCode !== rule.parentCode) {
    return false;
  }
  return true;
}

/**
 * Membership as a predicate over one concept.
 *
 * This is why `validate` never expands anything: checking a single code against
 * a value set costs one pass over its rules, whatever the size of the systems
 * behind them. Status is not considered; the caller has already decided whether
 * a retired concept is acceptable.
 */
export function conceptInValueSet(
  concept: TerminologyConcept,
  definition: ValueSetDefinition
): boolean {
  if (!definition.include.some((rule) => conceptMatchesRule(concept, rule))) {
    return false;
  }
  return !(definition.exclude ?? []).some((rule) => conceptMatchesRule(concept, rule));
}
