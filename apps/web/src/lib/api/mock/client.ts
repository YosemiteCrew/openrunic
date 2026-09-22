import { heldSession } from '@/lib/auth/store';

import { capabilitiesForRoles } from '../capabilities';

import { paginate } from '../pagination';
import type { ApiError } from '../client';
import type {
  ApiClient,
  Appointment,
  AppointmentCreateBody,
  AppointmentListQuery,
  AppointmentUpdateBody,
  ClaimDto,
  ClaimDtoStatus,
  ClinicalNoteDto,
  ClinicalNoteState,
  DiagnosticReportDto,
  DiagnosticReportListQuery,
  EncounterDto,
  EncounterListQuery,
  EncounterStatus,
  FacilityDto,
  FacilityListQuery,
  FormDefinitionDto,
  MedicationStatementDto,
  MedicationStatementListQuery,
  NoteListQuery,
  Patient,
  PatientCreateBody,
  PatientListQuery,
  PatientUpdateBody,
  PaymentDto,
  RemittanceDto,
  ServiceRequestDto,
  ServiceRequestListQuery,
  ServiceRequestStatus,
  StatementDto,
  TaskDto,
  TaskListQuery,
  TaskWorkStatus,
  UserDto,
  UserListQuery,
} from '../types';

import { MOCK_CHARTS, mockChartFor } from './chart';
import type { Medication } from '../chart/types';
import {
  MOCK_APPOINTMENTS,
  MOCK_DIRECTORY_FACILITIES,
  MOCK_DIRECTORY_USERS,
  MOCK_NOW,
  MOCK_PATIENTS,
} from './fixtures';
import { assertTransition, attempt, conflict, validationFailed } from './protocol';
import {
  MOCK_ACTING_USER,
  MOCK_CLAIM_RECORDS,
  MOCK_DIAGNOSTIC_REPORTS,
  MOCK_RESULT_OBSERVATIONS,
  MOCK_ENCOUNTERS,
  MOCK_FORM_DEFINITION_RECORDS,
  MOCK_NOTES,
  MOCK_NOTE_ADDENDA,
  MOCK_PAYMENT_RECORDS,
  MOCK_REMITTANCE_RECORDS,
  MOCK_SERVICE_REQUESTS,
  MOCK_STATEMENT_RECORDS,
  MOCK_TASKS,
} from './records';
import { createClock, createIdFactory, createTable, defined } from './store';
import type { MockTable, Stamped } from './store';

/**
 * The fixture-backed client.
 *
 * It exists because the live API needs Postgres and every screen still has to
 * render fully in a demo, a test and a design review. So it is not a stub: it
 * implements the same {@link ApiClient} contract, applies the same filters,
 * sorts and pagination the API applies, refuses the same transitions the API
 * refuses, and fails the same way, with an `ApiError` carrying an RFC 9457
 * problem document. A screen that works here works against the real API, which
 * is the whole point.
 *
 * Writes are implemented, and each one lands in an in-memory store the next
 * read sees. That reverses this file's earlier position, which was that a
 * fixture accepting writes would teach screens to trust state the server never
 * saw. The risk was real and the remedy was backwards: refusing to write meant
 * every screen kept its own local copy and toasted a success it had not earned,
 * which is the same lie with nobody left to catch it. A fixture that assigns an
 * id, enforces the state machine and shows the result on the next read is what
 * lets a screen be caught being wrong before Postgres is involved.
 *
 * The store is per-client and per-session: two `createMockClient()` calls never
 * see each other's writes, so one test cannot leak into the next, and a reload
 * puts the demo clinic back.
 */

/* Built once per patient and kept for as long as that patient object is alive.
   The palette searches on every keystroke, and rebuilding a joined, lowercased
   string for every row on every one of those is the whole cost of the search.
   A WeakMap, so a patient that falls out of the fixture is not held here. */
const HAYSTACKS = new WeakMap<Patient, string>();

function haystack(patient: Patient): string {
  const cached = HAYSTACKS.get(patient);
  if (cached !== undefined) return cached;
  const { given, family, preferred } = patient.name;
  const built = [given, family, preferred ?? '', patient.mrn].join(' ').toLowerCase();
  HAYSTACKS.set(patient, built);
  return built;
}

/** Case-insensitive prefix match, matching the FHIR `string` search semantic. */
function startsWith(value: string, prefix: string): boolean {
  return value.toLowerCase().startsWith(prefix.toLowerCase());
}

export function filterPatients(
  rows: readonly Patient[],
  query: PatientListQuery = {}
): readonly Patient[] {
  const { q, mrn, family, given, birthDate, active } = query;
  const needle = q?.trim().toLowerCase();

  const matched = rows.filter((patient) => {
    if (needle) {
      const searchable: string = haystack(patient);
      if (!searchable.includes(needle)) return false;
    }
    if (mrn && patient.mrn !== mrn) return false;
    if (family && !startsWith(patient.name.family, family)) return false;
    if (given && !startsWith(patient.name.given, given)) return false;
    if (birthDate && patient.birthDate !== birthDate) return false;
    if (active !== undefined && patient.active !== active) return false;
    return true;
  });

  const sort = query.sort ?? 'familyName';
  const direction = query.order === 'desc' ? -1 : 1;
  return [...matched].sort((a, b) => {
    if (sort === 'birthDate') return a.birthDate.localeCompare(b.birthDate) * direction;
    if (sort === 'createdAt') return a.createdAt.localeCompare(b.createdAt) * direction;
    return a.name.family.localeCompare(b.name.family, 'en') * direction;
  });
}

/**
 * The mock side of `GET /bff/v0/orders`, filtered and sorted the way
 * `serviceRequestListQuerySchema` says the route is.
 *
 * The two halves of the predicate are separate functions because they are two
 * different questions - which orders, and over what window - and the window has
 * a semantic worth stating once where it is implemented.
 */
export function filterServiceRequests(
  rows: readonly ServiceRequestDto[],
  query: ServiceRequestListQuery = {}
): readonly ServiceRequestDto[] {
  const matched = rows.filter(
    (order) => matchesServiceRequest(order, query) && withinRequestedWindow(order, query)
  );

  const direction = query.order === 'desc' ? -1 : 1;
  return [...matched].sort(byServiceRequest(query.sort ?? 'requestedAt', direction));
}

/** The exact-match half: every field the route narrows on by equality. */
function matchesServiceRequest(
  order: ServiceRequestDto,
  { patientId, encounterId, status, category, priority, orderedById }: ServiceRequestListQuery
): boolean {
  if (patientId && order.patientId !== patientId) return false;
  if (encounterId && order.encounterId !== encounterId) return false;
  if (status && order.status !== status) return false;
  if (category && order.category !== category) return false;
  if (priority && order.priority !== priority) return false;
  if (orderedById && order.orderedById !== orderedById) return false;
  return true;
}

/**
 * The window half, over `requestedAt`.
 *
 * Half-open - `from` inclusive, `to` exclusive - because that is what the
 * published list description promises, and a mock that closes the far end
 * double-counts the boundary row against every caller that pages a day at a
 * time.
 */
