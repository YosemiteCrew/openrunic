import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Tabs } from '@/components/admin/Tabs';

/**
 * Moving between tabs from the keyboard.
 *
 * The handler sits on the tabs rather than the tablist, because WAI-ARIA's
 * roving tabindex puts the single tab stop on the selected tab and a handler on
 * the list would be a handler on something the keyboard cannot reach.
 *
 * `admin-components.test.tsx` covers the rendering and the click path. None of
 * the four keys had been pressed, so the wrap-around arithmetic - the part most
 * likely to be wrong and least likely to be noticed - was never run.
 */

const ITEMS = [
  { id: 'first', label: 'First' },
  { id: 'second', label: 'Second' },
  { id: 'third', label: 'Third' },
];

function renderTabs(active: string) {
  const onChange = vi.fn();
  render(<Tabs label="Sections" items={ITEMS} active={active} onChange={onChange} />);
  return { onChange };
}

describe('keyboard navigation', () => {
  it.each([
    ['ArrowRight', 'first', 'second'],
    ['ArrowRight', 'third', 'first'],
    ['ArrowLeft', 'second', 'first'],
    ['ArrowLeft', 'first', 'third'],
    ['Home', 'third', 'first'],
    ['End', 'first', 'third'],
  ])('%s from %s selects %s', (key, active, expected) => {
    /*
     * Both wrap-arounds are here on purpose. `(index - 1 + length) % length` is
     * the expression that goes wrong when somebody simplifies it to
     * `(index - 1) % length`, which returns -1 at the start of the row and
     * would move focus nowhere.
     */
    const { onChange } = renderTabs(active);

    fireEvent.keyDown(screen.getByRole('tab', { selected: true }), { key });

    expect(onChange).toHaveBeenCalledWith(expected);
  });

  it('moves focus with the selection, not just the selection', () => {
    /*
     * The roving tabindex is only half of it. If focus stays on the old tab the
     * next arrow press moves relative to somewhere the reader is not.
     */
    renderTabs('first');

    fireEvent.keyDown(screen.getByRole('tab', { selected: true }), { key: 'ArrowRight' });

    expect(screen.getByRole('tab', { name: 'Second' })).toHaveFocus();
  });

  it('ignores a key it does not handle, leaving the page to it', () => {
    /*
     * Tab, Enter and typing all reach this handler and must pass through
     * untouched: swallowing Tab would trap the keyboard inside the tab row.
     */
    const { onChange } = renderTabs('first');
    const tab = screen.getByRole('tab', { selected: true });

    for (const key of ['Tab', 'a', 'ArrowUp', 'Enter']) {
      fireEvent.keyDown(tab, { key });
    }

    expect(onChange).not.toHaveBeenCalled();
  });

  it('does nothing when the active id names no tab', () => {
    /*
     * A defensive branch, and reachable: a screen that changes its tab list and
     * its selection in two renders is briefly in exactly this state.
     */
    const { onChange } = renderTabs('not-a-tab');

    fireEvent.keyDown(screen.getAllByRole('tab')[0] as HTMLElement, { key: 'ArrowRight' });

    expect(onChange).not.toHaveBeenCalled();
  });
});
