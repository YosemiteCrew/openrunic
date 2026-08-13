import {
  uuidv7,
  type AppointmentCreateInput,
  type PatientCreateInput,
  type PatientUpdateInput,
  type Prisma,
} from '@openrunic/database';

import type { AuditCollector } from '../audit/collector.js';
import { ApiError } from '../errors.js';

import type {
  AppointmentDelegate,
  AppointmentRecord,
  DbPort,
  DbTransaction,
  PatientDelegate,
  PatientRecord,
} from './db-port.js';
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
 * The Prisma-backed repositories.
 *
 * Everything here goes through {@link DbPort}, the narrow port that the
 * tenant-scoped client satisfies. Two consequences: this file never sees an
 * unscoped client, and the suite can drive it with a fake port, so the
 * where-clause construction and the row mapping are proved rather than assumed.
 *
 * Mutations run inside `$transaction` with their audit event, which is what
 * makes "audited in the same transaction as the mutation" a property of the
 * code rather than a convention.
 */

/**
 * Opens a tenant-scoped port. In production this is
 * `(tenantId) => createTenantClient(prisma, { tenantId })`; the indirection is
 * what lets the tests supply a fake without this module importing Prisma's
 * runtime.
 */
export type DbPortFactory = (tenantId: string) => DbPort;

export function createPrismaRepositoryRegistry(connect: DbPortFactory): RepositoryRegistry {
  return {
    forRequest(scope: RequestScope): Repositories {
      const port = connect(scope.tenantId);
      return {
        tenantId: scope.tenantId,
        patients: createPrismaPatientRepository(port, scope.audit),
        appointments: createPrismaAppointmentRepository(port, scope.audit),
      };
    },
  };
}

/* ------------------------------------------------------------------ patients */

