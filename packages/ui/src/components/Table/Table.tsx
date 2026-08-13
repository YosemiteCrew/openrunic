import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from '../../lib/cx';
import type { Align } from '../../types';

export interface TableColumn {
  key: string;
  header: string;
  align?: Align;
  /** Render this column in Spline Sans Mono (IDs, codes). */
  mono?: boolean;
  /** Tabular figures for measurements. Unaligned numeric columns default to the right. */
  numeric?: boolean;
}

export interface TableProps extends HTMLAttributes<HTMLElement> {
  columns?: TableColumn[];
  /** Row objects keyed by column key; values may be nodes (e.g. a Badge). */
  rows?: Array<Record<string, ReactNode>>;
  caption?: string;
}

/** Measurements read down a column, so an unaligned numeric column right-aligns itself. */
function alignOf(column: TableColumn): Align {
  if (column.align) return column.align;
  return column.numeric ? 'right' : 'left';
}

/** Prefer a row's own `id` so re-sorting a table does not re-key every row to its position. */
function rowKey(row: Record<string, ReactNode>, index: number): string {
  const id = row.id;
  return typeof id === 'string' || typeof id === 'number' ? String(id) : String(index);
}

/**
 * Records, results and schedules. White surface, cream header, hairlines and no vertical
 * rules - the columns are held apart by alignment and space, not by lines.
 *
 * The table scrolls horizontally inside its own container rather than squeezing columns,
 * and below md the first column stays put so a row never loses the thing it is about. The
 * header is sticky inside that container, so it survives a constrained height too.
 */
export function Table({ columns = [], rows = [], caption, className, ...rest }: TableProps) {
  return (
    <div className={cx('or-table', className)} {...rest}>
      {/* A horizontally scrolling box must be reachable by keyboard, or a keyboard-only
          user can never see the columns that overflow. Naming it as a region needs an
          accessible name, so the role only appears when there is a caption to use. */}
      <div
        className="or-table__scroll"
        tabIndex={0}
        role={caption ? 'region' : undefined}
        aria-label={caption}
      >
        <table className="or-table__grid">
          {caption ? <caption className="or-table__caption">{caption}</caption> : null}
          <thead>
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={cx('or-table__th', `or-table__cell--${alignOf(column)}`)}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={rowKey(row, index)} className="or-table__row">
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={cx(
                      'or-table__td',
                      `or-table__cell--${alignOf(column)}`,
                      column.mono && 'or-table__cell--mono',
                      column.numeric && 'or-table__cell--numeric'
                    )}
                  >
                    {row[column.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