function withinRequestedWindow(
  order: ServiceRequestDto,
  { from, to }: ServiceRequestListQuery
): boolean {
  if (from && order.requestedAt < from) return false;
  if (to && order.requestedAt >= to) return false;
  return true;
}

/**
 * The comparator the orders list is sorted by.
 *
 * `scheduledFor` is the only key that can be absent, and the route sorts an
 * absent one last ascending and FIRST descending: the spec reads it through
 * `comparable()`, which answers `+Infinity`, and the memory port multiplies the
 * whole comparison by the direction. Postgres agrees - `orderBy` names no
 * `nulls` option, and its defaults are NULLS LAST on asc, NULLS FIRST on desc.
 * So the null branch carries the direction like every other row.
 */
function byServiceRequest(
  sort: NonNullable<ServiceRequestListQuery['sort']>,
  direction: number
): (a: ServiceRequestDto, b: ServiceRequestDto) => number {
  if (sort === 'createdAt') {
    return (a, b) => a.createdAt.localeCompare(b.createdAt) * direction;
  }
  if (sort === 'requestedAt') {
    return (a, b) => a.requestedAt.localeCompare(b.requestedAt) * direction;
  }
  return (a, b) => {
    if (a.scheduledFor === null || b.scheduledFor === null) {
      const byAbsence = (a.scheduledFor === null ? 1 : 0) - (b.scheduledFor === null ? 1 : 0);
      return byAbsence * direction;
    }
    return a.scheduledFor.localeCompare(b.scheduledFor) * direction;
  };
}

/**
 * The reports a `/bff/v0/results` query matches.
 *
 * `reviewed` is a boolean over a nullable timestamp rather than a column, which
 * is what the route does too: `reviewed=false` is the sign-off queue and
 * `reviewed=true` the reports somebody has already acted on, and the absence of
 * the filter is both.
 */
export function filterDiagnosticReports(
  rows: readonly DiagnosticReportDto[],
  query: DiagnosticReportListQuery = {}
): readonly DiagnosticReportDto[] {
  const matched = rows.filter(
    (report) => matchesDiagnosticReport(report, query) && withinIssuedWindow(report, query)
  );

  const direction = query.order === 'desc' ? -1 : 1;
  return [...matched].sort(byDiagnosticReport(query.sort ?? 'issuedAt', direction));
}

/** The exact-match half, plus `reviewed` - a boolean read off a nullable timestamp. */
function matchesDiagnosticReport(
  report: DiagnosticReportDto,
  {
    patientId,
    encounterId,
    serviceRequestId,
    status,
    category,
    abnormalFlag,
    reviewed,
  }: DiagnosticReportListQuery
): boolean {
  if (patientId && report.patientId !== patientId) return false;
  if (encounterId && report.encounterId !== encounterId) return false;
  if (serviceRequestId && report.serviceRequestId !== serviceRequestId) return false;
  if (status && report.status !== status) return false;
  if (category && report.category !== category) return false;
  if (abnormalFlag && report.abnormalFlag !== abnormalFlag) return false;
  if (reviewed !== undefined && (report.reviewedAt !== null) !== reviewed) return false;
  return true;
}

/** The window half, over `issuedAt`. Half-open, as for orders above. */
function withinIssuedWindow(
  report: DiagnosticReportDto,
  { from, to }: DiagnosticReportListQuery
): boolean {
  if (from && report.issuedAt < from) return false;
  if (to && report.issuedAt >= to) return false;
  return true;
}

/**
 * The comparator the results list is sorted by.
 *
 * `effectiveAt` is the only nullable key, and it carries the direction the same
 * way `scheduledFor` does: absent sorts last ascending, first descending.
 */
function byDiagnosticReport(
  sort: NonNullable<DiagnosticReportListQuery['sort']>,
  direction: number
): (a: DiagnosticReportDto, b: DiagnosticReportDto) => number {
  if (sort === 'effectiveAt') {
    return (a, b) => {
      if (a.effectiveAt === null || b.effectiveAt === null) {
        return ((a.effectiveAt === null ? 1 : 0) - (b.effectiveAt === null ? 1 : 0)) * direction;
      }
      return a.effectiveAt.localeCompare(b.effectiveAt) * direction;
    };
  }
  return (a, b) => a[sort].localeCompare(b[sort]) * direction;
}

/**
 * The task statuses that mean the work is still in flight.
 *
 * Mirrored by hand from the API's own set, like every enum in `types.ts`: this
 * package has no import path into `apps/api`, and the openapi contract test is
 * what holds the two copies together.
 */
const OPEN_TASK_STATUSES: readonly TaskWorkStatus[] = ['OPEN', 'IN_PROGRESS', 'ON_HOLD'];

/**
 * The mock side of `GET /bff/v0/tasks`, filtered and sorted the way
 * `taskListQuerySchema` says the route is.
 *
 * Split the same three ways as the orders filter above - which tasks, whose
 * work, and over what window - because `inboxFor` is a union rather than an
 * equality and does not read as one guard among nine.
 */
export function filterTasks(
  rows: readonly TaskDto[],
  query: TaskListQuery = {}
): readonly TaskDto[] {
  const matched = rows.filter(
    (task) => matchesTask(task, query) && ownsTask(task, query) && withinDueWindow(task, query)
  );

  const direction = query.order === 'desc' ? -1 : 1;
  return [...matched].sort(byTask(query.sort ?? 'dueAt', direction));
}

/** The exact-match half, plus `open` - a boolean read off a status set. */
function matchesTask(
  task: TaskDto,
  { type, status, priority, patientId, slaState, open }: TaskListQuery
): boolean {
  if (type && task.type !== type) return false;
  if (status && task.status !== status) return false;
  if (priority && task.priority !== priority) return false;
  if (patientId && task.patientId !== patientId) return false;
  if (slaState && task.slaState !== slaState) return false;
  if (open !== undefined && open !== OPEN_TASK_STATUSES.includes(task.status)) return false;
  return true;
}

/**
 * The assignment half.
 *
 * `inboxFor` is the one filter here that is not an equality: an inbox is that
 * user's own work AND the pool nobody has claimed, and `assigneeType` is the
 * column that decides which a row is in - a `TEAM` task with a stale
 * `assigneeUserId` is still unclaimed.
 */
function ownsTask(
  task: TaskDto,
  { assigneeUserId, assigneeTeamKey, assigneeType, inboxFor }: TaskListQuery
): boolean {
  if (assigneeUserId && task.assigneeUserId !== assigneeUserId) return false;
  if (assigneeTeamKey && task.assigneeTeamKey !== assigneeTeamKey) return false;
  if (assigneeType && task.assigneeType !== assigneeType) return false;
  if (inboxFor && task.assigneeType !== 'TEAM' && task.assigneeUserId !== inboxFor) return false;
  return true;
}

/** The window half, over `dueAt`: `from` inclusive, `to` exclusive. */
function withinDueWindow(task: TaskDto, { from, to }: TaskListQuery): boolean {
  if (from && (task.dueAt === null || task.dueAt < from)) return false;
  if (to && (task.dueAt === null || task.dueAt >= to)) return false;
  return true;
}

