import type {
  BreakGlassGrantInput,
  AppointmentCreateInput,
  PatientCreateInput,
  PatientUpdateInput,
  RelatedPersonInput,
} from '@openrunic/database';

import {
  type BaseQuery,
  type CollectionSpec,
  containsFold,
  equalsIfSet,
  inWindow,
  jsonColumn,
  statusFilter,
  likeContains,
  likeStartsWith,
  matchesIfSet,
  type RowContext,
  startsWithFold,
  statusMetadata,
  windowFilter,
  type Writable,
} from '../collection.js';
import { APPOINTMENT_DEFAULTS, PATIENT_DEFAULTS } from '../defaults.js';
import type { ScopedRow } from '../rows.js';
import type { AdministrativeGender, AppointmentStatus, TelehealthVisitStatus } from '../types.js';

/**
 * Registration and scheduling: the two aggregates every other one refers to.
 *
 * They are also the reference for every other spec in this directory. What is
 * worth copying: the write contract comes from `@openrunic/database` rather
 * than being restated, `newRow` returns the whole row so the two storage
 * implementations cannot disagree about a default, and `matches` and `where`
 * are written next to each other so it is obvious when one grows a filter the
 * other does not have.
 */

/* ------------------------------------------------------------------ patients */

export interface PatientListQuery extends BaseQuery {
  /** Exact logical id. Backs the FHIR `_id` search parameter. */
  id?: string;
  /** Free text matched against family name, given name, preferred name and MRN. */
  q?: string;
  mrn?: string;
  sexAtBirth?: AdministrativeGender;
  family?: string;
  given?: string;
  /** Date of birth. Selects any birth recorded on this UTC day. */
  birthDate?: Date;
  active?: boolean;
  facilityId?: string;
  sort: 'familyName' | 'birthDate' | 'createdAt';
}

function sameUtcDay(left: Date, right: Date): boolean {
  return (
    left.getUTCFullYear() === right.getUTCFullYear() &&
    left.getUTCMonth() === right.getUTCMonth() &&
    left.getUTCDate() === right.getUTCDate()
  );
}

/**
 * The same rule as `sameUtcDay`, as a half-open range Prisma can filter with.
 *
 * `where` used to emit exact instant equality here while `matches` compared the
 * UTC day, which are two different rules for one filter. They agreed only
 * because three unrelated facts held at once: `birthDate` is `@db.Date` so
 * Postgres stores no time, and both entry points parse a bare `YYYY-MM-DD` and
 * append midnight UTC. Any one of those changing - a column type, or accepting
 * an ISO instant the way the window parameters already do - would have split
 * the two ports silently.
 *
 * A range says what `matches` says, so the agreement no longer rests on
 * arithmetic happening to coincide in three files nobody reads together.
 */
function utcDayRange(day: Date): { gte: Date; lt: Date } {
  const year = day.getUTCFullYear();
  const month = day.getUTCMonth();
  const date = day.getUTCDate();
  // `Date.UTC` rolls `date + 1` over a month or year end on its own, so the
  // upper bound needs no special case for the 31st or for December.
  return {
    gte: new Date(Date.UTC(year, month, date)),
    lt: new Date(Date.UTC(year, month, date + 1)),
  };
}

export const patientSpec: CollectionSpec<
  'Patient',
  PatientCreateInput,
  PatientUpdateInput,
  PatientListQuery
