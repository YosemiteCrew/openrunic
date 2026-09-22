import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { InboxScreen } from '@/app/(app)/inbox/InboxScreen';
import { ApiError } from '@/lib/api/client';
import { MOCK_INBOX_ITEMS, MOCK_NOW, MOCK_PATIENTS } from '@/lib/api/mock/fixtures';
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
  return {
    orders: { list: fail },
    results: { list: fail, analytes: fail },
    inbox: { list: fail },
  };
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

  /* Three states, not two, and all three in one render because the point is
     that they are told apart. A task with no patient is the practice's; a task
     whose id the name read could not answer for is somebody's and unnamed; a
     task whose id it could is named. Before #559 the third was impossible in a
     live build - every row resolved through the fixtures - so the second and
     third collapsed into the first and announced a patient's work as the
     practice's. Driven through the screen rather than the list, because the
     branch is a property of the row a reader scans. */
  it('separates a task nobody owns, one it cannot name, and one it can', async () => {
    const item = at([...MOCK_INBOX_ITEMS]);
    const patient = MOCK_PATIENTS[0];
    if (!patient) throw new Error('The fixtures need a patient.');
    const client = createWorklistClient({
      inbox: [
        { ...item, id: 'practice', patientId: null },
        { ...item, id: 'unnamed', patientId: '0192f1a0-0000-7000-8000-0000000000ff' },
        { ...item, id: 'named', patientId: patient.id },
      ],
    });
    render(<InboxScreen client={client} now={MOCK_NOW} />);
    await screen.findByRole('list', { name: 'Inbox items' });

    /* The awaited assertion comes FIRST, and the other two are then exact. The
       name is a second read over the ids this page came back with, so until it
       settles the named row reads unnamed as well - and `getByText` run before
       it lands finds "Patient record" twice. Asserting one of each AFTER the
       read is what says the three states were actually told apart, rather than
       two of them agreeing for a moment. */
    await within(list()).findByText(`${patient.name.family}, ${patient.name.given}`);
    expect(within(list()).getByText('Practice-wide')).toBeInTheDocument();
    expect(within(list()).getByText('Patient record')).toBeInTheDocument();
  });

  /* #539, on the third of the three worklists: this screen has no pager and its
     chip counts are a count of ONE page, so a queue that matched more than this
     page says so rather than letting the chips read as the practice's whole
     inbox. The refusal is the second, separate fact - an administrative task is
     absent for a different reason and has a different remedy. */
  it('states the page it is showing and the rows it refused, as two facts', async () => {
    const item = at([...MOCK_INBOX_ITEMS]);
    const client = {
      ...createWorklistClient(),
      inbox: {
        list: () =>
          Promise.resolve({
            data: [item],
            page: { page: 1, pageSize: 100, total: 94, totalPages: 1 },
            refused: 2,
          }),
      },
    } satisfies WorklistClient;
    render(<InboxScreen client={client} now={MOCK_NOW} />);
    await screen.findByRole('list', { name: 'Inbox items' });

    // 1 rendered + 2 refused is the window the route answered, under a total of 94.
    expect(screen.getByText(/3 of 94 items/)).toBeInTheDocument();
    expect(screen.getByText(/2 of the items on this page are not listed/)).toBeInTheDocument();
  });

  it('says neither thing when the page is the whole queue', async () => {
    render(<InboxScreen client={createWorklistClient()} now={MOCK_NOW} />);
    await screen.findByRole('list', { name: 'Inbox items' });

    expect(screen.queryByText(/of the items on this page/)).not.toBeInTheDocument();
    expect(screen.queryByText(/items\. The rest are on pages/)).not.toBeInTheDocument();
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
