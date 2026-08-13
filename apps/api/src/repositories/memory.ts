import {
  uuidv7,
  type AppointmentCreateInput,
  type PatientCreateInput,
  type PatientUpdateInput,
} from '@openrunic/database';

import type { AuditCollector } from '../audit/collector.js';
import { ApiError } from '../errors.js';

import { APPOINTMENT_DEFAULTS, PATIENT_DEFAULTS } from './defaults.js';
import type {
  AppointmentListQuery,
  AppointmentRepository,
  AppointmentRow,
  AppointmentUpdateInput,
  Page,
  PatientListQuery,
  PatientRepository,
  PatientRow,
  Repositories,
  RepositoryRegistry,
  RequestScope,
} from './types.js';

/**
 * The in-memory repository implementation.
 *
 * It is not a mock: it is a real implementation of the same interfaces, holding
 * rows in arrays and enforcing the same rules - tenant narrowing, MRN
 * uniqueness, pagination, sorting, audit emission. The whole HTTP test suite
 * runs against it, which is why none of those tests need Postgres and none of
 * them can be green because a stub said yes.
 *
 * Rows are stored across all tenants in one array on purpose. If the tenant
 * filter were achieved by handing each tenant its own array, the isolation
 * tests would be proving the harness rather than the code.
 */

export interface MemoryDataset {
  patients: PatientRow[];
  appointments: AppointmentRow[];
}

export function createEmptyDataset(): MemoryDataset {
  return { patients: [], appointments: [] };
}

interface Clock {
  now(): Date;
}

export interface MemoryRegistryOptions {
  dataset?: MemoryDataset;
  clock?: Clock;
  nextId?: () => string;
}

export interface MemoryRepositoryRegistry extends RepositoryRegistry {
  readonly dataset: MemoryDataset;
}

export function createMemoryRepositoryRegistry(
  options: MemoryRegistryOptions = {}
): MemoryRepositoryRegistry {
  const dataset = options.dataset ?? createEmptyDataset();
  const clock: Clock = options.clock ?? { now: () => new Date() };
  const nextId = options.nextId ?? uuidv7;

  return {
    dataset,
    forRequest(scope: RequestScope): Repositories {
      return {
        tenantId: scope.tenantId,
        patients: createMemoryPatientRepository(dataset, scope, clock, nextId),
        appointments: createMemoryAppointmentRepository(dataset, scope, clock, nextId),
      };
    },
  };
}

/* ------------------------------------------------------------------ patients */

function createMemoryPatientRepository(
  dataset: MemoryDataset,
  scope: RequestScope,
  clock: Clock,
  nextId: () => string
): PatientRepository {
  const { tenantId, audit } = scope;
  const mine = (): PatientRow[] => dataset.patients.filter((row) => row.tenantId === tenantId);

  return {
    list(query: PatientListQuery): Promise<Page<PatientRow>> {
      const matched = mine().filter((row) => matchesPatientQuery(row, query));
      sortPatients(matched, query);
      const page = paginate(matched, query.page, query.pageSize);
      for (const row of page.rows) {
        audit.read({ targetType: 'Patient', targetId: row.id, patientId: row.id });
      }
      return Promise.resolve(page);
    },

    findById(id: string): Promise<PatientRow | null> {
      const row = mine().find((candidate) => candidate.id === id) ?? null;
      if (row) audit.read({ targetType: 'Patient', targetId: row.id, patientId: row.id });
      return Promise.resolve(row);
    },

    findByMrn(mrn: string): Promise<PatientRow | null> {
      const row = mine().find((candidate) => candidate.mrn === mrn) ?? null;
      if (row) audit.read({ targetType: 'Patient', targetId: row.id, patientId: row.id });
      return Promise.resolve(row);
    },

    async create(input: PatientCreateInput): Promise<PatientRow> {
      if (mine().some((row) => row.mrn === input.mrn)) {
        // Mirrors `@@unique([tenantId, mrn])`. Raised here rather than left to
        // the handler so both implementations fail the same way.
        throw ApiError.conflict(`A patient with MRN ${input.mrn} already exists.`);
      }
      const now = clock.now();
      const row: PatientRow = {
        id: nextId(),
        tenantId,
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
        createdAt: now,
        updatedAt: now,
      };
      dataset.patients.push(row);
      await auditInTransaction(audit, {
        action: 'patient.created',
        targetType: 'Patient',
        targetId: row.id,
        patientId: row.id,
        metadata: { mrn: row.mrn },
      });
      return row;
    },

    async update(id: string, input: PatientUpdateInput): Promise<PatientRow | null> {
      const row = mine().find((candidate) => candidate.id === id);
      if (!row) return null;
      const changed = applyPatientUpdate(row, input);
      row.updatedAt = clock.now();
      await auditInTransaction(audit, {
        action: 'patient.updated',
        targetType: 'Patient',
        targetId: row.id,
        patientId: row.id,
        metadata: { fields: changed },
      });
      return row;
    },
  };
}

