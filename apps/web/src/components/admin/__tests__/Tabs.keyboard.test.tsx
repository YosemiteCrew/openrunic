import { createEvent, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Tabs } from '@/components/admin/Tabs';

/**
 * Moving between tabs from the keyboard.
 *
 * `admin-components.test.tsx` already presses ArrowRight - twice, so it covers
 * the right wrap-around - and End. What had never been pressed is **ArrowLeft
 * and Home**, which means the left wrap-around never ran. That is the half most
 * likely to be wrong: `(index - 1 + length) % length` is the expression somebody
 * simplifies to `(index - 1) % length`, which returns -1 at the start of the row.
 *
 * The rest of this file covers what a key does beyond calling `onChange`:
 * whether focus follows, and whether keys the handler does not own are left
 * alone.
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

    const tab = screen.getByRole('tab', { selected: true });
    const event = createEvent.keyDown(tab, { key });
    fireEvent(tab, event);

    expect(onChange).toHaveBeenCalledWith(expected);
    /*
     * Cancelled, as well as handled. Home and End scroll the document and the
     * arrows scroll a scrollable ancestor, so a handler that moved the
     * selection without calling `preventDefault` would move the tab and the
     * page under it at the same time.
     */
    expect(event.defaultPrevented, `${key} was not cancelled`).toBe(true);
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

  it('leaves a key it does not handle uncancelled, not merely unselected', () => {
    /*
     * Both halves matter, and only the first is obvious. Not calling `onChange`
     * is not enough: a handler that also called `preventDefault` on Tab would
     * pass a check for `onChange` alone while trapping the keyboard inside the
     * tab row, which is the regression worth catching.
     */
    const { onChange } = renderTabs('first');
    const tab = screen.getByRole('tab', { selected: true });

    for (const key of ['Tab', 'a', 'ArrowUp', 'Enter']) {
      const event = createEvent.keyDown(tab, { key });
      fireEvent(tab, event);
      expect(event.defaultPrevented, `${key} was cancelled`).toBe(false);
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