/**
 * The comparator the task list is sorted by.
 *
 * A task with no due date is not the most urgent one, so an absent `dueAt`
 * sorts last ascending - and first descending, carrying the direction like
 * every other row, which is what the route's own comparator does through
 * `comparable()`.
 */
function byTask(
  sort: NonNullable<TaskListQuery['sort']>,
  direction: number
): (a: TaskDto, b: TaskDto) => number {
  if (sort === 'createdAt') return (a, b) => a.createdAt.localeCompare(b.createdAt) * direction;
  if (sort === 'priority') return (a, b) => a.priority.localeCompare(b.priority) * direction;
  return (a, b) => (a.dueAt ?? '\uffff').localeCompare(b.dueAt ?? '\uffff') * direction;
}

export function filterAppointments(
  rows: readonly Appointment[],
  query: AppointmentListQuery = {}
): readonly Appointment[] {
  const { facilityId, providerId, patientId, status, from, to } = query;

  const matched = rows.filter((appointment) => {
    if (facilityId && appointment.facilityId !== facilityId) return false;
    if (providerId && appointment.providerId !== providerId) return false;
    if (patientId && appointment.patientId !== patientId) return false;
    if (status && appointment.status !== status) return false;
    // `from` is inclusive and `to` exclusive, so one day is [00:00, next 00:00).
    if (from && appointment.start < new Date(from).toISOString()) return false;
    if (to && appointment.start >= new Date(to).toISOString()) return false;
    return true;
  });

  const direction = query.order === 'desc' ? -1 : 1;
  const sort = query.sort ?? 'start';
  return [...matched].sort((a, b) =>
    sort === 'createdAt'
      ? a.createdAt.localeCompare(b.createdAt) * direction
      : a.start.localeCompare(b.start) * direction
  );
}

export function filterEncounters(
  rows: readonly EncounterDto[],
  query: EncounterListQuery = {}
): readonly EncounterDto[] {
  const matched = rows.filter((row) => {
    if (query.patientId && row.patientId !== query.patientId) return false;
    if (query.facilityId && row.facilityId !== query.facilityId) return false;
    if (query.providerId && row.providerId !== query.providerId) return false;
    if (query.status && row.status !== query.status) return false;
    if (query.from && row.startedAt < new Date(query.from).toISOString()) return false;
    if (query.to && row.startedAt >= new Date(query.to).toISOString()) return false;
    return true;
  });

  // Oldest first unless asked otherwise, because `sortOrderField` in
  // `apps/api/src/schemas/pagination.ts` defaults to `asc` and this client
  // exists to stand in for that API. It used to default the other way, which
  // meant the same query answered in opposite orders depending on which mode
  // the app was running in - the kind of difference that survives every test
  // and shows up the first day against a real server.
  const direction = query.order === 'desc' ? -1 : 1;
  return [...matched].sort((a, b) => a.startedAt.localeCompare(b.startedAt) * direction);
}

export function filterNotes(
  rows: readonly ClinicalNoteDto[],
  query: NoteListQuery = {}
): readonly ClinicalNoteDto[] {
  const matched = rows.filter((row) => {
    if (query.patientId && row.patientId !== query.patientId) return false;
    if (query.encounterId && row.encounterId !== query.encounterId) return false;
    if (query.authorId && row.authorId !== query.authorId) return false;
    if (query.state && row.state !== query.state) return false;
    return true;
  });

  // Ascending by default, for the reason given in `filterEncounters`.
  const direction = query.order === 'desc' ? -1 : 1;
  if (query.sort === 'signedAt') {
    // Sorting by signature puts unsigned notes last, because the board that
    // asks for this ordering is the one chasing the ones with no signature.
    return [...matched].sort(
      (a, b) => (a.signedAt ?? '￿').localeCompare(b.signedAt ?? '￿') * direction
    );
  }
  return [...matched].sort((a, b) => a.createdAt.localeCompare(b.createdAt) * direction);
}

/**
 * One fixture medication in DTO shape.
 *
 * `reportedAt`, `createdAt` and `updatedAt` are synthetic INSTANTS stepped back
 * from `MOCK_NOW`, and deliberately not `startedOn`. They used to be
 * `startedOn ?? MOCK_NOW`, which is wrong twice: it asserts a medication was
 * reported and stored on the day it was started, and `startedOn` is a date with
 * no time, so a consumer formatting an instant rendered midnight UTC - or the
 * previous calendar day, east of it - where the live route serialises a real
 * `toISOString()`. Stepped by the caller's index so `sort: 'reportedAt'` has a
 * defined order to produce rather than a column of equal values - which means
 * the caller owes a unique index PER RESPONSE, not per chart. It did not, once:
 * see the call site and #403.
 */
function toMedicationStatementDto(
  patientId: string,
  med: Medication,
  index: number
): MedicationStatementDto {
  const reportedAt = new Date(Date.parse(MOCK_NOW) - index * 3_600_000).toISOString();
  return {
    id: med.id,
    patientId,
    encounterId: null,
    rxnormCode: null,
    display: med.drug,
    sigText: med.sig,
    status: med.status,
    source: med.source,
    effectiveStart: med.startedOn,
    effectiveEnd: med.stoppedOn,
    reportedAt,
    note: null,
    createdAt: reportedAt,
    updatedAt: reportedAt,
  };
}

/**
 * The medication-statement query, applied.
 *
 * `encounterId`, `status`, `sort` and `order` are on the contract and were
 * accepted and dropped here, so `readMedications` - which sends
 * `sort: 'reportedAt', order: 'desc'` on every call - got fixture order in demo
 * mode and newest-first against a real server. A difference that renders
 * correctly in both and disagrees about which medication is at the top.
 */
export function filterMedicationStatements(
  rows: readonly MedicationStatementDto[],
  query: MedicationStatementListQuery = {}
): readonly MedicationStatementDto[] {
  const matched = rows.filter((row) => {
    if (query.patientId && row.patientId !== query.patientId) return false;
    if (query.encounterId && row.encounterId !== query.encounterId) return false;
    if (query.status && row.status !== query.status) return false;
    return true;
  });

  // Ascending by default, for the reason given in `filterEncounters`.
  const direction = query.order === 'desc' ? -1 : 1;
  const sort = query.sort ?? 'reportedAt';
  return [...matched].sort((a, b) => {
    if (sort === 'createdAt') return a.createdAt.localeCompare(b.createdAt) * direction;
    return a.reportedAt.localeCompare(b.reportedAt) * direction;
  });
}

export function filterFacilities(
  rows: readonly FacilityDto[],
  query: FacilityListQuery = {}
): readonly FacilityDto[] {
  const needle = query.q?.trim().toLowerCase();
  const matched = rows.filter((row) => {
    if (query.active !== undefined && row.active !== query.active) return false;
    // The route's `q` is free text over the name and the short code, which is
    // how a practice with two dozen sites finds one by the code on the door.
    if (needle && !`${row.name} ${row.code}`.toLowerCase().includes(needle)) return false;
    return true;
  });

  const direction = query.order === 'desc' ? -1 : 1;
  const sort = query.sort ?? 'name';
  return [...matched].sort((a, b) => {
    if (sort === 'code') return a.code.localeCompare(b.code, 'en') * direction;
    if (sort === 'createdAt') return a.createdAt.localeCompare(b.createdAt) * direction;
    return a.name.localeCompare(b.name, 'en') * direction;
  });
}

