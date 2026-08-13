import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { FlowBoardScreen } from '@/app/schedule/flow-board/FlowBoardScreen';
import { ApiError, createMockClient } from '@/lib/api';
import type { ApiClient } from '@/lib/api';

/**
 * The board at 10:20 on the fixture clinic day: one patient delayed, one in the
 * caution band, the rest calm. What is asserted here is the OpenEMR lesson - a
 * delay is a static, counted, worded state, and advancing a status is one click
 * with an undo behind it.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => '/schedule/flow-board',
}));

function failing(error: ApiError): ApiClient {
  return {
    mode: 'mock',
    patients: { list: () => Promise.reject(error), get: () => Promise.reject(error) },
    appointments: { list: () => Promise.reject(error), get: () => Promise.reject(error) },
  };
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
    // Bram Voskuijlen has been waiting since 09:26 against a 10:20 now.
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

    expect(screen.getByRole('region', { name: /^Arrived, 0 patients$/ })).toBeInTheDocument();
    const toast = await screen.findByRole('status');
    expect(toast).toHaveTextContent('Checked in');
    expect(within(toast).getByRole('button', { name: 'Undo' })).toBeInTheDocument();
  });

  it('puts the patient back where they were when the undo is taken', async () => {
    render(<FlowBoardScreen client={createMockClient()} />);

    const arrived = await screen.findByRole('region', { name: /^Arrived, 1 patients$/ });
    fireEvent.click(within(arrived).getByRole('button', { name: /^Move .* to checked in$/ }));
    fireEvent.click(
      within(await screen.findByRole('status')).getByRole('button', { name: 'Undo' })
    );

    expect(screen.getByRole('region', { name: /^Arrived, 1 patients$/ })).toBeInTheDocument();
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
    expect(screen.getByRole('region', { name: /^Checked in, 2 patients$/ })).toBeInTheDocument();
  });
});
