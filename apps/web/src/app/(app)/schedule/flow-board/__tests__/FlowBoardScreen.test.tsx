import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { FlowBoardScreen } from '@/app/(app)/schedule/flow-board/FlowBoardScreen';
import { ApiError, createMockClient } from '@/lib/api';
import type { ApiClient } from '@/lib/api';

/**
 * The board at 10:20 on the fixture clinic day: one patient delayed, one in the
 * caution band, the rest calm. What is asserted here is the legacy lesson - a
 * delay is a static, counted, worded state, and advancing a status is one click
 * with an undo behind it.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => '/schedule/flow-board',
}));

function failing(error: ApiError): ApiClient {
  return createMockClient({ failure: error });
}

function column(label: string): HTMLElement {
  return screen.getByRole('region', { name: new RegExp(`^${label}, \\d+ patients$`) });
}

describe('FlowBoardScreen', () => {
  it('renders one column per status with its count in the header', async () => {
    render(<FlowBoardScreen client={createMockClient()} />);

    expect(await screen.findByRole('region', { name: /^Arrived, \d+ patients$/ })).toBeVisible();
    for (const label of ['Checked in', 'Roomed', 'In progress', 'Checked out']) {
      expect(column(label)).toBeInTheDocument();
    }
  });

  it('shows both clocks on a card: time in status and time in the building', async () => {
    render(<FlowBoardScreen client={createMockClient()} />);

    const arrived = await screen.findByRole('region', { name: /^Arrived, \d+ patients$/ });
    expect(within(arrived).getByText('In this status')).toBeInTheDocument();
    expect(within(arrived).getByText('In the building')).toBeInTheDocument();
  });

  it('words the delay rather than only tinting it, and never blinks', async () => {
    render(<FlowBoardScreen client={createMockClient()} />);

    const checkedIn = await screen.findByRole('region', { name: /^Checked in, \d+ patients$/ });
    // Sampleton Mockford has been waiting since 09:26 against a 10:20 now.
    expect(within(checkedIn).getByText(/^Delayed \d+/)).toBeInTheDocument();
  });

  it('raises the caution band with its own counted word', async () => {
    render(<FlowBoardScreen client={createMockClient()} />);

    const arrived = await screen.findByRole('region', { name: /^Arrived, \d+ patients$/ });
    expect(within(arrived).getByText(/^Waiting \d+/)).toBeInTheDocument();
  });

  it('advances a patient in one click and offers an undo', async () => {
    render(<FlowBoardScreen client={createMockClient()} />);

    const arrived = await screen.findByRole('region', { name: /^Arrived, 1 patients$/ });
    fireEvent.click(within(arrived).getByRole('button', { name: /^Move .* to checked in$/ }));

    // The card moves once the server has agreed, not on the click.
    expect(
      await screen.findByRole('region', { name: /^Arrived, 0 patients$/ })
    ).toBeInTheDocument();
    const toast = await screen.findByRole('status');
    expect(toast).toHaveTextContent('Checked in');
    expect(within(toast).getByRole('button', { name: 'Undo' })).toBeInTheDocument();
  });

  it('records the advance, so a fresh read of the day finds the patient moved', async () => {
    const client = createMockClient();
    render(<FlowBoardScreen client={client} />);

    const arrived = await screen.findByRole('region', { name: /^Arrived, 1 patients$/ });
    fireEvent.click(within(arrived).getByRole('button', { name: /^Move .* to checked in$/ }));
    await screen.findByRole('region', { name: /^Arrived, 0 patients$/ });

    const board = await client.appointments.list({ status: 'ARRIVED' });
    expect(board.data).toHaveLength(0);
  });

  it('puts the patient back where they were when the undo is taken', async () => {
    render(<FlowBoardScreen client={createMockClient()} />);

    const arrived = await screen.findByRole('region', { name: /^Arrived, 1 patients$/ });
    fireEvent.click(within(arrived).getByRole('button', { name: /^Move .* to checked in$/ }));
    fireEvent.click(
      within(await screen.findByRole('status')).getByRole('button', { name: 'Undo' })
    );

    expect(
      await screen.findByRole('region', { name: /^Arrived, 1 patients$/ })
    ).toBeInTheDocument();
  });

  it('assigns a room from the board and says where the patient went', async () => {
    render(<FlowBoardScreen client={createMockClient()} />);

    const arrived = await screen.findByRole('region', { name: /^Arrived, \d+ patients$/ });
    const roomSelect = within(arrived).getByRole('combobox', { name: /^Room for / });
    fireEvent.change(roomSelect, { target: { value: 'Room 4' } });

    const toast = await screen.findByRole('status');
    expect(toast).toHaveTextContent('Room assigned');
    expect(toast).toHaveTextContent('Room 4');
  });

  it('filters the board to delayed patients only', async () => {
    render(<FlowBoardScreen client={createMockClient()} />);

    await screen.findByRole('region', { name: /^Arrived, \d+ patients$/ });
    fireEvent.click(screen.getByRole('switch', { name: /Delayed patients only/ }));

    expect(screen.getByRole('region', { name: /^In progress, 0 patients$/ })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /^Checked out, 0 patients$/ })).toBeInTheDocument();
  });

  it('filters by room without hiding the columns themselves', async () => {
    render(<FlowBoardScreen client={createMockClient()} />);

    await screen.findByRole('region', { name: /^Arrived, \d+ patients$/ });
    fireEvent.change(screen.getByRole('combobox', { name: 'Room' }), {
      target: { value: 'Room 1' },
    });

    expect(screen.getByRole('region', { name: /^Arrived, 0 patients$/ })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /^In progress, 1 patients$/ })).toBeInTheDocument();
  });

  it('says when it last read the server rather than implying it is live', async () => {
    render(<FlowBoardScreen client={createMockClient()} />);

    expect(await screen.findByText(/Last read at/)).toBeInTheDocument();
    expect(screen.getByText('10:20')).toBeInTheDocument();
  });

  it('shows the empty board with the one action that follows from it', async () => {
    render(<FlowBoardScreen client={createMockClient({ appointments: [] })} />);

    expect(await screen.findByText('No patients on the board yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to the schedule' })).toBeInTheDocument();
  });

  it('explains a server failure and offers a retry', async () => {
    render(<FlowBoardScreen client={failing(new ApiError('boom', { kind: 'network' }))} />);

    expect(await screen.findByText('No connection to the server')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('is operable from the keyboard: every advance is a focusable button', async () => {
    render(<FlowBoardScreen client={createMockClient()} />);

    const arrived = await screen.findByRole('region', { name: /^Arrived, \d+ patients$/ });
    const advance = within(arrived).getByRole('button', { name: /^Move .* to checked in$/ });
    advance.focus();
    expect(advance).toHaveFocus();

    fireEvent.click(document.activeElement as HTMLElement);
    expect(
      await screen.findByRole('region', { name: /^Checked in, 2 patients$/ })
    ).toBeInTheDocument();
  });
});

/** Opens the palette the way a keyboard user does, and runs one verb by name. */
async function runCommand(label: string | RegExp): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: /Search or run a command/ }));
  fireEvent.click(
    await screen.findByRole('option', {
      name: typeof label === 'string' ? new RegExp(label) : label,
    })
  );
}

