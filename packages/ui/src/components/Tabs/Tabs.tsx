import { useState } from 'react';
import type { HTMLAttributes, KeyboardEvent, ReactNode } from 'react';
import { cx } from '../../lib/cx';
import { ICON_STROKE_WIDTH, resolveLucideIcon } from '../../lib/lucide';
import { useFieldId } from '../../lib/useFieldId';
import type { IconSlug } from '../../types';

/** Tab icon size, straight from the design system's navigation specimen. */
const ICON_SIZE = 17;

/** The tabs a keyboard can reach, in strip order. Disabled ones are never a target. */
const ENABLED_TABS = '.or-tabs__tab:not(:disabled)';

export interface TabsItem {
  /** Stable key for the tab, reported by `onChange` and used to build the element ids. */
  id: string;
  /** Visible tab text. Keep it to one or two words so the strip stays readable. */
  label: string;
  /** Lucide icon slug shown before the label. */
  icon?: IconSlug;
  /** Greys the tab out and takes it out of both the arrow keys and the pointer. */
  disabled?: boolean;
  /** Content of the matching tabpanel. Only the selected item's panel is rendered. */
  panel?: ReactNode;
}

export interface TabsProps extends Omit<HTMLAttributes<HTMLElement>, 'onChange' | 'children'> {
  /** The sections, in strip order. */
  items?: TabsItem[];
  /** Controlled selection: the id of the tab to show. Pair it with `onChange`. */
  value?: string;
  /** Uncontrolled starting selection; without it the first enabled tab is selected. */
  defaultValue?: string;
  /** Called with the tab id whenever a tab is chosen, controlled or not. */
  onChange?: (id: string) => void;
  /** Accessible name for the strip, e.g. 'Record sections'. */
  label?: string;
}

/**
 * Where the arrow keys, Home and End land, given the current tab's position among the
 * enabled ones. Returns undefined for every other key, which the strip leaves alone.
 */
function nextIndexFor(key: string, current: number, count: number): number | undefined {
  const last = count - 1;
  if (key === 'Home') return 0;
  if (key === 'End') return last;
  if (key === 'ArrowRight') return current === last ? 0 : current + 1;
  if (key === 'ArrowLeft') return current === 0 ? last : current - 1;
  return undefined;
}

/**
 * One strip of sections over one panel, following the WAI-ARIA tabs pattern with automatic
 * activation: ArrowLeft and ArrowRight walk the strip and wrap, Home and End jump to its
 * ends, and each of those moves focus and selects in the same step, so what is focused is
 * always what is shown. Disabled tabs are skipped rather than stepped over silently.
 *
 * Only the selected tab is a Tab stop, so Tab enters the strip once and lands on the current
 * section; the panel is a Tab stop of its own so a keyboard user can reach content that
 * holds no focusable control at all. Below md the strip scrolls sideways rather than
 * wrapping, because a wrapped row of tabs stops reading as one strip.
 *
 * Controlled with `value` and `onChange`, uncontrolled with `defaultValue`; `onChange`
 * reports the tab id either way. `className` and every other attribute dress the root.
 */
export function Tabs({
  items = [],
  value,
  defaultValue,
  onChange,
  label,
  className,
  id,
  ...rest
}: TabsProps) {
  const tabsId = useFieldId(id);
  const [internalValue, setInternalValue] = useState(defaultValue);

  const enabled = items.filter((item) => !item.disabled);
  /* Controlled value first, then whatever the strip last chose for itself, then the first
     tab a keyboard user could actually reach. */
  const selectedId = value ?? internalValue ?? enabled[0]?.id;
  const selected = items.find((item) => item.id === selectedId);

  const tabId = (itemId: string) => `${tabsId}-tab-${itemId}`;
  const panelId = (itemId: string) => `${tabsId}-panel-${itemId}`;

  const selectTab = (itemId: string) => {
    // A controlled strip does not move itself; the caller decides what `value` becomes.
    if (value === undefined) setInternalValue(itemId);
    onChange?.(itemId);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    /* A selection that is not among the enabled tabs, because it is disabled or unknown,
       is treated as sitting on the first of them rather than nowhere. */
    const current = Math.max(
      enabled.findIndex((item) => item.id === selectedId),
      0
    );
    const index = nextIndexFor(event.key, current, enabled.length);
    if (index === undefined) return;

    /* The query returns exactly the enabled tabs in strip order, so it indexes the same
       way `enabled` does. With nothing to move to, the key belongs to the page. */
    const item = enabled[index];
    const tab = event.currentTarget.querySelectorAll<HTMLButtonElement>(ENABLED_TABS)[index];
    if (!item || !tab) return;

    event.preventDefault();
    selectTab(item.id);
    tab.focus();
  };

  return (
    <div id={tabsId} className={cx('or-tabs', className)} {...rest}>
      <div className="or-tabs__strip">
        <div className="or-tabs__list" role="tablist" aria-label={label} onKeyDown={handleKeyDown}>
          {items.map((item) => {
            const active = item.id === selectedId;
            const ItemIcon = item.icon ? resolveLucideIcon(item.icon) : undefined;
            return (
              <button
                key={item.id}
                id={tabId(item.id)}
                type="button"
                role="tab"
                className={cx('or-tabs__tab', active && 'or-tabs__tab--active')}
                aria-selected={active}
                aria-controls={panelId(item.id)}
                tabIndex={active ? 0 : -1}
                disabled={item.disabled}
                onClick={() => selectTab(item.id)}
              >
                {ItemIcon ? (
                  <ItemIcon
                    className="or-tabs__icon"
                    size={ICON_SIZE}
                    strokeWidth={ICON_STROKE_WIDTH}
                    aria-hidden="true"
                  />
                ) : null}
                <span className="or-tabs__label">{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>
      {selected ? (
        <div
          key={selected.id}
          id={panelId(selected.id)}
          className="or-tabs__panel"
          role="tabpanel"
          aria-labelledby={tabId(selected.id)}
          tabIndex={0}
        >
          {selected.panel}
        </div>
      ) : null}
    </div>
  );
}
