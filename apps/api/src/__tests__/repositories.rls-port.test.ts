import type { Prisma, PrismaClient } from '@openrunic/database';
import { describe, expect, it } from 'vitest';

import type { AppointmentRecord, DbPort, DbTransaction } from '../repositories/db-port.js';
import {
  createRlsDbPortFactory,
  createSessionBoundPortFactory,
  tenantTransactionSatisfiesPort,
  type TenantSessionRunner,
} from '../repositories/rls-port.js';

import { DEMO_TENANT_A, makeAppointmentRow, makePatientRow, testId } from './support.js';

/**
 * The RLS port, driven by a recording session runner.
 *
 * What is under test is a claim, not a behaviour: that no method on the port
 * can reach Postgres outside a transaction that has declared its tenant. The
 * runner below stands in for `withTenantSession`, so every call that would have
 * opened a session is recorded, and the test enumerates the port's entire
 * surface and asserts that each entry appears. A method added later without a
 * session wrapper fails the last test in this file rather than shipping.
 *
 * The session mechanism itself - `set_config(..., is_local => true)` as the
 * first statement, the policy that rejects a query without it - is proved
 * against a real Postgres in `packages/database/src/rls.integration.test.ts`.
 * There is no honest way to prove it here.
 */

interface Recorder {
  runner: TenantSessionRunner;
  sessions: string[];
  calls: { model: string; operation: string }[];
}

/** `AppointmentRow` and Prisma's record differ only in nominal type here. */
function appointmentRecord(n: number): AppointmentRecord {
  return makeAppointmentRow({ id: testId(n) }) as AppointmentRecord;
}

/** Args the port forwards untouched; their only job is to type-check. */
const PATIENT_CREATE: Prisma.PatientCreateArgs = {
  data: {
    id: testId(2),
    tenantId: DEMO_TENANT_A,
    mrn: 'OR-100482',
    givenName: 'Testina',
    familyName: 'Patientsson',
    birthDate: new Date('1994-03-02T00:00:00.000Z'),
  },
};

const APPOINTMENT_CREATE: Prisma.AppointmentCreateArgs = {
  data: {
    id: testId(4),
    tenantId: DEMO_TENANT_A,
    facilityId: testId(50),
    providerId: testId(60),
    typeCode: 'OFFICE_VISIT',
    typeDisplay: 'Office visit',
    start: new Date('2026-08-14T09:00:00.000Z'),
    end: new Date('2026-08-14T09:20:00.000Z'),
    durationMinutes: 20,
  },
};

const AUDIT_CREATE: Prisma.AuditEventCreateArgs = {
  data: {
    id: testId(5),
    tenantId: DEMO_TENANT_A,
    seq: 1n,
    actorType: 'user',
    actorId: testId(900),
    action: 'patient.created',
    targetType: 'Patient',
    prevHash: '0'.repeat(64),
    hash: 'f'.repeat(64),
  },
};

function recorder(): Recorder {
  const sessions: string[] = [];
  const calls: { model: string; operation: string }[] = [];

  const note =
    (model: string, operation: string) =>
    <T>(value: T) => {
      calls.push({ model, operation });
      return Promise.resolve(value);
    };

  const transaction: DbTransaction = {
    patient: {
      findMany: () => note('patient', 'findMany')([makePatientRow({ id: testId(1) })]),
      count: () => note('patient', 'count')(1),
      findFirst: () => note('patient', 'findFirst')(makePatientRow({ id: testId(1) })),
      create: () => note('patient', 'create')(makePatientRow({ id: testId(2) })),
      updateMany: () => note('patient', 'updateMany')({ count: 1 }),
    },
    appointment: {
      findMany: () => note('appointment', 'findMany')([appointmentRecord(3)]),
      count: () => note('appointment', 'count')(1),
      findFirst: () => note('appointment', 'findFirst')(appointmentRecord(3)),
      create: () => note('appointment', 'create')(appointmentRecord(4)),
      updateMany: () => note('appointment', 'updateMany')({ count: 1 }),
    },
    auditEvent: {
      create: () => note('auditEvent', 'create')({ id: testId(5) }),
      findFirst: () => note('auditEvent', 'findFirst')({ seq: 1n, hash: 'f'.repeat(64) }),
    },
  };

  return {
    sessions,
    calls,
    runner: (tenantId, run) => {
      sessions.push(tenantId);
      return run(transaction);
    },
  };
}