describe('FlowBoardScreen, driven from the command palette', () => {
  it('toggles the delayed filter, and the verb renames itself to what it now does', async () => {
    render(<FlowBoardScreen client={createMockClient()} />);
    await screen.findByRole('region', { name: /^Arrived, \d+ patients$/ });

    await runCommand('Show delayed patients only');
    expect(screen.getByRole('switch', { name: /Delayed patients only/ })).toBeChecked();

    // The verb is now the opposite one: a palette that keeps offering "show
    // delayed only" while it is already on is a palette nobody trusts.
    await runCommand('Show every patient on the board');
    expect(screen.getByRole('switch', { name: /Delayed patients only/ })).not.toBeChecked();
  });

  it('clears provider, room and delay filters in one verb', async () => {
    render(<FlowBoardScreen client={createMockClient()} />);
    await screen.findByRole('region', { name: /^Arrived, \d+ patients$/ });

    const cards = () => screen.queryAllByRole('button', { name: /^Move / }).length;
    const everyone = cards();

    fireEvent.change(screen.getByRole('combobox', { name: 'Room' }), {
      target: { value: 'Room 1' },
    });
    fireEvent.click(screen.getByRole('switch', { name: /Delayed patients only/ }));
    expect(cards()).toBeLessThan(everyone);

    await runCommand('Clear board filters');

    expect(screen.getByRole('combobox', { name: 'Room' })).toHaveValue('');
    expect(screen.getByRole('combobox', { name: 'Provider' })).toHaveValue('');
    expect(screen.getByRole('switch', { name: /Delayed patients only/ })).not.toBeChecked();
    expect(cards()).toBe(everyone);
  });

  it('reads the board again, which is the only way it ever refreshes', async () => {
    render(<FlowBoardScreen client={createMockClient()} />);
    await screen.findByRole('region', { name: /^Arrived, \d+ patients$/ });

    await runCommand('Read the board again');

    // The board never polls on its own, so a re-read has to leave it whole
    // rather than emptying it while it waits.
    expect(
      await screen.findByRole('region', { name: /^Arrived, 1 patients$/ })
    ).toBeInTheDocument();
  });

  it('narrows to one provider without hiding the columns', async () => {
    render(<FlowBoardScreen client={createMockClient()} />);
    await screen.findByRole('region', { name: /^Arrived, \d+ patients$/ });

    const provider = screen.getByRole('combobox', { name: 'Provider' }) as HTMLSelectElement;
    const option = Array.from(provider.options).find((entry) => entry.text.includes('Lindqvist'));
    fireEvent.change(provider, { target: { value: option!.value } });

    // Every column still renders, so the board's shape does not change under a
    // filter; only the counts do.
    expect(
      (await screen.findAllByRole('region', { name: /, \d+ patients$/ })).length
    ).toBeGreaterThan(3);
  });
});

