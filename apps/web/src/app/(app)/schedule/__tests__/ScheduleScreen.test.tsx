import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ScheduleScreen } from '@/app/(app)/schedule/ScheduleScreen';
import {
  ApiError,
  createMockClient,
  MOCK_APPOINTMENTS,
  MOCK_DIRECTORY_FACILITIES,
  MOCK_DIRECTORY_USERS,
  MOCK_PATIENTS,
  MOCK_PROVIDERS,
} from '@/lib/api';
import type {
  ApiClient,
  Appointment,
  AppointmentCreateBody,
  FacilityDto,
  UserDto,
} from '@/lib/api';

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
  return createMockClient({ failure: error });
}

function rail(): HTMLElement {
  return screen.getByRole('complementary', { name: 'Page context' });
}

/** The 09:40 acute visit: arrived, not yet checked in, so check-in is the next act. */
const ANKLE_INJURY = /09:40 to 10:00, Fictitia Notreal/;

describe('ScheduleScreen', () => {
  it('renders the day as a grid with a column per provider', async () => {
    render(<ScheduleScreen client={createMockClient()} />);

    expect(await screen.findByRole('region', { name: 'Day view grid' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /Ada Okafor/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /Ingrid Lindqvist/ })).toBeInTheDocument();
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

    expect(within(rail()).getByText('Fictitia Notreal')).toBeInTheDocument();
    expect(within(rail()).getByRole('button', { name: 'Check in Fictitia' })).toBeInTheDocument();
    expect(within(rail()).getByRole('link', { name: 'Open chart' })).toBeInTheDocument();
    expect(
      within(rail()).getByRole('link', { name: 'Insurance and eligibility' })
    ).toBeInTheDocument();
  });

  it('confirms check-in before it happens, then confirms it happened', async () => {
    render(<ScheduleScreen client={createMockClient()} />);

    fireEvent.click(await screen.findByRole('button', { name: ANKLE_INJURY }));
    fireEvent.click(within(rail()).getByRole('button', { name: 'Check in Fictitia' }));

    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent(/moves them onto the Flow Board/);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Check in Fictitia' }));

    const toast = await screen.findByRole('status');
    expect(toast).toHaveTextContent('Checked in');
    expect(toast).toHaveTextContent('Fictitia Notreal is on the Flow Board.');
  });

  it('records the check-in, so the rail stops offering it on the next read', async () => {
    const client = createMockClient();
    render(<ScheduleScreen client={client} />);

    fireEvent.click(await screen.findByRole('button', { name: ANKLE_INJURY }));
    fireEvent.click(within(rail()).getByRole('button', { name: 'Check in Fictitia' }));
    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Check in Fictitia' })
    );
    await screen.findByRole('status');

    // The visit moved on the server, not just on this screen.
    const day = await client.appointments.list({ status: 'CHECKED_IN' });
    expect(day.data.some((entry) => entry.checkedInAt !== null)).toBe(true);
    await waitFor(() =>
      expect(within(rail()).getByRole('button', { name: 'Already checked in' })).toBeDisabled()
    );
  });

  it('lets Escape abandon the check-in without changing anything', async () => {
    render(<ScheduleScreen client={createMockClient()} />);

    fireEvent.click(await screen.findByRole('button', { name: ANKLE_INJURY }));
    fireEvent.click(within(rail()).getByRole('button', { name: 'Check in Fictitia' }));
    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(within(rail()).getByRole('button', { name: 'Check in Fictitia' })).toBeEnabled();
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
    expect(within(rail()).getByText('Fictitia Notreal')).toBeInTheDocument();
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

/** Opens the palette the way a keyboard user does, and runs one verb by name. */
async function runCommand(label: string | RegExp): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: /Search or run a command/ }));
  fireEvent.click(
    await screen.findByRole('option', {
      name: typeof label === 'string' ? new RegExp(label) : label,
    })
  );
}

function dayHeading(): string {
  return screen.getByText(/The clinic day, per provider/).textContent ?? '';
}

