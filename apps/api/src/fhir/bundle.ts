import { searchsetBundle, type Bundle, type FhirResource } from '@openrunic/fhir';

import type { Page } from '../repositories/types.js';

/**
 * The `searchset` Bundle.
 *
 * Assembly belongs to `packages/fhir`; what belongs here is the one thing the
 * package cannot know, namely how this server's paging maps onto `self`,
 * `next` and `previous` URLs. So this file computes links and delegates the
 * rest.
 *
 * That split also fixes what the local copy got wrong: it emitted `entry: []`
 * for a search with no matches. FHIR JSON has no empty arrays - an empty result
 * is a bundle with `total: 0` and no `entry` element at all - and a strict
 * client is entitled to reject the array form. The package's `compact` drops
 * it, so an empty search is valid by construction rather than by remembering.
 *
 * `total` is the size of the whole result set, not of the page, which is what
 * the R4 spec requires and what a client's pager needs.
 */

export interface BundleContext {
  /** Absolute base of the FHIR endpoint, e.g. `https://example.org/fhir`. */
  baseUrl: string;
  resourceType: string;
  /** The original query, so `self` reproduces the request exactly. */
  query: Record<string, string>;
}

export function buildSearchsetBundle<TRow, TResource extends FhirResource>(
  page: Page<TRow>,
  toResource: (row: TRow) => TResource,
  context: BundleContext
): Bundle {
  const offset = (page.page - 1) * page.pageSize;
  const nextOffset = offset + page.pageSize;
  const previousOffset = offset - page.pageSize;

  return searchsetBundle(page.rows.map(toResource), {
    total: page.total,
    baseUrl: context.baseUrl,
    selfLink: searchUrl(context, offset, page.pageSize),
    ...(nextOffset < page.total ? { nextLink: searchUrl(context, nextOffset, page.pageSize) } : {}),
    ...(previousOffset >= 0
      ? { previousLink: searchUrl(context, previousOffset, page.pageSize) }
      : {}),
  });
}

function searchUrl(context: BundleContext, offset: number, count: number): string {
  const params = new URLSearchParams(context.query);
  params.set('_count', String(count));
  params.set('_offset', String(offset));
  // Sorted so the same search always produces the same link, which makes the
  // bundle comparable in a snapshot and cacheable by an intermediary.
  params.sort();
  return `${context.baseUrl}/${context.resourceType}?${params.toString()}`;
}