export function filterDirectoryUsers(
  rows: readonly UserDto[],
  query: UserListQuery = {}
): readonly UserDto[] {
  const needle = query.q?.trim().toLowerCase();
  const matched = rows.filter((row) => {
    if (query.status && row.status !== query.status) return false;
    if (query.isProvider !== undefined && row.isProvider !== query.isProvider) return false;
    if (needle) {
      const searchable = `${row.givenName} ${row.familyName} ${row.email}`.toLowerCase();
      if (!searchable.includes(needle)) return false;
    }
    return true;
  });

  const direction = query.order === 'desc' ? -1 : 1;
  const sort = query.sort ?? 'familyName';
  return [...matched].sort((a, b) => {
    if (sort === 'email') return a.email.localeCompare(b.email, 'en') * direction;
    if (sort === 'createdAt') return a.createdAt.localeCompare(b.createdAt) * direction;
    return a.familyName.localeCompare(b.familyName, 'en') * direction;
  });
}

/* -------------------------------------------------------------------------- */
/* The state machines, copied from the routers that own them                   */
/* -------------------------------------------------------------------------- */

/**
 * Each table below is transcribed from the route module that owns it in
 * `apps/api`. They are copied rather than imported because `apps/web` must not
 * import `apps/api` to render a page, which is the same reason `types.ts`
 * restates the wire schemas. A copied constant can drift, so each one names its
 * source: when a router's table changes, this one changes in the same pull
 * request.
 */

/** From `ENCOUNTER_SIGNING_TRANSITIONS` in `routes/clinical.ts`. */
const ENCOUNTER_SIGNING: Readonly<Record<EncounterStatus, readonly EncounterStatus[]>> = {
  PLANNED: [],
  IN_PROGRESS: ['COMPLETED'],
  ON_HOLD: [],
  COMPLETED: ['COMPLETED'],
  CANCELLED: [],
  ENTERED_IN_ERROR: [],
};

/** From `NOTE_SIGN_TRANSITIONS`. A draft under AI review counts as signable. */
const NOTE_SIGNING: Readonly<Record<ClinicalNoteState, readonly ClinicalNoteState[]>> = {
  DRAFT: ['SIGNED'],
  AI_DRAFT_REVIEW: ['SIGNED'],
  UNSIGNED: ['SIGNED'],
  SIGNED: [],
  AMENDED: [],
  ENTERED_IN_ERROR: [],
};

/** From `NOTE_ADDENDUM_TRANSITIONS`. Only signed notes take an addendum. */
const NOTE_ADDENDUM: Readonly<Record<ClinicalNoteState, readonly ClinicalNoteState[]>> = {
  DRAFT: [],
  AI_DRAFT_REVIEW: [],
  UNSIGNED: [],
  SIGNED: ['AMENDED'],
  AMENDED: ['AMENDED'],
  ENTERED_IN_ERROR: [],
};

/** From `NOTE_PATCH_TRANSITIONS`. Signing and amending have routes of their own. */
const NOTE_PATCH: Readonly<Record<ClinicalNoteState, readonly ClinicalNoteState[]>> = {
  DRAFT: ['AI_DRAFT_REVIEW', 'UNSIGNED', 'ENTERED_IN_ERROR'],
  AI_DRAFT_REVIEW: ['DRAFT', 'UNSIGNED', 'ENTERED_IN_ERROR'],
  UNSIGNED: ['DRAFT', 'AI_DRAFT_REVIEW', 'ENTERED_IN_ERROR'],
  SIGNED: ['ENTERED_IN_ERROR'],
  AMENDED: ['ENTERED_IN_ERROR'],
  ENTERED_IN_ERROR: [],
};

/** From `ORDER_TRANSITIONS` in `routes/orders.ts`. */
const ORDER_MOVES: Readonly<Record<ServiceRequestStatus, readonly ServiceRequestStatus[]>> = {
  DRAFT: ['PENDED', 'SIGNED', 'CANCELLED', 'ENTERED_IN_ERROR'],
  PENDED: ['SIGNED', 'CANCELLED', 'ENTERED_IN_ERROR'],
  SIGNED: ['TRANSMITTED', 'CANCELLED', 'ENTERED_IN_ERROR'],
  TRANSMITTED: ['IN_PROGRESS', 'CANCELLED', 'ENTERED_IN_ERROR'],
  IN_PROGRESS: ['RESULTED', 'CANCELLED', 'ENTERED_IN_ERROR'],
  RESULTED: ['COMPLETED', 'ENTERED_IN_ERROR'],
  COMPLETED: ['ENTERED_IN_ERROR'],
  CANCELLED: ['ENTERED_IN_ERROR'],
  ENTERED_IN_ERROR: ['ENTERED_IN_ERROR'],
};

/** From `TASK_TRANSITIONS`. The three closed states are terminal. */
const TASK_MOVES: Readonly<Record<TaskWorkStatus, readonly TaskWorkStatus[]>> = {
  OPEN: ['IN_PROGRESS', 'ON_HOLD', 'DONE', 'CANCELLED', 'EXPIRED'],
  IN_PROGRESS: ['ON_HOLD', 'DONE', 'CANCELLED', 'EXPIRED'],
  ON_HOLD: ['IN_PROGRESS', 'DONE', 'CANCELLED', 'EXPIRED'],
  DONE: [],
  CANCELLED: [],
  EXPIRED: [],
};

/** From `CLAIM_TRANSITIONS` in `routes/financial.ts`. */
const CLAIM_MOVES: Readonly<Record<ClaimDtoStatus, readonly ClaimDtoStatus[]>> = {
  DRAFT: ['SCRUBBED', 'VOID'],
  SCRUBBED: ['SUBMITTED', 'DRAFT'],
  SUBMITTED: ['ACKNOWLEDGED', 'REJECTED', 'DENIED'],
  ACKNOWLEDGED: ['PAID', 'PARTIAL', 'DENIED'],
  REJECTED: ['REBILLED', 'VOID'],
  DENIED: ['REBILLED', 'VOID'],
  PARTIAL: ['PAID', 'DENIED'],
  PAID: ['VOID'],
  REBILLED: ['SCRUBBED'],
  VOID: [],
};

/** From `PAYMENT_TRANSITIONS`. Money that failed or was voided is staying there. */
const PAYMENT_MOVES: Readonly<Record<PaymentDto['status'], readonly PaymentDto['status'][]>> = {
  PENDING: ['POSTED', 'VOIDED'],
  POSTED: ['REFUNDED', 'VOIDED'],
  FAILED: [],
  VOIDED: [],
  REFUNDED: [],
};

/** From `REMITTANCE_TRANSITIONS`. An advice is parsed before it is posted. */
const REMITTANCE_MOVES: Readonly<
  Record<RemittanceDto['status'], readonly RemittanceDto['status'][]>
> = {
  RECEIVED: ['PARSED'],
  PARSED: ['POSTED'],
  EXCEPTIONS: ['PARSED', 'POSTED'],
  POSTED: [],
};

