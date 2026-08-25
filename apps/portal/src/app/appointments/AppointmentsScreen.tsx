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
import { useTranslator } from '@/lib/i18n/messages';
import { formatDateTime } from '@/lib/format';
import { useAction, useAsync } from '@/lib/useAsync';

export interface AppointmentsScreenProps {
  api?: PortalApi;
}

export function AppointmentsScreen({ api = getPortalApi() }: Readonly<AppointmentsScreenProps>) {
  const t = useTranslator();
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
        overline={t('portal.appointments.overline')}
        title={t('portal.appointments.title')}
        lede={t('portal.appointments.lede')}
      />

      <div className="portal-actions">
        <Button iconLeft="calendar-plus" onClick={() => setRequestFor({})}>
          {t('portal.appointments.request')}
        </Button>
      </div>

      {request.status === 'done' ? (
        <output className="portal-record__meta">{t('portal.appointments.requested')}</output>
      ) : null}

      {cancel.status === 'failed' ? (
        <p className="portal-record__meta" role="alert">
          {t('portal.appointments.cancelFailed')}
        </p>
      ) : null}

      <AsyncBoundary
        state={state}
        loadingKey="portal.appointments.async.loading"
        errorKey="portal.appointments.async.error"
        onRetry={reload}
        isEmpty={(data) => data.upcoming.length === 0 && data.past.length === 0}
        empty={
          <EmptyState
            icon="calendar"
            title={t('portal.appointments.empty.title')}
            message={t('portal.appointments.empty.message')}
            action={
              <Button iconLeft="calendar-plus" onClick={() => setRequestFor({})}>
                {t('portal.appointments.request')}
              </Button>
            }
          />
        }
      >
        {(data) => (
          <div className="portal-stack">
            <section
              className="portal-section"
              aria-label={t('portal.appointments.upcoming.label')}
            >
              <h2 className="or-h2 portal-section__heading">
                {t('portal.appointments.upcoming.heading')}
              </h2>
              {data.upcoming.length === 0 ? (
                <p className="or-body">{t('portal.appointments.upcoming.none')}</p>
              ) : (
                data.upcoming.map((appointment) => (
                  /* Unlike the other screens, these cards sit inside a section that
                     already has its own heading, so each appointment is a level below
                     "Upcoming" rather than a sibling of it. */
                  <Card
                    key={appointment.id}
                    headingLevel={3}
                    overline={t(
                      appointment.mode === 'video'
                        ? 'portal.appointments.mode.video'
                        : 'portal.appointments.mode.inPerson'
                    )}
                    title={appointment.reason}
                  >
                    <AppointmentFacts t={t} appointment={appointment} />
                    <div className="portal-actions">
                      {appointment.joinUrl ? (
                        <Button href={appointment.joinUrl} iconLeft="video">
                          {t('portal.appointments.join')}
                        </Button>
                      ) : null}
                      {appointment.directionsUrl ? (
                        <Button href={appointment.directionsUrl} iconLeft="map-pin">
                          {t('portal.appointments.directions')}
                        </Button>
                      ) : null}
                      <Button
                        variant="secondary"
                        iconLeft="calendar-clock"
                        onClick={() => setRequestFor({ rescheduleOf: appointment.id })}
                      >
                        {t('portal.appointments.move')}
                      </Button>
                      <Button
                        variant="danger"
                        iconLeft="calendar-x"
                        onClick={() => setPendingCancel(appointment)}
                      >
                        {t('portal.appointments.cancel')}
                      </Button>
                    </div>
                  </Card>
                ))
              )}
            </section>

            <section className="portal-section" aria-label={t('portal.appointments.past.label')}>
              <h2 className="or-h2 portal-section__heading">
                {t('portal.appointments.past.heading')}
              </h2>
              {data.past.length === 0 ? (
                <p className="or-body">{t('portal.appointments.past.none')}</p>
              ) : (
                data.past.map((appointment) => (
                  <Card
                    key={appointment.id}
                    headingLevel={3}
                    overline={t('portal.appointments.mode.past')}
                    title={appointment.reason}
                  >
                    <AppointmentFacts t={t} appointment={appointment} />
                    {appointment.cancelledReason ? (
                      <p className="portal-record__meta">
                        <Badge tone="neutral">{t('portal.appointments.cancelledBadge')}</Badge>{' '}
                        {appointment.cancelledReason}
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
          title={t('portal.appointments.cancelDialog.title')}
          /* One message with three holes rather than three clauses assembled
             here. What this costs a patient is the whole point of the dialog,
             and a sentence built from fragments is the one place that argument
             would quietly come apart in another language. */
          description={t('portal.appointments.cancelDialog.description', {
            reason: pendingCancel.reason,
            clinician: pendingCancel.clinician,
            when: formatDateTime(t, pendingCancel.startsAt),
          })}
          onClose={() => setPendingCancel(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setPendingCancel(null)}>
                {t('portal.appointments.cancelDialog.keep')}
              </Button>
              <Button variant="danger" onClick={() => confirmCancel(pendingCancel)}>
                {t('portal.appointments.cancelDialog.confirm')}
              </Button>
            </>
          }
        />
      ) : null}

      {requestFor ? (
        <Modal
          open
          title={t(
            requestFor.rescheduleOf === undefined
              ? 'portal.appointments.requestDialog.title'
              : 'portal.appointments.requestDialog.rescheduleTitle'
          )}
          description={t('portal.appointments.requestDialog.description')}
          onClose={() => setRequestFor(null)}
          footer={
            <>
              {/* Not "Close": Modal already ships a dismiss control with that name, and
                  two controls answering to the same word is a maze for a screen reader. */}
              <Button variant="secondary" onClick={() => setRequestFor(null)}>
                {t('portal.appointments.requestDialog.close')}
              </Button>
              <Button
                disabled={reason.trim() === ''}
                onClick={() => submitRequest(requestFor.rescheduleOf)}
              >
                {t('portal.appointments.requestDialog.send')}
              </Button>
            </>
          }
        >
          <div className="portal-stack portal-stack--tight">
            <Input
              label={t('portal.appointments.requestDialog.reason.label')}
              hint={t('portal.appointments.requestDialog.reason.hint')}
              name="reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
            <Input
              label={t('portal.appointments.requestDialog.times.label')}
              hint={t('portal.appointments.requestDialog.times.hint')}
              name="preferredTimes"
              value={preferredTimes}
              onChange={(event) => setPreferredTimes(event.target.value)}
            />
            {request.status === 'failed' ? (
              <p className="portal-record__meta" role="alert">
                {t('portal.appointments.requestDialog.failed')}
              </p>
            ) : null}
          </div>
        </Modal>
      ) : null}
    </>
  );
}
