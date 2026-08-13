import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ResultList } from '@/components/results/ResultList';
import { MOCK_RESULTS } from '@/lib/api/mock/fixtures';
import type { ResultReport } from '@/lib/api/worklist';

/**
 * The queue's keyboard contract, at the component.
 *
 * The screen test covers a provider walking the queue with ArrowDown and Home.
 * These cover what it cannot reach: the ends of the list, the wrap, the keys
 * the queue must ignore, and a report whose patient is not in the directory -
 * which is a real arrival order, because a result can land before the demo
 * fixture that names the patient does.
 */

/** Strict indexing makes `[0]` optional; this asserts the match exists. */
function at<T>(items: T[], index = 0): T {
  const item = items[index];
  if (!item) throw new Error(`No element at index ${index}`);
  return item;
}

function renderQueue(reports: readonly ResultReport[] = MOCK_RESULTS) {
  const onSelect = vi.fn();
  const onSign = vi.fn();
  render(
    <ResultList
      reports={[...reports]}
      selectedId={null}
      onSelect={onSelect}
      onSign={onSign}
      signedIds={[]}
    />
  );
  const list = screen.getByRole('list', { name: 'Results to review' });
  return { onSelect, onSign, rows: within(list).queryAllByRole('button', { name: /Reported/ }) };
}

describe('ResultList, keyboard only', () => {
  it('jumps to the last row on End and back to the first on Home', () => {
    const { rows } = renderQueue();
    at(rows).focus();

    fireEvent.keyDown(at(rows), { key: 'End' });
    expect(document.activeElement).toBe(at(rows, rows.length - 1));

    fireEvent.keyDown(at(rows, rows.length - 1), { key: 'Home' });
    expect(document.activeElement).toBe(at(rows));
  });

  it('wraps to the last row when ArrowUp is pressed on the first', () => {
    const { rows } = renderQueue();
    at(rows).focus();

    fireEvent.keyDown(at(rows), { key: 'ArrowUp' });
    expect(document.activeElement).toBe(at(rows, rows.length - 1));
  });

  it('leaves focus alone for a key the queue does not own', () => {
    const { rows } = renderQueue();
    at(rows, 1).focus();

    // A provider typing into a filter, or reaching for a browser shortcut, must
    // not have the queue move focus out from under them.
    fireEvent.keyDown(at(rows, 1), { key: 'a' });
    expect(document.activeElement).toBe(at(rows, 1));
  });

  it('starts at the first row when the keystroke did not come from a row', () => {
    const { rows } = renderQueue();
    document.body.focus();

    fireEvent.keyDown(at(rows, 2), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(at(rows));
  });

  it('renders an empty queue without a row to move to', () => {
    const { rows } = renderQueue([]);
    expect(rows).toHaveLength(0);
    expect(screen.getByRole('list', { name: 'Results to review' })).toBeEmptyDOMElement();
  });

  it('names the patient as not recorded when the directory does not have them', () => {
    const orphan: ResultReport = { ...at([...MOCK_RESULTS]), patientId: 'not-a-patient' };
    const { rows } = renderQueue([orphan]);

    expect(within(at(rows)).getByText('Not recorded')).toBeInTheDocument();
    // No MRN is shown rather than a placeholder one: an invented MRN on a
    // results row is exactly the kind of string that gets copied into a chart.
    expect(within(at(rows)).queryByText(/^OR-/)).not.toBeInTheDocument();
  });
});
