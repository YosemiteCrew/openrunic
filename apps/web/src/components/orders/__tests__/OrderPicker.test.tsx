import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { OrderPicker } from '@/components/orders/OrderPicker';
import type { PatientProblem } from '@/lib/api';

/**
 * The picker is a combobox, so the whole of ordering has to be reachable
 * without a mouse: type, arrow to the entry, Enter. Focus never leaves the
 * field, so the active option is published through `aria-activedescendant`
 * rather than by moving focus - which is also what makes these assertions
 * about the highlight meaningful.
 */

const PROBLEMS: PatientProblem[] = [
  { code: 'E11.9', display: 'Type 2 diabetes', onset: '2021-04-09' },
];

function renderPicker(drafted: string[] = []) {
  const onAdd = vi.fn();
  render(
    <OrderPicker
      problems={PROBLEMS}
      draftedCodes={drafted}
      onAdd={onAdd}
      searchInputId="order-search"
    />
  );
  return { onAdd, field: screen.getByRole('combobox', { name: /Search the order catalogue/ }) };
}

function optionIds(): string[] {
  const list = screen.getByRole('list', { name: 'Matching orders' });
  return within(list)
    .queryAllByRole('button')
    .map((option) => option.getAttribute('id') ?? '');
}

describe('OrderPicker, keyboard only', () => {
  it('adds the option the highlight is on, not the first one', () => {
    const { onAdd, field } = renderPicker();
    const first = field.getAttribute('aria-activedescendant');

    fireEvent.keyDown(field, { key: 'ArrowDown' });
    const second = field.getAttribute('aria-activedescendant');
    expect(second).not.toBe(first);

    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onAdd).toHaveBeenCalledTimes(1);
    const added = onAdd.mock.calls[0]?.[0] as { code: string };
    expect(second).toContain(added.code);
  });

  it('wraps to the last option when ArrowUp is pressed on the first', () => {
    const { field } = renderPicker();
    const ids = optionIds();

    fireEvent.keyDown(field, { key: 'ArrowUp' });
    expect(field.getAttribute('aria-activedescendant')).toBe(ids.at(-1));
  });

  it('clears the query and the highlight after an entry is added', () => {
    const { field } = renderPicker();
    fireEvent.change(field, { target: { value: 'metabolic' } });
    expect(field).toHaveValue('metabolic');

    fireEvent.keyDown(field, { key: 'Enter' });
    expect(field).toHaveValue('');
  });

  it('says nothing matched, and Enter adds nothing, when the query has no hits', () => {
    const { onAdd, field } = renderPicker();
    fireEvent.change(field, { target: { value: 'zzzznotathing' } });

    expect(screen.getByText(/Nothing in the catalogue matches/)).toBeInTheDocument();
    expect(field).not.toHaveAttribute('aria-activedescendant');

    // Arrowing and Enter on an empty list must be inert, not throw.
    fireEvent.keyDown(field, { key: 'ArrowDown' });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onAdd).not.toHaveBeenCalled();
  });
});
