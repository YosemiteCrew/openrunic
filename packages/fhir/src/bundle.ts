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
  mode: 'match' | 'include',
  baseUrl: string | undefined
): fhir4.BundleEntry<fhir4.FhirResource> {
  return compact<fhir4.BundleEntry<fhir4.FhirResource>>({
    fullUrl: fullUrl(resource, baseUrl),
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
 */
export function searchsetBundle(
  matches: readonly fhir4.FhirResource[],
  options: SearchsetOptions = {}
): fhir4.Bundle<fhir4.FhirResource> {
  const entries = [
    ...matches.map((resource) => entryFor(resource, 'match', options.baseUrl)),
    ...(options.includes ?? []).map((resource) => entryFor(resource, 'include', options.baseUrl)),
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
