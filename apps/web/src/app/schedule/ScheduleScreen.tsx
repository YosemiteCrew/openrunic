'use client';

import { Button, IconButton, Select, Toast } from '@openrunic/ui';
import { useCallback, useMemo, useState } from 'react';
import type { ReactElement } from 'react';

import type { Command } from '@/components/command';
import { ScreenCommands } from '@/components/command';
import {
  awaitsCheckIn,
  BookingModal,
  CheckInDialog,
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
import { AppShell } from '@/components/shell';
import { AsyncBoundary } from '@/components/state';
import { api, MOCK_FACILITY, MOCK_PROVIDERS, useMutation } from '@/lib/api';
import type { ApiClient, ApiError, Appointment, Patient } from '@/lib/api';
import { formatDate, formatName, formatTime } from '@/lib/format';

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

/** No practitioner endpoint yet, so the columns come from the fixtures. */
const PROVIDERS: readonly ScheduleProvider[] = MOCK_PROVIDERS.map((provider) => ({
  id: provider.id,
  name: provider.name,
  role: provider.role,
}));

/* Stable empties, so a render before the data lands does not hand every memo a
   new reference and re-run work that has not changed. */
const NO_APPOINTMENTS: readonly Appointment[] = [];
const NO_PATIENTS: ReadonlyMap<string, Patient> = new Map();

const DEFAULT_SLOT_MINUTES = 20;

/** The server's own sentence for a refusal, or nothing when none was given. */
function refusalOf(error: ApiError | null): string | null {
  if (!error) return null;
  return error.problem?.detail ?? error.message;
}

export function ScheduleScreen({ client }: Readonly<ScheduleScreenProps>): ReactElement {
  const [day, setDay] = useState<string>(() => clinicToday());
  const [providerId, setProviderId] = useState<string>('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [findingSlots, setFindingSlots] = useState(false);
  const [bookingSlot, setBookingSlot] = useState<OpenSlot | null>(null);
  const [confirming, setConfirming] = useState<Appointment | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  /* Read once at mount: the rule marks when the screen was opened, and nothing
     on a clinical surface should tick on a timer the user did not ask for. */
  const [now] = useState<Date>(() => clinicNow());

  const state = useClinicDay({ day, providerId: providerId || undefined, client });
  const appointments = state.data?.appointments ?? NO_APPOINTMENTS;
  const patientsById = state.data?.patientsById ?? NO_PATIENTS;

  const writes = client ?? api;
  const refetch = state.refetch;

  const checkIn = useMutation((appointment: Appointment) =>
    writes.appointments.update(appointment.id, { status: 'CHECKED_IN' })
  );
  const booking = useMutation((details: BookingDetails) =>
    writes.appointments.create({
      facilityId: MOCK_FACILITY.id,
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
    () => (providerId ? PROVIDERS.filter((provider) => provider.id === providerId) : PROVIDERS),
    [providerId]
  );

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
      title: 'Checked in',
      message: patient
        ? `${formatName(patient.name)} is on the Flow Board.`
        : 'The visit is on the Flow Board.',
      href: '/schedule/flow-board',
      hrefLabel: 'Open the Flow Board',
    });
  };

  const confirmBooking = async (details: BookingDetails) => {
    const outcome = await booking.run(details);
    if (!outcome.ok) return;
    const saved = outcome.value;
    const patient = patientsById.get(details.patientId);
    setBookingSlot(null);
    refetch();
    setToast({
      title: 'Appointment booked',
      message: `${patient ? formatName(patient.name) : 'The patient'} is booked at ${formatTime(
        saved.start
      )} for a ${saved.type.display.toLowerCase()}.`,
    });
  };

  const commands = useMemo<Command[]>(() => {
    const registered: Command[] = [
      {
        id: 'schedule.find-available',
        group: 'actions',
        label: 'Find available slots',
        keywords: ['book', 'open slot', 'next available', 'appointment'],
        icon: 'calendar-search',
        perform: () => setFindingSlots(true),
      },
      {
        id: 'schedule.walk-in',
        group: 'actions',
        label: 'Add walk-in',
        keywords: ['walk in', 'unscheduled', 'squeeze in'],
        icon: 'user-plus',
        perform: openWalkIn,
      },
      {
        id: 'schedule.today',
        group: 'actions',
        label: 'Go to today',
        keywords: ['now', 'current day', 'reset date'],
        icon: 'calendar-check',
        perform: () => setDay(clinicToday()),
      },
      {
        id: 'schedule.previous-day',
        group: 'actions',
        label: 'Go to the previous day',
        icon: 'chevron-left',
        perform: () => setDay((value) => shiftDay(value, -1)),
      },
      {
        id: 'schedule.next-day',
        group: 'actions',
        label: 'Go to the next day',
        icon: 'chevron-right',
        perform: () => setDay((value) => shiftDay(value, 1)),
      },
    ];

    if (selected && awaitsCheckIn(selected.status)) {
      const patient = selected.patientId ? patientsById.get(selected.patientId) : undefined;
      registered.push({
        id: 'schedule.check-in',
        group: 'actions',
        label: patient ? `Check in ${givenName(patient.name)}` : 'Check in the selected visit',
        keywords: ['arrive', 'arrival', 'front desk'],
        icon: 'log-in',
        perform: () => setConfirming(selected),
      });
    }

    return registered;
  }, [openWalkIn, patientsById, selected]);

  const confirmingPatient = confirming?.patientId
    ? patientsById.get(confirming.patientId)
    : undefined;

  return (
    <AppShell
      title="Schedule"
      description={`${formatDate(day)}. The clinic day, per provider, with status inline.`}
      topBarActions={
        <div className="or-day-pager">
          <IconButton
            icon="chevron-left"
            label="Previous day"
            variant="ghost"
            onClick={() => setDay(shiftDay(day, -1))}
          />
          <Button variant="ghost" size="sm" onClick={() => setDay(clinicToday())}>
            Today
          </Button>
          <IconButton
            icon="chevron-right"
            label="Next day"
            variant="ghost"
            onClick={() => setDay(shiftDay(day, 1))}
          />
          <Select
            aria-label="Provider"
            value={providerId}
            onChange={(event) => setProviderId(event.target.value)}
            options={[
              { value: '', label: 'All providers' },
              ...PROVIDERS.map((provider) => ({ value: provider.id, label: provider.name })),
            ]}
          />
        </div>
      }
      actions={
        <>
          <Button variant="secondary" iconLeft="user-plus" onClick={openWalkIn}>
            Add walk-in
          </Button>
          <Button iconLeft="calendar-search" onClick={() => setFindingSlots(true)}>
            Find available
          </Button>
        </>
      }
      rightRail={
        <DayRail
          appointments={appointments}
          patientsById={patientsById}
          selected={selected}
          onCheckIn={setConfirming}
          onWalkIn={openWalkIn}
        />
      }
    >
      <ScreenCommands commands={commands} />

      {findingSlots ? (
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
        subject="today's schedule"
        loadingRows={10}
        isEmpty={(data) => data.appointments.length === 0}
        empty={{
          title: 'No appointments on this day',
          message: 'Nothing is booked for this date. Find an open slot to book the first visit.',
          icon: 'calendar-days',
          action: (
            <Button iconLeft="calendar-search" onClick={() => setFindingSlots(true)}>
              Find available
            </Button>
          ),
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

      {confirming ? (
        <CheckInDialog
          appointment={confirming}
          patient={confirmingPatient}
          pending={checkIn.pending}
          error={refusalOf(checkIn.error)}
          onCancel={() => setConfirming(null)}
          onConfirm={confirmCheckIn}
        />
      ) : null}

      {bookingSlot ? (
        <BookingModal
          slot={bookingSlot}
          providers={columns}
          patients={[...patientsById.values()]}
          pending={booking.pending}
          error={refusalOf(booking.error)}
          onCancel={() => setBookingSlot(null)}
          onConfirm={confirmBooking}
        />
      ) : null}

      {toast ? (
        <div className="or-fd-toast-host">
          <Toast
            tone="success"
            title={toast.title}
            message={toast.message}
            action={
              toast.href ? (
                <Button variant="ghost" size="sm" href={toast.href}>
                  {toast.hrefLabel}
                </Button>
              ) : null
            }
            onClose={() => setToast(null)}
          />
        </div>
      ) : null}
    </AppShell>
  );
}