> = {
  model: 'Patient',
  targetType: 'Patient',
  action: 'patient',
  /**
   * The patient's usual site. It narrows lists and it does NOT refuse an
   * addressed read. This is #139, decided.
   *
   * Every other facility-scoped collection narrows on `facilityId`, which is
   * containment: the appointment happened there, the encounter happened there,
   * the charge was raised there. `primaryFacilityId` is attribution - the site
   * that registered them. Patient was the only one of nine narrowing on a
   * column that is not `facilityId`, and that uniqueness is the tell.
   *
   * The two halves want different answers, which is why this spec is the only
   * one that sets `facilityHidesAddressed`.
   *
   * A LIST stays narrowed. A work queue should be local, and this is what keeps
   * a site-limited caller from paging the whole practice's index of names, MRNs
   * and birth dates. Removing that was the first draft of this change and it
   * was wrong: it widened a listing surface to fix a lookup problem.
   *
   * An addressed READ is not refused. The caller already has the id and is
   * treating the person, and a patient registered at the north clinic standing
   * in front of the south clinic is the ordinary case rather than the edge. The
   * old behaviour failed in both directions at once - it hid that chart from
   * the clinician holding it, while still showing a patient registered here who
   * has only ever been seen elsewhere.
   *
   * The portal made it sharper. The facility and compartment clauses are ANDed
   * rather than alternatives, so pinning a token to one chart did not exempt
   * it, and `Principal.facilityIds` comes from an IdP claim - so an IdP that
   * omits `facilities` locked every portal user out of their own record. That
   * is an addressed read, and it works now.
   *
   * What this is NOT is a care-relationship model. Nothing here asks whether
   * the caller is treating this patient; it asks whether they know the id. The
   * real answer is an explicit care relationship or an audited break-glass, and
   * that is filed rather than pretended at. Every read is recorded in the audit
   * trail meanwhile, which is detection rather than prevention and is worth
   * being honest about.
   */
  facilityColumn: 'primaryFacilityId',
  facilityScoped: true,
  facilityHidesAddressed: false,
  // A patient-scoped token reaches exactly one chart, and for this table that
  // chart is the row's own id.
  compartment: { column: 'id' },

  newRow(input: PatientCreateInput): Writable<'Patient'> {
    return {
      mrn: input.mrn,
      primaryFacilityId: input.primaryFacilityId ?? null,
      givenName: input.givenName,
      middleName: input.middleName ?? null,
      familyName: input.familyName,
      prefix: input.prefix ?? null,
      suffix: input.suffix ?? null,
      preferredName: input.preferredName ?? null,
      birthDate: input.birthDate,
      deceasedAt: input.deceasedAt ?? null,
      sexAtBirth: input.sexAtBirth ?? PATIENT_DEFAULTS.sexAtBirth,
      genderIdentityCode: input.genderIdentityCode ?? null,
      pronouns: input.pronouns ?? null,
      raceCodes: [...(input.raceCodes ?? [])],
      ethnicityCodes: [...(input.ethnicityCodes ?? [])],
      languageCode: input.languageCode ?? PATIENT_DEFAULTS.languageCode,
      maritalStatusCode: input.maritalStatusCode ?? null,
      email: input.email ?? null,
      phoneMobile: input.phoneMobile ?? null,
      phoneHome: input.phoneHome ?? null,
      addressLine1: input.addressLine1 ?? null,
      addressLine2: input.addressLine2 ?? null,
      city: input.city ?? null,
      state: input.state ?? null,
      postalCode: input.postalCode ?? null,
      country: input.country ?? PATIENT_DEFAULTS.country,
      sensitivityClass: input.sensitivityClass ?? PATIENT_DEFAULTS.sensitivityClass,
      portalEnabled: input.portalEnabled ?? PATIENT_DEFAULTS.portalEnabled,
      active: input.active ?? PATIENT_DEFAULTS.active,
    };
  },

  patchData(patch: PatientUpdateInput): Partial<Writable<'Patient'>> {
    // Every present key is a key the client asked to change. Absent keys must
    // stay absent: writing null for them would turn "not mentioned" into
    // "clear this column".
    return Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
  },

  matches(row: ScopedRow<'Patient'>, query: PatientListQuery): boolean {
    // One conjunction, one line per filter. Every clause is "unconstrained, or
    // satisfied", so adding a filter adds a line rather than a branch.
    return (
      equalsIfSet(query.id, row.id) &&
      equalsIfSet(query.mrn, row.mrn) &&
      equalsIfSet(query.sexAtBirth, row.sexAtBirth) &&
      equalsIfSet(query.active, row.active) &&
      equalsIfSet(query.facilityId, row.primaryFacilityId) &&
      matchesIfSet(query.family, (family) => startsWithFold(row.familyName, family)) &&
      matchesIfSet(query.given, (given) => startsWithFold(row.givenName, given)) &&
      matchesIfSet(query.birthDate, (birthDate) => sameUtcDay(row.birthDate, birthDate)) &&
      matchesIfSet(query.q, (q) =>
        containsFold([row.familyName, row.givenName, row.preferredName, row.mrn], q)
      )
    );
  },

  where(query: PatientListQuery) {
    return {
      ...(query.id === undefined ? {} : { id: query.id }),
      ...(query.mrn === undefined ? {} : { mrn: query.mrn }),
      ...(query.sexAtBirth === undefined ? {} : { sexAtBirth: query.sexAtBirth }),
      ...(query.family === undefined ? {} : { familyName: likeStartsWith(query.family) }),
      ...(query.given === undefined ? {} : { givenName: likeStartsWith(query.given) }),
      ...(query.active === undefined ? {} : { active: query.active }),
      ...(query.facilityId === undefined ? {} : { primaryFacilityId: query.facilityId }),
      ...(query.birthDate === undefined ? {} : { birthDate: utcDayRange(query.birthDate) }),
      ...(query.q === undefined
        ? {}
        : {
            OR: [
              { familyName: likeContains(query.q) },
              { givenName: likeContains(query.q) },
              { preferredName: likeContains(query.q) },
              { mrn: likeContains(query.q) },
            ],
          }),
    };
  },

  sortValue(row: ScopedRow<'Patient'>, sort: PatientListQuery['sort']): number | string {
    if (sort === 'birthDate') return row.birthDate.getTime();
    if (sort === 'createdAt') return row.createdAt.getTime();
    return `${row.familyName} ${row.givenName}`;
  },

  orderBy(query: PatientListQuery) {
    const { order } = query;
    if (query.sort === 'birthDate') return [{ birthDate: order }, { id: 'asc' as const }];
    if (query.sort === 'createdAt') return [{ createdAt: order }, { id: 'asc' as const }];
    return [{ familyName: order }, { givenName: order }, { id: 'asc' as const }];
  },

  writeMetadata(row: ScopedRow<'Patient'>): Record<string, unknown> {
    return { mrn: row.mrn };
  },

  uniqueBy: {
    where: (input: PatientCreateInput) => ({ mrn: input.mrn }),
    matches: (row: ScopedRow<'Patient'>, input: PatientCreateInput) => row.mrn === input.mrn,
    message: (input: PatientCreateInput) => `A patient with MRN ${input.mrn} already exists.`,
  },
};

