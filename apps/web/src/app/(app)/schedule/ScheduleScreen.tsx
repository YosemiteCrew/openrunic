'use client';

import type { Translator } from '@openrunic/i18n';
import { Alert, Button, IconButton, Select } from '@openrunic/ui';
import { useCallback, useMemo, useState } from 'react';
import type { ReactElement } from 'react';

import type { Command } from '@/components/command';
import { ScreenCommands } from '@/components/command';
import {
  awaitsCheckIn,
  clinicNow,
  clinicToday,
  DayRail,
  FindAvailablePanel,
  findOpenSlots,
  givenName,
  ScheduleGrid,
  shiftDay,
  useClinicDay,
} from '@/components/schedule';
import type { BookingDetails, OpenSlot, ScheduleProvider } from '@/components/schedule';
import { ScheduleOverlays } from './ScheduleOverlays';
import { AppShell } from '@/components/shell';
import { AsyncBoundary } from '@/components/state';
import { api, useMutation } from '@/lib/api';
import type { ApiClient, ApiError, Appointment, FacilityDto, Patient } from '@/lib/api';
import { formatDate, formatName, formatTime } from '@/lib/format';
import { useTranslator } from '@/lib/i18n/messages';

/**
 * FD-01 Schedule day view: the front door.
 *
 * The whole day at a glance, and the launch point for everything the front desk
 * does with it. Legacy systems buried the calendar behind a menu and defaulted to a
 * month view that took thirty seconds to draw; here the day is the home screen,
 * the current time is ruled across it, and every action on a visit is reachable
 * from the palette without touching the grid.
 *
 * Booking posts to `/appointments` and check-in patches one, and both are
 * followed by a re-read of the day rather than by a local edit of the row. The
 * day is a shared surface - two people at one desk work the same list - so what
 * it shows has to be what the server holds, not what this browser last did.
 *
 * Every id in that POST is read back from the API first. The facility and the
 * clinician both come from `useClinicDay`, which lists them through the same
 * client the booking is posted with, because `POST /appointments` checks the
 * facility against the grants on the token and the provider against a foreign
 * key. An id from anywhere else looks like a booking here and is a refusal
 * there, and the one thing this screen must never do is say a visit is booked
 * when the server has no such row.
 */

export interface ScheduleScreenProps {
  /** Injectable for tests. Defaults to the app's `api`. */
  client?: ApiClient;
}

interface ToastMessage {
  title: string;
  message: string;
  href?: string;
  hrefLabel?: string;
}

/* Stable empties, so a render before the data lands does not hand every memo a
   new reference and re-run work that has not changed. */
const NO_APPOINTMENTS: readonly Appointment[] = [];
const NO_PATIENTS: ReadonlyMap<string, Patient> = new Map();
const NO_PROVIDERS: readonly ScheduleProvider[] = [];
const NO_FACILITIES: readonly FacilityDto[] = [];

const DEFAULT_SLOT_MINUTES = 20;

/** The server's own sentence for a refusal, or nothing when none was given. */
function refusalOf(error: ApiError | null): string | null {
  if (!error) return null;
  return error.problem?.detail ?? error.message;
}

/**
 * Why this day cannot be booked into, or null when it can.
 *
 * A booking names the facility it happens at and the clinician it is with, and
 * the API checks both: the facility against the grants on the token, the
 * provider against a foreign key. When the directory came back without one of
 * them there is no id this screen could honestly send, so it says so and offers
 * no booking verb, rather than opening a dialog whose Book button would post
 * something from nowhere and then report a success the server never granted.
 */
function bookingBlockedReason(
  t: Translator,
  facility: FacilityDto | null,
  providerCount: number
): string | null {
  if (facility === null) return t('schedule.day.blocked.noFacility');
  if (providerCount === 0) {
    return t('schedule.day.blocked.noProvider', { facility: facility.name });
  }
  return null;
}

/**
 * Palette synonyms from one comma-separated message.
 *
 * They are per-language and not transliterations: somebody searching in Spanish
 * does not type "walk in", so the Spanish catalogue carries the words they do
 * type and this splits whichever list the reader's language supplied.
 */
