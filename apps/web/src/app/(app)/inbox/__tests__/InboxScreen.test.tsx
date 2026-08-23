import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { InboxScreen } from '@/app/(app)/inbox/InboxScreen';
import { ApiError } from '@/lib/api/client';
import { MOCK_INBOX_ITEMS, MOCK_NOW } from '@/lib/api/mock/fixtures';
import { createWorklistClient } from '@/lib/api/worklist';
import type { WorklistClient } from '@/lib/api/worklist';

/**
 * The typed inbox, driven the way it is worked: filter to a stream, finish the
 * item in its row, undo the one that was a mistake. The SLA wording is asserted
 * because "overdue" has to be a word before it is a colour.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => '/inbox',
}));

function failing(): WorklistClient {
  const fail = () => Promise.reject(new ApiError('offline', { kind: 'network' }));
  return { orders: { list: fail }, results: { list: fail }, inbox: { list: fail } };
}

function list(): HTMLElement {
  return screen.getByRole('list', { name: 'Inbox items' });
}

/** Strict indexing makes `[0]` optional; this asserts the match exists. */
function at<T>(items: T[], index = 0): T {
  const item = items[index];
  if (!item) throw new Error(`No element at index ${index}`);
  return item;
}

describe('InboxScreen', () => {
  it('shows every stream with its count and orders the queue by what will hurt', async () => {
    render(<InboxScreen client={createWorklistClient()} now={MOCK_NOW} />);

    const filters = await screen.findByRole('group', { name: 'Filter by stream' });
    expect(within(filters).getByRole('button', { name: /Refills 2/ })).toBeInTheDocument();
    expect(within(filters).getByRole('button', { name: /Everything 11/ })).toBeInTheDocument();

    const rows = within(list()).getAllByRole('listitem');
    expect(at(rows)).toHaveTextContent(/Overdue by/);
  });

  it('states an SLA in words on every row', async () => {
    render(<InboxScreen client={createWorklistClient()} now={MOCK_NOW} />);
    await screen.findByRole('list', { name: 'Inbox items' });

    expect(screen.getByText('Due in 40 min')).toBeInTheDocument();
    expect(screen.getAllByText(/Overdue by/).length).toBe(2);
  });

  it('filters to one stream and back', async () => {
    render(<InboxScreen client={createWorklistClient()} now={MOCK_NOW} />);
    await screen.findByRole('list', { name: 'Inbox items' });

    fireEvent.click(screen.getByRole('button', { name: /Cosign 2/ }));

    const rows = within(list()).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(at(rows)).toHaveTextContent('Cosign');

    fireEvent.click(screen.getByRole('button', { name: /Everything/ }));
    expect(within(list()).getAllByRole('listitem')).toHaveLength(MOCK_INBOX_ITEMS.length);
  });

  it('finishes the common action in the row, and offers an undo', async () => {
    render(<InboxScreen client={createWorklistClient()} now={MOCK_NOW} />);
    await screen.findByRole('list', { name: 'Inbox items' });

    const before = within(list()).getAllByRole('listitem').length;
    fireEvent.click(at(within(list()).getAllByRole('button', { name: 'Approve refill' })));

    expect(await screen.findByText('Refill approved')).toBeInTheDocument();
    expect(within(list()).getAllByRole('listitem')).toHaveLength(before - 1);

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(within(list()).getAllByRole('listitem')).toHaveLength(before);
  });

  it('claims a team-pool item without leaving the row', async () => {
    render(<InboxScreen client={createWorklistClient()} now={MOCK_NOW} />);
    await screen.findByRole('list', { name: 'Inbox items' });

    const claim = within(list()).getAllByRole('button', { name: 'Assign to me' });
    const before = claim.length;
    fireEvent.click(at(claim));

    expect(await screen.findByText('Assigned to you')).toBeInTheDocument();
    expect(within(list()).getAllByRole('button', { name: 'Assign to me' })).toHaveLength(
      before - 1
    );
  });

  it('is operable from the keyboard, with a visible action per row', async () => {
    render(<InboxScreen client={createWorklistClient()} now={MOCK_NOW} />);
    await screen.findByRole('list', { name: 'Inbox items' });

    const action = at(within(list()).getAllByRole('button', { name: 'Cosign note' }));
    action.focus();
    expect(document.activeElement).toBe(action);

    fireEvent.keyDown(action, { key: 'Enter' });
    fireEvent.click(action);
    expect(await screen.findByText('Note cosigned')).toBeInTheDocument();
  });

  it('narrows to the team pool from the assignment filter', async () => {
    render(<InboxScreen client={createWorklistClient()} now={MOCK_NOW} />);
    await screen.findByRole('list', { name: 'Inbox items' });

    fireEvent.change(screen.getByLabelText('Assignment'), { target: { value: 'TEAM' } });

    const rows = within(await screen.findByRole('list', { name: 'Inbox items' })).getAllByRole(
      'listitem'
    );
    expect(rows).toHaveLength(MOCK_INBOX_ITEMS.filter((item) => item.assignedTo === 'TEAM').length);
  });

  it('says the inbox is clear rather than showing a blank region', async () => {
    render(<InboxScreen client={createWorklistClient({ inbox: [] })} now={MOCK_NOW} />);

    expect(await screen.findByText('Inbox zero, for now')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to the schedule' })).toHaveAttribute(
      'href',
      '/schedule'
    );
  });

  it('says what happened and what to do when the inbox fails to load', async () => {
    render(<InboxScreen client={failing()} now={MOCK_NOW} />);

    expect(await screen.findByText('No connection to the server')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

/** Opens the palette the way a keyboard user does, and runs one verb by name. */
async function runCommand(label: string): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: /Search or run a command/ }));
  fireEvent.click(await screen.findByRole('option', { name: new RegExp(label) }));
}

describe('InboxScreen, driven from the command palette', () => {
  it.each(['results', 'messages', 'refills', 'cosign', 'tasks'])(
    'filters the queue to %s',
    async (stream) => {
      render(<InboxScreen client={createWorklistClient()} now={MOCK_NOW} />);
      await screen.findByRole('list', { name: 'Inbox items' });

      await runCommand(`Show ${stream} in the inbox`);

      const rows = within(list()).queryAllByRole('listitem');
      const expected = MOCK_INBOX_ITEMS.filter(
        (item) => item.stream === stream.toUpperCase()
      ).length;
      expect(rows).toHaveLength(expected);
    }
  );

  it('goes back to every stream from the palette', async () => {
    render(<InboxScreen client={createWorklistClient()} now={MOCK_NOW} />);
    await screen.findByRole('list', { name: 'Inbox items' });

    await runCommand('Show refills in the inbox');
    expect(within(list()).getAllByRole('listitem').length).toBeLessThan(MOCK_INBOX_ITEMS.length);

    await runCommand('Show every inbox stream');
    expect(within(list()).getAllByRole('listitem')).toHaveLength(MOCK_INBOX_ITEMS.length);
  });

  it('switches between my queue and the team pool without a mouse', async () => {
    render(<InboxScreen client={createWorklistClient()} now={MOCK_NOW} />);
    await screen.findByRole('list', { name: 'Inbox items' });

    await runCommand('Show only my inbox items');
    expect(await screen.findByLabelText('Assignment')).toHaveValue('ME');
    expect(within(list()).getAllByRole('listitem')).toHaveLength(
      MOCK_INBOX_ITEMS.filter((item) => item.assignedTo === 'ME').length
    );

    await runCommand('Show the team pool');
    expect(await screen.findByLabelText('Assignment')).toHaveValue('TEAM');
  });
});

describe('InboxScreen, undo', () => {
  it('puts a claimed item back in the pool when the claim was a mistake', async () => {
    render(<InboxScreen client={createWorklistClient()} now={MOCK_NOW} />);
    await screen.findByRole('list', { name: 'Inbox items' });

    const before = within(list()).getAllByRole('button', { name: 'Assign to me' }).length;
    fireEvent.click(at(within(list()).getAllByRole('button', { name: 'Assign to me' })));
    await screen.findByText('Assigned to you');

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

    expect(within(list()).getAllByRole('button', { name: 'Assign to me' })).toHaveLength(before);
    expect(screen.queryByText('Assigned to you')).not.toBeInTheDocument();
  });

  it('dismisses the toast without undoing what it confirmed', async () => {
    render(<InboxScreen client={createWorklistClient()} now={MOCK_NOW} />);
    await screen.findByRole('list', { name: 'Inbox items' });

    const before = within(list()).getAllByRole('listitem').length;
    fireEvent.click(at(within(list()).getAllByRole('button', { name: 'Approve refill' })));
    await screen.findByText('Refill approved');

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
    expect(within(list()).getAllByRole('listitem')).toHaveLength(before - 1);
  });

  it('undoes the last completion only, not everything finished so far', async () => {
    render(<InboxScreen client={createWorklistClient()} now={MOCK_NOW} />);
    await screen.findByRole('list', { name: 'Inbox items' });

    const before = within(list()).getAllByRole('listitem').length;
    fireEvent.click(at(within(list()).getAllByRole('button', { name: 'Approve refill' })));
    await screen.findByText('Refill approved');
    fireEvent.click(at(within(list()).getAllByRole('button', { name: 'Assign to me' })));
    await screen.findByText('Assigned to you');

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

    // The refill stays approved; only the claim is reversed.
    expect(within(list()).getAllByRole('listitem')).toHaveLength(before - 1);
  });
});