/* -------------------------------------------------------------- appointments */

export interface AppointmentListQuery extends BaseQuery {
  id?: string;
  facilityId?: string;
  providerId?: string;
  patientId?: string;
  status?: AppointmentStatus;
  /**
   * States to leave out, rather than the one state to keep.
   *
   * Same reason as the encounter query: the care-relationship check needs "any
   * booking that still counts", and a cancelled or entered-in-error slot is a
   * row that says the opposite. Granting chart access on a booking somebody
   * withdrew is granting it on a mistake.
   */
  excludeStatuses?: readonly AppointmentStatus[];
  /** Inclusive lower bound on `start`. */
  from?: Date;
  /** Exclusive upper bound on `start`. */
  to?: Date;
  sort: 'start' | 'createdAt';
}

/** Fields an appointment update may change. Reschedules keep the same row. */
export interface AppointmentUpdateInput {
  status?: AppointmentStatus;
  start?: Date;
  end?: Date;
  durationMinutes?: number;
  room?: string;
  reasonText?: string;
  cancelReason?: string;
  providerId?: string;
  typeCode?: string;
  typeDisplay?: string;
}

export const appointmentSpec: CollectionSpec<
  'Appointment',
  AppointmentCreateInput,
  AppointmentUpdateInput,
  AppointmentListQuery
