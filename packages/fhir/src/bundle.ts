/// <reference types="fhir" preserve="true" />

import { compact, isPresentString, present } from './primitives.js';

/** Options for {@link searchsetBundle}. */
export interface SearchsetOptions {
  /**
   * Total matches across all pages. Defaults to the number of matches in this
   * bundle, which is correct only for an unpaged result, so a paged search
   * should always pass it.
   */
  total?: number;
  /** Server base, e.g. `https://example.org/fhir/R4`, used to build `fullUrl`. */
  baseUrl?: string;
  /** The search URL that produced this bundle. */
  selfLink?: string;
  nextLink?: string;
  previousLink?: string;
  /** Resources pulled in by `_include`; they are marked `include`, not `match`. */
  includes?: readonly fhir4.FhirResource[];
  /**
   * What the search matched and could not represent.
   *
   * A row the server cannot project is not a row it may quietly leave out. A
   * result one entry short, with nothing saying so, is indistinguishable from a
   * result that genuinely had one fewer - which is the same defect as a total
   * summed from part of its inputs, one level up.
   *
   * FHIR's answer is an entry whose `search.mode` is `outcome`, and these are
   * it: they carry no `fullUrl`, because a diagnostic is not retrievable at a
   * URL, and they do not count towards `total`, because a bundle whose total
   * included its own diagnostics would be a new wrong number.
   */
  outcomes?: readonly fhir4.OperationOutcome[];
  /** ISO 8601 instant the search was executed. */
  timestamp?: string;
  /** Bundle id, when the server assigns one. */
  id?: string;
}

function fullUrl(resource: fhir4.FhirResource, baseUrl: string | undefined): string | undefined {
  if (!isPresentString(baseUrl) || !isPresentString(resource.id)) {
    return undefined;
  }
  const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  return `${base}/${resource.resourceType}/${resource.id}`;
}

function entryFor(
  resource: fhir4.FhirResource,
  mode: 'match' | 'include' | 'outcome',
  baseUrl: string | undefined
): fhir4.BundleEntry<fhir4.FhirResource> {
  return compact<fhir4.BundleEntry<fhir4.FhirResource>>({
    // An outcome entry gets none, even if the resource were given an id. A
    // `fullUrl` says the entry is retrievable there, and a diagnostic about
    // this search is not a resource on this server.
    fullUrl: mode === 'outcome' ? undefined : fullUrl(resource, baseUrl),
    resource,
    search: { mode },
  });
}

function link(relation: string, url: string | undefined): fhir4.BundleLink | undefined {
  return isPresentString(url) ? { relation, url } : undefined;
}

/**
 * Builds a `searchset` bundle.
 *
 * `total` is always present, including when it is zero: an empty search result
 * is a bundle with a total of 0 and no `entry` array at all, because FHIR JSON
 * has no empty arrays.
 *
 * `total` counts matches only. Includes and outcomes are in the bundle and not
 * in the count, which is what a client's pager needs and what R4 means by the
 * number of resources matching the search.
 */
export function searchsetBundle(
  matches: readonly fhir4.FhirResource[],
  options: SearchsetOptions = {}
): fhir4.Bundle<fhir4.FhirResource> {
  const entries = [
    ...matches.map((resource) => entryFor(resource, 'match', options.baseUrl)),
    ...(options.includes ?? []).map((resource) => entryFor(resource, 'include', options.baseUrl)),
    // Last, so a client reading entries in order has the matches before the
    // note about what is missing from them.
    ...(options.outcomes ?? []).map((resource) => entryFor(resource, 'outcome', options.baseUrl)),
  ];

  return compact<fhir4.Bundle<fhir4.FhirResource>>({
    resourceType: 'Bundle',
    id: options.id,
    type: 'searchset',
    timestamp: options.timestamp,
    total: options.total ?? matches.length,
    link: present<fhir4.BundleLink>([
      link('self', options.selfLink),
      link('next', options.nextLink),
      link('previous', options.previousLink),
    ]),
    entry: entries,
  });
}

/** The HTTP verbs a transaction entry may carry. */
export type TransactionMethod = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** One entry in a transaction bundle. */
export interface TransactionEntry {
  method: TransactionMethod;
  /** Request URL relative to the server base, e.g. `Patient` or `Patient/123`. */
  url: string;
  resource?: fhir4.FhirResource;
  /** Client-assigned URL, normally a `urn:uuid:` for POST entries. */
  fullUrl?: string;
  /** Conditional create: `identifier=...`. */
  ifNoneExist?: string;
  /** Optimistic locking on update. */
  ifMatch?: string;
  ifNoneMatch?: string;
  ifModifiedSince?: string;
}

/**
 * Builds a `transaction` bundle. Transaction entries carry a `request`; only
 * write verbs carry a `resource`, and an entry without one omits the key
 * rather than sending `null`.
 */
export function transactionBundle(
  entries: readonly TransactionEntry[]
): fhir4.Bundle<fhir4.FhirResource> {
  return compact<fhir4.Bundle<fhir4.FhirResource>>({
    resourceType: 'Bundle',
    type: 'transaction',
    entry: entries.map((entry) =>
      compact<fhir4.BundleEntry<fhir4.FhirResource>>({
        fullUrl: entry.fullUrl,
        resource: entry.resource,
        request: compact<fhir4.BundleEntryRequest>({
          method: entry.method,
          url: entry.url,
          ifNoneExist: entry.ifNoneExist,
          ifMatch: entry.ifMatch,
          ifNoneMatch: entry.ifNoneMatch,
          ifModifiedSince: entry.ifModifiedSince,
        }),
      })
    ),
  });
}

/** Reads the resources of a bundle, optionally filtered by search mode. */
export function bundleResources(
  // `fhir4.Bundle<fhir4.FhirResource>` now defaults its entries to the `Resource` base rather than
  // the `FhirResource` union, so the parameter says which it wants. Reading a
  // resource out of a bundle is only useful once it can be discriminated on
  // `resourceType`, and that is what the union provides.
  bundle: fhir4.Bundle<fhir4.FhirResource>,
  mode?: 'match' | 'include'
): fhir4.FhirResource[] {
  return present(
    (bundle.entry ?? []).map((entry) => {
      if (mode !== undefined && entry.search?.mode !== mode) {
        return undefined;
      }
      return entry.resource;
    })
  );
}
