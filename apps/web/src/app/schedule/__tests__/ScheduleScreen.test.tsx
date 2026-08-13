import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ScheduleScreen } from '@/app/schedule/ScheduleScreen';
import { ApiError, createMockClient, MOCK_APPOINTMENTS, MOCK_PATIENTS } from '@/lib/api';
import type { ApiClient, Appointment } from '@/lib/api';

/**
 * The day view, driven the way a front desk drives it: look at the day, click a
 * visit, check the patient in. Keyboard operation is asserted separately,
 * because "reachable with a mouse" is not the contract this product signed.
 */

const push = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => '/schedule',
}));

beforeEach(() => {
  push.mockClear();
});

function failing(error: ApiError): ApiClient {
  return {
    mode: 'mock',
    patients: { list: () => Promise.reject(error), get: () => Promise.reject(error) },
    appointments: { list: () => Promise.reject(error), get: () => Promise.reject(error) },
  };
}

function rail(): HTMLElement {
  return screen.getByRole('complementary', { name: 'Page context' });
}

/** The 09:40 acute visit: arrived, not yet checked in, so check-in is the next act. */
const ANKLE_INJURY = /09:40 to 10:00, Noor Haddadin/;

describe('ScheduleScreen', () => {
  it('renders the day as a grid with a column per provider', async () => {
    render(<ScheduleScreen client={createMockClient()} />);

    expect(await screen.findByRole('region', { name: 'Day view grid' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /Dr\. Okafor/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /Dr\. Lindqvist/ })).toBeInTheDocument();
  });

  it('puts a status word on every visit, never colour alone', async () => {
    render(<ScheduleScreen client={createMockClient()} />);

    const block = await screen.findByRole('button', { name: ANKLE_INJURY });
    expect(within(block).getByText('Arrived')).toBeInTheDocument();
  });

  it('leaves cancelled visits off the grid and counts them in the rail', async () => {
    render(<ScheduleScreen client={createMockClient()} />);

    await screen.findByRole('region', { name: 'Day view grid' });
    expect(screen.queryByRole('button', { name: /11:20 to 11:40/ })).not.toBeInTheDocument();
    expect(within(rail()).getByText('Cancelled').closest('div')).toHaveTextContent('1');
  });

  it('selects a visit and offers check-in and the chart in the rail', async () => {
    render(<ScheduleScreen client={createMockClient()} />);

    fireEvent.click(await screen.findByRole('button', { name: ANKLE_INJURY }));

    expect(within(rail()).getByText('Noor Haddadin')).toBeInTheDocument();
    expect(within(rail()).getByRole('button', { name: 'Check in Noor' })).toBeInTheDocument();
    expect(within(rail()).getByRole('link', { name: 'Open chart' })).toBeInTheDocument();
    expect(
      within(rail()).getByRole('link', { name: 'Insurance and eligibility' })
    ).toBeInTheDocument();
  });

  it('confirms check-in before it happens, then confirms it happened', async () => {
    render(<ScheduleScreen client={createMockClient()} />);

    fireEvent.click(await screen.findByRole('button', { name: ANKLE_INJURY }));
    fireEvent.click(within(rail()).getByRole('button', { name: 'Check in Noor' }));

    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent(/creates today's visit and moves them onto the Flow Board/);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Check in Noor' }));

    const toast = await screen.findByRole('status');
    expect(toast).toHaveTextContent('Checked in');
    expect(toast).toHaveTextContent('Noor Haddadin is on the Flow Board.');
  });

  it('lets Escape abandon the check-in without changing anything', async () => {
    render(<ScheduleScreen client={createMockClient()} />);

    fireEvent.click(await screen.findByRole('button', { name: ANKLE_INJURY }));
    fireEvent.click(within(rail()).getByRole('button', { name: 'Check in Noor' }));
    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(within(rail()).getByRole('button', { name: 'Check in Noor' })).toBeEnabled();
  });

  it('makes every visit a real button in the tab order, activated from the keyboard', async () => {
    render(<ScheduleScreen client={createMockClient()} />);

    const block = await screen.findByRole('button', { name: ANKLE_INJURY });
    expect(block.tagName).toBe('BUTTON');
    expect(block).not.toHaveAttribute('tabindex', '-1');

    block.focus();
    expect(block).toHaveFocus();
    // Enter on a focused button dispatches a click; jsdom does not synthesise it.
    fireEvent.click(document.activeElement as HTMLElement);

    expect(block).toHaveAttribute('aria-pressed', 'true');
    expect(within(rail()).getByText('Noor Haddadin')).toBeInTheDocument();
  });

  it('answers Find available with five real open slots', async () => {
    render(<ScheduleScreen client={createMockClient()} />);

    await screen.findByRole('region', { name: 'Day view grid' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Find available' })[0] as HTMLElement);

    expect(await screen.findByText('Next open 20-minute slots')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Book \d\d:\d\d with/ })).toHaveLength(5);
  });

  it('books into a chosen slot and says who was booked', async () => {
    render(<ScheduleScreen client={createMockClient()} />);

    await screen.findByRole('region', { name: 'Day view grid' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Find available' })[0] as HTMLElement);
    fireEvent.click(
      (await screen.findAllByRole('button', { name: /^Book \d\d:\d\d with/ }))[0] as HTMLElement
    );

    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /^Book \w/ }));

    expect(await screen.findByRole('status')).toHaveTextContent('Appointment booked');
  });

  it('shows the empty day with the one action that follows from it', async () => {
    render(<ScheduleScreen client={createMockClient({ appointments: [] })} />);

    expect(await screen.findByText('No appointments on this day')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Find available' }).length).toBeGreaterThan(0);
  });

  it('explains a server failure and offers a retry', async () => {
    render(
      <ScheduleScreen client={failing(new ApiError('boom', { kind: 'http', status: 500 }))} />
    );

    expect(await screen.findByText('The server could not answer')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('does not offer a retry for a failure retrying cannot fix', async () => {
    render(
      <ScheduleScreen client={failing(new ApiError('nope', { kind: 'http', status: 403 }))} />
    );

    expect(await screen.findByText('Your role cannot open this')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('splits a double-booked slot and labels it as such', async () => {
    const first = MOCK_APPOINTMENTS[0] as Appointment;
    const overlapping: Appointment[] = [first, { ...first, id: 'overlap' }];

    render(
      <ScheduleScreen
        client={createMockClient({ appointments: overlapping, patients: MOCK_PATIENTS })}
      />
    );

    expect(await screen.findAllByRole('button', { name: /Double-booked/ })).toHaveLength(2);
  });
});