function synonyms(list: string): string[] {
  return list
    .split(',')
    .map((word) => word.trim())
    .filter((word) => word !== '');
}

export function ScheduleScreen({ client }: Readonly<ScheduleScreenProps>): ReactElement {
  const t = useTranslator();
  const [day, setDay] = useState<string>(() => clinicToday());
  const [facilityId, setFacilityId] = useState<string>('');
  const [providerId, setProviderId] = useState<string>('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [findingSlots, setFindingSlots] = useState(false);
  const [bookingSlot, setBookingSlot] = useState<OpenSlot | null>(null);
  const [confirming, setConfirming] = useState<Appointment | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  /* Read once at mount: the rule marks when the screen was opened, and nothing
     on a clinical surface should tick on a timer the user did not ask for. */
  const [now] = useState<Date>(() => clinicNow());

  const state = useClinicDay({
    day,
    facilityId: facilityId || undefined,
    providerId: providerId || undefined,
    client,
  });
  const appointments = state.data?.appointments ?? NO_APPOINTMENTS;
  const patientsById = state.data?.patientsById ?? NO_PATIENTS;
  const facilities = state.data?.facilities ?? NO_FACILITIES;
  const providers = state.data?.providers ?? NO_PROVIDERS;
  /* The facility the day is scoped to, resolved by the hook rather than by this
     screen: the day shown and the day booked into have to be the same one. */
  const facility = state.data?.facility ?? null;

  const writes = client ?? api;
  const refetch = state.refetch;

  const checkIn = useMutation((appointment: Appointment) =>
    writes.appointments.update(appointment.id, { status: 'CHECKED_IN' })
  );
  /* The facility is an argument rather than a closed-over nullable, so this
     write cannot be built at all without one that was read back from the API. */
  const booking = useMutation((bookAt: FacilityDto, details: BookingDetails) =>
    writes.appointments.create({
      facilityId: bookAt.id,
      patientId: details.patientId,
      providerId: details.slot.providerId,
      typeCode: details.visitTypeCode,
      typeDisplay: details.visitType,
      start: details.slot.start,
      end: details.slot.end,
      durationMinutes: DEFAULT_SLOT_MINUTES,
      ...(details.reason.trim() ? { reasonText: details.reason.trim() } : {}),
    })
  );

  const columns = useMemo(
    () => (providerId ? providers.filter((provider) => provider.id === providerId) : providers),
    [providerId, providers]
  );

  const blockedReason = bookingBlockedReason(t, facility, providers.length);

  const slots = useMemo(
    () =>
      findOpenSlots(
        appointments,
        columns.map((provider) => provider.id),
        day,
        now,
        { durationMinutes: DEFAULT_SLOT_MINUTES }
      ),
    [appointments, columns, day, now]
  );

  const selected = appointments.find((appointment) => appointment.id === selectedId) ?? null;

  /** A walk-in is a booking into the first slot that is actually free. */
  const openWalkIn = useCallback(() => {
    setFindingSlots(true);
    setBookingSlot(slots[0] ?? null);
  }, [slots]);

  const confirmCheckIn = async (appointment: Appointment) => {
    const outcome = await checkIn.run(appointment);
    // The dialog stays open on a refusal so the reason is read next to the
    // button that caused it, rather than behind a closed dialog.
    if (!outcome.ok) return;
    const patient = outcome.value.patientId ? patientsById.get(outcome.value.patientId) : undefined;
    setConfirming(null);
    refetch();
    setToast({
      title: t('schedule.checkIn.toast.title'),
      message: patient
        ? t('schedule.checkIn.toast.message', { name: formatName(patient.name) })
        : t('schedule.checkIn.toast.messageUnassigned'),
      href: '/schedule/flow-board',
      hrefLabel: t('schedule.checkIn.toast.openFlowBoard'),
    });
  };

  const confirmBooking = async (bookAt: FacilityDto, details: BookingDetails) => {
    const outcome = await booking.run(bookAt, details);
    if (!outcome.ok) return;
    const saved = outcome.value;
    const patient = patientsById.get(details.patientId);
    setBookingSlot(null);
    refetch();
    /* The visit type is the practice's own catalogue entry, carried on the
       appointment the server just wrote, so it is interpolated as it stands
       rather than translated. See `BookingModal`. */
    const values = {
      time: formatTime(saved.start),
      visitType: saved.type.display.toLowerCase(),
    };
    setToast({
      title: t('schedule.booking.toast.title'),
      message: patient
        ? t('schedule.booking.toast.message', { ...values, name: formatName(patient.name) })
        : t('schedule.booking.toast.messageUnassigned', values),
    });
  };

  const commands = useMemo<Command[]>(() => {
    const registered: Command[] = [
      {
        id: 'schedule.today',
        group: 'actions',
        label: t('schedule.day.command.today'),
        keywords: synonyms(t('schedule.day.command.today.keywords')),
        icon: 'calendar-check',
        perform: () => setDay(clinicToday()),
      },
      {
        id: 'schedule.previous-day',
        group: 'actions',
        label: t('schedule.day.command.previousDay'),
        icon: 'chevron-left',
        perform: () => setDay((value) => shiftDay(value, -1)),
      },
      {
        id: 'schedule.next-day',
        group: 'actions',
        label: t('schedule.day.command.nextDay'),
        icon: 'chevron-right',
        perform: () => setDay((value) => shiftDay(value, 1)),
      },
    ];

    /* The two booking verbs are offered only when a booking can actually be
       made. A palette that lists "Add walk-in" against an organisation with no
       facility on file is offering a verb whose only possible outcome is a
       refusal, and the alert on the page says why instead. */
    if (blockedReason === null) {
      registered.unshift(
        {
          id: 'schedule.find-available',
          group: 'actions',
          label: t('schedule.day.command.findAvailable'),
          keywords: synonyms(t('schedule.day.command.findAvailable.keywords')),
          icon: 'calendar-search',
          perform: () => setFindingSlots(true),
        },
        {
          id: 'schedule.walk-in',
          group: 'actions',
          label: t('schedule.action.addWalkIn'),
          keywords: synonyms(t('schedule.day.command.walkIn.keywords')),
          icon: 'user-plus',
          perform: openWalkIn,
        }
      );
    }

    if (selected && awaitsCheckIn(selected.status)) {
      const patient = selected.patientId ? patientsById.get(selected.patientId) : undefined;
      registered.push({
        id: 'schedule.check-in',
        group: 'actions',
        label: patient
          ? t('schedule.checkIn.named', { name: givenName(patient.name) })
          : t('schedule.day.command.checkInSelected'),
        keywords: synonyms(t('schedule.day.command.checkIn.keywords')),
        icon: 'log-in',
        perform: () => setConfirming(selected),
      });
    }

    return registered;
  }, [blockedReason, openWalkIn, patientsById, selected, t]);

  const confirmingPatient = confirming?.patientId
    ? patientsById.get(confirming.patientId)
    : undefined;

  /* Where the day is happening, named in the heading rather than only in the
     top bar, because it is the facility a booking made from this screen is
     written against. Two whole sentences rather than one with a clause the code
     glues in: the first render of this screen has no `state.data` yet, and a
     language that puts the place somewhere else in the sentence cannot move a
     fragment that arrived already assembled. */
  const description = facility
    ? t('schedule.day.descriptionAtFacility', {
        date: formatDate(day),
        facility: facility.name,
      })
    : t('schedule.day.description', { date: formatDate(day) });

  return (
    <AppShell
      title={t('schedule.day.title')}
      description={description}
      topBarActions={
        <div className="or-day-pager">
          <IconButton
            icon="chevron-left"
            label={t('schedule.day.previousDay')}
            variant="ghost"
            onClick={() => setDay(shiftDay(day, -1))}
          />
          <Button variant="ghost" size="sm" onClick={() => setDay(clinicToday())}>
            {t('schedule.day.today')}
          </Button>
          <IconButton
            icon="chevron-right"
            label={t('schedule.day.nextDay')}
            variant="ghost"
            onClick={() => setDay(shiftDay(day, 1))}
          />
          {/* Offered only when there is a choice to make. One facility is not a
              choice, and a select with a single option is a control that does
              nothing. */}
          {facilities.length > 1 ? (
            <Select
              aria-label={t('schedule.filter.facility')}
              value={facility?.id ?? ''}
              onChange={(event) => setFacilityId(event.target.value)}
              options={facilities.map((row) => ({ value: row.id, label: row.name }))}
            />
          ) : null}
          <Select
            aria-label={t('schedule.filter.provider')}
            value={providerId}
            onChange={(event) => setProviderId(event.target.value)}
            options={[
              { value: '', label: t('schedule.filter.allProviders') },
              ...providers.map((provider) => ({ value: provider.id, label: provider.name })),
            ]}
          />
        </div>
      }
      actions={
        <>
          <Button
            variant="secondary"
            iconLeft="user-plus"
            disabled={blockedReason !== null}
            onClick={openWalkIn}
          >
            {t('schedule.action.addWalkIn')}
          </Button>
          <Button
            iconLeft="calendar-search"
            disabled={blockedReason !== null}
            onClick={() => setFindingSlots(true)}
          >
            {t('schedule.action.findAvailable')}
          </Button>
        </>
      }
      rightRail={
        <DayRail
          appointments={appointments}
          patientsById={patientsById}
          selected={selected}
          canBook={blockedReason === null}
          onCheckIn={setConfirming}
          onWalkIn={openWalkIn}
        />
      }
    >
      <ScreenCommands commands={commands} />

      {/* Only once the directory has answered: during the first read there is
          no facility yet, and a notice saying so would be reporting the loading
          state as a configuration fault. */}
      {state.status === 'success' && blockedReason !== null ? (
        <Alert tone="caution" title={t('schedule.day.blocked.title')} message={blockedReason} />
      ) : null}

      {findingSlots && facility !== null ? (
        <FindAvailablePanel
          slots={slots}
          providers={columns}
          durationMinutes={DEFAULT_SLOT_MINUTES}
          onBook={setBookingSlot}
          onClose={() => setFindingSlots(false)}
        />
      ) : null}

      <AsyncBoundary
        state={state}
        subject={t('schedule.day.subject')}
        loadingRows={10}
        isEmpty={(data) => data.appointments.length === 0}
        empty={{
          title: t('schedule.day.empty.title'),
          message: t('schedule.day.empty.message'),
          icon: 'calendar-days',
          // No verb when the verb cannot be performed: the alert above already
          // says what is missing, and a button that opens nothing is worse.
          action:
            blockedReason === null ? (
              <Button iconLeft="calendar-search" onClick={() => setFindingSlots(true)}>
                {t('schedule.action.findAvailable')}
              </Button>
            ) : undefined,
        }}
      >
        {(data) => (
          <ScheduleGrid
            appointments={data.appointments}
            providers={columns}
            patientsById={data.patientsById}
            now={now}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        )}
      </AsyncBoundary>

      <ScheduleOverlays
        confirming={confirming}
        confirmingPatient={confirmingPatient}
        checkInPending={checkIn.pending}
        checkInError={refusalOf(checkIn.error)}
        onCancelCheckIn={() => setConfirming(null)}
        onConfirmCheckIn={(appointment) => void confirmCheckIn(appointment)}
        bookingSlot={bookingSlot}
        facility={facility}
        providers={columns}
        patients={[...patientsById.values()]}
        bookingPending={booking.pending}
        bookingError={refusalOf(booking.error)}
        onCancelBooking={() => setBookingSlot(null)}
        onConfirmBooking={(bookAt, details) => void confirmBooking(bookAt, details)}
        toast={toast}
        onDismissToast={() => setToast(null)}
      />
    </AppShell>
  );
}
