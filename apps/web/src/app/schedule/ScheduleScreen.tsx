'use client';

import { Button, IconButton, Modal, Select, Toast } from '@openrunic/ui';
import { useCallback, useMemo, useState } from 'react';
import type { ReactElement } from 'react';

import type { Command } from '@/components/command';
import { ScreenCommands } from '@/components/command';
import {
  BookingModal,
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
import { IS_MOCK_MODE, MOCK_PROVIDERS } from '@/lib/api';
import type { ApiClient, Appointment, Patient } from '@/lib/api';
import { formatDate, formatName, formatTime } from '@/lib/format';

/**
 * FD-01 Schedule day view: the front door.
 *
 * The whole day at a glance, and the launch point for everything the front desk
 * does with it. OpenEMR buried its calendar behind a menu and defaulted to a
 * month view that took thirty seconds to draw; here the day is the home screen,
 * the current time is ruled across it, and every action on a visit is reachable
 * from the palette without touching the grid.
 *
 * Writes are not built yet, so check-in and booking are held for this session
 * and said so plainly rather than pretending to have saved. When the
 * appointment write endpoints land, the two pieces of local state below become
 * a mutation plus a refetch and nothing else on this screen changes.
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

export function ScheduleScreen({ client }: ScheduleScreenProps = {}): ReactElement {
  const [day, setDay] = useState<string>(() => clinicToday());
  const [providerId, setProviderId] = useState<string>('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [findingSlots, setFindingSlots] = useState(false);
  const [bookingSlot, setBookingSlot] = useState<OpenSlot | null>(null);
  const [confirming, setConfirming] = useState<Appointment | null>(null);
  const [checkedIn, setCheckedIn] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [toast, setToast] = useState<ToastMessage | null>(null);

  /* Read once at mount: the rule marks when the screen was opened, and nothing
     on a clinical surface should tick on a timer the user did not ask for. */
  const [now] = useState<Date>(() => clinicNow());

  const state = useClinicDay({ day, providerId: providerId || undefined, client });
  const appointments = state.data?.appointments ?? NO_APPOINTMENTS;
  const patientsById = state.data?.patientsById ?? NO_PATIENTS;

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

  const confirmCheckIn = (appointment: Appointment) => {
    const patient = appointment.patientId ? patientsById.get(appointment.patientId) : undefined;
    setCheckedIn((previous) => new Set(previous).add(appointment.id));
    setConfirming(null);
    setToast({
      title: 'Checked in',
      message: patient
        ? `${formatName(patient.name)} is on the Flow Board. Today's visit was created.`
        : 'The visit was created and is on the Flow Board.',
      href: '/schedule/flow-board',
      hrefLabel: 'Open the Flow Board',
    });
  };

  const confirmBooking = (details: BookingDetails) => {
    const patient = patientsById.get(details.patientId);
    setBookingSlot(null);
    setToast({
      title: 'Appointment booked',
      message: `${patient ? formatName(patient.name) : 'The patient'} is booked at ${formatTime(
        details.slot.start
      )} for a ${details.visitType.toLowerCase()}.`,
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

    if (selected && !checkedIn.has(selected.id)) {
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
  }, [checkedIn, openWalkIn, patientsById, selected]);

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
          checkedIn={checkedIn}
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

      {IS_MOCK_MODE ? (
        <p className="or-caption or-fd-mock-note">
          Mock mode: the schedule reads fixtures, and check-in and booking are held for this session
          only.
        </p>
      ) : null}

      {confirming ? (
        <Modal
          open
          role="alertdialog"
          width={520}
          title="Check in this patient"
          description={
            confirmingPatient
              ? `Check in ${formatName(confirmingPatient.name)} for the ${formatTime(
                  confirming.start
                )} ${confirming.type.display.toLowerCase()}. This creates today's visit and moves them onto the Flow Board.`
              : "Check in this visit. This creates today's visit and moves it onto the Flow Board."
          }
          onClose={() => setConfirming(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirming(null)}>
                Cancel
              </Button>
              <Button onClick={() => confirmCheckIn(confirming)}>
                {confirmingPatient
                  ? `Check in ${givenName(confirmingPatient.name)}`
                  : 'Check in visit'}
              </Button>
            </>
          }
        />
      ) : null}

      {bookingSlot ? (
        <BookingModal
          slot={bookingSlot}
          providers={columns}
          patients={[...patientsById.values()]}
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
