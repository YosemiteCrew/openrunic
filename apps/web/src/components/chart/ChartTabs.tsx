'use client';

import { cx } from '@openrunic/ui';
import { useRef } from 'react';
import type { KeyboardEvent, ReactElement } from 'react';

import { panelId, tabId } from './ids';

/**
 * The chart's one level of tabs.
 *
 * Composed in the app rather than taken from `@openrunic/ui`, which has no tab
 * primitive today: this is one of the library gaps the chart had to work
 * around, and it is written to be lifted into the library unchanged.
 *
 * It follows the ARIA tabs pattern properly, because a chart is read all day by
 * people who never touch the mouse: one tab stop for the whole strip, arrows to
 * move between tabs, Home and End to jump, and the selected tab is marked by
 * `aria-selected` as well as by ink, never by colour alone.
 */

export interface ChartTabItem {
  id: string;
  /** Sentence case. "Care team", not "Care Team". */
  label: string;
  /** Rendered beside the label. Null hides it; zero is a real, useful answer. */
  count?: number | null;
}

export interface ChartTabsProps {
  tabs: readonly ChartTabItem[];
  activeId: string;
  onChange: (id: string) => void;
  /** Prefixes the tab and panel ids so two tab strips can share a page. */
  idPrefix: string;
  /** Names the strip for a screen reader: "Chart sections". */
  label: string;
}

export function ChartTabs({
  tabs,
  activeId,
  onChange,
  idPrefix,
  label,
}: Readonly<ChartTabsProps>): ReactElement {
  const buttons = useRef(new Map<string, HTMLButtonElement>());

  const focusTab = (index: number) => {
    const item = tabs[index];
    if (!item) return;
    // Selection follows focus, which is the right choice here: every panel is
    // already loaded, so arrowing across the strip costs nothing and reads the
    // whole chart without a single Enter press.
    onChange(item.id);
    buttons.current.get(item.id)?.focus();
  };

  /**
   * Bound to each tab rather than to the tablist. Roving tabindex leaves the
   * tablist itself out of the tab order on purpose, so it is not something a
   * keyboard can focus, and a key handler belongs on the thing that can be.
   */
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const current = tabs.findIndex((tab) => tab.id === activeId);
    if (current < 0) return;

    if (event.key === 'ArrowRight') {
      event.preventDefault();
      focusTab((current + 1) % tabs.length);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      focusTab((current - 1 + tabs.length) % tabs.length);
    } else if (event.key === 'Home') {
      event.preventDefault();
      focusTab(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      focusTab(tabs.length - 1);
    }
  };

  return (
    <div className="or-chart-tabs" role="tablist" aria-label={label}>
      {tabs.map((tab) => {
        const selected = tab.id === activeId;
        return (
          <button
            key={tab.id}
            type="button"
            id={tabId(idPrefix, tab.id)}
            ref={(node) => {
              if (node) buttons.current.set(tab.id, node);
              else buttons.current.delete(tab.id);
            }}
            className={cx('or-chart-tabs__tab', selected && 'or-chart-tabs__tab--selected')}
            role="tab"
            aria-selected={selected}
            aria-controls={panelId(idPrefix, tab.id)}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={onKeyDown}
          >
            {tab.label}
            {tab.count === null || tab.count === undefined ? null : (
              <span className="or-chart-tabs__count">{tab.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
