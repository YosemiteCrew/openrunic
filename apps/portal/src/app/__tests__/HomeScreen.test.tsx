import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { HomeScreen } from '@/app/HomeScreen';
import { emptyApi, fails, never, stubApi } from '@/__tests__/support';
import { buildFixtures } from '@/lib/api';
import { buildHomeSummary } from '@/lib/api/fixtures';
import type { Appointment, HomeSummary } from '@/lib/api/types';

function homeWith(overrides: Partial<HomeSummary>): HomeSummary {
  return { ...buildHomeSummary(buildFixtures()), ...overrides };
}

const IN_PERSON: Appointment = {
  id: 'appt-in-person',
  startsAt: '2026-09-24T14:00:00.000Z',
  durationMinutes: 30,
  reason: 'Blood pressure check',
  clinician: 'Exampla Testperson',
  department: 'General practice',
  mode: 'in-person',
  location: 'Elmfield Practice, Room 4',
  directionsUrl: 'https://example.invalid/directions/elmfield',
};

describe('HomeScreen', () => {
  it('renders one h1 and the next appointment in full', async () => {
    render(<HomeScreen api={stubApi()} />);

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Thyroid review' })
    ).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByText(/Thursday, 3 September 2026 at 09:30/)).toBeInTheDocument();
    expect(screen.getByText(/Dr. Okafor, Endocrinology/)).toBeInTheDocument();
  });

  it('shows the balance, the unread count and what is waiting on the reader', async () => {
    render(<HomeScreen api={stubApi()} />);

    expect(await screen.findByText('£84.50 GBP')).toBeInTheDocument();
    expect(screen.getByText(/Due by 15 September 2026/)).toBeInTheDocument();
    expect(screen.getByText('1 message you have not read.')).toBeInTheDocument();
    expect(screen.getByText('Before your thyroid review')).toBeInTheDocument();
  });

  it('offers joining a video call, and directions for an in-person visit', async () => {
    const { unmount } = render(<HomeScreen api={stubApi()} />);

    const join = await screen.findByRole('link', { name: 'Join the video call' });
    expect(join).toHaveAttribute('href', 'https://example.invalid/video/appt-2041');
    expect(screen.queryByRole('link', { name: 'Get directions' })).not.toBeInTheDocument();
    unmount();

    render(
      <HomeScreen
        api={stubApi({ getHome: () => Promise.resolve(homeWith({ nextAppointment: IN_PERSON })) })}
      />
    );

    expect(await screen.findByRole('link', { name: 'Get directions' })).toHaveAttribute(
      'href',
      'https://example.invalid/directions/elmfield'
    );
    expect(screen.getByText('Elmfield Practice, Room 4')).toBeInTheDocument();
  });

  it('says the practice will confirm the room when an in-person visit has no location', async () => {
    const unlocated: Appointment = { ...IN_PERSON };
    delete unlocated.location;

    render(
      <HomeScreen
        api={stubApi({
          getHome: () => Promise.resolve(homeWith({ nextAppointment: unlocated })),
        })}
      />
    );

    expect(await screen.findByText('The practice will confirm the room.')).toBeInTheDocument();
  });

  it('reaches the primary actions by keyboard alone', async () => {
    render(<HomeScreen api={stubApi()} />);
    await screen.findByRole('link', { name: 'Join the video call' });

    await userEvent.tab();
    expect(screen.getByRole('link', { name: 'Join the video call' })).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole('link', { name: 'See all appointments' })).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole('link', { name: 'Pay a bill' })).toHaveFocus();
  });

  it('stays calm when there is nothing booked, nothing owed and nothing to do', async () => {
    render(
      <HomeScreen
        api={stubApi({
          getHome: () =>
            Promise.resolve(
              homeWith({
                nextAppointment: null,
                balance: {
                  outstanding: { amountMinor: 0, currency: 'GBP' },
                  dueOn: null,
                  statementCount: 0,
                },
                unreadMessages: 1,
                actionItems: [],
              })
            ),
        })}
      />
    );

    expect(
      await screen.findByRole('heading', { level: 2, name: 'You have no appointments booked' })
    ).toBeInTheDocument();
    expect(screen.getByText('There is nothing to pay.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See your bills' })).toBeInTheDocument();
    expect(screen.getByText('There is nothing waiting on you.')).toBeInTheDocument();
  });

  it('states when a balance has no due date rather than leaving a blank', async () => {
    render(
      <HomeScreen
        api={stubApi({
          getHome: () =>
            Promise.resolve(
              homeWith({
                balance: {
                  outstanding: { amountMinor: 500, currency: 'GBP' },
                  dueOn: null,
                  statementCount: 1,
                },
              })
            ),
        })}
      />
    );

    expect(await screen.findByText(/Ask the practice when this is due\./)).toBeInTheDocument();
  });

  it('states the loading fact while the summary is on its way', () => {
    render(<HomeScreen api={stubApi({ getHome: never })} />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading your home summary.');
  });

  it('shows a calm empty state when the account has nothing at all', async () => {
    render(<HomeScreen api={emptyApi()} />);

    expect(
      await screen.findByRole('heading', { name: 'Nothing needs your attention.' })
    ).toBeInTheDocument();
  });

  it('states the error and recovers when the reader tries again', async () => {
    let attempt = 0;
    const good = stubApi();
    const api = stubApi({
      getHome: () => {
        attempt += 1;
        return attempt === 1 ? fails() : good.getHome();
      },
    });

    render(<HomeScreen api={api} />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Your home summary did not load.');

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('£84.50 GBP')).toBeInTheDocument();
  });

  it('never dresses money or a to-do in alarm colours', async () => {
    render(<HomeScreen api={stubApi()} />);
    await screen.findByText('£84.50 GBP');

    // Danger red is reserved for a clinical value outside its range.
    expect(document.querySelectorAll('.or-badge--danger')).toHaveLength(0);
  });
});