> = {
  model: 'Appointment',
  targetType: 'Appointment',
  action: 'appointment',
  patientColumn: 'patientId',
  facilityColumn: 'facilityId',
  facilityScoped: true,
  compartment: { column: 'patientId' },

  newRow(input: AppointmentCreateInput): Writable<'Appointment'> {
    return {
      facilityId: input.facilityId,
      patientId: input.patientId ?? null,
      providerId: input.providerId,
      typeCode: input.typeCode,
      typeDisplay: input.typeDisplay,
      status: input.status ?? APPOINTMENT_DEFAULTS.status,
      start: input.start,
      end: input.end,
      durationMinutes: input.durationMinutes,
      room: input.room ?? null,
      reasonText: input.reasonText ?? null,
      recurrenceGroupId: input.recurrenceGroupId ?? null,
      recurrenceRule: jsonColumn(input.recurrenceRule),
      createdVia: input.createdVia ?? APPOINTMENT_DEFAULTS.createdVia,
      cancelReason: null,
      checkedInAt: null,
      createdById: null,
    };
  },

  patchData(
    patch: AppointmentUpdateInput,
    before: ScopedRow<'Appointment'>,
    context: RowContext
  ): Partial<Writable<'Appointment'>> {
    const data: Partial<Writable<'Appointment'>> = Object.fromEntries(
      Object.entries(patch).filter(([, value]) => value !== undefined)
    );
    // The Flow Board's wait timers read this column, so it is set where the
    // status is set rather than by a later job that might not run.
    if (patch.status === 'CHECKED_IN' && before.checkedInAt === null) {
      data.checkedInAt = context.now;
    }
    return data;
  },

  matches(row: ScopedRow<'Appointment'>, query: AppointmentListQuery): boolean {
    if (query.id !== undefined && row.id !== query.id) return false;
    if (query.facilityId !== undefined && row.facilityId !== query.facilityId) return false;
    if (query.providerId !== undefined && row.providerId !== query.providerId) return false;
    if (query.patientId !== undefined && row.patientId !== query.patientId) return false;
    if (query.status !== undefined && row.status !== query.status) return false;
    if (query.excludeStatuses?.includes(row.status) === true) return false;
    if (query.from !== undefined && row.start.getTime() < query.from.getTime()) return false;
    return query.to === undefined || row.start.getTime() < query.to.getTime();
  },

  where(query: AppointmentListQuery) {
    const start = windowFilter(query.from, query.to);
    return {
      ...(query.id === undefined ? {} : { id: query.id }),
      ...(query.facilityId === undefined ? {} : { facilityId: query.facilityId }),
      ...(query.providerId === undefined ? {} : { providerId: query.providerId }),
      ...(query.patientId === undefined ? {} : { patientId: query.patientId }),
      /* One `status` key, not two spreads. Written as two, the second silently
         overwrote the first and a query naming both a status and an exclusion
         lost the status entirely - which the port-agreement suite caught,
         because `matches` still honoured both. */
      ...statusFilter(query.status, query.excludeStatuses),
      ...(start === undefined ? {} : { start }),
    };
  },

  sortValue(row: ScopedRow<'Appointment'>, sort: AppointmentListQuery['sort']): number {
    return sort === 'createdAt' ? row.createdAt.getTime() : row.start.getTime();
  },

  orderBy(query: AppointmentListQuery) {
    if (query.sort === 'createdAt') return [{ createdAt: query.order }, { id: 'asc' as const }];
    return [{ start: query.order }, { id: 'asc' as const }];
  },

  writeMetadata(
    row: ScopedRow<'Appointment'>,
    before: ScopedRow<'Appointment'> | null
  ): Record<string, unknown> {
    if (before === null) return { status: row.status, start: row.start.toISOString() };
    return before.status === row.status ? {} : { statusFrom: before.status, statusTo: row.status };
  },
};

/* --------------------------------------------------------------- telehealth */

export interface TelehealthVisitListQuery extends BaseQuery {
  appointmentId?: string;
  status?: TelehealthVisitStatus;
  /** Inclusive lower bound on `scheduledStart`. */
  from?: Date;
  /** Exclusive upper bound on `scheduledStart`. */
  to?: Date;
  sort: 'scheduledStart' | 'createdAt';
}