/** Applies the patch in place and reports which columns it touched. */
function applyPatientUpdate(row: PatientRow, input: PatientUpdateInput): string[] {
  const changed: string[] = [];
  const assign = <K extends keyof PatientRow>(key: K, value: PatientRow[K]): void => {
    row[key] = value;
    changed.push(key);
  };

  if (input.primaryFacilityId !== undefined) assign('primaryFacilityId', input.primaryFacilityId);
  if (input.givenName !== undefined) assign('givenName', input.givenName);
  if (input.middleName !== undefined) assign('middleName', input.middleName);
  if (input.familyName !== undefined) assign('familyName', input.familyName);
  if (input.prefix !== undefined) assign('prefix', input.prefix);
  if (input.suffix !== undefined) assign('suffix', input.suffix);
  if (input.preferredName !== undefined) assign('preferredName', input.preferredName);
  if (input.birthDate !== undefined) assign('birthDate', input.birthDate);
  if (input.deceasedAt !== undefined) assign('deceasedAt', input.deceasedAt);
  if (input.sexAtBirth !== undefined) assign('sexAtBirth', input.sexAtBirth);
  if (input.genderIdentityCode !== undefined)
    assign('genderIdentityCode', input.genderIdentityCode);
  if (input.pronouns !== undefined) assign('pronouns', input.pronouns);
  if (input.raceCodes !== undefined) assign('raceCodes', [...input.raceCodes]);
  if (input.ethnicityCodes !== undefined) assign('ethnicityCodes', [...input.ethnicityCodes]);
  if (input.languageCode !== undefined) assign('languageCode', input.languageCode);
  if (input.maritalStatusCode !== undefined) assign('maritalStatusCode', input.maritalStatusCode);
  if (input.email !== undefined) assign('email', input.email);
  if (input.phoneMobile !== undefined) assign('phoneMobile', input.phoneMobile);
  if (input.phoneHome !== undefined) assign('phoneHome', input.phoneHome);
  if (input.addressLine1 !== undefined) assign('addressLine1', input.addressLine1);
  if (input.addressLine2 !== undefined) assign('addressLine2', input.addressLine2);
  if (input.city !== undefined) assign('city', input.city);
  if (input.state !== undefined) assign('state', input.state);
  if (input.postalCode !== undefined) assign('postalCode', input.postalCode);
  if (input.country !== undefined) assign('country', input.country);
  if (input.sensitivityClass !== undefined) assign('sensitivityClass', input.sensitivityClass);
  if (input.portalEnabled !== undefined) assign('portalEnabled', input.portalEnabled);
  if (input.active !== undefined) assign('active', input.active);
  return changed;
}

