import type { TableColumn } from '@openrunic/ui';

/**
 * Table headers as catalogue keys, translated at render.
 *
 * Every billing table used to declare its columns as a module-scope constant
 * with English headers in it. A constant is built once, when the module is
 * first imported, and the reader arrives afterwards - so the words were fixed
 * before anything knew what language to say them in.
 *
 * Keeping the shape as data and the words as keys preserves what the constant
 * was for (the columns of a table are reviewable in one place, in order) while
 * moving the one part that depends on the reader to where the reader is known.
 */

/** A column declaration carrying its header's key instead of its header. */
export type KeyedColumn = Omit<TableColumn, 'header'> & { readonly headerKey: string };

export function translateColumns(
  columns: readonly KeyedColumn[],
  translate: (key: string) => string
): TableColumn[] {
  return columns.map(({ headerKey, ...column }) => ({ ...column, header: translate(headerKey) }));
}