/**
 * What the routes may write after a room exists.
 *
 * No `roomRef`, no `joinUrl` and no `vendorId`. Those describe a room a vendor
 * made; rewriting them here would point this record at a different room while
 * the visit it belongs to carries on, and nobody would be able to tell which
 * room the participants were actually in.
 */
export interface TelehealthVisitPatchInput {
  status?: TelehealthVisitStatus;
  endedAt?: Date;
  endedReason?: string;
  durationSeconds?: number;
}

export interface TelehealthVisitCreateInput {
  appointmentId: string;
  vendorId: string;
  roomRef: string;
  joinUrl: string;
  scheduledStart: Date;
  expiresAt: Date;
}

export const telehealthVisitSpec: CollectionSpec<
  'TelehealthVisit',
  TelehealthVisitCreateInput,
  TelehealthVisitPatchInput,
  TelehealthVisitListQuery
> = {
  model: 'TelehealthVisit',
  targetType: 'TelehealthVisit',
  action: 'appointment',
  // No patient column, and closed rather than open. A visit points at an
  // appointment, which is where the chart is; duplicating the patient here would
  // give one visit two answers to whose it is, and the two would drift the first
  // time an appointment was moved to a different chart. But `open` let a
  // compartment-bound principal read the table, and a portal token bound to one
  // chart could list every patient's OPEN visit and lift the join URL for a
  // consultation that is not theirs. The patient reaches their own visit by the
  // passwordless link they are sent, not by listing this table, so a
  // compartment-restricted principal is refused it wholesale.
  compartment: 'closed',

  newRow(input: TelehealthVisitCreateInput): Writable<'TelehealthVisit'> {
    return {
      appointmentId: input.appointmentId,
      vendorId: input.vendorId,
      roomRef: input.roomRef,
      joinUrl: input.joinUrl,
      status: 'OPEN',
      scheduledStart: input.scheduledStart,
      expiresAt: input.expiresAt,
      endedAt: null,
      endedReason: null,
      durationSeconds: null,
    };
  },

  patchData(patch: TelehealthVisitPatchInput): Partial<Writable<'TelehealthVisit'>> {
    return Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
  },

  matches(row: ScopedRow<'TelehealthVisit'>, query: TelehealthVisitListQuery): boolean {
    if (query.appointmentId !== undefined && row.appointmentId !== query.appointmentId) {
      return false;
    }
    if (query.status !== undefined && row.status !== query.status) return false;
    return inWindow(row.scheduledStart, query.from, query.to);
  },

  where(query: TelehealthVisitListQuery) {
    const scheduledStart = windowFilter(query.from, query.to);
    return {
      ...(query.appointmentId === undefined ? {} : { appointmentId: query.appointmentId }),
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(scheduledStart === undefined ? {} : { scheduledStart }),
    };
  },

  sortValue(row: ScopedRow<'TelehealthVisit'>, sort: TelehealthVisitListQuery['sort']): number {
    if (sort === 'createdAt') return row.createdAt.getTime();
    return row.scheduledStart.getTime();
  },

  orderBy(query: TelehealthVisitListQuery) {
    const { order } = query;
    if (query.sort === 'createdAt') return [{ createdAt: order }, { id: 'asc' as const }];
    return [{ scheduledStart: order }, { id: 'asc' as const }];
  },

  writeMetadata(
    row: ScopedRow<'TelehealthVisit'>,
    before: ScopedRow<'TelehealthVisit'> | null
  ): Record<string, unknown> {
    // The room reference, not the join url and never a token. A support engineer
    // tracing a failed visit needs to name the room to the vendor; nothing in an
    // audit record needs to be able to enter it.
    return statusMetadata(row.status, before, { roomRef: row.roomRef });
  },
};

