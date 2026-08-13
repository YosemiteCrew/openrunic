import type { ReactElement } from 'react';

/**
 * The one loading surface.
 *
 * Skeletons that mirror the final layout, never a spinner over empty space: the
 * screen keeps its dimensions, so nothing jumps when the data lands. The
 * skeleton itself is decorative and hidden from assistive technology; the live
 * region beside it carries the whole meaning.
 */

export type LoadingVariant =
  /** Header row plus body rows. Tables, worklists, ledgers. */
  | 'table'
  /** A grid of card blocks. Dashboards, adapter grids, cohort tiles. */
  | 'cards'
  /** Stacked text lines. Notes, summaries, detail panels. */
  | 'text';

export interface LoadingStateProps {
  /** What is loading, as a noun phrase: "Patients", "Today's schedule". */
  label: string;
  variant?: LoadingVariant;
  /** Rows or cards to draw. Match the density of the real thing. */
  rows?: number;
}

function keys(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `skeleton-${index}`);
}

export function LoadingState({
  label,
  variant = 'table',
  rows = 6,
}: Readonly<LoadingStateProps>): ReactElement {
  return (
    <div className="or-loading" data-variant={variant}>
      <div className="or-loading__skeleton" aria-hidden="true">
        {variant === 'table' ? <div className="or-loading__head" /> : null}
        {keys(rows).map((key) => (
          <div key={key} className="or-loading__row" />
        ))}
      </div>
      {/* Polite, not assertive: a load is expected, so it waits for a pause. */}
      <output className="or-loading__status or-small">Loading {label.toLowerCase()}</output>
    </div>
  );
}
