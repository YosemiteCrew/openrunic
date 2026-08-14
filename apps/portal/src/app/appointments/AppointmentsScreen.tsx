'use client';

/**
 * Appointments: what is booked, what has happened, and the three things a patient can do.
 *
 * Cancelling takes two steps and the second one says what cancelling costs in plain words -
 * the slot goes to someone else and the next opening may be later. A one-tap cancel next to
 * a "join" button is a trap, and "Are you sure?" is not a consequence.
 *
 * Requesting and rescheduling both raise a request rather than a booking. The practice
 * confirms by message, and the copy never implies anything is settled before that.
 */

import { useCallback, useState } from 'react';
import { Badge, Button, Card, EmptyState, Input, Modal } from '@openrunic/ui';
import { AsyncBoundary } from '@/components/AsyncBoundary';
import { PageHeader } from '@/components/PageHeader';
import { AppointmentFacts } from '@/components/appointments/AppointmentFacts';
import { getPortalApi } from '@/lib/api';
import type { Appointment, PortalApi } from '@/lib/api/types';
import { formatDateTime } from '@/lib/format';
import { useAction, useAsync } from '@/lib/useAsync';

export interface AppointmentsScreenProps {
  api?: PortalApi;
}

export function AppointmentsScreen({ api = getPortalApi() }: Readonly<AppointmentsScreenProps>) {
  const load = useCallback(() => api.getAppointments(), [api]);
  const { state, reload } = useAsync(load);

  /** The appointment awaiting the second step of a cancellation, if any. */
  const [pendingCancel, setPendingCancel] = useState<Appointment | null>(null);
  /** Open request form. `null` means closed; a string is the id being rescheduled. */
  const [requestFor, setRequestFor] = useState<{ rescheduleOf?: string } | null>(null);
  const [reason, setReason] = useState('');
  const [preferredTimes, setPreferredTimes] = useState('');

  const cancel = useAction((id: string) => api.cancelAppointment(id));
  const request = useAction(async (rescheduleOf: string | undefined) => {
    await api.requestAppointment({
      reason,
      preferredTimes,
      ...(rescheduleOf === undefined ? {} : { rescheduleOf }),
    });
  });

  /* Both take what they act on as an argument rather than reading the open-dialog state:
     the dialog is the only caller and has already narrowed it, so a re-check here would be
     a branch that can never run. */
  const confirmCancel = async (appointment: Appointment) => {
    const done = await cancel.run(appointment.id);
    setPendingCancel(null);
    if (done) reload();
  };

  const submitRequest = async (rescheduleOf: string | undefined) => {
    const sent = await request.run(rescheduleOf);
    if (sent) {
      setRequestFor(null);
      setReason('');
      setPreferredTimes('');
    }
  };

  return (
    <>
      <PageHeader
        overline="Your visits"
        title="Appointments"
        lede="What is booked, what has already happened, and how to ask for a change."
      />

      <div className="portal-actions">
        <Button iconLeft="calendar-plus" onClick={() => setRequestFor({})}>
          Request an appointment
        </Button>
      </div>

      {request.status === 'done' ? (
        <output className="portal-record__meta">
          Your request has gone to the practice. They will confirm by message. Nothing is booked
          until they do.
        </output>
      ) : null}

      {cancel.status === 'failed' ? (
        <p className="portal-record__meta" role="alert">
          The appointment was not cancelled and is still booked. Check your connection, then try
          again.
        </p>
      ) : null}

      <AsyncBoundary
        state={state}
        what="your appointments"
        onRetry={reload}
        isEmpty={(data) => data.upcoming.length === 0 && data.past.length === 0}
        empty={
          <EmptyState
            icon="calendar"
            title="You have no appointments."
            message="Request one and the practice will confirm a time by message."
            action={
              <Button iconLeft="calendar-plus" onClick={() => setRequestFor({})}>
                Request an appointment
              </Button>
            }
          />
        }
      >
        {(data) => (
          <div className="portal-stack">
            <section className="portal-section" aria-label="Upcoming appointments">
              <h2 className="or-h2 portal-section__heading">Upcoming</h2>
              {data.upcoming.length === 0 ? (
                <p className="or-body">You have nothing booked.</p>
              ) : (
                data.upcoming.map((appointment) => (
                  /* Unlike the other screens, these cards sit inside a section that
                     already has its own heading, so each appointment is a level below
                     "Upcoming" rather than a sibling of it. */
                  <Card
                    key={appointment.id}
                    headingLevel={3}
                    overline={appointment.mode === 'video' ? 'Video call' : 'In person'}
                    title={appointment.reason}
                  >
                    <AppointmentFacts appointment={appointment} />
                    <div className="portal-actions">
                      {appointment.joinUrl ? (
                        <Button href={appointment.joinUrl} iconLeft="video">
                          Join the video call
                        </Button>
                      ) : null}
                      {appointment.directionsUrl ? (
                        <Button href={appointment.directionsUrl} iconLeft="map-pin">
                          Get directions
                        </Button>
                      ) : null}
                      <Button
                        variant="secondary"
                        iconLeft="calendar-clock"
                        onClick={() => setRequestFor({ rescheduleOf: appointment.id })}
                      >
                        Ask to move it
                      </Button>
                      <Button
                        variant="danger"
                        iconLeft="calendar-x"
                        onClick={() => setPendingCancel(appointment)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </Card>
                ))
              )}
            </section>

            <section className="portal-section" aria-label="Past appointments">
              <h2 className="or-h2 portal-section__heading">Past</h2>
              {data.past.length === 0 ? (
                <p className="or-body">You have no past appointments on record.</p>
              ) : (
                data.past.map((appointment) => (
                  <Card
                    key={appointment.id}
                    headingLevel={3}
                    overline="Past"
                    title={appointment.reason}
                  >
                    <AppointmentFacts appointment={appointment} />
                    {appointment.cancelledReason ? (
                      <p className="portal-record__meta">
                        <Badge tone="neutral">Cancelled</Badge> {appointment.cancelledReason}
                      </p>
                    ) : null}
                  </Card>
                ))
              )}
            </section>
          </div>
        )}
      </AsyncBoundary>

      {/* Step two of the cancellation. The consequence is the whole point of this dialog. */}
      {pendingCancel ? (
        <Modal
          open
          title="Cancel this appointment?"
          description={`This would cancel ${pendingCancel.reason} with ${pendingCancel.clinician} on ${formatDateTime(pendingCancel.startsAt)}. The slot goes to someone else, and to be seen you would have to request a new appointment. The next opening may be weeks later.`}
          onClose={() => setPendingCancel(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setPendingCancel(null)}>
                Keep the appointment
              </Button>
              <Button variant="danger" onClick={() => confirmCancel(pendingCancel)}>
                Cancel the appointment
              </Button>
            </>
          }
        />
      ) : null}

      {requestFor ? (
        <Modal
          open
          title={
            requestFor.rescheduleOf === undefined
              ? 'Request an appointment'
              : 'Ask to move this appointment'
          }
          description="This goes to the practice as a request. They will confirm a time by message. Nothing is booked until they do."
          onClose={() => setRequestFor(null)}
          footer={
            <>
              {/* Not "Close": Modal already ships a dismiss control with that name, and
                  two controls answering to the same word is a maze for a screen reader. */}
              <Button variant="secondary" onClick={() => setRequestFor(null)}>
                Close without sending
              </Button>
              <Button
                disabled={reason.trim() === ''}
                onClick={() => submitRequest(requestFor.rescheduleOf)}
              >
                Send the request
              </Button>
            </>
          }
        >
          <div className="portal-stack portal-stack--tight">
            <Input
              label="What do you need to be seen about?"
              hint="A short line is enough."
              name="reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
            <Input
              label="When can you come?"
              hint="For example, weekday mornings."
              name="preferredTimes"
              value={preferredTimes}
              onChange={(event) => setPreferredTimes(event.target.value)}
            />
            {request.status === 'failed' ? (
              <p className="portal-record__meta" role="alert">
                Your request did not send, and what you typed is still here. Check your connection,
                then send it again.
              </p>
            ) : null}
          </div>
        </Modal>
      ) : null}
    </>
  );
}