describe('FlowBoardScreen, rooms and undo', () => {
  it('does not claim to have cleared a room the API will not clear', async () => {
    render(<FlowBoardScreen client={createMockClient()} />);
    const inProgress = await screen.findByRole('region', { name: /^In progress, \d+ patients$/ });

    const roomSelect = within(inProgress).getByRole('combobox', { name: /^Room for / });
    const before = (roomSelect as HTMLSelectElement).value;
    fireEvent.change(roomSelect, { target: { value: '' } });

    // The empty entry is the select's placeholder, not a "no room" instruction:
    // the appointment patch takes a room of at least one character, so there is
    // nothing to send and nothing to announce.
    await waitFor(() => expect(roomSelect).toHaveValue(before));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('puts a patient back in the room the undo came from', async () => {
    render(<FlowBoardScreen client={createMockClient()} />);
    await screen.findByRole('region', { name: /^In progress, \d+ patients$/ });

    /* Re-queried on each assertion rather than held: a re-read of the day
       replaces the card, so a reference captured before the write is a node
       that is no longer on the board. */
    const roomSelect = (): HTMLElement =>
      within(screen.getByRole('region', { name: /^In progress, \d+ patients$/ })).getByRole(
        'combobox',
        { name: /^Room for / }
      );
    const before = (roomSelect() as HTMLSelectElement).value;

    fireEvent.change(roomSelect(), { target: { value: 'Room 4' } });
    await waitFor(() => expect(roomSelect()).toHaveValue('Room 4'));

    fireEvent.click(
      within(await screen.findByRole('status')).getByRole('button', { name: 'Undo' })
    );

    // The undo is a second write back, so the room returns from the server
    // rather than from a remembered value on this screen.
    await waitFor(() => expect(roomSelect()).toHaveValue(before));
  });

  it('dismisses the confirmation without undoing the move it confirmed', async () => {
    render(<FlowBoardScreen client={createMockClient()} />);
    const arrived = await screen.findByRole('region', { name: /^Arrived, \d+ patients$/ });

    fireEvent.click(within(arrived).getAllByRole('button', { name: /^Move / })[0]!);
    const toast = await screen.findByRole('status');
    fireEvent.click(within(toast).getByRole('button', { name: 'Dismiss' }));

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(
      await screen.findByRole('region', { name: /^Arrived, 0 patients$/ })
    ).toBeInTheDocument();
  });
});

describe('FlowBoardScreen, when the server refuses a move', () => {
  /** Reads the day normally and refuses every write, as a lost grant would. */
  function refusesWrites(): ApiClient {
    const client = createMockClient();
    return {
      ...client,
      appointments: {
        ...client.appointments,
        update: () =>
          Promise.reject(
            new ApiError('forbidden', {
              kind: 'http',
              status: 403,
              problem: {
                type: 'https://openrunic.org/problems/forbidden',
                title: 'Not permitted',
                status: 403,
                detail: 'This facility is not granted to your role.',
                instance: '/bff/v0/appointments',
                requestId: 'req-7',
              },
            })
          ),
      },
    };
  }

  it('leaves the card where it is and repeats the reason it was given', async () => {
    render(<FlowBoardScreen client={refusesWrites()} />);

    const arrived = await screen.findByRole('region', { name: /^Arrived, 1 patients$/ });
    fireEvent.click(within(arrived).getByRole('button', { name: /^Move .* to checked in$/ }));

    // A refusal interrupts rather than waiting for a pause, which is what the
    // alert role is for: the clinician is about to walk off with the patient.
    const toast = await screen.findByRole('alert');
    expect(toast).toHaveTextContent('That move was refused');
    // The server's own sentence, because a generic failure is not the answer.
    expect(toast).toHaveTextContent('This facility is not granted to your role.');
    // Nothing to undo: the board never claimed the card had moved.
    expect(within(toast).queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: /^Arrived, 1 patients$/ })).toBeInTheDocument();
  });

  it('says so for a refused room assignment too, not only for an advance', async () => {
    render(<FlowBoardScreen client={refusesWrites()} />);

    const arrived = await screen.findByRole('region', { name: /^Arrived, \d+ patients$/ });
    fireEvent.change(within(arrived).getByRole('combobox', { name: /^Room for / }), {
      target: { value: 'Room 4' },
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('That move was refused');
  });
});
