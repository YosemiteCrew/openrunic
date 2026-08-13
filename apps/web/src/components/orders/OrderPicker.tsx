'use client';

import { Badge, Button, Input, Tag } from '@openrunic/ui';
import { useId, useMemo, useState } from 'react';
import type { ChangeEvent, KeyboardEvent, ReactElement } from 'react';

import { rankCatalog } from '@/lib/api';
import type { OrderCatalogEntry, PatientProblem } from '@/lib/api';

/**
 * Favourites and type-ahead: the two ways a clinician actually finds an order.
 *
 * The screen is built on the fact that a practice orders the same twenty
 * things. Favourites are one click with everything pre-filled, and the search
 * ranks the catalogue against this patient's problem list before it ranks it
 * alphabetically. OpenEMR's procedure order form had neither, which is why
 * ordering there began with remembering what the test was called.
 *
 * The field is a combobox: typing filters, Arrow keys move the active option,
 * Enter adds it, and focus never leaves the input. That is the keyboard
 * contract, and it is also what makes the screen drivable by an agent.
 *
 * Proposed @openrunic/ui addition: a `Combobox` primitive. The palette composes
 * the same behaviour today; two copies is the point at which it belongs in the
 * library.
 */

export interface OrderPickerProps {
  problems: PatientProblem[];
  /** Codes already drafted, so the picker can say so instead of adding twice. */
  draftedCodes: string[];
  onAdd: (entry: OrderCatalogEntry) => void;
  /** Id given to the search field, so a palette command can focus it. */
  searchInputId: string;
}

/** Enough to choose from without turning the panel into a catalogue browser. */
const VISIBLE_RESULTS = 6;

export function OrderPicker({
  problems,
  draftedCodes,
  onAdd,
  searchInputId,
}: OrderPickerProps): ReactElement {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const baseId = useId();
  const listId = `${baseId}-results`;

  const favourites = useMemo(
    () => rankCatalog('', problems).filter((entry) => entry.favourite),
    [problems]
  );
  const results = useMemo(
    () => rankCatalog(query, problems).slice(0, VISIBLE_RESULTS),
    [query, problems]
  );

  // Clamped during render: the list changes on every keystroke, and an effect
  // would leave one frame pointing past the end of it.
  const active = activeIndex < results.length ? activeIndex : 0;
  const drafted = new Set(draftedCodes);

  const add = (entry: OrderCatalogEntry | undefined) => {
    if (!entry) return;
    onAdd(entry);
    setQuery('');
    setActiveIndex(0);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (results.length === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((active + step + results.length) % results.length);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      add(results[active]);
    }
  };

  const activeOptionId = results[active] ? `${baseId}-option-${results[active].code}` : undefined;

  return (
    <div className="or-picker">
      <div className="or-picker__favourites">
        <p className="or-overline">Favourites</p>
        {/* Named as a group so "the favourites row" is one thing to a screen
            reader and to an agent, not eight loose buttons. */}
        <div className="or-cluster" role="group" aria-label="Favourite orders">
          {favourites.map((entry) => (
            <Button
              key={entry.code}
              variant="secondary"
              size="sm"
              iconLeft="star"
              onClick={() => add(entry)}
            >
              {entry.name}
            </Button>
          ))}
        </div>
      </div>

      <Input
        id={searchInputId}
        label="Search the order catalogue"
        hint="Ranked against this patient's problem list. Arrow keys move, Enter adds."
        placeholder="Test, scan or procedure"
        iconLeft="search"
        value={query}
        autoComplete="off"
        role="combobox"
        aria-expanded="true"
        aria-controls={listId}
        aria-activedescendant={activeOptionId}
        aria-autocomplete="list"
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          setQuery(event.target.value);
          setActiveIndex(0);
        }}
        onKeyDown={onKeyDown}
      />

      <ul id={listId} className="or-picker__list" aria-label="Matching orders">
        {results.length === 0 ? (
          <li className="or-picker__empty or-small">
            Nothing in the catalogue matches {`"${query.trim()}"`}. Try the test name or its short
            code.
          </li>
        ) : null}

        {results.map((entry, index) => {
          const already = drafted.has(entry.code);
          const linked = entry.problemCodes.some((code) =>
            problems.some((problem) => problem.code === code)
          );
          return (
            <li key={entry.code} className="or-picker__item">
              <button
                type="button"
                id={`${baseId}-option-${entry.code}`}
                className="or-picker__option"
                data-active={index === active ? 'true' : undefined}
                onClick={() => add(entry)}
              >
                <span className="or-picker__name">{entry.name}</span>
                <span className="or-picker__meta or-small">
                  <span className="or-mono">{entry.code}</span>
                  <span>{entry.destination}</span>
                  <span>{entry.turnaround}</span>
                </span>
              </button>
              <span className="or-picker__flags">
                {linked ? <Tag>On the problem list</Tag> : null}
                {already ? (
                  <Badge tone="neutral" icon="check">
                    Already drafted
                  </Badge>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
