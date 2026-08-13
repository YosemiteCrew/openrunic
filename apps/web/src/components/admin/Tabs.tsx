'use client';

import { useRef } from 'react';
import type { KeyboardEvent, ReactElement, ReactNode } from 'react';

/**
 * A one-level tab row.
 *
 * PROPOSED LIBRARY ADDITION. The library has no tabs component, and three admin
 * screens need one (developer platform, facilities, forms). Tabs never nest
 * deeper than one level; anything deeper is an in-page section with anchor
 * navigation.
 *
 * Keyboard model is the WAI-ARIA authoring practice: the tab row is one tab
 * stop, arrow keys move between tabs and select as they go, Home and End jump
 * to the ends.
 */

export interface TabItem {
  id: string;
  label: string;
  /** A count or status word rendered after the label. Never colour alone. */
  hint?: ReactNode;
}

export interface TabsProps {
  /** Names the tab row for a screen reader: "Developer platform sections". */
  label: string;
  items: TabItem[];
  active: string;
  onChange: (id: string) => void;
}

export function Tabs({ label, items, active, onChange }: TabsProps): ReactElement {
  const refs = useRef(new Map<string, HTMLButtonElement>());

  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    const index = items.findIndex((item) => item.id === active);
    if (index < 0) return;

    let next = index;
    if (event.key === 'ArrowLeft') next = (index - 1 + items.length) % items.length;
    if (event.key === 'ArrowRight') next = (index + 1) % items.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = items.length - 1;

    const target = items[next];
    if (!target) return;
    event.preventDefault();
    onChange(target.id);
    refs.current.get(target.id)?.focus();
  };

  return (
    <div className="or-tabs" role="tablist" aria-label={label} onKeyDown={move}>
      {items.map((item) => {
        const selected = item.id === active;
        return (
          <button
            key={item.id}
            ref={(node) => {
              if (node) refs.current.set(item.id, node);
              else refs.current.delete(item.id);
            }}
            type="button"
            role="tab"
            id={`tab-${item.id}`}
            aria-selected={selected}
            aria-controls={`panel-${item.id}`}
            tabIndex={selected ? 0 : -1}
            className="or-tabs__tab"
            data-selected={selected ? 'true' : undefined}
            onClick={() => onChange(item.id)}
          >
            {item.label}
            {item.hint === undefined ? null : <span className="or-tabs__hint">{item.hint}</span>}
          </button>
        );
      })}
    </div>
  );
}

export interface TabPanelProps {
  id: string;
  active: boolean;
  children: ReactNode;
}

/** The panel a tab controls. Unmounted when inactive: no hidden focus stops. */
export function TabPanel({ id, active, children }: TabPanelProps): ReactElement | null {
  if (!active) return null;
  return (
    <div
      role="tabpanel"
      id={`panel-${id}`}
      aria-labelledby={`tab-${id}`}
      tabIndex={0}
      className="or-tabs__panel"
    >
      {children}
    </div>
  );
}
