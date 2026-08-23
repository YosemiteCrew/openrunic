'use client';

import { Button, Card, Select, Switch, Toast } from '@openrunic/ui';
import type { ToastTone } from '@openrunic/ui';
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
import type { ScheduleProvider } from '@/components/schedule';
import { AppShell } from '@/components/shell';
import { AsyncBoundary } from '@/components/state';
import { api, MOCK_ROOMS, mockStatusSince, useMutation } from '@/lib/api';
import type { ApiClient, ApiError, Appointment, AppointmentStatus, Patient } from '@/lib/api';
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
 * instead of implying it is live. Advancing a status and assigning a room both
 * patch the appointment and then re-read the board, and the undo on the toast
 * is a second write back to where the card was rather than a local rollback: a
 * card that says ROOMED because this browser remembers moving it, on a board
 * two other people are also working, is worse than no board.
 */

export interface FlowBoardScreenProps {
  /** Injectable for tests. Defaults to the app's `api`. */
  client?: ApiClient;
}

interface ToastMessage {
  title: string;
  message: string;
  /** A refusal reads as a failure, never as the confirmation it is not. */
  tone?: ToastTone;
  undo?: () => void;
}

/** The two moves this board makes: along the flow, and between rooms. */
type AppointmentPatch = { status: AppointmentStatus } | { room: string };

/** The server's own words for a refusal, falling back to why it never answered. */
function refusalOf(error: ApiError): string {
  return error.problem?.detail ?? error.message;
}

const NO_APPOINTMENTS: readonly Appointment[] = [];
const NO_PATIENTS: ReadonlyMap<string, Patient> = new Map();
const NO_PROVIDERS: readonly ScheduleProvider[] = [];

/** Every status that puts a card on the board, in any column. */
const ON_BOARD: ReadonlySet<AppointmentStatus> = new Set(
  FLOW_COLUMNS.flatMap((column) => [...column.statuses])
);

export function FlowBoardScreen({ client }: Readonly<FlowBoardScreenProps>): ReactElement {
  const [providerId, setProviderId] = useState('');
  const [room, setRoom] = useState('');
  const [delayedOnly, setDelayedOnly] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const [now] = useState<Date>(() => clinicNow());
  const [day] = useState<string>(() => clinicToday());

  const state = useClinicDay({ day, providerId: providerId || undefined, client });
  const appointments = state.data?.appointments ?? NO_APPOINTMENTS;
  const patientsById = state.data?.patientsById ?? NO_PATIENTS;
  /* The filter narrows a server-side query, so its options have to be ids the
     server knows. A fixture id here would quietly empty the board. */
  const providers = state.data?.providers ?? NO_PROVIDERS;

  const writes = client ?? api;
  const refetch = state.refetch;

  const move = useMutation((id: string, patch: AppointmentPatch) =>
    writes.appointments.update(id, patch)
  );

  const onBoard = useMemo(
    () =>
      appointments.filter((appointment) => {
        if (!ON_BOARD.has(appointment.status)) return false;
        if (room && appointment.room !== room) return false;
        if (delayedOnly) {
          const waited = minutesBetween(mockStatusSince(appointment), now);
          if (delayTier(appointment.status, waited) === 'none') return false;
        }
        return true;
      }),
    [appointments, delayedOnly, now, room]
  );

  /* One write, one re-read, one toast. The undo is another write rather than a
     rollback of local state, because the board is shared and the server is the
     only thing that knows where a card actually is. */
  const apply = useCallback(
    async (id: string, patch: AppointmentPatch, message: ToastMessage): Promise<void> => {
      const outcome = await move.run(id, patch);
      if (outcome.ok) {
        refetch();
        setToast(message);
        return;
      }
      // The card has not moved, so the board must not say it has. The refusal
      // comes back with the outcome rather than being read off the hook, which
      // at this point still holds the previous render's error.
      setToast({
        title: 'That move was refused',
        message: refusalOf(outcome.error),
        tone: 'danger',
      });
    },
    [move, refetch]
  );

  const advance = (appointment: Appointment) => {
    const from = appointment.status;
    const to = nextStatus(from);
    if (!to) return;
    const patient = appointment.patientId ? patientsById.get(appointment.patientId) : undefined;

    void apply(
      appointment.id,
      { status: to },
      {
        title: formatEnumLabel(to),
        message: `${patient ? formatName(patient.name) : 'This visit'} moved from ${formatEnumLabel(
          from
        ).toLowerCase()} to ${formatEnumLabel(to).toLowerCase()}.`,
        undo: () => {
          void apply(
            appointment.id,
            { status: from },
            {
              title: formatEnumLabel(from),
              message: `Moved back to ${formatEnumLabel(from).toLowerCase()}.`,
            }
          );
        },
      }
    );
  };

  const assignRoom = (appointment: Appointment, next: string) => {
    const previousRoom = appointment.room;
    const patient = appointment.patientId ? patientsById.get(appointment.patientId) : undefined;

    // Named once: the toast says the same "who" whichever branch it takes.
    const who = patient ? givenName(patient.name) : 'This visit';
    // The API's patch schema takes a room of at least one character, so
    // clearing one is not a write it accepts. Until it does, the board offers
    // moving a patient between rooms and not emptying one.
    if (!next) return;

    void apply(
      appointment.id,
      { room: next },
      {
        title: 'Room assigned',
        message: `${who} is in ${next}.`,
        ...(previousRoom
          ? {
              undo: () => {
                void apply(
                  appointment.id,
                  { room: previousRoom },
                  { title: 'Room assigned', message: `${who} is back in ${previousRoom}.` }
                );
              },
            }
          : {}),
      }
    );
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
              ...providers.map((provider) => ({
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
                column.statuses.includes(appointment.status)
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
                            appointment={appointment}
                            patient={
                              appointment.patientId
                                ? patientsById.get(appointment.patientId)
                                : undefined
                            }
                            statusSince={mockStatusSince(appointment)}
                            now={now}
                            room={appointment.room}
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
            tone={toast.tone ?? 'success'}
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
