import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OrdersScreen } from '@/app/(app)/orders/OrdersScreen';
import { ApiError } from '@/lib/api/client';
import { MOCK_NOW } from '@/lib/api/mock/fixtures';
import { createWorklistClient } from '@/lib/api/worklist';
import type { WorklistClient } from '@/lib/api/worklist';

const push = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => '/orders',
}));

function failing(): WorklistClient {
  const fail = () => Promise.reject(new ApiError('offline', { kind: 'network' }));
  return { orders: { list: fail }, results: { list: fail }, inbox: { list: fail } };
}

beforeEach(() => {
  push.mockClear();
});

/** Strict indexing makes `[0]` optional; this asserts the match exists. */
function at<T>(items: T[], index = 0): T {
  const item = items[index];
  if (!item) throw new Error(`No element at index ${index}`);
  return item;
}

describe('OrdersScreen', () => {
  it('renders the ledger with a status word beside every order', async () => {
    render(<OrdersScreen client={createWorklistClient()} now={MOCK_NOW} />);

    const table = await screen.findByRole('table');
    expect(within(table).getAllByText('HbA1c').length).toBeGreaterThan(0);
    expect(within(table).getAllByText('In progress').length).toBeGreaterThan(0);
    expect(within(table).getAllByText('OR-100482').length).toBeGreaterThan(0);
  });

  it('names an unacknowledged requisition and offers a retry in the row', async () => {
    render(<OrdersScreen client={createWorklistClient()} now={MOCK_NOW} />);

    expect(await screen.findByText(/Unacknowledged 1 d/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Retry Ankle X-ray, three views/ })
    ).toBeInTheDocument();
  });

  it('filters the ledger to one status', async () => {
    render(<OrdersScreen client={createWorklistClient()} now={MOCK_NOW} />);
    await screen.findByRole('table');

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'PENDED' } });

    const table = await screen.findByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(2);
    expect(within(table).getByText('Creatinine')).toBeInTheDocument();
  });

  it('reaches the new order composer from the page action', async () => {
    render(<OrdersScreen client={createWorklistClient()} now={MOCK_NOW} />);
    await screen.findByRole('table');

    const link = at(screen.getAllByRole('link', { name: 'New order' }));
    expect(link).toHaveAttribute('href', '/orders/new');
  });

  it('registers its verbs with the palette, so the filter is reachable by keyboard', async () => {
    render(<OrdersScreen client={createWorklistClient()} now={MOCK_NOW} />);
    await screen.findByRole('table');

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const field = await screen.findByLabelText('Search patients, screens and actions');
    fireEvent.change(field, { target: { value: 'pended' } });

    const option = await screen.findByText('Show pended orders');
    fireEvent.click(option);

    const table = await screen.findByRole('table');
    expect(within(table).getByText('Creatinine')).toBeInTheDocument();
    expect(within(table).getAllByRole('row')).toHaveLength(2);
  });

  it('says what is empty and offers the one action, per filter', async () => {
    render(<OrdersScreen client={createWorklistClient({ orders: [] })} now={MOCK_NOW} />);

    expect(await screen.findByText('No orders yet')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'New order' }).length).toBeGreaterThan(0);
  });

  it('says what happened and what to do when the ledger fails to load', async () => {
    render(<OrdersScreen client={failing()} now={MOCK_NOW} />);

    expect(await screen.findByText('No connection to the server')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