/** From `STATEMENT_TRANSITIONS`. Generated, sent, then paid or written off. */
const STATEMENT_MOVES: Readonly<Record<StatementDto['status'], readonly StatementDto['status'][]>> =
  {
    DRAFT: ['GENERATED'],
    GENERATED: ['SENT'],
    SENT: ['PAID', 'VOID'],
    PAID: [],
    VOID: [],
  };

/** From `FORM_DEFINITION_TRANSITIONS` in `routes/platform.ts`. */
const FORM_MOVES: Readonly<
  Record<FormDefinitionDto['status'], readonly FormDefinitionDto['status'][]>
> = {
  DRAFT: ['PUBLISHED'],
  PUBLISHED: ['RETIRED'],
  RETIRED: [],
};

/* -------------------------------------------------------------------------- */
/* Registration and booking                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The flat create body, as the aggregate the API answers with.
 *
 * The API stores registration as columns and reads it back nested, so this
 * mapping exists there too, in `toPatientDto`. Doing it here as well is what
 * makes `patients.create(...)` return the same object shape in both modes,
 * which is the only reason a screen can render the result without asking which
 * client it is holding.
 */
function toPatient(body: PatientCreateBody): Omit<Patient, keyof Stamped> {
  return {
    mrn: body.mrn,
    primaryFacilityId: body.primaryFacilityId ?? null,
    name: {
      given: body.givenName,
      middle: body.middleName ?? null,
      family: body.familyName,
      prefix: body.prefix ?? null,
      suffix: body.suffix ?? null,
      preferred: body.preferredName ?? null,
    },
    birthDate: body.birthDate,
    deceasedAt: body.deceasedAt ?? null,
    sexAtBirth: body.sexAtBirth ?? 'UNKNOWN',
    genderIdentityCode: body.genderIdentityCode ?? null,
    pronouns: body.pronouns ?? null,
    raceCodes: body.raceCodes ?? [],
    ethnicityCodes: body.ethnicityCodes ?? [],
    languageCode: body.languageCode ?? 'en-US',
    maritalStatusCode: body.maritalStatusCode ?? null,
    telecom: {
      email: body.email ?? null,
      phoneMobile: body.phoneMobile ?? null,
      phoneHome: body.phoneHome ?? null,
    },
    address: {
      line1: body.line1 ?? null,
      line2: body.line2 ?? null,
      city: body.city ?? null,
      state: body.state ?? null,
      postalCode: body.postalCode ?? null,
      country: body.country ?? 'US',
    },
    sensitivityClass: body.sensitivityClass ?? 'NORMAL',
    portalEnabled: body.portalEnabled ?? false,
    active: body.active ?? true,
  };
}

/** An amendment, applied to the nested aggregate the store holds. */
function amendPatient(existing: Patient, body: PatientUpdateBody): Partial<Patient> {
  return {
    ...defined({
      primaryFacilityId: body.primaryFacilityId,
      birthDate: body.birthDate,
      deceasedAt: body.deceasedAt,
      sexAtBirth: body.sexAtBirth,
      genderIdentityCode: body.genderIdentityCode,
      pronouns: body.pronouns,
      raceCodes: body.raceCodes,
      ethnicityCodes: body.ethnicityCodes,
      languageCode: body.languageCode,
      maritalStatusCode: body.maritalStatusCode,
      sensitivityClass: body.sensitivityClass,
      portalEnabled: body.portalEnabled,
      active: body.active,
    }),
    name: {
      ...existing.name,
      ...defined({
        given: body.givenName,
        middle: body.middleName,
        family: body.familyName,
        prefix: body.prefix,
        suffix: body.suffix,
        preferred: body.preferredName,
      }),
    },
    telecom: {
      ...existing.telecom,
      ...defined({
        email: body.email,
        phoneMobile: body.phoneMobile,
        phoneHome: body.phoneHome,
      }),
    },
    address: {
      ...existing.address,
      ...defined({
        line1: body.line1,
        line2: body.line2,
        city: body.city,
        state: body.state,
        postalCode: body.postalCode,
        country: body.country,
      }),
    },
  };
}

function toAppointment(body: AppointmentCreateBody): Omit<Appointment, keyof Stamped> {
  return {
    facilityId: body.facilityId,
    patientId: body.patientId ?? null,
    providerId: body.providerId,
    // Carried inline rather than as a reference, so renaming a catalogue entry
    // never rewrites what a past appointment was booked as.
    type: { code: body.typeCode, display: body.typeDisplay },
    status: body.status ?? 'BOOKED',
    start: body.start,
    end: body.end,
    durationMinutes: body.durationMinutes,
    room: body.room ?? null,
    reasonText: body.reasonText ?? null,
    recurrenceGroupId: body.recurrenceGroupId ?? null,
    createdVia: body.createdVia ?? 'STAFF',
    cancelReason: null,
    checkedInAt: null,
  };
}

/**
 * The two rules `appointmentUpdateSchema` enforces beyond field types.
 *
 * They are checked here because a screen that only ever meets them in
 * production has never been tested against them, and both are reachable by a
 * mis-wired button: an empty patch from a form that changed nothing, and a
 * cancellation whose reason was never collected.
 */
function assertPatchIsUsable(body: AppointmentUpdateBody): void {
  if (Object.values(body).every((value) => value === undefined)) {
    throw validationFailed('The request body failed validation.', [
      { path: '', message: 'the patch must change at least one field' },
    ]);
  }
  if (body.status === 'CANCELLED' && body.cancelReason === undefined) {
    throw validationFailed('The request body failed validation.', [
      { path: 'cancelReason', message: 'a cancellation must record a reason' },
    ]);
  }
}

/* -------------------------------------------------------------------------- */
/* The client                                                                  */
/* -------------------------------------------------------------------------- */

export interface MockClientOptions {
  /**
   * The facility directory. An empty array is a real state a screen has to
   * handle: an organisation with no facility cannot be booked into, and a
   * screen that carried on regardless would be posting an id from nowhere.
   */
  facilities?: readonly FacilityDto[];
  /** The staff directory, clinicians and everyone else. */
  users?: readonly UserDto[];
  patients?: readonly Patient[];
  appointments?: readonly Appointment[];
  encounters?: readonly EncounterDto[];
  notes?: readonly ClinicalNoteDto[];
  orders?: readonly ServiceRequestDto[];
  results?: readonly DiagnosticReportDto[];
  tasks?: readonly TaskDto[];
  claims?: readonly ClaimDto[];
  payments?: readonly PaymentDto[];
  remittances?: readonly RemittanceDto[];
  /**
   * The roles the caller holds, for `session.me`.
   *
   * The demonstration reads the held session, because the caller is whoever
   * signed in. A TEST has no sign-in, so it states the principal it is driving
   * as - which is better than a default, since #313 is precisely about a screen
   * behaving differently for two principals and a default would pick one.
   */
  roles?: readonly string[];
  statements?: readonly StatementDto[];
  formDefinitions?: readonly FormDefinitionDto[];
  /**
   * Fails every call with this error, for the screens' error states. One flag
   * rather than a hand-written client literal, which had to grow a line every
   * time the contract did.
   */
  failure?: ApiError;
  /** The instant the first write is stamped with. Fixed, so a test is repeatable. */
  now?: string;
}

