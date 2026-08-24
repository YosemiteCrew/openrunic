import type { BadgeTone } from '@openrunic/ui';

import type { Appointment, AppointmentStatus, PatientName, UserDto } from '@/lib/api';
import { formatTime } from '@/lib/format';

import type { ScheduleProvider } from './ScheduleGrid';

/**
 * The schedule's arithmetic, with no React in it.
 *
 * Everything the day grid and the flow board decide - which lane a
 * double-booked appointment sits in, how tall a block is, whether a wait has
 * crossed into the caution band - is a pure function here, so it can be tested
 * without rendering and reasoned about without reading JSX.
 */

/** One row of the grid. Ten minutes is the shortest slot the practice books. */
export const SLOT_MINUTES = 10;

/** The day the grid always shows, even when nothing is booked in the early rows. */
const DEFAULT_OPEN_MINUTES = 8 * 60;
const DEFAULT_CLOSE_MINUTES = 17 * 60;

/**
 * The word a badge or a column heading shows for each state.
 *
 * A literal map rather than a key built from the status at the call site. The
 * catalogue drift test reads the source for the keys it asks for and finds
 * literals; a key assembled from a variable is invisible to it, and so is
 * invisible to whoever has to find the string when it is wrong.
 *
 * These replaced a rule that lowercased the enum member and capitalised the
 * first letter. That rule needed two hand-written exceptions because it turns
 * `NOSHOW` into "Noshow", and it could not be translated at all - which matters
 * most on the flow board, where a column heading and the badge on every card in
 * it name the same state and must not say two different things.
 */
export const STATUS_LABEL_KEY: Readonly<Record<AppointmentStatus, string>> = {
  PROPOSED: 'schedule.status.proposed',
  PENDING: 'schedule.status.pending',
  BOOKED: 'schedule.status.booked',
  ARRIVED: 'schedule.status.arrived',
  CHECKED_IN: 'schedule.status.checkedIn',
  ROOMED: 'schedule.status.roomed',
  IN_PROGRESS: 'schedule.status.inProgress',
  CHECKED_OUT: 'schedule.status.checkedOut',
  FULFILLED: 'schedule.status.fulfilled',
  CANCELLED: 'schedule.status.cancelled',
  NOSHOW: 'schedule.status.noShow',
  ENTERED_IN_ERROR: 'schedule.status.enteredInError',
};

/**
 * The same states, written to sit inside a sentence: "moved from arrived to
 * checked in".
 *
 * A second message rather than `toLowerCase()` on the first, because casing is
 * a per-language decision code cannot make. German capitalises its nouns
 * wherever they stand, and Turkish has two i rules that turn a correct word
 * into a wrong one.
 */
export const STATUS_INLINE_KEY: Readonly<Record<AppointmentStatus, string>> = {
  PROPOSED: 'schedule.status.inline.proposed',
  PENDING: 'schedule.status.inline.pending',
  BOOKED: 'schedule.status.inline.booked',
  ARRIVED: 'schedule.status.inline.arrived',
  CHECKED_IN: 'schedule.status.inline.checkedIn',
  ROOMED: 'schedule.status.inline.roomed',
  IN_PROGRESS: 'schedule.status.inline.inProgress',
  CHECKED_OUT: 'schedule.status.inline.checkedOut',
  FULFILLED: 'schedule.status.inline.fulfilled',
  CANCELLED: 'schedule.status.inline.cancelled',
  NOSHOW: 'schedule.status.inline.noShow',
  ENTERED_IN_ERROR: 'schedule.status.inline.enteredInError',
};

export interface StatusPresentation {
  /**
   * Catalogue key for the word, always rendered: status is never colour alone.
   *
   * A key rather than the word, because this is a pure function with no
   * translator and the screens that call it all have one.
   */
  labelKey: string;
  tone: BadgeTone;
  /** The visit is over, so the block reads quiet rather than live. */
  done: boolean;
}

/**
 * Status tones come off the clinical palette only: olive for a visit that
 * finished, danger for one that failed, hazelnut for everything in flight.
 * Terracotta is for actions, never for state.
 */
