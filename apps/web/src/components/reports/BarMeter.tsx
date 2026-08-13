'use client';

import type { ReactElement } from 'react';

/**
 * A labelled proportional bar: the claim funnel's stages and the AR aging
 * buckets. The bar is decoration on top of a number that is always rendered as
 * text, so the row reads perfectly with the drawing removed.
 */

export interface BarMeterRow {
  id: string;
  label: string;
  /** The number that drives the bar's length. */
  value: number;
  /** The number as a person should read it: "$21,480.00", "68 claims". */
  valueText: string;
  /** Optional second line: a split, a drop-off, an age. */
  detail?: string;
  /** Draws the bar in the danger tint and says so in `detail`. */
  attention?: boolean;
}

export interface BarMeterProps {
  /** Names the list for a screen reader: "Accounts receivable by age". */
  label: string;
  rows: BarMeterRow[];
}

export function BarMeter({ label, rows }: Readonly<BarMeterProps>): ReactElement {
  const max = rows.reduce((peak, row) => Math.max(peak, row.value), 0) || 1;

  return (
    <ul className="or-meter" aria-label={label}>
      {rows.map((row) => (
        <li
          key={row.id}
          className="or-meter__row"
          data-attention={row.attention ? 'true' : undefined}
        >
          <span className="or-small or-meter__label">{row.label}</span>
          <span className="or-meter__track" aria-hidden="true">
            <span
              className="or-meter__fill"
              style={{ width: `${Math.max((row.value / max) * 100, 1).toFixed(1)}%` }}
            />
          </span>
          <span className="or-meter__value or-mono">{row.valueText}</span>
          {row.detail ? <span className="or-caption or-meter__detail">{row.detail}</span> : null}
        </li>
      ))}
    </ul>
  );
}
