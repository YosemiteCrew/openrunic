'use client';

import { Button, Card, Select, Switch, Toast } from '@openrunic/ui';
import { useCallback, useMemo, useState } from 'react';
import type { ReactElement } from 'react';

import type { Command } from '@/components/command';
import { ScreenCommands } from '@/components/command';
import {
  clinicNow,
  clinicToday,
  delayTier,
  FLOW_COLUMNS,
  FlowCard,
  givenName,
  minutesBetween,
  nextStatus,
  useClinicDay,
} from '@/components/schedule';
import { AppShell } from '@/components/shell';
import { AsyncBoundary } from '@/components/state';
import { MOCK_PROVIDERS, MOCK_ROOMS, mockStatusSince } from '@/lib/api';
import type { ApiClient, Appointment, AppointmentStatus, Patient } from '@/lib/api';
import { formatEnumLabel, formatName, formatTime } from '@/lib/format';

/**
 * FD-03 Patient Flow Board: where every patient physically is.
 *
 * Five status columns with their counts in the header, a card per patient with
 * two clocks and a one-click advance, and rooms assigned from the board itself.
 * The delay treatment is static and worded, never a blink, and the board never
 * scrolls or reorders itself while someone is reading it.
 *
 * There is no push channel yet, so the board says when it last read the server
 * instead of implying it is live. Advancing a status and assigning a room are
 * held for this session, with an undo on the toast, until the write endpoints
 * land.
 */

export interface FlowBoardScreenProps {
  /** Injectable for tests. Defaults to the app's `api`. */
  client?: ApiClient;
}

interface ToastMessage {
  title: string;
  message: string;
  undo?: () => void;
}

const NO_APPOINTMENTS: readonly Appointment[] = [];
const NO_PATIENTS: ReadonlyMap<string, Patient> = new Map();

/** Every status that puts a card on the board, in any column. */
const ON_BOARD: readonly AppointmentStatus[] = FLOW_COLUMNS.flatMap((column) => [
  ...column.statuses,
]);