function matchesPatientQuery(row: PatientRow, query: PatientListQuery): boolean {
  if (query.id !== undefined && row.id !== query.id) return false;
  if (query.mrn !== undefined && row.mrn !== query.mrn) return false;
  if (query.sexAtBirth !== undefined && row.sexAtBirth !== query.sexAtBirth) return false;
  if (query.family !== undefined && !startsWithFold(row.familyName, query.family)) return false;
  if (query.given !== undefined && !startsWithFold(row.givenName, query.given)) return false;
  if (query.active !== undefined && row.active !== query.active) return false;
  if (query.birthDate !== undefined && !sameUtcDay(row.birthDate, query.birthDate)) return false;
  if (query.q !== undefined) {
    const needle = query.q.toLowerCase();
    const haystack = [row.familyName, row.givenName, row.preferredName ?? '', row.mrn]
      .join(' ')
      .toLowerCase();
    if (!haystack.includes(needle)) return false;
  }
  return true;
}

function sortPatients(rows: PatientRow[], query: PatientListQuery): void {
  const direction = query.order === 'desc' ? -1 : 1;
  rows.sort((a, b) => {
    const primary =
      query.sort === 'birthDate'
        ? a.birthDate.getTime() - b.birthDate.getTime()
        : query.sort === 'createdAt'
          ? a.createdAt.getTime() - b.createdAt.getTime()
          : a.familyName.localeCompare(b.familyName) || a.givenName.localeCompare(b.givenName);
    // Ties break on id so a page boundary never reorders between requests.
    return primary === 0 ? a.id.localeCompare(b.id) : primary * direction;
  });
}

/* -------------------------------------------------------------- appointments */

function createMemoryAppointmentRepository(
  dataset: MemoryDataset,
  scope: RequestScope,
  clock: Clock,
  nextId: () => string
): AppointmentRepository {
  const { tenantId, audit } = scope;
  const mine = (): AppointmentRow[] =>
    dataset.appointments.filter((row) => row.tenantId === tenantId);

  return {
    list(query: AppointmentListQuery): Promise<Page<AppointmentRow>> {
      const matched = mine().filter((row) => matchesAppointmentQuery(row, query));
      sortAppointments(matched, query);
      const page = paginate(matched, query.page, query.pageSize);
      for (const row of page.rows) {
        audit.read({
          targetType: 'Appointment',
          targetId: row.id,
          ...(row.patientId === null ? {} : { patientId: row.patientId }),
        });
      }
      return Promise.resolve(page);
    },

    findById(id: string): Promise<AppointmentRow | null> {
      const row = mine().find((candidate) => candidate.id === id) ?? null;
      if (row) {
        audit.read({
          targetType: 'Appointment',
          targetId: row.id,
          ...(row.patientId === null ? {} : { patientId: row.patientId }),
        });
      }
      return Promise.resolve(row);
    },

    async create(input: AppointmentCreateInput): Promise<AppointmentRow> {
      const now = clock.now();
      const row: AppointmentRow = {
        id: nextId(),
        tenantId,
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
        createdVia: input.createdVia ?? APPOINTMENT_DEFAULTS.createdVia,
        cancelReason: null,
        checkedInAt: null,
        createdById: null,
        createdAt: now,
        updatedAt: now,
      };
      dataset.appointments.push(row);
      await auditInTransaction(audit, {
        action: 'appointment.created',
        targetType: 'Appointment',
        targetId: row.id,
        ...(row.patientId === null ? {} : { patientId: row.patientId }),
        facilityId: row.facilityId,
        metadata: { status: row.status, start: row.start.toISOString() },
      });
      return row;
    },

    async update(id: string, input: AppointmentUpdateInput): Promise<AppointmentRow | null> {
      const row = mine().find((candidate) => candidate.id === id);
      if (!row) return null;
      const previousStatus = row.status;
      const changed = applyAppointmentUpdate(row, input);
      row.updatedAt = clock.now();
      await auditInTransaction(audit, {
        action: 'appointment.updated',
        targetType: 'Appointment',
        targetId: row.id,
        ...(row.patientId === null ? {} : { patientId: row.patientId }),
        facilityId: row.facilityId,
        metadata: {
          fields: changed,
          ...(row.status === previousStatus
            ? {}
            : { statusFrom: previousStatus, statusTo: row.status }),
        },
      });
      return row;
    },
  };
}