export function presentStatus(status: AppointmentStatus): StatusPresentation {
  const labelKey = STATUS_LABEL_KEY[status];
  if (status === 'CHECKED_OUT' || status === 'FULFILLED') {
    return { labelKey, tone: 'success', done: true };
  }
  if (status === 'NOSHOW' || status === 'ENTERED_IN_ERROR') {
    return { labelKey, tone: 'danger', done: true };
  }
  if (status === 'CANCELLED') return { labelKey, tone: 'neutral', done: true };
  return { labelKey, tone: 'neutral', done: false };
}

/**
 * What a person is called, for button copy: "Check in Testina", never "Check in
 * T. Patientsson". A preferred name wins, because it is what the front desk
 * will say out loud.
 */
export function givenName(name: PatientName): string {
  return name.preferred ?? name.given;
}

/**
 * A directory row, as a column heading.
 *
 * The name and the credential are everything `/bff/v0/users` publishes about a
 * clinician that a person can read: there is no display name and no specialty
 * label on the wire, and `taxonomyCode` is a NUCC code rather than a word. So
 * the column says the name and, under it, the credential the record actually
 * carries, and says nothing where the record is silent.
 */
export function toScheduleProvider(user: UserDto): ScheduleProvider {
  return {
    id: user.id,
    name: `${user.givenName} ${user.familyName}`,
    role: user.credential ?? '',
  };
}

/** Visit categories draw from the viz ramp at fixed lightness, never a free colour. */
const CATEGORY_VIZ: Readonly<Record<string, number>> = {
  FOLLOWUP: 1,
  CHRONIC: 2,
  WELLCHILD: 3,
  ACUTE: 4,
  PHYSICAL: 5,
  IMMUNISATION: 6,
  PROCEDURE: 2,
  TELEHEALTH: 3,
};

/** A stable 1-6 viz slot for a visit type, so an unknown code still gets a colour. */
export function categoryViz(code: string): number {
  const known = CATEGORY_VIZ[code.toUpperCase()];
  if (known) return known;
  const sum = [...code].reduce((total, character) => total + (character.codePointAt(0) ?? 0), 0);
  return (sum % 6) + 1;
}

/**
 * Minutes past midnight in the clinic's timezone, read through the shared
 * formatter so the grid can never disagree with the times printed on it.
 */
