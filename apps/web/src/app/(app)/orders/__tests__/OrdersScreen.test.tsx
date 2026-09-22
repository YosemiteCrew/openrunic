import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OrdersScreen } from '@/app/(app)/orders/OrdersScreen';
import { ApiError } from '@/lib/api/client';
import { MOCK_NOW, MOCK_ORDERS } from '@/lib/api/mock/fixtures';
import { createWorklistClient } from '@/lib/api/worklist';
import type { WorklistClient } from '@/lib/api/worklist';

const push = vi.fn();
const CORE_ORDERS = MOCK_ORDERS.slice(0, 13);

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => '/orders',
}));

function failing(): WorklistClient {
  const fail = () => Promise.reject(new ApiError('offline', { kind: 'network' }));
  return {
    orders: { list: fail },
    results: { list: fail, analytes: fail },
    inbox: { list: fail },
  };
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
  const base = createWorklistClient({ orders: CORE_ORDERS });
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

/**
 * A page the route truncated: the ledger matched `beyond` more orders than it
 * put on the page, and this screen has no pager to reach them (#539).
 *
 * `refused` stays zero here so the two causes stay separable. A row absent
 * because the ledger has no word for it and a row absent because it is on page
 * two are different facts with different remedies, and a screen that printed
 * one number for both would be wrong in whichever direction the reader guessed.
 */
function truncated(beyond: number): WorklistClient {
  const base = createWorklistClient({ orders: CORE_ORDERS });
  return {
    ...base,
    orders: {
      list: async (query) => {
        const page = await base.orders.list(query);
        return { ...page, page: { ...page.page, total: page.page.total + beyond } };
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

  it('renders the demo beyond one page and names the unreachable remainder', async () => {
    render(<OrdersScreen client={createWorklistClient()} now={MOCK_NOW} />);
    const table = await screen.findByRole('table');

    expect(within(table).getAllByRole('row')).toHaveLength(101);
    expect(
      screen.getByText(`100 of ${MOCK_ORDERS.length} orders.`, { exact: false })
    ).toBeInTheDocument();
    expect(screen.queryByText(`${MOCK_ORDERS.length} orders`)).not.toBeInTheDocument();
    expect(screen.queryByText(/not listed/)).not.toBeInTheDocument();
  });

  /* The count and the list have to answer the same question. A clinician
     reading a total of 16 and counting 13 rows cannot tell whether three are
     missing or three are elsewhere, so the screen says which. */
  it('states the rows it matched but cannot render, beside the total', async () => {
    render(<OrdersScreen client={withRefused(3)} now={MOCK_NOW} />);

    const table = await screen.findByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(CORE_ORDERS.length + 1);
    expect(screen.getByText(`${CORE_ORDERS.length + 3} orders`)).toBeInTheDocument();
    expect(screen.getByText(/^3 of the orders on this page are not listed/)).toBeInTheDocument();
  });

  /* The blocker on #540: the route paginates at 25 by default and this screen
     has no pager, so a bare total over a full table says nothing about whether
     the table is the whole match. The count line has to name the window. */
  it('names the window when the ledger matched more orders than the page holds', async () => {
    render(<OrdersScreen client={truncated(35)} now={MOCK_NOW} />);

    const table = await screen.findByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(CORE_ORDERS.length + 1);
    expect(
      screen.getByText(`${CORE_ORDERS.length} of ${CORE_ORDERS.length + 35} orders.`, {
        exact: false,
      })
    ).toBeInTheDocument();
    /* The bare total is what the reader would otherwise have read as the row
       count, so it must not also be on the page. */
    expect(screen.queryByText(`${CORE_ORDERS.length + 35} orders`)).not.toBeInTheDocument();
  });

  it('asks for a window wider than the route default', async () => {
    const list = vi.fn(createWorklistClient().orders.list);
    render(
      <OrdersScreen client={{ ...createWorklistClient(), orders: { list } }} now={MOCK_NOW} />
    );
    await screen.findByRole('table');

    expect(list).toHaveBeenCalledWith(expect.objectContaining({ pageSize: 100 }));
  });

  it('says what happened and what to do when the ledger fails to load', async () => {
    render(<OrdersScreen client={failing()} now={MOCK_NOW} />);

    expect(await screen.findByText('No connection to the server')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