const NO_PATIENT = 'No such patient.';
const NO_APPOINTMENT = 'No such appointment.';
const NO_ENCOUNTER = 'No such visit.';
const NO_NOTE = 'No such clinical note.';
const NO_ORDER = 'No such order.';
const NO_RESULT = 'No such result.';
const NO_TASK = 'No such task.';
const NO_CLAIM = 'No such claim.';
const NO_PAYMENT = 'No such payment.';
const NO_REMITTANCE = 'No such remittance.';
const NO_STATEMENT = 'No such statement.';
const NO_DEFINITION = 'No such form definition.';

/** Matches `MOCK_NOW`, so a fixture written before the first write sorts before it. */
const DEFAULT_CLOCK_START = '2026-08-12T10:20:00.000Z';

export function createMockClient(options: MockClientOptions = {}): ApiClient {
  const clock = createClock(options.now ?? DEFAULT_CLOCK_START);
  const table = <T extends Stamped>(seed: readonly T[], prefix: string): MockTable<T> =>
    createTable(seed, clock, createIdFactory(prefix));

  const patients = table(options.patients ?? MOCK_PATIENTS, 'p');
  const appointments = table(options.appointments ?? MOCK_APPOINTMENTS, 'a');
  const encounters = table(options.encounters ?? MOCK_ENCOUNTERS, 'e');
  const notes = table(options.notes ?? MOCK_NOTES, 'n');
  const addenda = table(MOCK_NOTE_ADDENDA, 'q');
  const orders = table(options.orders ?? MOCK_SERVICE_REQUESTS, 's');
  const results = table(options.results ?? MOCK_DIAGNOSTIC_REPORTS, 'r');
  const tasks = table(options.tasks ?? MOCK_TASKS, 't');
  const claims = table(options.claims ?? MOCK_CLAIM_RECORDS, 'c');
  const payments = table(options.payments ?? MOCK_PAYMENT_RECORDS, 'm');
  const remittances = table(options.remittances ?? MOCK_REMITTANCE_RECORDS, 'w');
  const statements = table(options.statements ?? MOCK_STATEMENT_RECORDS, 'x');
  const definitions = table(options.formDefinitions ?? MOCK_FORM_DEFINITION_RECORDS, 'g');

  /** Every call goes through here, so the failure flag is honoured exactly once. */
  const answer = <T>(run: () => T): Promise<T> => {
    if (options.failure) return Promise.reject(options.failure);
    return attempt(run);
  };

  /** One order move, shared by the three routes that make them. */
  const moveOrder = (id: string, to: ServiceRequestStatus): Promise<ServiceRequestDto> =>
    answer(() => {
      const before = orders.require(id, NO_ORDER);
      assertTransition(ORDER_MOVES, 'order', before.status, to);
      // Stamped where the move happens rather than by a labs adapter later: an
      // order that says TRANSMITTED and cannot say when is one nobody can chase.
      const transmitted = to === 'TRANSMITTED' ? { transmittedAt: clock.now() } : {};
      return orders.patch(id, { status: to, ...transmitted }, NO_ORDER);
    });

  const moveClaim = (id: string, to: ClaimDtoStatus, statusReason?: string): Promise<ClaimDto> =>
    answer(() => {
      const before = claims.require(id, NO_CLAIM);
      assertTransition(CLAIM_MOVES, 'claim', before.status, to);
      const stamps: Partial<ClaimDto> = {};
      if (to === 'SUBMITTED') stamps.submittedAt = clock.now();
      if (to === 'ACKNOWLEDGED') stamps.acknowledgedAt = clock.now();
      if (to === 'PAID' || to === 'PARTIAL' || to === 'DENIED') stamps.adjudicatedAt = clock.now();
      return claims.patch(id, { status: to, ...stamps, ...defined({ statusReason }) }, NO_CLAIM);
    });

  /* Read-only, so they are plain arrays rather than tables: nothing in the
     client writes a facility or a user, and a table would imply otherwise. */
  const facilities = options.facilities ?? MOCK_DIRECTORY_FACILITIES;
  const directoryUsers = options.users ?? MOCK_DIRECTORY_USERS;

  return {
    mode: 'mock',

    /* The demonstration build has no API, and this is the answer one would have
       given. Read from the held session for the same reason `config.ts` reads
       `currentAccessToken` for the live client: the caller is whoever signed in,
       and a client that had to be told would be told by every screen. */
    session: {
      me: () =>
        answer(() => {
          const roles = options.roles ?? heldSession()?.identity.roles ?? [];
          /* The demonstration build signs one clinician in, and the fixtures
             are written about them: `MOCK_TASKS` assigns to this id, so an
             inbox asking "which of these are mine" gets the same answer here
             as it would from a server that had resolved the token. */
          return {
            roles: [...roles],
            permissions: capabilitiesForRoles(roles),
            userId: MOCK_ACTING_USER,
          };
        }),
    },

    facilities: {
      list: (query = {}) =>
        answer(() => paginate(filterFacilities(facilities, query), query.page, query.pageSize)),
    },

    users: {
      list: (query = {}) =>
        answer(() =>
          paginate(filterDirectoryUsers(directoryUsers, query), query.page, query.pageSize)
        ),
    },

    patients: {
      list: (query = {}) =>
        answer(() => paginate(filterPatients(patients.all(), query), query.page, query.pageSize)),
      get: (id) => answer(() => patients.require(id, NO_PATIENT)),
      create: (body) =>
        answer(() => {
          // An MRN is unique per organisation, and the API answers a duplicate
          // with a 409 rather than a second record for the same person.
          if (patients.all().some((patient) => patient.mrn === body.mrn)) {
            throw conflict('That MRN is taken.');
          }
          return patients.insert(toPatient(body));
        }),
      update: (id, body) =>
        answer(() => {
          const existing = patients.require(id, NO_PATIENT);
          return patients.patch(id, amendPatient(existing, body), NO_PATIENT);
        }),
    },

    appointments: {
      list: (query = {}) =>
        answer(() =>
          paginate(filterAppointments(appointments.all(), query), query.page, query.pageSize)
        ),
      get: (id) => answer(() => appointments.require(id, NO_APPOINTMENT)),
      create: (body) => answer(() => appointments.insert(toAppointment(body))),
      update: (id, body) =>
        answer(() => {
          assertPatchIsUsable(body);
          const existing = appointments.require(id, NO_APPOINTMENT);
          const { typeCode, typeDisplay, ...rest } = body;
          const type =
            typeCode === undefined && typeDisplay === undefined
              ? {}
              : {
                  type: {
                    code: typeCode ?? existing.type.code,
                    display: typeDisplay ?? existing.type.display,
                  },
                };
          // Arrival is stamped where the status moves, so the flow board's
          // clock starts from the instant the patient stopped waiting outside.
          const arrival =
            rest.status === 'CHECKED_IN' && existing.checkedInAt === null
              ? { checkedInAt: clock.now() }
              : {};
          return appointments.patch(id, { ...defined(rest), ...type, ...arrival }, NO_APPOINTMENT);
        }),
    },

    /*
     * The demo build's medication statements, read back off the demo chart.
     *
     * The chart a reader sees in fixture mode is composed in
     * `chart/client.ts` from `mock/chart.ts` and does not come through here -
     * so this door could have returned an empty page and nothing would have
     * noticed. An empty page is the wrong answer: it says this patient records
     * no medications, which is the sentence the issue behind this work is
     * about. It answers from the same fixture the chart shows instead, so the
     * two cannot disagree.
     *
     * `prescriber` and `refillsRemaining` have no home in the DTO, which is why
     * they are dropped here rather than invented - a statement is not a
     * prescription.
     */
    medicationStatements: {
      list: (query = {}) =>
        answer(() => {
          // Every accessible statement when no patient is named, which is what
          // the live route does. Answering an empty page there said this
          // deployment records no medications at all - the same wrong sentence
          // the per-patient case was written to avoid, one level up.
          const charts =
            query.patientId === undefined ? MOCK_CHARTS : [mockChartFor(query.patientId)];
          // `offset` carries the index ACROSS charts. A bare `map((med, i))`
          // restarts at 0 for every chart, which made `reportedAt` unique
          // within a patient and tied across them - 7 of 8 rows shared an
          // instant with another row, so `sort: 'reportedAt'` had no defined
          // order over most of this response. #403.
          //
          // The running offset rather than `.flatMap(...).map(...)`: the
          // two-pass version reads better and costs 6 points of the react-doctor
          // floor (`js-combine-iterations`, web 98 -> 92). That job is NOT on
          // the dev ruleset's required list, which is the reason to keep this
          // shape rather than a reason to ignore it - a red check that cannot
          // block a merge is the one nobody has to look at. One pass, one
          // counter.
          //
          // What this buys is a TOTAL order, not a correct one. There is no
          // reported-at anywhere in the fixtures, so any value here is invented;
          // what the mock owes is a distinct instant per row and the same shape
          // the live DTO serialises, not agreement with a clock nobody wrote
          // down.
          //
          // And the index is scoped to the RESPONSE, not to the row, which has
          // a consequence worth stating rather than leaving to be found: the
          // same statement carries a different `reportedAt` when it arrives in
          // the all-patients list than when it is fetched with its own
          // `patientId`. Measured in review: 4 of 8 rows move. A real server
          // would not - `reportedAt` is a column, not a function of the query.
          // Nothing correlates a row across the two shapes today, because
          // `chart/live.ts` is the only consumer and always sends a
          // `patientId`; a caller that did would need a row-scoped instant
          // here.
          let offset = 0;
          const rows = charts.flatMap((chart) => {
            const mapped = chart.medications.map((med, i) =>
              toMedicationStatementDto(chart.patientId, med, offset + i)
            );
            offset += mapped.length;
            return mapped;
          });
          return paginate(filterMedicationStatements(rows, query), query.page, query.pageSize);
        }),
    },

    prescriptions: {
      getRefillsRemaining: (id) =>
        answer(() => {
          // Fixed figures, because this mock keeps no fill store - but the
          // arithmetic is the API's own, so a screen built against the mock sees
          // the number the server would send. `authorisedRefills` is the repeats
          // allowed in addition to the original dispense, so the first fill
          // spends no refill and only the ones after it do.
          const authorisedRefills = 5;
          const fillsRecorded = 2;
          return {
            prescriptionId: id,
            authorisedRefills,
            fillsRecorded,
            refillsRemaining: Math.max(0, authorisedRefills - Math.max(0, fillsRecorded - 1)),
          };
        }),
    },

    encounters: {
      list: (query = {}) =>
        answer(() =>
          paginate(filterEncounters(encounters.all(), query), query.page, query.pageSize)
        ),
      get: (id) => answer(() => encounters.require(id, NO_ENCOUNTER)),
      sign: (id) =>
        answer(() => {
          const row = encounters.require(id, NO_ENCOUNTER);
          assertTransition(ENCOUNTER_SIGNING, 'visit', row.status, 'COMPLETED');
          if (row.signedAt !== null) {
            // A second signature would overwrite what the first person
            // attested to, and the record has to keep the first one.
            throw conflict('That visit is already signed.');
          }
          const at = clock.now();
          return encounters.patch(
            id,
            {
              status: 'COMPLETED',
              signedAt: at,
              signedById: MOCK_ACTING_USER,
              endedAt: row.endedAt ?? at,
            },
            NO_ENCOUNTER
          );
        }),
    },

    notes: {
      list: (query = {}) =>
        answer(() => paginate(filterNotes(notes.all(), query), query.page, query.pageSize)),
      get: (id) => answer(() => notes.require(id, NO_NOTE)),
      create: (body) =>
        answer(() =>
          notes.insert({
            patientId: body.patientId,
            encounterId: body.encounterId,
            authorId: body.authorId,
            title: body.title,
            blocks: body.blocks,
            state: body.state ?? 'DRAFT',
            cosignerId: body.cosignerId ?? null,
            cosignedAt: null,
            signedAt: null,
            signedById: null,
            lockedAt: null,
          })
        ),
      update: (id, body) =>
        answer(() => {
          const row = notes.require(id, NO_NOTE);
          // A signed note is what someone attested to at a moment, so its text
          // stops being editable then. The correction path is an addendum,
          // which leaves both versions readable; an in-place edit would leave a
          // record that disagrees with the decisions taken from it.
          const changesContent = body.title !== undefined || body.blocks !== undefined;
          if (changesContent && (row.state === 'SIGNED' || row.state === 'AMENDED')) {
            throw conflict(
              'A signed note cannot be edited. Record an addendum against it instead.'
            );
          }
          if (body.state !== undefined && body.state !== row.state) {
            assertTransition(NOTE_PATCH, 'clinical note', row.state, body.state);
          }
          return notes.patch(id, defined(body), NO_NOTE);
        }),
      sign: (id) =>
        answer(() => {
          const row = notes.require(id, NO_NOTE);
          assertTransition(NOTE_SIGNING, 'clinical note', row.state, 'SIGNED');
          const at = clock.now();
          return notes.patch(
            id,
            { state: 'SIGNED', signedAt: at, signedById: MOCK_ACTING_USER, lockedAt: at },
            NO_NOTE
          );
        }),
      listAddenda: (noteId, query = {}) =>
        answer(() => {
          // The note is read first so that addenda on a chart this principal
          // cannot reach are a 404 rather than an empty list. An empty list
          // would say the note has no addenda, which is a different and false
          // statement.
          notes.require(noteId, NO_NOTE);
          const rows = addenda.all().filter((row) => row.noteId === noteId);
          return paginate(rows, query.page, query.pageSize);
        }),
      addAddendum: (noteId, body) =>
        answer(() => {
          const note = notes.require(noteId, NO_NOTE);
          assertTransition(NOTE_ADDENDUM, 'clinical note', note.state, 'AMENDED');
          const addendum = addenda.insert({
            noteId,
            // Stamped here, not read from the body, mirroring what the API does
            // with the verified principal.
            authorId: MOCK_ACTING_USER,
            blocks: body.blocks,
            reason: body.reason ?? null,
            signedAt: clock.now(),
          });
          // The note moves with its addendum. A reader who sees `AMENDED` knows
          // to look for one; a reader who does not, does not have to.
          notes.patch(noteId, { state: 'AMENDED' }, NO_NOTE);
          return addendum;
        }),
    },

    orders: {
      list: (query = {}) =>
        answer(() =>
          paginate(filterServiceRequests(orders.all(), query), query.page, query.pageSize)
        ),
      sign: (id) => moveOrder(id, 'SIGNED'),
      transmit: (id) => moveOrder(id, 'TRANSMITTED'),
      cancel: (id) => moveOrder(id, 'CANCELLED'),
    },

    results: {
      list: (query = {}) =>
        answer(() =>
          paginate(filterDiagnosticReports(results.all(), query), query.page, query.pageSize)
        ),
      /* Read through the report, as the route does: an id naming a report this
         client has no row for is absent rather than an empty list, which would
         read as a report with no analytes. */
      listObservations: (id, query = {}) =>
        answer(() => {
          results.require(id, NO_RESULT);
          const rows = MOCK_RESULT_OBSERVATIONS.filter(
            (observation) => observation.diagnosticReportId === id
          );
          const direction = query.order === 'desc' ? -1 : 1;
          const sort = query.sort ?? 'sequence';
          const sorted = [...rows].sort((a, b) =>
            sort === 'sequence'
              ? (a.sequence - b.sequence) * direction
              : a[sort].localeCompare(b[sort]) * direction
          );
          return paginate(sorted, query.page, query.pageSize);
        }),
      review: (id) =>
        answer(() => {
          const before = results.require(id, NO_RESULT);
          if (before.reviewedAt !== null) {
            // An already-reviewed result is one somebody has acted on, and a
            // second sign-off would overwrite the name of whoever did.
            throw conflict('That result has already been reviewed.');
          }
          return results.patch(
            id,
            { reviewedAt: clock.now(), reviewedById: MOCK_ACTING_USER },
            NO_RESULT
          );
        }),
    },

    tasks: {
      list: (query = {}) =>
        answer(() => paginate(filterTasks(tasks.all(), query), query.page, query.pageSize)),
      complete: (id, body = {}) =>
        answer(() => {
          const before = tasks.require(id, NO_TASK);
          assertTransition(TASK_MOVES, 'task', before.status, 'DONE');
          return tasks.patch(
            id,
            {
              status: 'DONE',
              completedAt: clock.now(),
              completedById: MOCK_ACTING_USER,
              ...defined({ outcome: body.outcome }),
            },
            NO_TASK
          );
        }),
    },

    claims: {
      scrub: (id, body = {}) => moveClaim(id, 'SCRUBBED', body.statusReason),
      submit: (id, body = {}) => moveClaim(id, 'SUBMITTED', body.statusReason),
      status: (id, body) => moveClaim(id, body.status, body.statusReason),
    },

    payments: {
      post: (id, body = {}) =>
        answer(() => {
          const before = payments.require(id, NO_PAYMENT);
          assertTransition(PAYMENT_MOVES, 'payment', before.status, 'POSTED');
          return payments.patch(
            id,
            {
              status: 'POSTED',
              postedAt: clock.now(),
              postedById: MOCK_ACTING_USER,
              ...defined({ note: body.note }),
            },
            NO_PAYMENT
          );
        }),
    },

    remittances: {
      parse: (id) =>
        answer(() => {
          const before = remittances.require(id, NO_REMITTANCE);
          assertTransition(REMITTANCE_MOVES, 'remittance', before.status, 'PARSED');
          const remittance = remittances.patch(id, { status: 'PARSED' }, NO_REMITTANCE);
          // There is no remittance-line fixture, so the advice reports the
          // exception count it already carries rather than inventing a parse
          // that never read anything.
          return {
            remittance,
            lineCount: remittance.exceptionCount,
            matchedCount: 0,
            exceptionCount: remittance.exceptionCount,
          };
        }),
      post: (id, body = {}) =>
        answer(() => {
          const before = remittances.require(id, NO_REMITTANCE);
          // Asked before anything is written, so a refused post never leaves a
          // payment behind for an advice that did not move.
          assertTransition(REMITTANCE_MOVES, 'remittance', before.status, 'POSTED');
          const at = clock.now();
          const payment = payments.insert({
            patientId: null,
            payerId: before.payerId,
            remittanceId: id,
            source: 'PAYER_ERA',
            method: body.method ?? 'EFT',
            status: 'POSTED',
            amountCents: before.totalPaidCents,
            currency: 'USD',
            reference: before.checkOrEftNumber,
            adapterRef: null,
            receivedAt: before.receivedAt,
            postedAt: at,
            postedById: MOCK_ACTING_USER,
            note: null,
          });
          const remittance = remittances.patch(
            id,
            { status: 'POSTED', postedAt: at, postedById: MOCK_ACTING_USER },
            NO_REMITTANCE
          );
          return {
            remittance,
            payment,
            allocationCount: 0,
            allocatedCents: 0,
            skippedLineCount: before.exceptionCount,
          };
        }),
    },

    statements: {
      generate: (id, body = {}) =>
        answer(() => {
          const before = statements.require(id, NO_STATEMENT);
          assertTransition(STATEMENT_MOVES, 'statement', before.status, 'GENERATED');
          return statements.patch(
            id,
            {
              status: 'GENERATED',
              generatedAt: clock.now(),
              ...defined({ balanceCents: body.balanceCents, pdfStorageKey: body.pdfStorageKey }),
            },
            NO_STATEMENT
          );
        }),
      send: (id, body) =>
        answer(() => {
          const before = statements.require(id, NO_STATEMENT);
          assertTransition(STATEMENT_MOVES, 'statement', before.status, 'SENT');
          return statements.patch(
            id,
            {
              status: 'SENT',
              deliveredVia: body.deliveredVia,
              deliveredAt: clock.now(),
              // The token itself is never stored here, only the fact of one:
              // a fixture holding pay-link tokens would be a fixture holding
              // bearer credentials for a payment page.
              payLinkSet: body.payLinkToken !== undefined,
              ...defined({ payLinkExpiresAt: body.payLinkExpiresAt }),
            },
            NO_STATEMENT
          );
        }),
    },

    forms: {
      publish: (id, body) =>
        answer(() => {
          if (body.formDefinitionId !== id) {
            throw validationFailed('The request body failed validation.', [
              { path: 'formDefinitionId', message: 'must be the definition named in the path' },
            ]);
          }
          const before = definitions.require(id, NO_DEFINITION);
          assertTransition(FORM_MOVES, 'form definition', before.status, 'PUBLISHED');
          return definitions.patch(
            id,
            {
              status: 'PUBLISHED',
              publishedAt: body.publishedAt ?? clock.now(),
              publishedById: MOCK_ACTING_USER,
              compiled: body.compiled,
              ...defined({ promotionManifest: body.promotionManifest }),
            },
            NO_DEFINITION
          );
        }),
    },
  };
}
