'use client';

import type { ReactElement, ReactNode } from 'react';

/**
 * The filter row every admin and report table sits under.
 *
 * It is a labelled group rather than a form: filters apply as they change, so
 * there is nothing to submit, and a submit button would imply otherwise. Date
 * range always comes first, then the screen's own filters, then the actions
 * (export, saved views) at the end of the row.
 */

export interface FilterBarProps {
  /** Names the group: "Filter the audit trail". Never rendered visually. */
  label: string;
  children: ReactNode;
  /** Export, saved views, reset. Right of the filters. */
  actions?: ReactNode;
  /** "12 of 48 events" - the count the filters produced. Always say it. */
  summary?: ReactNode;
}

export function FilterBar({
  label,
  children,
  actions,
  summary,
}: Readonly<FilterBarProps>): ReactElement {
  return (
    // A group rather than a landmark region: these are related controls, not a
    // section of the page, and a filter bar on every screen would litter the
    // landmark list.
    <fieldset className="or-filterbar" aria-label={label}>
      <div className="or-filterbar__fields">{children}</div>
      <div className="or-filterbar__end">
        {summary ? (
          // Polite: the count changes as filters change, and a screen reader
          // user needs to hear the result without chasing the table.
          <output className="or-small or-filterbar__summary">{summary}</output>
        ) : null}
        {actions ? <div className="or-filterbar__actions">{actions}</div> : null}
      </div>
    </fieldset>
  );
}
