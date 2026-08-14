import {
  compareExpansionOrder,
  compareSearchOrder,
  displayContains,
  displayStartsWith,
} from './ordering.js';
import type {
  TerminologyConcept,
  ValidationVerdict,
  ValidateRequest,
  ValueSetExpansion,
} from './service.js';
import { conceptInValueSet, conceptMatchesRule } from './value-set.js';
import type { ValueSetDefinition } from './value-set.js';

/**
 * The part of the contract that does not care where concepts came from.
 *
 * Both implementations differ only in how they FETCH concepts: one filters an
 * array, the other issues queries. Everything after the fetch, deciding what a
 * verdict says, applying exclusions, ranking a search, cutting a page, is
 * identical, so it lives here and is written once. That is what makes the
 * shared contract suite a real test of both implementations rather than two
 * suites that happen to have the same name: a divergence in the interesting
 * logic is impossible, because there is only one copy of it.
 */

/** What an implementation has to establish before a verdict can be built. */
export interface VerdictInput {
  readonly request: ValidateRequest;
  /** The resolved concept, or null when the code does not exist in the system. */
  readonly concept: TerminologyConcept | null;
  /** Whether the system has any codes loaded at all. Only consulted when `concept` is null. */
  readonly systemKnown: boolean;
  /** The definition named by `request.valueSet`, or null when the request named none. */
  readonly valueSet: ValueSetDefinition | null;
}

/**
 * Turns a resolution into the structured verdict `validate` returns.
 *
 * The order of the checks is the order a clinician would want to be told about
 * them: a deployment that never loaded the system is a different conversation
 * from a typo, which is a different conversation from a code that was retired
 * last April, which is different again from a perfectly good code that is not
 * on this particular form. Reporting only the first failure keeps the message
 * to one sentence.
 *
 * A retired code is accepted when either the caller asked for historical
 * tolerance or the value set itself is built to describe historical data, since
 * in both cases somebody has already decided that retired members belong.
 */
export function buildVerdict(input: VerdictInput): ValidationVerdict {
  const { request, concept, systemKnown, valueSet } = input;

  if (concept === null) {
    if (!systemKnown) {
      return {
        valid: false,
        reason: 'system_not_known',
        message: `Code system ${request.system} is not loaded in this deployment.`,
        concept: null,
      };
    }
    return {
      valid: false,
      reason: 'code_not_found',
      message: `${request.code} is not a code in ${request.system}.`,
      concept: null,
    };
  }

  const retiredAccepted = request.allowInactive === true || valueSet?.includeRetired === true;
  if (!concept.isActive && !retiredAccepted) {
    return {
      valid: false,
      reason: 'code_inactive',
      message: `${concept.code} (${concept.display}) has been retired in ${concept.system}.`,
      concept,
    };
  }

  if (valueSet !== null && !conceptInValueSet(concept, valueSet)) {
    return {
      valid: false,
      reason: 'not_in_value_set',
      message: `${concept.code} (${concept.display}) is not a member of ${valueSet.url}.`,
      concept,
    };
  }

  return { valid: true, concept };
}

/**
 * Applies exclusions, the display filter, the sort key and the page cut to an
 * already-materialized include set.
 *
 * `members` must already be de-duplicated and status-filtered: this function
 * cannot tell a genuine duplicate from two releases of the same code, and the
 * two implementations remove duplicates at different points (the array
 * implementation never creates any, the store implementation merges one query
 * per include rule).
 *
 * `total` counts the members that survived exclusion and filtering, not the
 * page, so a picker can say "showing 20 of 340" without a second call.
 */
export function assembleExpansion(
  definition: ValueSetDefinition,
  members: readonly TerminologyConcept[],
  page: { readonly filter?: string; readonly offset: number; readonly limit: number }
): ValueSetExpansion {
  const excludes = definition.exclude ?? [];
  const filter = page.filter;
  const matched = members.filter((concept) => {
    if (excludes.some((rule) => conceptMatchesRule(concept, rule))) {
      return false;
    }
    return filter === undefined || displayContains(concept.display, filter);
  });
  matched.sort(compareExpansionOrder);

  return {
    valueSet: definition.url,
    total: matched.length,
    offset: page.offset,
    concepts: matched.slice(page.offset, page.offset + page.limit),
  };
}

/**
 * Ranks search candidates: prefix matches first, then substring matches, each
 * bucket in {@link compareSearchOrder}.
 *
 * Applied by both implementations to the rows they fetched, so the presentation
 * order is decided by this package rather than by a database collation. It is
 * cheap: it only ever sees one page of candidates.
 */
export function rankSearchResults(
  candidates: readonly TerminologyConcept[],
  query: string,
  limit: number
): readonly TerminologyConcept[] {
  const prefix: TerminologyConcept[] = [];
  const rest: TerminologyConcept[] = [];
  for (const concept of candidates) {
    if (displayStartsWith(concept.display, query)) {
      prefix.push(concept);
    } else {
      rest.push(concept);
    }
  }
  prefix.sort(compareSearchOrder);
  rest.sort(compareSearchOrder);
  return [...prefix, ...rest].slice(0, limit);
}
