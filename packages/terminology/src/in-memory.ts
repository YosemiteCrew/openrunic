import { ok, err } from '@openrunic/types';
import type { Result } from '@openrunic/types';

import { assembleExpansion, buildVerdict, rankSearchResults } from './evaluation.js';
import { clampLimit, clampOffset, displayContains } from './ordering.js';
import {
  DEFAULT_EXPANSION_LIMIT,
  DEFAULT_MAX_EXPANSION_SIZE,
  DEFAULT_SEARCH_LIMIT,
  codeNotFound,
  expansionTooLarge,
  systemNotFound,
  valueSetNotFound,
} from './service.js';
import type {
  ExpandValueSetRequest,
  LookupRequest,
  SearchRequest,
  TerminologyConcept,
  TerminologyError,
  TerminologyService,
  ValidateRequest,
  ValidationVerdict,
  ValueSetExpansion,
} from './service.js';
import { conceptMatchesRule } from './value-set.js';
import type { ValueSetDefinition } from './value-set.js';

/**
 * The array-backed implementation: the one tests and development run against.
 *
 * It exists so that nothing outside this package needs a database to work with
 * coded data. A form-engine test that needs a bound value set, a mapper test
 * that needs a display, a local development server with a handful of demo codes
 * loaded: all of them take a `TerminologyService`, and this is the cheapest
 * thing that is one. Because it satisfies the same contract suite as the
 * store-backed implementation, a test written against it is a test of the real
 * behaviour and not of a convenient mock.
 *
 * Everything is held as a plain array and scanned. That is the right shape at
 * this size (a fixture is tens of codes, a development load is thousands) and
 * it keeps the implementation obviously correct, which is the whole point of a
 * reference implementation. Anything that needs indexes belongs in Postgres.
 */

/** Construction options, mirroring the ones the store-backed implementation accepts. */
export interface InMemoryTerminologyOptions {
  /** Members an expansion will materialize before refusing. Defaults to {@link DEFAULT_MAX_EXPANSION_SIZE}. */
  readonly maxExpansionSize?: number;
}

/**
 * Builds a service over a fixed set of concepts and value-set definitions.
 *
 * Definitions are passed in rather than read from the concepts because the
 * schema has no value-set table: a value set is configuration, and both
 * implementations take it the same way. Run definitions that came from
 * configuration through `parseValueSetDefinition` first.
 */
export function createInMemoryTerminologyService(
  codes: readonly TerminologyConcept[],
  valueSets: readonly ValueSetDefinition[] = [],
  options: InMemoryTerminologyOptions = {}
): TerminologyService {
  const concepts = [...codes];
  const systems = new Set(concepts.map((concept) => concept.system));
  const definitions = new Map(valueSets.map((definition) => [definition.url, definition]));
  const maxExpansionSize = options.maxExpansionSize ?? DEFAULT_MAX_EXPANSION_SIZE;

  /**
   * Resolves one code. With no version the newest loaded release wins, compared
   * as an opaque string: the column holds whatever label the publisher used and
   * this package refuses to guess whether that label is a semantic version, a
   * date or a serial number. Whether the winning row happens to be retired is
   * `validate`'s business, not `lookup`'s.
   */
  function resolve(system: string, code: string, version?: string): TerminologyConcept | null {
    let best: TerminologyConcept | null = null;
    for (const concept of concepts) {
      if (concept.system !== system || concept.code !== code) {
        continue;
      }
      if (version !== undefined && concept.version !== version) {
        continue;
      }
      if (best === null || concept.version > best.version) {
        best = concept;
      }
    }
    return best;
  }

  function lookup(request: LookupRequest): Promise<Result<TerminologyConcept, TerminologyError>> {
    const concept = resolve(request.system, request.code, request.version);
    if (concept !== null) {
      return Promise.resolve(ok(concept));
    }
    if (!systems.has(request.system)) {
      return Promise.resolve(err(systemNotFound(request.system)));
    }
    return Promise.resolve(
      err(codeNotFound(request.system, request.code, request.version ?? null))
    );
  }

  function validate(
    request: ValidateRequest
  ): Promise<Result<ValidationVerdict, TerminologyError>> {
    // The value set is checked before the code: an unconfigured value set is a
    // deployment fault, and reporting it as "that code is not a member" would
    // send an operator's problem to a clinician.
    let definition: ValueSetDefinition | null = null;
    if (request.valueSet !== undefined) {
      definition = definitions.get(request.valueSet) ?? null;
      if (definition === null) {
        return Promise.resolve(err(valueSetNotFound(request.valueSet)));
      }
    }
    const concept = resolve(request.system, request.code, request.version);
    return Promise.resolve(
      ok(
        buildVerdict({
          request,
          concept,
          systemKnown: systems.has(request.system),
          valueSet: definition,
        })
      )
    );
  }

  function expandValueSet(
    request: ExpandValueSetRequest
  ): Promise<Result<ValueSetExpansion, TerminologyError>> {
    const definition = definitions.get(request.valueSet);
    if (definition === undefined) {
      return Promise.resolve(err(valueSetNotFound(request.valueSet)));
    }

    const admitsRetired = definition.includeRetired === true;
    const members = concepts.filter((concept) => {
      if (!concept.isActive && !admitsRetired) {
        return false;
      }
      return definition.include.some((rule) => conceptMatchesRule(concept, rule));
    });
    if (members.length > maxExpansionSize) {
      return Promise.resolve(err(expansionTooLarge(definition.url, maxExpansionSize)));
    }

    return Promise.resolve(
      ok(
        assembleExpansion(definition, members, {
          filter: request.filter,
          offset: clampOffset(request.offset),
          limit: clampLimit(request.limit, DEFAULT_EXPANSION_LIMIT),
        })
      )
    );
  }

  function search(
    request: SearchRequest
  ): Promise<Result<readonly TerminologyConcept[], TerminologyError>> {
    const query = request.query.trim();
    // An empty box matches everything, which is never what a picker wants and
    // is exactly what a full scan looks like. Answer with nothing instead.
    if (query === '') {
      return Promise.resolve(ok([]));
    }
    const includeInactive = request.includeInactive === true;
    const candidates = concepts.filter((concept) => {
      if (request.system !== undefined && concept.system !== request.system) {
        return false;
      }
      if (!concept.isActive && !includeInactive) {
        return false;
      }
      return displayContains(concept.display, query);
    });
    return Promise.resolve(
      ok(rankSearchResults(candidates, query, clampLimit(request.limit, DEFAULT_SEARCH_LIMIT)))
    );
  }

  return { lookup, validate, expandValueSet, search };
}
