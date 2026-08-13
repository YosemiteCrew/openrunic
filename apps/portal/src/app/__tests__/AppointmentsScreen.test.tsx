import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AppointmentsScreen } from '@/app/appointments/AppointmentsScreen';
import { emptyApi, fails, never, stubApi } from '@/__tests__/support';
import type { Appointment } from '@/lib/api/types';

describe('AppointmentsScreen', () => {
  it('separates what is booked from what has happened', async () => {
    render(<AppointmentsScreen api={stubApi()} />);

    const upcoming = await screen.findByRole('region', { name: 'Upcoming appointments' });
    const past = screen.getByRole('region', { name: 'Past appointments' });

    expect(within(upcoming).getByText(/Thursday, 3 September 2026 at 09:30/)).toBeInTheDocument();
    expect(within(past).getByText(/Thursday, 11 June 2026 at 11:15/)).toBeInTheDocument();
  });

  it('offers joining, directions, moving and cancelling on a booked visit', async () => {
    render(<AppointmentsScreen api={stubApi()} />);
    await screen.findByRole('region', { name: 'Upcoming appointments' });

    expect(screen.getByRole('link', { name: 'Join the video call' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Get directions' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Ask to move it' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Cancel' })).toHaveLength(2);
  });

  it('takes two steps to cancel, and states the consequence in plain words', async () => {
    const api = stubApi();
    const cancelSpy = vi.spyOn(api, 'cancelAppointment');
    render(<AppointmentsScreen api={api} />);
    await screen.findByRole('region', { name: 'Upcoming appointments' });

    // Step one opens the dialog. Nothing is cancelled yet.
    await userEvent.click(screen.getAllByRole('button', { name: 'Cancel' })[0] as HTMLElement);
    expect(cancelSpy).not.toHaveBeenCalled();

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Cancel this appointment?');
    expect(dialog).toHaveTextContent('The slot goes to someone else');
    expect(dialog).toHaveTextContent('you would have to request a new appointment');
    expect(dialog).toHaveTextContent('The next opening may be weeks later.');

    // Step two is the one that acts.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel the appointment' }));

    await waitFor(() => expect(cancelSpy).toHaveBeenCalledWith('appt-2041'));
  });

  it('backs out of a cancellation without touching the booking', async () => {
    const api = stubApi();
    const cancelSpy = vi.spyOn(api, 'cancelAppointment');
    render(<AppointmentsScreen api={api} />);
    await screen.findByRole('region', { name: 'Upcoming appointments' });

    await userEvent.click(screen.getAllByRole('button', { name: 'Cancel' })[0] as HTMLElement);
    await userEvent.click(screen.getByRole('button', { name: 'Keep the appointment' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(cancelSpy).not.toHaveBeenCalled();
  });

  it('moves a cancelled appointment into the past list', async () => {
    render(<AppointmentsScreen api={stubApi()} />);
    await screen.findByRole('region', { name: 'Upcoming appointments' });

    await userEvent.click(screen.getAllByRole('button', { name: 'Cancel' })[0] as HTMLElement);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel the appointment' }));

    const past = await screen.findByRole('region', { name: 'Past appointments' });
    await waitFor(() =>
      expect(within(past).getByText('You cancelled this appointment.')).toBeInTheDocument()
    );
  });

  it('says the booking is untouched when the cancellation fails', async () => {
    render(<AppointmentsScreen api={stubApi({ cancelAppointment: fails })} />);
    await screen.findByRole('region', { name: 'Upcoming appointments' });

    await userEvent.click(screen.getAllByRole('button', { name: 'Cancel' })[0] as HTMLElement);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel the appointment' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The appointment was not cancelled and is still booked.'
    );
  });

  it('raises a request rather than implying a booking', async () => {
    const api = stubApi();
    const requestSpy = vi.spyOn(api, 'requestAppointment');
    render(<AppointmentsScreen api={api} />);

    await userEvent.click(screen.getByRole('button', { name: 'Request an appointment' }));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Nothing is booked until they do.');

    await userEvent.type(
      within(dialog).getByLabelText(/What do you need to be seen about\?/),
      'Sore throat'
    );
    await userEvent.type(within(dialog).getByLabelText(/When can you come\?/), 'Weekday mornings');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send the request' }));

    await waitFor(() =>
      expect(requestSpy).toHaveBeenCalledWith({
        reason: 'Sore throat',
        preferredTimes: 'Weekday mornings',
      })
    );
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Your request has gone to the practice.'
    );
  });

  it('names the appointment being moved on a reschedule request', async () => {
    const api = stubApi();
    const requestSpy = vi.spyOn(api, 'requestAppointment');
    render(<AppointmentsScreen api={api} />);
    await screen.findByRole('region', { name: 'Upcoming appointments' });

    await userEvent.click(
      screen.getAllByRole('button', { name: 'Ask to move it' })[0] as HTMLElement
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Ask to move this appointment');

    await userEvent.type(
      within(dialog).getByLabelText(/What do you need to be seen about\?/),
      'Thyroid review'
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send the request' }));

    await waitFor(() =>
      expect(requestSpy).toHaveBeenCalledWith({
        reason: 'Thyroid review',
        preferredTimes: '',
        rescheduleOf: 'appt-2041',
      })
    );
  });

  it('keeps what was typed when the request fails to send', async () => {
    render(<AppointmentsScreen api={stubApi({ requestAppointment: fails })} />);

    await userEvent.click(screen.getByRole('button', { name: 'Request an appointment' }));
    const dialog = screen.getByRole('dialog');
    const reason = within(dialog).getByLabelText(/What do you need to be seen about\?/);
    await userEvent.type(reason, 'Sore throat');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send the request' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Your request did not send');
    expect(reason).toHaveValue('Sore throat');
  });

  it('will not send a request with no reason, and closes on request', async () => {
    render(<AppointmentsScreen api={stubApi()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Request an appointment' }));
    expect(screen.getByRole('button', { name: 'Send the request' })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Close without sending' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('cancels from the keyboard alone', async () => {
    const api = stubApi();
    const cancelSpy = vi.spyOn(api, 'cancelAppointment');
    render(<AppointmentsScreen api={api} />);
    await screen.findByRole('region', { name: 'Upcoming appointments' });

    const trigger = screen.getAllByRole('button', { name: 'Cancel' })[0] as HTMLElement;
    trigger.focus();
    await userEvent.keyboard('{Enter}');

    const confirm = screen.getByRole('button', { name: 'Cancel the appointment' });
    confirm.focus();
    await userEvent.keyboard('{Enter}');

    await waitFor(() => expect(cancelSpy).toHaveBeenCalledOnce());
  });

  it('closes the cancel dialog on Escape without cancelling', async () => {
    const api = stubApi();
    const cancelSpy = vi.spyOn(api, 'cancelAppointment');
    render(<AppointmentsScreen api={api} />);
    await screen.findByRole('region', { name: 'Upcoming appointments' });

    await userEvent.click(screen.getAllByRole('button', { name: 'Cancel' })[0] as HTMLElement);
    await userEvent.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(cancelSpy).not.toHaveBeenCalled();
  });

  it('states the loading fact while the appointments are on their way', () => {
    render(<AppointmentsScreen api={stubApi({ getAppointments: never })} />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading your appointments.');
  });

  it('says there are none, and offers the way to get one', async () => {
    render(<AppointmentsScreen api={emptyApi()} />);

    expect(
      await screen.findByRole('heading', { name: 'You have no appointments.' })
    ).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Request an appointment' })).toHaveLength(2);
  });

  it('states each list is empty when only the other has anything', async () => {
    const good = stubApi();
    const { upcoming, past } = await good.getAppointments();

    const { unmount } = render(
      <AppointmentsScreen
        api={stubApi({ getAppointments: () => Promise.resolve({ upcoming, past: [] }) })}
      />
    );
    expect(await screen.findByText('You have no past appointments on record.')).toBeInTheDocument();
    unmount();

    render(
      <AppointmentsScreen
        api={stubApi({ getAppointments: () => Promise.resolve({ upcoming: [], past }) })}
      />
    );
    expect(await screen.findByText('You have nothing booked.')).toBeInTheDocument();
  });

  it('says the practice will confirm the room when a visit has no location', async () => {
    const unlocated: Appointment = {
      id: 'appt-unlocated',
      startsAt: '2026-09-24T14:00:00.000Z',
      durationMinutes: 30,
      reason: 'Blood pressure check',
      clinician: 'Marek Oyelaran',
      department: 'General practice',
      mode: 'in-person',
    };

    render(
      <AppointmentsScreen
        api={stubApi({
          getAppointments: () => Promise.resolve({ upcoming: [unlocated], past: [] }),
        })}
      />
    );

    expect(await screen.findByText('The practice will confirm the room.')).toBeInTheDocument();
  });

  it('states the error and recovers when the reader tries again', async () => {
    let attempt = 0;
    const good = stubApi();
    const api = stubApi({
      getAppointments: () => {
        attempt += 1;
        return attempt === 1 ? fails() : good.getAppointments();
      },
    });

    render(<AppointmentsScreen api={api} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Your appointments did not load.');

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(
      await screen.findByRole('region', { name: 'Upcoming appointments' })
    ).toBeInTheDocument();
  });
});
