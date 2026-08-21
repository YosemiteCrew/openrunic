import { z } from 'zod';

import type { Page } from '../repositories/types.js';

/**
 * Offset pagination, one page at a time.
 *
 * Offsets rather than cursors because every list in the product is a screen
 * with a pager and a total: a schedule day, a claim worklist, a patient search.
 * A cursor cannot answer "43 results", and the tenant-prefixed composite
 * indexes make the offsets cheap at clinic scale. Exports and Bulk Data get
 * cursors when they land; they are a different access pattern, not this one.
 */

/** Hard ceiling on a page. Above this, callers should be exporting, not paging. */
export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 25;

export const paginationQueryFields = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
};

export const sortOrderField = z.enum(['asc', 'desc']).default('asc');

/** The pager block every list response carries. */
export const pageMetaSchema = z.strictObject({
  page: z.int().min(1),
  pageSize: z.int().min(1).max(MAX_PAGE_SIZE),
  total: z.int().min(0),
  totalPages: z.int().min(1),
});

export type PageMeta = z.infer<typeof pageMetaSchema>;

/** Wraps any item schema in the standard list envelope, for the OpenAPI spec. */
export function listResponseSchema<T extends z.ZodType>(item: T) {
  return z.strictObject({ data: z.array(item), page: pageMetaSchema });
}

export interface ListResponse<T> {
  data: T[];
  page: PageMeta;
}

export function toListResponse<TRow, TDto>(
  page: Page<TRow>,
  serialize: (row: TRow) => TDto
): ListResponse<TDto> {
  return {
    data: page.rows.map(serialize),
    page: {
      page: page.page,
      pageSize: page.pageSize,
      total: page.total,
      // A zero-result search has one (empty) page, not zero pages: the pager
      // still has to render something.
      totalPages: Math.max(1, Math.ceil(page.total / page.pageSize)),
    },
  };
}

/** The window every dated list accepts: `from` inclusive, `to` exclusive. */
export const windowQueryFields = {
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
};

/** Turns that window into the repository's shape. Absent stays absent. */
export function windowOf(input: { from?: string; to?: string }): { from?: Date; to?: Date } {
  return {
    ...(input.from === undefined ? {} : { from: new Date(input.from) }),
    ...(input.to === undefined ? {} : { to: new Date(input.to) }),
  };
}