function applyAppointmentUpdate(row: AppointmentRow, input: AppointmentUpdateInput): string[] {
  const changed: string[] = [];
  const assign = <K extends keyof AppointmentRow>(key: K, value: AppointmentRow[K]): void => {
    row[key] = value;
    changed.push(key);
  };

  if (input.status !== undefined) {
    assign('status', input.status);
    // The Flow Board's wait timers read this column, so it is set where the
    // status is set rather than by a later job that might not run.
    if (input.status === 'CHECKED_IN' && row.checkedInAt === null) {
      row.checkedInAt = row.updatedAt;
      changed.push('checkedInAt');
    }
  }
  if (input.start !== undefined) assign('start', input.start);
  if (input.end !== undefined) assign('end', input.end);
  if (input.durationMinutes !== undefined) assign('durationMinutes', input.durationMinutes);
  if (input.room !== undefined) assign('room', input.room);
  if (input.reasonText !== undefined) assign('reasonText', input.reasonText);
  if (input.cancelReason !== undefined) assign('cancelReason', input.cancelReason);
  if (input.providerId !== undefined) assign('providerId', input.providerId);
  if (input.typeCode !== undefined) assign('typeCode', input.typeCode);
  if (input.typeDisplay !== undefined) assign('typeDisplay', input.typeDisplay);
  return changed;
}

function matchesAppointmentQuery(row: AppointmentRow, query: AppointmentListQuery): boolean {
  if (query.facilityId !== undefined && row.facilityId !== query.facilityId) return false;
  if (query.providerId !== undefined && row.providerId !== query.providerId) return false;
  if (query.patientId !== undefined && row.patientId !== query.patientId) return false;
  if (query.status !== undefined && row.status !== query.status) return false;
  if (query.from !== undefined && row.start.getTime() < query.from.getTime()) return false;
  if (query.to !== undefined && row.start.getTime() >= query.to.getTime()) return false;
  return true;
}

function sortAppointments(rows: AppointmentRow[], query: AppointmentListQuery): void {
  const direction = query.order === 'desc' ? -1 : 1;
  rows.sort((a, b) => {
    const primary =
      query.sort === 'createdAt'
        ? a.createdAt.getTime() - b.createdAt.getTime()
        : a.start.getTime() - b.start.getTime();
    return primary === 0 ? a.id.localeCompare(b.id) : primary * direction;
  });
}

/* ------------------------------------------------------------------- helpers */

/**
 * Stands in for "same transaction as the mutation".
 *
 * The in-memory store has no transactions, but the array push above it has
 * already completed and nothing can interleave, so the write and its audit
 * event are atomic in the only sense this implementation can offer. The scope
 * object is passed as the unit of work so the sink records the write as
 * transactional, exactly as the Prisma implementation does.
 */
async function auditInTransaction(
  audit: AuditCollector,
  entry: Parameters<AuditCollector['write']>[0]
): Promise<void> {
  await audit.write(entry, MEMORY_UNIT_OF_WORK);
}

const MEMORY_UNIT_OF_WORK = { kind: 'memory' } as const;

function paginate<T>(rows: readonly T[], page: number, pageSize: number): Page<T> {
  const offset = (page - 1) * pageSize;
  return {
    rows: rows.slice(offset, offset + pageSize),
    total: rows.length,
    page,
    pageSize,
  };
}

function startsWithFold(value: string, prefix: string): boolean {
  return value.toLowerCase().startsWith(prefix.toLowerCase());
}

function sameUtcDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}
