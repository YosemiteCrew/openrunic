'use client';

import { Button, Card, Input } from '@openrunic/ui';
import { useMemo } from 'react';
import type { ReactElement } from 'react';

import type { ProcedureCode } from '@/lib/api';
import { formatMoney } from '@/lib/format';

/**
 * Code search and the shortcut panels above the charge table.
 *
 * The panels are the reason a routine visit can be captured in seconds: the
 * codes a practice actually bills are one click away and permanently visible,
 * rather than hidden behind a search nobody knows the vocabulary for. Search is
 * there for everything else, and every result is a real button, so the whole
 * picker is operable from the keyboard without a combobox to learn.
 */

/** Enough matches to choose from, few enough to read without scrolling. */
const RESULT_LIMIT = 6;

export interface ChargePickerProps {
  catalog: readonly ProcedureCode[];
  /** Panel names, in the order the groups render. */
  panels: readonly string[];
  currency: string;
  query: string;
  onQueryChange: (value: string) => void;
  onAdd: (code: ProcedureCode) => void;
  /** Set on the search field so a palette command can put the caret in it. */
  searchInputId: string;
}

export function ChargePicker({
  catalog,
  panels,
  currency,
  query,
  onQueryChange,
  onAdd,
  searchInputId,
}: ChargePickerProps): ReactElement {
  const needle = query.trim().toLowerCase();

  const matches = useMemo(() => {
    if (!needle) return [];
    return catalog
      .filter((code) => `${code.code} ${code.display}`.toLowerCase().includes(needle))
      .slice(0, RESULT_LIMIT);
  }, [catalog, needle]);

  return (
    <Card overline="Add charges" title="Codes">
      <div className="or-code-picker">
        <Input
          id={searchInputId}
          label="Search CPT and HCPCS"
          placeholder="Code or description"
          iconLeft="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          autoComplete="off"
        />

        {needle ? (
          <div className="or-code-picker__results">
            {matches.length === 0 ? (
              <p className="or-small or-billing__hint">
                No code matches {`"${query.trim()}"`}. Try the code number or a shorter word.
              </p>
            ) : (
              <ul className="or-code-picker__list">
                {matches.map((code) => (
                  <li key={code.code}>
                    <Button
                      variant="ghost"
                      size="sm"
                      iconLeft="plus"
                      fullWidth
                      onClick={() => onAdd(code)}
                    >
                      <span className="or-mono">{code.code}</span>
                      <span className="or-code-picker__display">{code.display}</span>
                      <span className="or-mono or-code-picker__fee">
                        {formatMoney(code.fee, { currency }).text}
                      </span>
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}

        {panels.map((panel) => {
          const codes = catalog.filter((code) => code.panel === panel);
          if (codes.length === 0) return null;
          return (
            <div key={panel} className="or-code-picker__panel">
              <p className="or-overline">{panel}</p>
              <div className="or-code-picker__chips">
                {codes.map((code) => (
                  <Button
                    key={code.code}
                    variant="secondary"
                    size="sm"
                    onClick={() => onAdd(code)}
                    aria-label={`Add ${code.code}, ${code.display}`}
                  >
                    <span className="or-mono">{code.code}</span>
                  </Button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
