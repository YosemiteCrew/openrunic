import type { ListResponse } from './types';

/**
 * The one pager.
 *
 * Page arithmetic lived in three copies (the core mock client, the billing
 * client, the admin client) and had already started to drift in its comments.
 * It is one function here because every list on every screen has to agree on
 * what "page 2 of a filtered set" means: the same clamping, the same 1-based
 * page, and the same answer for an empty result.
 */

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export function paginate<T>(
  rows: readonly T[],
  page = 1,
  pageSize = DEFAULT_PAGE_SIZE
): ListResponse<T> {
  const size = Math.min(Math.max(pageSize, 1), MAX_PAGE_SIZE);
  const current = Math.max(page, 1);
  const start = (current - 1) * size;
  return {
    data: rows.slice(start, start + size),
    page: {
      page: current,
      pageSize: size,
      total: rows.length,
      // A zero-result search or filter has one empty page, not zero: the pager
      // still renders, so the footer never disappears mid-search.
      totalPages: Math.max(1, Math.ceil(rows.length / size)),
    },
  };
}
