'use client';

import type { ReactElement, ReactNode } from 'react';

/**
 * Label and value pairs inside a drawer or a card.
 *
 * A description list rather than a two-column table: these are attributes of
 * one record, not rows of a data set, and a screen reader should announce them
 * that way. Absent values arrive already formatted as "Not recorded"; this
 * component never renders a blank value.
 */

export interface DetailItem {
  label: string;
  value: ReactNode;
  /** Renders the value in Spline Sans Mono: ids, codes, hashes. */
  mono?: boolean;
}

export interface DetailListProps {
  items: DetailItem[];
  /** Two columns from 640px. Use for wide drawers and cards. */
  columns?: 1 | 2;
}

export function DetailList({ items, columns = 1 }: DetailListProps): ReactElement {
  return (
    <dl className="or-details" data-columns={columns}>
      {items.map((item) => (
        <div key={item.label} className="or-details__row">
          <dt className="or-small or-details__label">{item.label}</dt>
          <dd className={item.mono ? 'or-mono or-details__value' : 'or-body or-details__value'}>
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