/**
 * The people around a patient, as their own collection.
 *
 * The row has existed since registration shipped and had no repository, so
 * nothing outside a direct query could read one. `ConsentGrant` points at these
 * rows, which made the gap worse than an unexposed table: a client could be
 * told a consent was granted to a related person it had no way to resolve.
 *
 * Compartmented on `patientId` like every other chart-scoped collection, so a
 * token bound to one patient sees that patient's contacts and no others.
 * Not facility-scoped: a guardian belongs to a person, not to a site.
 */
export interface RelatedPersonListQuery extends BaseQuery {
  patientId?: string;
  active?: boolean;
  isGuardian?: boolean;
  isEmergencyContact?: boolean;
  sort: 'familyName' | 'createdAt';
}

export type RelatedPersonPatchInput = Partial<Omit<RelatedPersonInput, 'patientId'>>;

export const relatedPersonSpec: CollectionSpec<
  'RelatedPerson',
  RelatedPersonInput,
  RelatedPersonPatchInput,
  RelatedPersonListQuery
> = {
  model: 'RelatedPerson',
  targetType: 'RelatedPerson',
  action: 'relatedPerson',
  patientColumn: 'patientId',
  compartment: { column: 'patientId' },

  newRow(input: RelatedPersonInput): Writable<'RelatedPerson'> {
    return {
      patientId: input.patientId,
      relationshipCode: input.relationshipCode,
      relationshipText: input.relationshipText ?? null,
      givenName: input.givenName,
      familyName: input.familyName,
      phone: input.phone ?? null,
      email: input.email ?? null,
      addressLine1: input.addressLine1 ?? null,
      city: input.city ?? null,
      state: input.state ?? null,
      postalCode: input.postalCode ?? null,
      country: input.country ?? PATIENT_DEFAULTS.country,
      isGuardian: input.isGuardian ?? false,
      isEmergencyContact: input.isEmergencyContact ?? false,
      isPortalProxy: input.isPortalProxy ?? false,
      active: input.active ?? true,
    };
  },

  patchData(patch: RelatedPersonPatchInput): Partial<Writable<'RelatedPerson'>> {
    return Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
  },

  matches(row: ScopedRow<'RelatedPerson'>, query: RelatedPersonListQuery): boolean {
    if (query.patientId !== undefined && row.patientId !== query.patientId) return false;
    if (query.active !== undefined && row.active !== query.active) return false;
    if (query.isGuardian !== undefined && row.isGuardian !== query.isGuardian) return false;
    return query.isEmergencyContact === undefined
      ? true
      : row.isEmergencyContact === query.isEmergencyContact;
  },

  where(query: RelatedPersonListQuery) {
    return {
      ...(query.patientId === undefined ? {} : { patientId: query.patientId }),
      ...(query.active === undefined ? {} : { active: query.active }),
      ...(query.isGuardian === undefined ? {} : { isGuardian: query.isGuardian }),
      ...(query.isEmergencyContact === undefined
        ? {}
        : { isEmergencyContact: query.isEmergencyContact }),
    };
  },

  sortValue(
    row: ScopedRow<'RelatedPerson'>,
    sort: RelatedPersonListQuery['sort']
  ): string | number {
    return sort === 'createdAt' ? row.createdAt.getTime() : row.familyName;
  },

  orderBy(query: RelatedPersonListQuery) {
    const { order } = query;
    if (query.sort === 'createdAt') return [{ createdAt: order }, { id: 'asc' as const }];
    return [{ familyName: order }, { id: 'asc' as const }];
  },
};

export interface BreakGlassGrantListQuery extends BaseQuery {
  userId?: string;
  patientId?: string;
  /** Grants still in force at this instant. */
  unexpiredAt?: Date;
  /**
   * Grants declared since this instant, whatever became of them.
   *
   * Deliberately not `unexpiredAt`. The caller chooses the expiry, so a count
   * of what is still in force is a count the caller can drain at will; this one
   * asks how many declarations were made, which is the number a reviewer means
   * and the one a short window cannot reduce.
   */
  grantedSince?: Date;
  sort: 'grantedAt' | 'createdAt';
}