export function minutesOfDay(instant: string | null | undefined): number | null {
  const time = formatTime(instant);
  if (!/^\d{2}:\d{2}$/.test(time)) return null;
  const [hours, minutes] = time.split(':').map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

export interface DayWindow {
  /** Minutes past midnight for the first grid row. */
  openMinutes: number;
  /** Minutes past midnight after the last grid row. */
  closeMinutes: number;
  /** Number of `SLOT_MINUTES` rows between them. */
  rows: number;
}

/** Floors to the hour below and ceils to the hour above, so the axis reads in hours. */
function floorHour(minutes: number): number {
  return Math.floor(minutes / 60) * 60;
}

function ceilHour(minutes: number): number {
  return Math.ceil(minutes / 60) * 60;
}

/**
 * The visible day: the clinic's default hours, widened by anything booked
 * outside them. An early add-on at 07:20 must not fall off the top of the grid.
 */
export function dayWindow(appointments: readonly Appointment[]): DayWindow {
  let open = DEFAULT_OPEN_MINUTES;
  let close = DEFAULT_CLOSE_MINUTES;

  for (const appointment of appointments) {
    const start = minutesOfDay(appointment.start);
    const end = minutesOfDay(appointment.end);
    if (start !== null) open = Math.min(open, floorHour(start));
    if (end !== null) close = Math.max(close, ceilHour(end));
  }

  return { openMinutes: open, closeMinutes: close, rows: (close - open) / SLOT_MINUTES };
}

/** 1-based CSS grid row for an instant, clamped inside the window. */
export function rowForInstant(instant: string, window: DayWindow): number {
  const minutes = minutesOfDay(instant);
  if (minutes === null) return 1;
  const clamped = Math.min(Math.max(minutes, window.openMinutes), window.closeMinutes);
  return Math.floor((clamped - window.openMinutes) / SLOT_MINUTES) + 1;
}

export interface PlacedAppointment {
  appointment: Appointment;
  /** 0-based sub-column inside the provider column. */
  lane: number;
  /** How many sub-columns this appointment's overlap cluster needs. */
  lanes: number;
  rowStart: number;
  rowEnd: number;
}

/**
 * Double-booking is a fact of a clinic day, not an error, so overlapping
 * appointments split their provider column into lanes rather than hiding one
 * behind the other. Appointments that do not overlap anything keep the full
 * width, because a day with one double-book must not look like a narrow day.
 */
export function assignLanes(
  appointments: readonly Appointment[],
  window: DayWindow
): PlacedAppointment[] {
  const sorted = [...appointments].sort((a, b) => a.start.localeCompare(b.start));
  const placed: PlacedAppointment[] = [];

  /** Appointments that overlap each other transitively; they share a lane count. */
  let cluster: PlacedAppointment[] = [];
  let clusterEnd = '';
  /** End instant per lane, so a lane frees up as soon as its appointment ends. */
  let laneEnds: string[] = [];

  const closeCluster = () => {
    const lanes = Math.max(1, laneEnds.length);
    for (const entry of cluster) placed.push({ ...entry, lanes });
    cluster = [];
    laneEnds = [];
    clusterEnd = '';
  };

  for (const appointment of sorted) {
    if (clusterEnd !== '' && appointment.start >= clusterEnd) closeCluster();

    let lane = laneEnds.findIndex((end) => end <= appointment.start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(appointment.end);
    } else {
      laneEnds[lane] = appointment.end;
    }

    if (appointment.end > clusterEnd) clusterEnd = appointment.end;

    const rowStart = rowForInstant(appointment.start, window);
    const rowEnd = Math.max(rowStart + 1, rowForInstant(appointment.end, window));
    cluster.push({ appointment, lane, lanes: 1, rowStart, rowEnd });
  }

  closeCluster();
  return placed;
}

/** Appointments per provider, in the column order the providers are given in. */
export function groupByProvider(
  appointments: readonly Appointment[],
  providerIds: readonly string[]
): Map<string, Appointment[]> {
  const columns = new Map<string, Appointment[]>();
  for (const providerId of providerIds) columns.set(providerId, []);
  for (const appointment of appointments) {
    const column = columns.get(appointment.providerId);
    if (column) column.push(appointment);
  }
  return columns;
}

/** Statuses that put a patient on the flow board, in the order they advance. */
export const FLOW_SEQUENCE: readonly AppointmentStatus[] = [
  'ARRIVED',
  'CHECKED_IN',
  'ROOMED',
  'IN_PROGRESS',
  'CHECKED_OUT',
];

export interface FlowColumn {
  id: string;
  /**
   * Catalogue key for the heading, and deliberately the same key the badge on
   * a card in this column uses.
   *
   * One key rather than a column heading of its own, because the heading and
   * the badge name one state: two keys would be two chances for the board to
   * tell a reader that somebody is "Roomed" under a column headed something
   * else, and there is no version of that which is right.
   */
  labelKey: string;
  statuses: readonly AppointmentStatus[];
  /** The visit is finished, so the column reads muted. */
  done: boolean;
}

/** The board's columns. Fulfilled folds into checked out: both mean "gone home". */
export const FLOW_COLUMNS: readonly FlowColumn[] = [
  { id: 'ARRIVED', labelKey: STATUS_LABEL_KEY.ARRIVED, statuses: ['ARRIVED'], done: false },
  {
    id: 'CHECKED_IN',
    labelKey: STATUS_LABEL_KEY.CHECKED_IN,
    statuses: ['CHECKED_IN'],
    done: false,
  },
  { id: 'ROOMED', labelKey: STATUS_LABEL_KEY.ROOMED, statuses: ['ROOMED'], done: false },
  {
    id: 'IN_PROGRESS',
    labelKey: STATUS_LABEL_KEY.IN_PROGRESS,
    statuses: ['IN_PROGRESS'],
    done: false,
  },
  {
    id: 'DONE',
    labelKey: STATUS_LABEL_KEY.CHECKED_OUT,
    statuses: ['CHECKED_OUT', 'FULFILLED'],
    done: true,
  },
];

/**
 * Statuses a front desk can still check a patient in from.
 *
 * Read off the appointment rather than remembered per session, so two people
 * working the same desk see the same answer and a reload does not offer to
 * check somebody in twice.
 */
const AWAITING_CHECK_IN: ReadonlySet<AppointmentStatus> = new Set<AppointmentStatus>([
  'PROPOSED',
  'PENDING',
  'BOOKED',
  'ARRIVED',
]);

export function awaitsCheckIn(status: AppointmentStatus): boolean {
  return AWAITING_CHECK_IN.has(status);
}

/** The next status a one-click advance moves to, or null at the end of the line. */
export function nextStatus(status: AppointmentStatus): AppointmentStatus | null {
  const index = FLOW_SEQUENCE.indexOf(status);
  if (index === -1 || index === FLOW_SEQUENCE.length - 1) return null;
  return FLOW_SEQUENCE[index + 1] ?? null;
}

/**
 * Waiting bands. Legacy boards blinked at you past the threshold; this returns a tier
 * and the screen renders a static treatment plus a counted, worded label.
 */
export type DelayTier = 'none' | 'caution' | 'delayed';

export const CAUTION_MINUTES = 15;
export const DELAYED_MINUTES = 30;

/** Only a patient still waiting for someone can be delayed; a visit in progress cannot. */
const WAITING_STATUSES: ReadonlySet<AppointmentStatus> = new Set([
  'ARRIVED',
  'CHECKED_IN',
  'ROOMED',
]);

export function delayTier(status: AppointmentStatus, waitingMinutes: number): DelayTier {
  if (!WAITING_STATUSES.has(status)) return 'none';
  if (waitingMinutes >= DELAYED_MINUTES) return 'delayed';
  if (waitingMinutes >= CAUTION_MINUTES) return 'caution';
  return 'none';
}

/** Whole minutes between two instants; negative spans read as zero, never as a countdown. */
export function minutesBetween(from: string | null | undefined, to: Date): number {
  if (!from) return 0;
  const start = new Date(from).getTime();
  if (Number.isNaN(start)) return 0;
  return Math.max(0, Math.floor((to.getTime() - start) / 60_000));
}

export interface OpenSlot {
  providerId: string;
  /** ISO instant. */
  start: string;
  /** ISO instant. */
  end: string;
}

export interface FindAvailableOptions {
  /** Visit length to fit. Drives which gaps count as bookable. */
  durationMinutes?: number;
  /** How many slots to return. Five is what the brief asks the button to surface. */
  limit?: number;
}

/**
 * An instant on a clinic day from minutes past midnight. Safe because
 * `CLINIC_TIME_ZONE` is UTC: when facilities carry a real zone this becomes a
 * zoned construction, and it is the only place that has to change.
 */
function instantAt(day: string, minutes: number): string {
  const hours = String(Math.floor(minutes / 60)).padStart(2, '0');
  const rest = String(minutes % 60).padStart(2, '0');
  return `${day}T${hours}:${rest}:00.000Z`;
}

/**
 * The next real open slots, in one call. This is the whole point of Find
 * available: not a search form, an answer. Cancelled visits free their slot, so
 * a cancellation immediately becomes bookable time.
 */
export function findOpenSlots(
  appointments: readonly Appointment[],
  providerIds: readonly string[],
  day: string,
  after: Date,
  options: FindAvailableOptions = {}
): OpenSlot[] {
  const duration = options.durationMinutes ?? 20;
  const limit = options.limit ?? 5;
  const live = appointments.filter((appointment) => appointment.status !== 'CANCELLED');
  const window = dayWindow(live);

  const afterMinutes = minutesOfDay(after.toISOString()) ?? window.openMinutes;
  const first = Math.ceil(Math.max(afterMinutes, window.openMinutes) / SLOT_MINUTES) * SLOT_MINUTES;

  const slots: OpenSlot[] = [];
  for (const providerId of providerIds) {
    const booked = live.filter((appointment) => appointment.providerId === providerId);
    for (let start = first; start + duration <= window.closeMinutes; start += SLOT_MINUTES) {
      const from = instantAt(day, start);
      const to = instantAt(day, start + duration);
      const clash = booked.some((appointment) => appointment.start < to && appointment.end > from);
      if (!clash) slots.push({ providerId, start: from, end: to });
    }
  }

  return slots
    .toSorted((a, b) => a.start.localeCompare(b.start) || a.providerId.localeCompare(b.providerId))
    .slice(0, limit);
}

/** Counts per board column, for the header. Zero is shown, never hidden. */
export function countByColumn(appointments: readonly Appointment[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const column of FLOW_COLUMNS) {
    counts[column.id] = appointments.filter((appointment) =>
      column.statuses.includes(appointment.status)
    ).length;
  }
  return counts;
}
