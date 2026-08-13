import {
  COMMON_SEARCH_PARAMS,
  SEARCH_SUPPORT,
  type Interaction,
  type SearchParamDefinition,
  type SupportedResourceType,
} from '@openrunic/fhir';

import { MAX_PAGE_SIZE } from '../schemas/pagination.js';

/**
 * The FHIR conformance registry.
 *
 * `packages/fhir` owns the *catalogue*: which search parameters exist for each
 * US Core resource, what type each is and what it means. This file owns the
 * *inventory*: which of them this server has actually implemented. Splitting it
 * that way is what lets the CapabilityStatement be generated rather than
 * written, and what lets `fhir.test.ts` assert the two agree - a parameter
 * named here that the router does not serve fails the build, and a parameter
 * the router serves that is not named here is invisible to clients and equally
 * a bug.
 *
 * ADR-0002's rule is that `/metadata` can never drift from reality. The way to
 * guarantee that is to give the endpoint and the implementation one source.
 */

/** Result-set control parameters, accepted on every search. */
export const CONTROL_SEARCH_PARAMS: readonly SearchParamDefinition[] = [
  {
    name: '_count',
    type: 'number',
    documentation: `Page size, 1 to ${MAX_PAGE_SIZE}.`,
    mustSupport: false,
  },
  {
    name: '_offset',
    type: 'number',
    documentation: 'Zero-based offset into the result set. Must be a multiple of `_count`.',
    mustSupport: false,
  },
];

/** One resource type this server serves, and the parameters it implements. */
export interface ServedResource {
  readonly type: SupportedResourceType;
  readonly interactions: readonly Interaction[];
  /**
   * Search parameter names, each of which must exist in the package's catalogue
   * for this resource type. `_id` comes from the shared list; everything else
   * is resource-specific.
   */
  readonly params: readonly string[];
}

/** Looks up a parameter's definition, whichever list it lives in. */
export function searchParamDefinition(
  resourceType: SupportedResourceType,
  name: string
): SearchParamDefinition | undefined {
  return (
    SEARCH_SUPPORT[resourceType].searchParams.find((param) => param.name === name) ??
    COMMON_SEARCH_PARAMS.find((param) => param.name === name) ??
    CONTROL_SEARCH_PARAMS.find((param) => param.name === name)
  );
}

/** Every parameter name accepted for a resource, control parameters included. */
export function acceptedSearchParams(
  served: readonly ServedResource[],
  resourceType: string
): ReadonlySet<string> {
  const resource = served.find((candidate) => candidate.type === resourceType);
  return new Set([
    ...(resource?.params ?? []),
    ...CONTROL_SEARCH_PARAMS.map((param) => param.name),
  ]);
}

/** The US Core profile a resource is served against, when one applies. */
export function profileOf(resourceType: SupportedResourceType): string | undefined {
  return SEARCH_SUPPORT[resourceType].profile;
}