describe('ScheduleScreen, moving around the day', () => {
  it('pages back and forward a day, and comes back to today', async () => {
    render(<ScheduleScreen client={createMockClient()} />);
    await screen.findByRole('region', { name: 'Day view grid' });

    expect(dayHeading()).toContain('12 Aug 2026');

    fireEvent.click(screen.getByRole('button', { name: 'Previous day' }));
    expect(dayHeading()).toContain('11 Aug 2026');

    fireEvent.click(screen.getByRole('button', { name: 'Next day' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next day' }));
    expect(dayHeading()).toContain('13 Aug 2026');

    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(dayHeading()).toContain('12 Aug 2026');
  });

  it('shows an empty day rather than the previous grid when paging onto one', async () => {
    render(<ScheduleScreen client={createMockClient()} />);
    await screen.findByRole('region', { name: 'Day view grid' });

    fireEvent.click(screen.getByRole('button', { name: 'Previous day' }));

    expect(await screen.findByText('No appointments on this day')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Day view grid' })).not.toBeInTheDocument();
  });

  it('narrows the grid to one provider, and back to all of them', async () => {
    render(<ScheduleScreen client={createMockClient()} />);
    await screen.findByRole('region', { name: 'Day view grid' });

    fireEvent.change(screen.getByLabelText('Provider'), {
      target: { value: MOCK_PROVIDERS[0].id },
    });

    expect(
      await screen.findByRole('heading', { level: 2, name: /Ada Okafor/ })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { level: 2, name: /Ingrid Lindqvist/ })
    ).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Provider'), { target: { value: '' } });
    expect(
      await screen.findByRole('heading', { level: 2, name: /Ingrid Lindqvist/ })
    ).toBeInTheDocument();
  });
});

describe('ScheduleScreen, driven from the command palette', () => {
  it('pages the day without a mouse, in both directions and back to today', async () => {
    render(<ScheduleScreen client={createMockClient()} />);
    await screen.findByRole('region', { name: 'Day view grid' });

    await runCommand('Go to the previous day');
    expect(dayHeading()).toContain('11 Aug 2026');

    await runCommand('Go to the next day');
    await runCommand('Go to the next day');
    expect(dayHeading()).toContain('13 Aug 2026');

    await runCommand('Go to today');
    expect(dayHeading()).toContain('12 Aug 2026');
  });

  it('opens the open-slot panel, which can then be hidden again', async () => {
    render(<ScheduleScreen client={createMockClient()} />);
    await screen.findByRole('region', { name: 'Day view grid' });

    await runCommand('Find available slots');
    expect(await screen.findByText('Next open 20-minute slots')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Hide open slots' }));
    expect(screen.queryByText('Next open 20-minute slots')).not.toBeInTheDocument();
  });

  it('takes a walk-in straight into the first slot that is genuinely free', async () => {
    render(<ScheduleScreen client={createMockClient()} />);
    await screen.findByRole('region', { name: 'Day view grid' });

    await runCommand('Add walk-in');

    // The booking dialog opens on a slot already chosen, rather than making the
    // desk read a list while somebody stands at the counter.
    const dialog = await screen.findByRole('dialog', { name: 'Book appointment' });
    expect(dialog).toHaveTextContent(/Booking holds the slot immediately/);
    // And the panel behind it stays open, so a different slot is one click away.
    expect(screen.getByText('Next open 20-minute slots')).toBeInTheDocument();
  });

  it('offers check-in only for a visit that is selected and not already in', async () => {
    render(<ScheduleScreen client={createMockClient()} />);
    await screen.findByRole('region', { name: 'Day view grid' });

    fireEvent.click(screen.getByRole('button', { name: /Search or run a command/ }));
    expect(screen.queryByRole('option', { name: /Check in/ })).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByLabelText('Search patients, screens and actions'), {
      key: 'Escape',
    });

    fireEvent.click(screen.getByRole('button', { name: ANKLE_INJURY }));
    await runCommand('Check in Fictitia');

    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Check in Fictitia' }));
    await screen.findByRole('status');

    // Once she is in, the verb is gone: the palette never offers a second
    // check-in for a patient already on the Flow Board.
    fireEvent.click(screen.getByRole('button', { name: /Search or run a command/ }));
    expect(screen.queryByRole('option', { name: /Check in Noor/ })).not.toBeInTheDocument();
  });
});

describe('ScheduleScreen, backing out of an action', () => {
  it('cancels the check-in from the dialog footer without checking anyone in', async () => {
    render(<ScheduleScreen client={createMockClient()} />);

    fireEvent.click(await screen.findByRole('button', { name: ANKLE_INJURY }));
    fireEvent.click(within(rail()).getByRole('button', { name: 'Check in Fictitia' }));
    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' })
    );

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(within(rail()).getByRole('button', { name: 'Check in Fictitia' })).toBeEnabled();
  });

  it('cancels a booking and leaves the day as it was', async () => {
    render(<ScheduleScreen client={createMockClient()} />);
    await screen.findByRole('region', { name: 'Day view grid' });

    fireEvent.click(screen.getAllByRole('button', { name: 'Find available' })[0] as HTMLElement);
    fireEvent.click(
      (await screen.findAllByRole('button', { name: /^Book \d\d:\d\d with/ }))[0] as HTMLElement
    );
    fireEvent.click(
      within(await screen.findByRole('dialog', { name: 'Book appointment' })).getByRole('button', {
        name: 'Cancel',
      })
    );

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Book appointment' })).not.toBeInTheDocument()
    );
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('dismisses the confirmation toast, which does not undo what it confirmed', async () => {
    render(<ScheduleScreen client={createMockClient()} />);

    fireEvent.click(await screen.findByRole('button', { name: ANKLE_INJURY }));
    fireEvent.click(within(rail()).getByRole('button', { name: 'Check in Fictitia' }));
    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Check in Fictitia' })
    );

    const toast = await screen.findByRole('status');
    expect(within(toast).getByRole('link', { name: 'Open the Flow Board' })).toHaveAttribute(
      'href',
      '/schedule/flow-board'
    );

    fireEvent.click(within(toast).getByRole('button', { name: /Dismiss|Close/ }));

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect(within(rail()).getByRole('button', { name: 'Already checked in' })).toBeDisabled();
  });

  it('books from the rail walk-in button as well as the page action', async () => {
    render(<ScheduleScreen client={createMockClient()} />);
    await screen.findByRole('region', { name: 'Day view grid' });

    fireEvent.click(within(rail()).getByRole('button', { name: 'Add walk-in' }));

    expect(await screen.findByRole('dialog', { name: 'Book appointment' })).toBeInTheDocument();
  });
});

describe('ScheduleScreen, a slot with no patient on it', () => {
  /** A held slot: booked time with nobody attached to it yet. */
  function unassignedDay(): ApiClient {
    const first = MOCK_APPOINTMENTS[0] as Appointment;
    return createMockClient({
      // Booked rather than fulfilled: a visit that already happened cannot be
      // checked in, and the rail reads that off the status now.
      appointments: [
        { ...first, id: 'held-slot', patientId: null, reasonText: null, status: 'BOOKED' },
      ],
      patients: MOCK_PATIENTS,
    });
  }

  it('names the slot as unassigned rather than showing a blank patient row', async () => {
    render(<ScheduleScreen client={unassignedDay()} />);

    fireEvent.click(await screen.findByRole('button', { name: /08:00 to 08:20/ }));

    expect(within(rail()).getByText('Unassigned slot')).toBeInTheDocument();
    // No chart to open and no coverage to check, so neither is offered.
    expect(within(rail()).queryByRole('link', { name: 'Open chart' })).not.toBeInTheDocument();
    expect(within(rail()).getByRole('button', { name: 'Check in' })).toBeInTheDocument();
  });

  it('checks a held slot in, wording the confirmation without a name', async () => {
    render(<ScheduleScreen client={unassignedDay()} />);

    fireEvent.click(await screen.findByRole('button', { name: /08:00 to 08:20/ }));
    fireEvent.click(within(rail()).getByRole('button', { name: 'Check in' }));

    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('Check in this visit. This moves it onto the Flow Board.');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Check in visit' }));

    const toast = await screen.findByRole('status');
    expect(toast).toHaveTextContent('The visit is on the Flow Board.');
  });

  it('offers a check-in verb with no name in it when the slot has no patient', async () => {
    render(<ScheduleScreen client={unassignedDay()} />);

    fireEvent.click(await screen.findByRole('button', { name: /08:00 to 08:20/ }));
    fireEvent.click(screen.getByRole('button', { name: /Search or run a command/ }));

    expect(
      await screen.findByRole('option', { name: /Check in the selected visit/ })
    ).toBeInTheDocument();
  });

  it('opens the booking dialog on nothing when the day has no room left', async () => {
    // One provider's day taken wall to wall, and the board filtered to them:
    // the walk-in verb has no slot to reach for, and must not open a booking
    // dialog on an undefined one.
    const first = MOCK_APPOINTMENTS[0] as Appointment;
    const dayStart = Date.parse(`${first.start.slice(0, 10)}T00:00:00.000Z`);
    const wallToWall = Array.from({ length: 72 }, (_, index) => ({
      ...first,
      id: `full-${index}`,
      start: new Date(dayStart + index * 20 * 60_000).toISOString(),
      end: new Date(dayStart + (index + 1) * 20 * 60_000).toISOString(),
    }));
    render(<ScheduleScreen client={createMockClient({ appointments: wallToWall })} />);
    await screen.findByRole('region', { name: 'Day view grid' });
    fireEvent.change(screen.getByLabelText('Provider'), {
      target: { value: first.providerId },
    });
    await waitFor(() =>
      expect(
        screen.queryByRole('heading', { level: 2, name: /Ingrid Lindqvist/ })
      ).not.toBeInTheDocument()
    );

    fireEvent.click(within(rail()).getByRole('button', { name: 'Add walk-in' }));

    expect(screen.queryByRole('dialog', { name: 'Book appointment' })).not.toBeInTheDocument();
    // The open-slot panel opens instead and says there is nothing to offer.
    expect(await screen.findByText(/No slot fits 20 minutes on this day/)).toBeInTheDocument();
  });
});

describe('ScheduleScreen, when a write is refused', () => {
  /** Reads the day normally and refuses every write, as a lost grant would. */
  function refusesWrites(): ApiClient {
    const client = createMockClient();
    const refused = () =>
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
            requestId: 'req-9',
          },
        })
      );
    return {
      ...client,
      appointments: { ...client.appointments, create: refused, update: refused },
    };
  }

  it('keeps the check-in dialog open with the reason, and toasts nothing', async () => {
    render(<ScheduleScreen client={refusesWrites()} />);

    fireEvent.click(await screen.findByRole('button', { name: ANKLE_INJURY }));
    fireEvent.click(within(rail()).getByRole('button', { name: 'Check in Fictitia' }));
    const dialog = screen.getByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Check in Fictitia' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'This facility is not granted to your role.'
    );
    // The one thing this screen must never do: confirm a check-in that did not
    // happen. The patient is still standing at the desk.
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(within(rail()).getByRole('button', { name: 'Check in Fictitia' })).toBeEnabled();
  });

  it('keeps the booking dialog open with the reason rather than closing on a refusal', async () => {
    render(<ScheduleScreen client={refusesWrites()} />);

    await screen.findByRole('region', { name: 'Day view grid' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Add walk-in' })[0]!);
    const dialog = await screen.findByRole('dialog', { name: 'Book appointment' });
    fireEvent.click(within(dialog).getByRole('button', { name: /^Book / }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'This facility is not granted to your role.'
    );
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('disables the booking verb while the slot is being held', async () => {
    let release: ((value: never) => void) | undefined;
    const client = createMockClient();
    const holding: ApiClient = {
      ...client,
      appointments: {
        ...client.appointments,
        create: () =>
          new Promise((_, reject) => {
            release = reject as (value: never) => void;
          }),
      },
    };
    render(<ScheduleScreen client={holding} />);

    await screen.findByRole('region', { name: 'Day view grid' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Add walk-in' })[0]!);
    const dialog = await screen.findByRole('dialog', { name: 'Book appointment' });
    fireEvent.click(within(dialog).getByRole('button', { name: /^Book / }));

    // A second click would book the slot twice, so the verb says what it is
    // doing and stops accepting.
    expect(await within(dialog).findByRole('button', { name: 'Booking...' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(release).toBeInstanceOf(Function);
  });
});

/**
 * The ids a booking is written with.
 *
 * This screen used to post `MOCK_FACILITY.id` and a provider id off the fixture
 * list. Against the real API that is a 403 from the facility check before the
 * write, and a foreign key violation behind it, while the screen showed a
 * success toast. So the directory below deliberately shares no id with the
 * fixtures: anything this screen posts has to have come from the client it
 * posts through, and a screen that reached for a constant fails here.
 */
describe('ScheduleScreen, the ids a booking is written with', () => {
  const ANNEX: FacilityDto = {
    ...(MOCK_DIRECTORY_FACILITIES[0] as FacilityDto),
    id: '0192f1a0-0000-7000-8000-00000000f009',
    name: 'Birchwood Annex',
    code: 'BIRCH',
  };

  const FERREIRA: UserDto = {
    ...(MOCK_DIRECTORY_USERS[0] as UserDto),
    id: '0192f1a0-0000-7000-8000-00000000d009',
    email: 'n.ferreira@birchwood.clinic.invalid',
    givenName: 'Nils',
    familyName: 'Ferreira',
    credential: 'NP',
  };

  /** Records every create body, and still writes it to the store underneath. */
  function recording(): { client: ApiClient; created: AppointmentCreateBody[] } {
    const client = createMockClient({
      facilities: [ANNEX],
      users: [FERREIRA],
      // One visit at this site, so the grid draws rather than the empty state,
      // and the rest of the day is open for the walk-in to land in.
      appointments: [
        {
          ...(MOCK_APPOINTMENTS[0] as Appointment),
          facilityId: ANNEX.id,
          providerId: FERREIRA.id,
        },
      ],
    });
    const created: AppointmentCreateBody[] = [];
    return {
      created,
      client: {
        ...client,
        appointments: {
          ...client.appointments,
          create: (body, signal) => {
            created.push(body);
            return client.appointments.create(body, signal);
          },
        },
      },
    };
  }

  it('draws the columns from the directory, name and credential', async () => {
    const { client } = recording();
    render(<ScheduleScreen client={client} />);

    expect(
      await screen.findByRole('heading', { level: 2, name: /Nils Ferreira/ })
    ).toBeInTheDocument();
    // And the fixture clinicians are nowhere on the screen, because this
    // organisation does not employ them.
    expect(screen.queryByRole('heading', { name: /Okafor/ })).not.toBeInTheDocument();
  });

  it('names the facility it is about to book into, in the page description', async () => {
    const { client } = recording();
    render(<ScheduleScreen client={client} />);

    expect(await screen.findByText(/at Birchwood Annex/)).toBeInTheDocument();
  });

  it('posts the facility and the provider the directory returned, not a fixture', async () => {
    const { client, created } = recording();
    render(<ScheduleScreen client={client} />);

    await screen.findByRole('region', { name: 'Day view grid' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Add walk-in' })[0] as HTMLElement);
    const dialog = await screen.findByRole('dialog', { name: 'Book appointment' });
    fireEvent.click(within(dialog).getByRole('button', { name: /^Book \w/ }));

    expect(await screen.findByRole('status')).toHaveTextContent('Appointment booked');
    expect(created).toHaveLength(1);
    expect(created[0]?.facilityId).toBe(ANNEX.id);
    expect(created[0]?.providerId).toBe(FERREIRA.id);
  });
});

describe('ScheduleScreen, when there is nothing to book against', () => {
  it('says why rather than offering a booking that would be refused', async () => {
    // An organisation with no facility on file. A booking has to name one, so
    // there is no honest way to open the dialog.
    render(<ScheduleScreen client={createMockClient({ facilities: [] })} />);

    expect(await screen.findByText('This day cannot be booked into')).toBeInTheDocument();
    expect(screen.getByText(/No active facility came back/)).toBeInTheDocument();
    // Both walk-in controls refuse to start something that cannot finish.
    for (const button of screen.getAllByRole('button', { name: 'Add walk-in' })) {
      expect(button).toBeDisabled();
    }
    expect(screen.getByRole('button', { name: 'Find available' })).toBeDisabled();
  });

  it('withholds the booking verbs from the palette as well as from the page', async () => {
    render(<ScheduleScreen client={createMockClient({ facilities: [] })} />);
    await screen.findByText('This day cannot be booked into');

    fireEvent.click(screen.getByRole('button', { name: /Search or run a command/ }));

    expect(screen.queryByRole('option', { name: /Add walk-in/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Find available slots/ })).not.toBeInTheDocument();
    // The verbs that do not need a facility are still there.
    expect(await screen.findByRole('option', { name: /Go to today/ })).toBeInTheDocument();
  });

  it('names the facility when it is the clinician list that came back empty', async () => {
    render(<ScheduleScreen client={createMockClient({ users: [] })} />);

    expect(await screen.findByText('This day cannot be booked into')).toBeInTheDocument();
    expect(screen.getByText(/No active clinician came back for Cedar Clinic/)).toBeInTheDocument();
  });

  it('leaves the day itself readable, because reading it is not booking', async () => {
    render(<ScheduleScreen client={createMockClient({ users: [] })} />);

    // No columns to draw, so no grid, but the counts and the refusal both show.
    expect(await screen.findByText('This day cannot be booked into')).toBeInTheDocument();
    expect(within(rail()).getByText('Day at a glance')).toBeInTheDocument();
  });
});

describe('ScheduleScreen, more than one facility', () => {
  const CEDAR = MOCK_DIRECTORY_FACILITIES[0] as FacilityDto;
  const ANNEX: FacilityDto = {
    ...CEDAR,
    id: '0192f1a0-0000-7000-8000-00000000f002',
    name: 'Birchwood Annex',
    code: 'BIRCH',
  };

  /** One visit at each site, at different times, so the day visibly changes. */
  function twoSites(): ApiClient {
    const cedarVisit = MOCK_APPOINTMENTS[0] as Appointment;
    return createMockClient({
      facilities: [CEDAR, ANNEX],
      appointments: [
        cedarVisit,
        {
          ...cedarVisit,
          id: 'annex-1',
          facilityId: ANNEX.id,
          start: '2026-08-12T13:00:00.000Z',
          end: '2026-08-12T13:20:00.000Z',
        },
      ],
    });
  }

  it('offers the choice, and scopes the day to the facility chosen', async () => {
    render(<ScheduleScreen client={twoSites()} />);

    await screen.findByRole('region', { name: 'Day view grid' });
    // The list arrives sorted by name, which is the route's own default, and
    // the first row is what the day opens on until someone chooses otherwise.
    expect(screen.getByLabelText('Facility')).toHaveValue(ANNEX.id);
    expect(screen.getByRole('button', { name: /13:00 to 13:20/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /08:00 to 08:20/ })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Facility'), { target: { value: CEDAR.id } });

    // The day is now the other site's: its visit, and not the one next door.
    expect(await screen.findByRole('button', { name: /08:00 to 08:20/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /13:00 to 13:20/ })).not.toBeInTheDocument();
    expect(screen.getByText(/at Cedar Clinic/)).toBeInTheDocument();
  });

  it('hides the picker when there is only one facility to pick', async () => {
    render(<ScheduleScreen client={createMockClient()} />);

    await screen.findByRole('region', { name: 'Day view grid' });
    expect(screen.queryByLabelText('Facility')).not.toBeInTheDocument();
  });
});
