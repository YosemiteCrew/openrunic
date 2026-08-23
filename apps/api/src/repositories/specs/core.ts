import type {
  AppointmentCreateInput,
  PatientCreateInput,
  PatientUpdateInput,
} from '@openrunic/database';

import {
  type BaseQuery,
  type CollectionSpec,
  containsFold,
  equalsIfSet,
  inWindow,
  jsonColumn,
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
  const start = new Date(
    Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 0, 0, 0, 0)
  );
  const next = new Date(start.getTime());
  next.setUTCDate(next.getUTCDate() + 1);
  return { gte: start, lt: next };
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
  facilityColumn: 'primaryFacilityId',
  facilityScoped: true,
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
      ...(query.status === undefined ? {} : { status: query.status }),
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
  // No patient column and no compartment. A visit points at an appointment,
  // which is where the chart is; duplicating the patient here would give one
  // visit two answers to whose it is, and the two would drift the first time an
  // appointment was moved to a different chart.
  compartment: 'open',

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

export const coreSpecs = {
  patients: patientSpec,
  appointments: appointmentSpec,
  telehealthVisits: telehealthVisitSpec,
} as const;