export function FlowBoardScreen({ client }: FlowBoardScreenProps = {}): ReactElement {
  const [providerId, setProviderId] = useState('');
  const [room, setRoom] = useState('');
  const [delayedOnly, setDelayedOnly] = useState(false);
  const [statusOverrides, setStatusOverrides] = useState<Record<string, AppointmentStatus>>({});
  const [roomOverrides, setRoomOverrides] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const [now] = useState<Date>(() => clinicNow());
  const [day] = useState<string>(() => clinicToday());

  const state = useClinicDay({ day, providerId: providerId || undefined, client });
  const appointments = state.data?.appointments ?? NO_APPOINTMENTS;
  const patientsById = state.data?.patientsById ?? NO_PATIENTS;

  const statusOf = useCallback(
    (appointment: Appointment): AppointmentStatus =>
      statusOverrides[appointment.id] ?? appointment.status,
    [statusOverrides]
  );

  const roomOf = useCallback(
    (appointment: Appointment): string | null => roomOverrides[appointment.id] ?? appointment.room,
    [roomOverrides]
  );

  const onBoard = useMemo(
    () =>
      appointments.filter((appointment) => {
        if (!ON_BOARD.includes(statusOf(appointment))) return false;
        if (room && roomOf(appointment) !== room) return false;
        if (delayedOnly) {
          const waited = minutesBetween(mockStatusSince(appointment), now);
          if (delayTier(statusOf(appointment), waited) === 'none') return false;
        }
        return true;
      }),
    [appointments, delayedOnly, now, room, roomOf, statusOf]
  );

  const advance = (appointment: Appointment) => {
    const from = statusOf(appointment);
    const to = nextStatus(from);
    if (!to) return;
    const patient = appointment.patientId ? patientsById.get(appointment.patientId) : undefined;

    setStatusOverrides((previous) => ({ ...previous, [appointment.id]: to }));
    setToast({
      title: formatEnumLabel(to),
      message: `${patient ? formatName(patient.name) : 'This visit'} moved from ${formatEnumLabel(
        from
      ).toLowerCase()} to ${formatEnumLabel(to).toLowerCase()}.`,
      undo: () => setStatusOverrides((previous) => ({ ...previous, [appointment.id]: from })),
    });
  };

  const assignRoom = (appointment: Appointment, next: string) => {
    const previousRoom = roomOf(appointment);
    const patient = appointment.patientId ? patientsById.get(appointment.patientId) : undefined;

    setRoomOverrides((previous) => ({ ...previous, [appointment.id]: next }));
    setToast({
      title: next ? 'Room assigned' : 'Room cleared',
      message: next
        ? `${patient ? givenName(patient.name) : 'This visit'} is in ${next}.`
        : `${patient ? givenName(patient.name) : 'This visit'} has no room.`,
      undo: () =>
        setRoomOverrides((previous) => ({ ...previous, [appointment.id]: previousRoom ?? '' })),
    });
  };

  const commands = useMemo<Command[]>(
    () => [
      {
        id: 'flow-board.delayed-only',
        group: 'actions',
        label: delayedOnly ? 'Show every patient on the board' : 'Show delayed patients only',
        keywords: ['delay', 'waiting', 'late', 'filter'],
        icon: 'timer',
        perform: () => setDelayedOnly((value) => !value),
      },
      {
        id: 'flow-board.clear-filters',
        group: 'actions',
        label: 'Clear board filters',
        keywords: ['reset', 'all providers', 'all rooms'],
        icon: 'filter-x',
        perform: () => {
          setProviderId('');
          setRoom('');
          setDelayedOnly(false);
        },
      },
      {
        id: 'flow-board.refresh',
        group: 'actions',
        label: 'Read the board again',
        keywords: ['refresh', 'sync', 'reload'],
        icon: 'rotate-ccw',
        perform: state.refetch,
      },
    ],
    [delayedOnly, state.refetch]
  );

  return (
    <AppShell
      title="Flow Board"
      description="Where every patient is right now, and how long they have been there."
      topBarActions={
        <p className="or-small or-flow-sync">
          Last read at <span className="or-mono">{formatTime(now.toISOString())}</span>
        </p>
      }
      actions={
        <Button variant="secondary" iconLeft="calendar-days" href="/schedule">
          Back to the schedule
        </Button>
      }
    >
      <ScreenCommands commands={commands} />

      <Card overline="Filters" title="Narrow the board">
        <div className="or-flow-filters">
          <Select
            label="Provider"
            value={providerId}
            onChange={(event) => setProviderId(event.target.value)}
            options={[
              { value: '', label: 'All providers' },
              ...MOCK_PROVIDERS.map((provider) => ({
                value: provider.id,
                label: provider.name,
              })),
            ]}
          />
          <Select
            label="Room"
            value={room}
            onChange={(event) => setRoom(event.target.value)}
            options={[
              { value: '', label: 'All rooms' },
              ...MOCK_ROOMS.map((option) => ({ value: option, label: option })),
            ]}
          />
          <Switch
            label="Delayed patients only"
            hint="Waiting 15 minutes or more in a pre-visit status."
            checked={delayedOnly}
            onChange={() => setDelayedOnly((value) => !value)}
          />
        </div>
      </Card>

      <AsyncBoundary
        state={state}
        subject="the flow board"
        loadingVariant="cards"
        loadingRows={5}
        isEmpty={() => onBoard.length === 0}
        empty={{
          title: 'No patients on the board yet',
          message:
            'Patients appear here the moment they are checked in. Check the first arrival in from the schedule.',
          icon: 'users',
          action: (
            <Button iconLeft="calendar-days" href="/schedule">
              Go to the schedule
            </Button>
          ),
        }}
      >
        {() => (
          <div className="or-flow-board">
            {FLOW_COLUMNS.map((column) => {
              const cards = onBoard.filter((appointment) =>
                column.statuses.includes(statusOf(appointment))
              );
              return (
                <section
                  key={column.id}
                  className="or-flow-column"
                  data-done={column.done || undefined}
                  aria-label={`${column.label}, ${cards.length} patients`}
                >
                  <header className="or-flow-column__head">
                    <h3 className="or-flow-column__title">{column.label}</h3>
                    <span className="or-mono or-flow-column__count">{cards.length}</span>
                  </header>

                  {cards.length === 0 ? (
                    <p className="or-caption or-flow-column__empty">Nobody here right now.</p>
                  ) : (
                    <ul className="or-flow-column__list">
                      {cards.map((appointment) => (
                        <li key={appointment.id}>
                          <FlowCard
                            appointment={{ ...appointment, status: statusOf(appointment) }}
                            patient={
                              appointment.patientId
                                ? patientsById.get(appointment.patientId)
                                : undefined
                            }
                            statusSince={mockStatusSince(appointment)}
                            now={now}
                            room={roomOverrides[appointment.id] ?? null}
                            onAdvance={advance}
                            onAssignRoom={assignRoom}
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </AsyncBoundary>

      {toast ? (
        <div className="or-fd-toast-host">
          <Toast
            tone="success"
            title={toast.title}
            message={toast.message}
            action={
              toast.undo ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    toast.undo?.();
                    setToast(null);
                  }}
                >
                  Undo
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