/** Every call the port can make, as data, so the sweep below cannot drift. */
const SURFACE: { model: string; operation: string; call: (port: DbPort) => Promise<unknown> }[] = [
  { model: 'patient', operation: 'findMany', call: (p) => p.patient.findMany({}) },
  { model: 'patient', operation: 'count', call: (p) => p.patient.count({}) },
  { model: 'patient', operation: 'findFirst', call: (p) => p.patient.findFirst({}) },
  { model: 'patient', operation: 'create', call: (p) => p.patient.create(PATIENT_CREATE) },
  { model: 'patient', operation: 'updateMany', call: (p) => p.patient.updateMany({ data: {} }) },
  { model: 'appointment', operation: 'findMany', call: (p) => p.appointment.findMany({}) },
  { model: 'appointment', operation: 'count', call: (p) => p.appointment.count({}) },
  { model: 'appointment', operation: 'findFirst', call: (p) => p.appointment.findFirst({}) },
  {
    model: 'appointment',
    operation: 'create',
    call: (p) => p.appointment.create(APPOINTMENT_CREATE),
  },
  {
    model: 'appointment',
    operation: 'updateMany',
    call: (p) => p.appointment.updateMany({ data: {} }),
  },
  { model: 'auditEvent', operation: 'create', call: (p) => p.auditEvent.create(AUDIT_CREATE) },
  { model: 'auditEvent', operation: 'findFirst', call: (p) => p.auditEvent.findFirst({}) },
];

describe('the RLS-bound port', () => {
  it('opens a declared session for every read and every write', async () => {
    const { runner, sessions, calls } = recorder();
    const port = createSessionBoundPortFactory(runner)(DEMO_TENANT_A);

    for (const entry of SURFACE) {
      await entry.call(port);
    }

    // One session per call, all of them naming the request's organisation.
    expect(sessions).toHaveLength(SURFACE.length);
    expect(new Set(sessions)).toEqual(new Set([DEMO_TENANT_A]));
    expect(calls).toEqual(SURFACE.map(({ model, operation }) => ({ model, operation })));
  });

  it('covers the whole port surface, so a new method cannot slip past unwrapped', () => {
    const { runner } = recorder();
    const port = createSessionBoundPortFactory(runner)(DEMO_TENANT_A);

    const reachable = Object.entries(port)
      .filter(([, value]) => typeof value === 'object' && value !== null)
      .flatMap(([model, delegate]) =>
        Object.keys(delegate as Record<string, unknown>).map((operation) => `${model}.${operation}`)
      );

    // The sweep above walks SURFACE; this asserts SURFACE is the port. Add a
    // delegate method and forget the session wrapper, and this fails.
    expect(new Set(reachable)).toEqual(
      new Set(SURFACE.map(({ model, operation }) => `${model}.${operation}`))
    );
  });

  it('runs an explicit transaction inside one declared session', async () => {
    const { runner, sessions, calls } = recorder();
    const port = createSessionBoundPortFactory(runner)(DEMO_TENANT_A);

    const result = await port.$transaction(async (tx) => {
      await tx.patient.create(PATIENT_CREATE);
      await tx.auditEvent.create(AUDIT_CREATE);
      return 'done';
    });

    // A mutation and its audit event share one session and one transaction,
    // which is what keeps them atomic under RLS as well as under Prisma.
    expect(result).toBe('done');
    expect(sessions).toEqual([DEMO_TENANT_A]);
    expect(calls.map((entry) => entry.operation)).toEqual(['create', 'create']);
  });

  it('binds each request to its own organisation', async () => {
    const { runner, sessions } = recorder();
    const factory = createSessionBoundPortFactory(runner);

    await factory('tenant-one').patient.findMany({});
    await factory('tenant-two').patient.findMany({});

    expect(sessions).toEqual(['tenant-one', 'tenant-two']);
  });

  it('builds a port from a PrismaClient without touching it', () => {
    // Constructing the port must not connect, query or extend: the registry
    // calls the factory once per request, long before a handler asks for
    // anything.
    const port = createRlsDbPortFactory({} as unknown as PrismaClient)(DEMO_TENANT_A);

    expect(typeof port.$transaction).toBe('function');
    expect(typeof port.patient.findMany).toBe('function');
    expect(tenantTransactionSatisfiesPort).toBe(true);
  });
});
