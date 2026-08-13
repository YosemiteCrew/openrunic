import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ResultsScreen } from '@/app/results/ResultsScreen';
import { ApiError } from '@/lib/api/client';
import { MOCK_NOW, MOCK_RESULTS } from '@/lib/api/mock/fixtures';
import { createWorklistClient } from '@/lib/api/worklist';
import type { WorklistClient } from '@/lib/api/worklist';

/**
 * The sign-off queue, driven the way a provider drives it between patients:
 * abnormal first, read the values against their ranges, sign, move on. The
 * batch action and the critical exclusion are asserted because that exclusion
 * is the safety property of the screen.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => '/results',
}));

function failing(): WorklistClient {
  const fail = () => Promise.reject(new ApiError('offline', { kind: 'network' }));
  return { orders: { list: fail }, results: { list: fail }, inbox: { list: fail } };
}

function queue(): HTMLElement {
  return screen.getByRole('list', { name: 'Results to review' });
}

/** Strict indexing makes `[0]` optional; this asserts the match exists. */
function at<T>(items: T[], index = 0): T {
  const item = items[index];
  if (!item) throw new Error(`No element at index ${index}`);
  return item;
}

describe('ResultsScreen', () => {
  it('puts the critical value at the top of the queue and names why', async () => {
    render(<ResultsScreen client={createWorklistClient()} now={MOCK_NOW} />);

    const rows = within(
      await screen.findByRole('list', { name: 'Results to review' })
    ).getAllByRole('listitem');
    expect(at(rows)).toHaveTextContent('Oyelaran, Marek');
    expect(at(rows)).toHaveTextContent('Critical value');
    expect(at(rows)).toHaveTextContent(/Potassium 6.2 mmol\/L, above range/);
  });

  it('reads every value against its reference range, in words', async () => {
    render(<ResultsScreen client={createWorklistClient()} now={MOCK_NOW} />);
    await screen.findByRole('list', { name: 'Results to review' });

    const table = screen.getByRole('table');
    expect(within(table).getByText('6.2 mmol/L')).toBeInTheDocument();
    expect(within(table).getByText('3.5 to 5.1 mmol/L')).toBeInTheDocument();
    expect(within(table).getAllByText('Above range').length).toBeGreaterThan(0);
    expect(within(table).getAllByText('In range').length).toBeGreaterThan(0);
    // Cumulative context: one value is a number, three are a direction.
    expect(within(table).getByText(/5.4 on 14 Jun/)).toBeInTheDocument();
  });

  it('moves through the queue with the arrow keys', async () => {
    render(<ResultsScreen client={createWorklistClient()} now={MOCK_NOW} />);
    await screen.findByRole('list', { name: 'Results to review' });

    const openers = within(queue()).getAllByRole('button', { name: /Reported/ });
    at(openers).focus();
    fireEvent.keyDown(queue(), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(at(openers, 1));

    fireEvent.keyDown(queue(), { key: 'Home' });
    expect(document.activeElement).toBe(at(openers));
  });

  it('signs one result behind a confirmation that states the consequence', async () => {
    render(<ResultsScreen client={createWorklistClient()} now={MOCK_NOW} />);
    await screen.findByRole('list', { name: 'Results to review' });

    fireEvent.click(at(screen.getAllByRole('button', { name: /^Sign$/ })));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/releases it to the portal/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Sign result' }));

    expect(await screen.findByText('Comprehensive metabolic panel signed')).toBeInTheDocument();
  });

  it('attaches a note when signing with one', async () => {
    render(<ResultsScreen client={createWorklistClient()} now={MOCK_NOW} />);
    await screen.findByRole('list', { name: 'Results to review' });

    fireEvent.click(screen.getByRole('button', { name: 'Sign with note' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Note for the record'), {
      target: { value: 'Repeat potassium today and call the patient.' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Sign with note' }));

    expect(
      await screen.findByText('Repeat potassium today and call the patient.')
    ).toBeInTheDocument();
  });

  it('never batches a critical value, and says so', async () => {
    render(<ResultsScreen client={createWorklistClient()} now={MOCK_NOW} />);
    await screen.findByRole('list', { name: 'Results to review' });

    fireEvent.click(screen.getByRole('button', { name: /Sign 2 in-range results/ }));

    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText(/Critical and out-of-range results are not included/)
    ).toBeInTheDocument();
    expect(within(dialog).queryByText('Comprehensive metabolic panel')).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Sign 2 results' }));
    expect(await screen.findByText('2 in-range results signed')).toBeInTheDocument();
  });

  it('switches between my queue and the team pool', async () => {
    render(<ResultsScreen client={createWorklistClient()} now={MOCK_NOW} />);
    await screen.findByRole('list', { name: 'Results to review' });

    fireEvent.change(screen.getByLabelText('Assignment'), { target: { value: 'TEAM' } });

    const rows = within(
      await screen.findByRole('list', { name: 'Results to review' })
    ).getAllByRole('listitem');
    expect(rows).toHaveLength(MOCK_RESULTS.filter((report) => report.assignedTo === 'TEAM').length);
  });

  it('says the queue is clear rather than showing a blank region', async () => {
    render(<ResultsScreen client={createWorklistClient({ results: [] })} now={MOCK_NOW} />);

    expect(await screen.findByText('All results reviewed')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to the inbox' })).toHaveAttribute('href', '/inbox');
  });

  it('says what happened and what to do when the queue fails to load', async () => {
    render(<ResultsScreen client={failing()} now={MOCK_NOW} />);

    expect(await screen.findByText('No connection to the server')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