/**
 * Break-glass grants: deliberate access to a chart the reader has no
 * relationship with.
 *
 * Compartment-open, and that needs saying. A patient-scoped principal reading
 * this table sees only their own tenant's rows and only through a query
 * somebody wrote; there is no route that exposes it to the portal, and the
 * authorisation check that reads it runs for staff principals. Marking it
 * closed would refuse the check itself for a portal principal, which is the
 * wrong failure: a patient reading their own chart has a relationship the
 * compartment already expresses and never needs a grant.
 *
 * There is no patch: a grant is a statement about a moment, and editing the
 * reason afterwards is exactly what the record exists to prevent. It expires on
 * its own.
 */
export const breakGlassGrantSpec: CollectionSpec<
  'BreakGlassGrant',
  BreakGlassGrantInput,
  never,
  BreakGlassGrantListQuery
> = {
  model: 'BreakGlassGrant',
  targetType: 'BreakGlassGrant',
  action: 'breakGlass',
  /* Audit metadata, not narrowing. Without it the `breakGlass.created` event
     names no patient, so "who broke glass on this chart" - the question the
     `(tenantId, patientId, grantedAt)` index was added for - finds nothing in
     the audit trail. The compartment below is what decides who may read the
     table. */
  patientColumn: 'patientId',
  compartment: 'open',

  newRow(input: BreakGlassGrantInput, context): Writable<'BreakGlassGrant'> {
    return {
      userId: input.userId,
      patientId: input.patientId,
      reason: input.reason,
      grantedAt: context.now,
      expiresAt: input.expiresAt,
    };
  },

  patchData(): Partial<Writable<'BreakGlassGrant'>> {
    return {};
  },

  /**
   * The stated reason, on the audit event as well as on the row.
   *
   * Without this the generic writer records only which columns were written,
   * and the reason lives on a table with no read route at all - so the review
   * surface that is supposed to make emergency access answerable could tell you
   * that somebody broke glass and not why. The reason is the whole control; it
   * belongs where the reviewer is looking.
   *
   * The window goes with it, because "for four hours" and "for four minutes"
   * are different declarations and the event should say which was made.
   */
  writeMetadata(row: ScopedRow<'BreakGlassGrant'>): Record<string, unknown> {
    return {
      reason: row.reason,
      grantedAt: row.grantedAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
    };
  },

  matches(row: ScopedRow<'BreakGlassGrant'>, query: BreakGlassGrantListQuery): boolean {
    if (query.userId !== undefined && row.userId !== query.userId) return false;
    if (query.patientId !== undefined && row.patientId !== query.patientId) return false;
    /* Strictly after: a grant that expires at this instant has expired. The
       alternative rounds a window open by however coarse the clock is. */
    if (query.unexpiredAt !== undefined && row.expiresAt <= query.unexpiredAt) return false;
    return query.grantedSince === undefined || row.grantedAt > query.grantedSince;
  },

  where(query: BreakGlassGrantListQuery) {
    return {
      ...(query.userId === undefined ? {} : { userId: query.userId }),
      ...(query.patientId === undefined ? {} : { patientId: query.patientId }),
      ...(query.unexpiredAt === undefined ? {} : { expiresAt: { gt: query.unexpiredAt } }),
      ...(query.grantedSince === undefined ? {} : { grantedAt: { gt: query.grantedSince } }),
    };
  },

  sortValue(row: ScopedRow<'BreakGlassGrant'>, sort: BreakGlassGrantListQuery['sort']): number {
    return sort === 'createdAt' ? row.createdAt.getTime() : row.grantedAt.getTime();
  },

  orderBy(query: BreakGlassGrantListQuery) {
    const { order } = query;
    if (query.sort === 'createdAt') return [{ createdAt: order }, { id: 'asc' as const }];
    return [{ grantedAt: order }, { id: 'asc' as const }];
  },
};

export const coreSpecs = {
  patients: patientSpec,
  relatedPersons: relatedPersonSpec,
  appointments: appointmentSpec,
  telehealthVisits: telehealthVisitSpec,
  breakGlassGrants: breakGlassGrantSpec,
} as const;