function createPrismaPatientRepository(port: DbPort, audit: AuditCollector): PatientRepository {
  const read = (row: PatientRow): void => {
    audit.read({ targetType: 'Patient', targetId: row.id, patientId: row.id });
  };

  return {
    async list(query: PatientListQuery): Promise<Page<PatientRow>> {
      const where = patientWhere(query);
      const [records, total] = await Promise.all([
        port.patient.findMany({
          where,
          orderBy: patientOrderBy(query),
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        port.patient.count({ where }),
      ]);
      const rows = records.map(toPatientRow);
      rows.forEach(read);
      return { rows, total, page: query.page, pageSize: query.pageSize };
    },

    async findById(id: string): Promise<PatientRow | null> {
      const record = await port.patient.findFirst({ where: { id } });
      if (!record) return null;
      const row = toPatientRow(record);
      read(row);
      return row;
    },

    async findByMrn(mrn: string): Promise<PatientRow | null> {
      const record = await port.patient.findFirst({ where: { mrn } });
      if (!record) return null;
      const row = toPatientRow(record);
      read(row);
      return row;
    },

    create(input: PatientCreateInput): Promise<PatientRow> {
      return port.$transaction(async (tx) => {
        const existing = await tx.patient.findFirst({ where: { mrn: input.mrn } });
        if (existing) {
          throw ApiError.conflict(`A patient with MRN ${input.mrn} already exists.`);
        }
        const record = await tx.patient.create({
          data: { ...patientCreateData(input), id: uuidv7(), tenantId: TENANT_STAMPED_BY_CLIENT },
        });
        const row = toPatientRow(record);
        await audit.write(
          {
            action: 'patient.created',
            targetType: 'Patient',
            targetId: row.id,
            patientId: row.id,
            metadata: { mrn: row.mrn },
          },
          tx
        );
        return row;
      });
    },

    update(id: string, input: PatientUpdateInput): Promise<PatientRow | null> {
      return port.$transaction(async (tx) => {
        const data = patientUpdateData(input);
        const result = await tx.patient.updateMany({ where: { id }, data });
        if (result.count === 0) return null;
        // Re-read rather than trust the patch: defaults, triggers and the
        // `updatedAt` column are the database's to decide.
        const record = await tx.patient.findFirst({ where: { id } });
        if (!record) return null;
        const row = toPatientRow(record);
        await audit.write(
          {
            action: 'patient.updated',
            targetType: 'Patient',
            targetId: row.id,
            patientId: row.id,
            metadata: { fields: Object.keys(data) },
          },
          tx
        );
        return row;
      });
    },
  };
}

/**
 * Placeholder for the tenant column.
 *
 * Prisma's generated create input demands `tenantId`, but the tenant extension
 * overwrites whatever is supplied with the request's organisation, and it
 * applies its stamp last precisely so a caller cannot name a different tenant.
 * This constant makes that visible instead of leaving a plausible-looking value
 * in the call site.
 */
const TENANT_STAMPED_BY_CLIENT = '';

function patientWhere(query: PatientListQuery): Prisma.PatientWhereInput {
  const where: Prisma.PatientWhereInput = {};
  if (query.id !== undefined) where.id = query.id;
  if (query.mrn !== undefined) where.mrn = query.mrn;
  if (query.sexAtBirth !== undefined) where.sexAtBirth = query.sexAtBirth;
  if (query.family !== undefined) {
    where.familyName = { startsWith: query.family, mode: 'insensitive' };
  }
  if (query.given !== undefined) {
    where.givenName = { startsWith: query.given, mode: 'insensitive' };
  }
  if (query.active !== undefined) where.active = query.active;
  if (query.birthDate !== undefined) where.birthDate = query.birthDate;
  if (query.q !== undefined) {
    where.OR = [
      { familyName: { contains: query.q, mode: 'insensitive' } },
      { givenName: { contains: query.q, mode: 'insensitive' } },
      { preferredName: { contains: query.q, mode: 'insensitive' } },
      { mrn: { contains: query.q, mode: 'insensitive' } },
    ];
  }
  return where;
}

function patientOrderBy(query: PatientListQuery): Prisma.PatientOrderByWithRelationInput[] {
  const { order } = query;
  if (query.sort === 'birthDate') return [{ birthDate: order }, { id: 'asc' }];
  if (query.sort === 'createdAt') return [{ createdAt: order }, { id: 'asc' }];
  return [{ familyName: order }, { givenName: order }, { id: 'asc' }];
}

function patientCreateData(
  input: PatientCreateInput
): Omit<Prisma.PatientCreateManyInput, 'id' | 'tenantId'> {
  // The zod schema is a `strictObject` whose optional keys are absent (not
  // present-and-undefined) when unsupplied, so this spread never turns "not
  // given" into an explicit null.
  return { ...input };
}

function patientUpdateData(input: PatientUpdateInput): Prisma.PatientUpdateManyMutationInput {
  // `PatientUpdateInput` is already `.partial()`, so every present key is a key
  // the client asked to change. Absent keys must stay absent: writing `null`
  // for them would turn "not mentioned" into "clear this column".
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

function toPatientRow(record: PatientRecord): PatientRow {
  return {
    id: record.id,
    tenantId: record.tenantId,
    mrn: record.mrn,
    primaryFacilityId: record.primaryFacilityId,
    givenName: record.givenName,
    middleName: record.middleName,
    familyName: record.familyName,
    prefix: record.prefix,
    suffix: record.suffix,
    preferredName: record.preferredName,
    birthDate: record.birthDate,
    deceasedAt: record.deceasedAt,
    sexAtBirth: record.sexAtBirth,
    genderIdentityCode: record.genderIdentityCode,
    pronouns: record.pronouns,
    raceCodes: [...record.raceCodes],
    ethnicityCodes: [...record.ethnicityCodes],
    languageCode: record.languageCode,
    maritalStatusCode: record.maritalStatusCode,
    email: record.email,
    phoneMobile: record.phoneMobile,
    phoneHome: record.phoneHome,
    addressLine1: record.addressLine1,
    addressLine2: record.addressLine2,
    city: record.city,
    state: record.state,
    postalCode: record.postalCode,
    country: record.country,
    sensitivityClass: record.sensitivityClass,
    portalEnabled: record.portalEnabled,
    active: record.active,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/* -------------------------------------------------------------- appointments */

function createPrismaAppointmentRepository(
  port: DbPort,
  audit: AuditCollector
): AppointmentRepository {
  const read = (row: AppointmentRow): void => {
    audit.read({
      targetType: 'Appointment',
      targetId: row.id,
      ...(row.patientId === null ? {} : { patientId: row.patientId }),
    });
  };

  return {
    async list(query: AppointmentListQuery): Promise<Page<AppointmentRow>> {
      const where = appointmentWhere(query);
      const [records, total] = await Promise.all([
        port.appointment.findMany({
          where,
          orderBy: appointmentOrderBy(query),
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        port.appointment.count({ where }),
      ]);
      const rows = records.map(toAppointmentRow);
      rows.forEach(read);
      return { rows, total, page: query.page, pageSize: query.pageSize };
    },

    async findById(id: string): Promise<AppointmentRow | null> {
      const record = await port.appointment.findFirst({ where: { id } });
      if (!record) return null;
      const row = toAppointmentRow(record);
      read(row);
      return row;
    },

    create(input: AppointmentCreateInput): Promise<AppointmentRow> {
      return port.$transaction(async (tx) => {
        const record = await tx.appointment.create({
          data: {
            ...appointmentCreateData(input),
            id: uuidv7(),
            tenantId: TENANT_STAMPED_BY_CLIENT,
          },
        });
        const row = toAppointmentRow(record);
        await audit.write(
          {
            action: 'appointment.created',
            targetType: 'Appointment',
            targetId: row.id,
            ...(row.patientId === null ? {} : { patientId: row.patientId }),
            facilityId: row.facilityId,
            metadata: { status: row.status, start: row.start.toISOString() },
          },
          tx
        );
        return row;
      });
    },

    update(id: string, input: AppointmentUpdateInput): Promise<AppointmentRow | null> {
      return port.$transaction(async (tx) => {
        const before = await tx.appointment.findFirst({ where: { id } });
        if (!before) return null;
        const data = appointmentUpdateData(input, toAppointmentRow(before));
        const result = await tx.appointment.updateMany({ where: { id }, data });
        if (result.count === 0) return null;
        const record = await tx.appointment.findFirst({ where: { id } });
        if (!record) return null;
        const row = toAppointmentRow(record);
        await audit.write(
          {
            action: 'appointment.updated',
            targetType: 'Appointment',
            targetId: row.id,
            ...(row.patientId === null ? {} : { patientId: row.patientId }),
            facilityId: row.facilityId,
            metadata: {
              fields: Object.keys(data),
              ...(row.status === before.status
                ? {}
                : { statusFrom: before.status, statusTo: row.status }),
            },
          },
          tx
        );
        return row;
      });
    },
  };
}

function appointmentWhere(query: AppointmentListQuery): Prisma.AppointmentWhereInput {
  const where: Prisma.AppointmentWhereInput = {};
  if (query.facilityId !== undefined) where.facilityId = query.facilityId;
  if (query.providerId !== undefined) where.providerId = query.providerId;
  if (query.patientId !== undefined) where.patientId = query.patientId;
  if (query.status !== undefined) where.status = query.status;
  if (query.from !== undefined || query.to !== undefined) {
    where.start = {
      ...(query.from === undefined ? {} : { gte: query.from }),
      ...(query.to === undefined ? {} : { lt: query.to }),
    };
  }
  return where;
}

function appointmentOrderBy(
  query: AppointmentListQuery
): Prisma.AppointmentOrderByWithRelationInput[] {
  if (query.sort === 'createdAt') return [{ createdAt: query.order }, { id: 'asc' }];
  return [{ start: query.order }, { id: 'asc' }];
}

function appointmentCreateData(
  input: AppointmentCreateInput
): Omit<Prisma.AppointmentCreateManyInput, 'id' | 'tenantId'> {
  const { patientId, recurrenceGroupId, recurrenceRule, ...rest } = input;
  return {
    ...rest,
    ...(patientId === undefined ? {} : { patientId }),
    ...(recurrenceGroupId === undefined ? {} : { recurrenceGroupId }),
    ...(recurrenceRule === undefined
      ? {}
      : { recurrenceRule: recurrenceRule as Prisma.InputJsonValue }),
  };
}

function appointmentUpdateData(
  input: AppointmentUpdateInput,
  before: AppointmentRow
): Prisma.AppointmentUpdateManyMutationInput {
  const data: Prisma.AppointmentUpdateManyMutationInput = Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined)
  );
  if (input.status === 'CHECKED_IN' && before.checkedInAt === null) {
    data.checkedInAt = new Date();
  }
  return data;
}

function toAppointmentRow(record: AppointmentRecord): AppointmentRow {
  return {
    id: record.id,
    tenantId: record.tenantId,
    facilityId: record.facilityId,
    patientId: record.patientId,
    providerId: record.providerId,
    typeCode: record.typeCode,
    typeDisplay: record.typeDisplay,
    status: record.status,
    start: record.start,
    end: record.end,
    durationMinutes: record.durationMinutes,
    room: record.room,
    reasonText: record.reasonText,
    recurrenceGroupId: record.recurrenceGroupId,
    createdVia: record.createdVia,
    cancelReason: record.cancelReason,
    checkedInAt: record.checkedInAt,
    createdById: record.createdById,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/** Exported for the adapter's unit tests; not part of the repository contract. */
export const __internals = {
  appointmentOrderBy,
  appointmentWhere,
  patientOrderBy,
  patientWhere,
  toAppointmentRow,
  toPatientRow,
};

export type { AppointmentDelegate, PatientDelegate, DbTransaction };
