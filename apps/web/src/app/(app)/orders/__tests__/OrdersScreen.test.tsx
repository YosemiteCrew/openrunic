import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OrdersScreen } from '@/app/(app)/orders/OrdersScreen';
import { ApiError } from '@/lib/api/client';
import { MOCK_NOW, MOCK_ORDERS } from '@/lib/api/mock/fixtures';
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

/**
 * A ledger page whose total is larger than the rows on it, the way a live page
 * carrying a referral or a draft is (#539).
 *
 * The total and the row count are deliberately different numbers here. A screen
 * that printed `data.length` where it should print `page.total` agrees with
 * itself on the fixture client, which reports no refusal at all, and is wrong
 * only on exactly this page.
 */
function withRefused(refused: number): WorklistClient {
  const base = createWorklistClient();
  return {
    ...base,
    orders: {
      list: async (query) => {
        const page = await base.orders.list(query);
        return {
          ...page,
          page: { ...page.page, total: page.page.total + refused },
          refused,
        };
      },
    },
  };
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

  it('states how many orders the ledger matched, and how many of them are shown', async () => {
    render(<OrdersScreen client={createWorklistClient()} now={MOCK_NOW} />);
    await screen.findByRole('table');

    expect(
      screen.getByText(`${MOCK_ORDERS.length} of ${MOCK_ORDERS.length} orders`)
    ).toBeInTheDocument();
    expect(screen.queryByText(/not listed/)).not.toBeInTheDocument();
  });

  /* The count and the list have to answer the same question. A clinician
     reading a total of 16 and counting 13 rows cannot tell whether three are
     missing or three are elsewhere, so the screen says which. */
  it('states the rows it matched but cannot render, beside the total', async () => {
    render(<OrdersScreen client={withRefused(3)} now={MOCK_NOW} />);

    const table = await screen.findByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(MOCK_ORDERS.length + 1);
    expect(
      screen.getByText(`${MOCK_ORDERS.length} of ${MOCK_ORDERS.length + 3} orders`)
    ).toBeInTheDocument();
    expect(screen.getByText(/^3 of them are not listed/)).toBeInTheDocument();
  });

  /* #540: a live page can be smaller than the total for a reason `refused`
     never counts - pageSize capping how many rows the route returns at all.
     Nothing upstream calls that a refusal, so a screen that only ever checked
     `refused` would show this exact case as a bare, silent total, which is the
     defect the reviewer found in the first version of this fix. */
  it('states the window even when nothing was refused, only paged', async () => {
    const base = createWorklistClient();
    const client: WorklistClient = {
      ...base,
      orders: {
        list: async (query) => {
          const page = await base.orders.list(query);
          return { ...page, page: { ...page.page, total: page.page.total + 40 }, refused: 0 };
        },
      },
    };

    render(<OrdersScreen client={client} now={MOCK_NOW} />);
    await screen.findByRole('table');

    expect(
      screen.getByText(`${MOCK_ORDERS.length} of ${MOCK_ORDERS.length + 40} orders`)
    ).toBeInTheDocument();
    expect(screen.queryByText(/not listed/)).not.toBeInTheDocument();
  });

  it('says what happened and what to do when the ledger fails to load', async () => {
    render(<OrdersScreen client={failing()} now={MOCK_NOW} />);

    expect(await screen.findByText('No connection to the server')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
