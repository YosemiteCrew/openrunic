import { operationOutcome, searchsetBundle, type Bundle, type FhirResource } from '@openrunic/fhir';

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
 * the R4 spec requires and what a client's pager needs. A row that matched and
 * could not be projected still counts towards it: it matched. The difference
 * between `total` and the entries returned is what the `outcome` entry below
 * exists to explain, and leaving it unexplained is the failure this file's
 * `withheld` handling exists to prevent.
 */

export interface BundleContext {
  /** Absolute base of the FHIR endpoint, e.g. `https://example.org/fhir`. */
  baseUrl: string;
  resourceType: string;
  /** The original query, so `self` reproduces the request exactly. */
  query: Record<string, string>;
}

export function buildSearchsetBundle<TRow, TResource extends FhirResource>(
  page: Page<TRow> & { readonly withheld?: readonly string[] },
  toResource: (row: TRow) => TResource,
  context: BundleContext
): Bundle {
  const offset = (page.page - 1) * page.pageSize;
  const nextOffset = offset + page.pageSize;
  const previousOffset = offset - page.pageSize;

  /*
   * One outcome entry, one issue per row that was left out.
   *
   * One entry rather than one per row, because they are all the same statement
   * about this search; `warning` rather than `error`, because the search
   * succeeded and this is what it could not include; and `incomplete`, which is
   * R4's own code for exactly this.
   *
   * A search with nothing withheld passes no `outcomes` at all, so the bundle
   * it emits is byte-identical to the one it emitted before this existed. Every
   * searchset this server produces goes through here, so that is the property
   * worth asserting.
   */
  const withheld = page.withheld ?? [];

  return searchsetBundle(page.rows.map(toResource), {
    total: page.total,
    ...(withheld.length === 0
      ? {}
      : {
          outcomes: [
            operationOutcome(
              withheld.map((diagnostics) => ({
                severity: 'warning' as const,
                code: 'incomplete' as const,
                diagnostics,
              }))
            ),
          ],
        }),
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
