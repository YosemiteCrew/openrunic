import type { Prisma } from '@openrunic/database';
import { describe, expect, it } from 'vitest';

import { AuditCollector } from '../audit/collector.js';
import { createMemoryAuditSink, type MemoryAuditSink } from '../audit/memory-sink.js';
import type {
  AppointmentRecord,
  DbPort,
  DbTransaction,
  PatientRecord,
} from '../repositories/db-port.js';
import { tenantClientSatisfiesPort } from '../repositories/db-port.js';
import { __internals, createPrismaRepositoryRegistry } from '../repositories/prisma.js';
import type { AuditUnitOfWork } from '../audit/types.js';
import type { Repositories } from '../repositories/types.js';

import {
  DEMO_FACILITY_A,
  DEMO_TENANT_A,
  makeAppointmentRow,
  makePatientRow,
  testId,
} from './support.js';

/**
 * The Prisma adapter, driven by a fake {@link DbPort}.
 *
 * The fake is honest about the only thing that matters here: which arguments
 * the adapter sends and what it does with what comes back. It is not a fake
 * *database* - it does not filter - because the filtering under test is the
 * `where` clause the adapter builds, and asserting on that clause is stronger
 * than asserting that a hand-written matcher agreed with it.
 *
 * The tenant narrowing this adapter relies on is the extension's, not its own,
 * and `tenantClientSatisfiesPort` is the compile-time assertion that the real
 * scoped client still fits this port.
 */

interface RecordedCall {
  model: string;
  operation: string;
  args: unknown;
}

interface FakePort extends DbPort {
  calls: RecordedCall[];
  patients: PatientRecord[];
  appointments: AppointmentRecord[];
  /** The transaction handle, so a test can prove the audit event joined *it*. */
  tx: DbTransaction;
  transactions: number;
}

function fakePort(): FakePort {
  const calls: RecordedCall[] = [];
  const patients: PatientRecord[] = [];
  const appointments: AppointmentRecord[] = [];
  const state = { transactions: 0 };

  const record = (model: string, operation: string, args: unknown): void => {
    calls.push({ model, operation, args });
  };

  const transaction: DbTransaction = {
    patient: {
      findMany: (args) => {
        record('patient', 'findMany', args);
        return Promise.resolve([...patients]);
      },
      count: (args) => {
        record('patient', 'count', args);
        return Promise.resolve(patients.length);
      },
      findFirst: (args) => {
        record('patient', 'findFirst', args);
        return Promise.resolve(patients[0] ?? null);
      },
      create: (args) => {
        record('patient', 'create', args);
        const created = makePatientRow({ id: testId(11) });
        patients.push(created);
        return Promise.resolve(created);
      },
      updateMany: (args) => {
        record('patient', 'updateMany', args);
        return Promise.resolve({ count: patients.length });
      },
    },
    appointment: {
      findMany: (args) => {
        record('appointment', 'findMany', args);
        return Promise.resolve([...appointments]);
      },
      count: (args) => {
        record('appointment', 'count', args);
        return Promise.resolve(appointments.length);
      },
      findFirst: (args) => {
        record('appointment', 'findFirst', args);
        return Promise.resolve(appointments[0] ?? null);
      },
      create: (args) => {
        record('appointment', 'create', args);
        const created = makeAppointmentRow({ id: testId(111) }) as AppointmentRecord;
        appointments.push(created);
        return Promise.resolve(created);
      },
      updateMany: (args) => {
        record('appointment', 'updateMany', args);
        return Promise.resolve({ count: appointments.length });
      },
    },
    auditEvent: {
      create: () => Promise.resolve({ id: testId(999) }),
      findFirst: () => Promise.resolve(null),
    },
  };

  return {
    ...transaction,
    calls,
    patients,
    appointments,
    tx: transaction,
    get transactions(): number {
      return state.transactions;
    },
    $transaction<R>(fn: (tx: DbTransaction) => Promise<R>): Promise<R> {
      state.transactions += 1;
      return fn(transaction);
    },
  };
}

function harness(): {
  port: FakePort;
  repos: Repositories;
  sink: MemoryAuditSink;
  /** Every unit of work the repositories handed to the audit sink. */
  unitsOfWork: (AuditUnitOfWork | undefined)[];
} {
  const port = fakePort();
  const inner = createMemoryAuditSink();
  const unitsOfWork: (AuditUnitOfWork | undefined)[] = [];
  const sink: MemoryAuditSink = {
    ...inner,
    recordWrite(tenantId, event, unitOfWork) {
      unitsOfWork.push(unitOfWork);
      return inner.recordWrite(tenantId, event, unitOfWork);
    },
  };
  const registry = createPrismaRepositoryRegistry(() => port);
  const repos = registry.forRequest({
    tenantId: DEMO_TENANT_A,
    audit: new AuditCollector(sink, {
      tenantId: DEMO_TENANT_A,
      actorType: 'user',
      actorId: testId(900),
      requestId: 'req-1',
      method: 'GET',
      path: '/test',
    }),
  });
  return { port, repos, sink, unitsOfWork };
}

function callArgs(port: FakePort, model: string, operation: string): unknown {
  return port.calls.find((call) => call.model === model && call.operation === operation)?.args;
}

describe('the port', () => {
  it('is satisfied by the real tenant-scoped client at compile time', () => {
    expect(tenantClientSatisfiesPort).toBe(true);
  });
});

describe('patient where clauses', () => {
  const base = { page: 1, pageSize: 25, sort: 'familyName' as const, order: 'asc' as const };

  it('is empty for an unfiltered search', () => {
    expect(__internals.patientWhere(base)).toEqual({});
  });

  it('matches names case-insensitively by prefix, as the FHIR string semantic requires', () => {
    expect(__internals.patientWhere({ ...base, family: 'Pat', given: 'Tes' })).toEqual({
      familyName: { startsWith: 'Pat', mode: 'insensitive' },
      givenName: { startsWith: 'Tes', mode: 'insensitive' },
    });
  });

  it('turns free text into an OR across the searchable columns', () => {
    const where = __internals.patientWhere({ ...base, q: 'tess' });

    expect(where.OR).toEqual([
      { familyName: { contains: 'tess', mode: 'insensitive' } },
      { givenName: { contains: 'tess', mode: 'insensitive' } },
      { preferredName: { contains: 'tess', mode: 'insensitive' } },
      { mrn: { contains: 'tess', mode: 'insensitive' } },
    ]);
  });

  it('passes exact filters straight through', () => {
    const birthDate = new Date('1994-03-02T00:00:00.000Z');

    expect(
      __internals.patientWhere({
        ...base,
        id: testId(1),
        mrn: 'OR-100482',
        sexAtBirth: 'FEMALE',
        active: true,
        birthDate,
      })
    ).toEqual({ id: testId(1), mrn: 'OR-100482', sexAtBirth: 'FEMALE', active: true, birthDate });
  });

  it('orders by the requested key and always breaks ties on id', () => {
    expect(__internals.patientOrderBy(base)).toEqual([
      { familyName: 'asc' },
      { givenName: 'asc' },
      { id: 'asc' },
    ]);
    expect(__internals.patientOrderBy({ ...base, sort: 'birthDate', order: 'desc' })).toEqual([
      { birthDate: 'desc' },
      { id: 'asc' },
    ]);
    expect(__internals.patientOrderBy({ ...base, sort: 'createdAt' })).toEqual([
      { createdAt: 'asc' },
      { id: 'asc' },
    ]);
  });
});

describe('appointment where clauses', () => {
  const base = { page: 1, pageSize: 25, sort: 'start' as const, order: 'asc' as const };

  it('is empty for an unfiltered search', () => {
    expect(__internals.appointmentWhere(base)).toEqual({});
  });

  it('builds a half-open window on start', () => {
    const from = new Date('2026-08-14T00:00:00.000Z');
    const to = new Date('2026-08-15T00:00:00.000Z');

    expect(__internals.appointmentWhere({ ...base, from, to }).start).toEqual({
      gte: from,
      lt: to,
    });
    expect(__internals.appointmentWhere({ ...base, from }).start).toEqual({ gte: from });
    expect(__internals.appointmentWhere({ ...base, to }).start).toEqual({ lt: to });
  });

  it('passes the flow-board filters straight through', () => {
    expect(
      __internals.appointmentWhere({
        ...base,
        facilityId: DEMO_FACILITY_A,
        providerId: testId(900),
        patientId: testId(1),
        status: 'CHECKED_IN',
      })
    ).toEqual({
      facilityId: DEMO_FACILITY_A,
      providerId: testId(900),
      patientId: testId(1),
      status: 'CHECKED_IN',
    });
  });

  it('orders by start or creation, tie-broken on id', () => {
    expect(__internals.appointmentOrderBy(base)).toEqual([{ start: 'asc' }, { id: 'asc' }]);
    expect(__internals.appointmentOrderBy({ ...base, sort: 'createdAt', order: 'desc' })).toEqual([
      { createdAt: 'desc' },
      { id: 'asc' },
    ]);
  });
});

describe('row mapping', () => {
  it('projects a Prisma patient record onto the repository row', () => {
    const record = makePatientRow({ raceCodes: ['2106-3'] });

    const row = __internals.toPatientRow(record);
    expect(row).toEqual(makePatientRow({ raceCodes: ['2106-3'] }));
    expect(row.raceCodes).not.toBe(record.raceCodes);
  });

  it('projects a Prisma appointment record onto the repository row', () => {
    expect(__internals.toAppointmentRow(makeAppointmentRow() as AppointmentRecord)).toEqual(
      makeAppointmentRow()
    );
  });
});

describe('the Prisma patient repository', () => {
  it('pages with skip and take and counts the same where clause', async () => {
    const { port, repos } = harness();
    await repos.patients.list({
      page: 3,
      pageSize: 10,
      family: 'Pat',
      sort: 'familyName',
      order: 'asc',
    });

    const findMany = callArgs(port, 'patient', 'findMany') as Prisma.PatientFindManyArgs;
    const count = callArgs(port, 'patient', 'count') as Prisma.PatientCountArgs;
    expect(findMany.skip).toBe(20);
    expect(findMany.take).toBe(10);
    expect(count.where).toEqual(findMany.where);
  });

  it('reads by id and by MRN with findFirst, never findUnique', async () => {
    const { port, repos } = harness();
    port.patients.push(makePatientRow({ id: testId(1) }));

    await expect(repos.patients.findById(testId(1))).resolves.toMatchObject({ id: testId(1) });
    await expect(repos.patients.findByMrn('OR-100482')).resolves.toMatchObject({ id: testId(1) });
    expect(port.calls.filter((call) => call.operation === 'findFirst')).toHaveLength(2);
  });

  it('resolves to null when the scoped query finds nothing', async () => {
    const { repos } = harness();

    await expect(repos.patients.findById(testId(1))).resolves.toBeNull();
    await expect(repos.patients.findByMrn('missing')).resolves.toBeNull();
  });

  it('creates inside a transaction, with the audit event in the same transaction', async () => {
    const { port, repos, sink, unitsOfWork } = harness();
    await repos.patients.create({
      mrn: 'OR-100482',
      givenName: 'Testina',
      familyName: 'Patientsson',
      birthDate: new Date('1994-03-02T00:00:00.000Z'),
    });

    expect(port.transactions).toBe(1);
    expect(sink.writes()[0]?.transactional).toBe(true);
    // Not merely "a" transaction: the one the insert ran in.
    expect(unitsOfWork).toEqual([port.tx]);
  });

  it('lets the tenant extension own the tenant column rather than naming one', async () => {
    const { port, repos } = harness();
    await repos.patients.create({
      mrn: 'OR-100482',
      givenName: 'Testina',
      familyName: 'Patientsson',
      birthDate: new Date('1994-03-02T00:00:00.000Z'),
    });

    const args = callArgs(port, 'patient', 'create') as Prisma.PatientCreateArgs;
    const data = args.data as { id: string; tenantId: string };
    expect(data.tenantId).toBe('');
    expect(data.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('refuses a duplicate MRN before it reaches the insert', async () => {
    const { port, repos } = harness();
    port.patients.push(makePatientRow());

    await expect(
      repos.patients.create({
        mrn: 'OR-100482',
        givenName: 'Testina',
        familyName: 'Patientsson',
        birthDate: new Date('1994-03-02T00:00:00.000Z'),
      })
    ).rejects.toThrow(/already exists/);
    expect(callArgs(port, 'patient', 'create')).toBeUndefined();
  });

  it('updates with updateMany, then re-reads what the database actually stored', async () => {
    const { port, repos, unitsOfWork } = harness();
    port.patients.push(makePatientRow({ id: testId(1) }));

    const row = await repos.patients.update(testId(1), { familyName: 'Renamed' });

    const args = callArgs(port, 'patient', 'updateMany') as Prisma.PatientUpdateManyArgs;
    expect(args.where).toEqual({ id: testId(1) });
    expect(args.data).toEqual({ familyName: 'Renamed' });
    expect(row?.familyName).toBe('Patientsson');
    expect(unitsOfWork).toEqual([port.tx]);
  });

  it('resolves update to null when the scoped updateMany matched nothing', async () => {
    const { repos } = harness();

    await expect(repos.patients.update(testId(1), { familyName: 'Renamed' })).resolves.toBeNull();
  });

  it('drops explicitly-undefined patch keys so "not mentioned" never clears a column', async () => {
    const { port, repos } = harness();
    port.patients.push(makePatientRow({ id: testId(1) }));

    await repos.patients.update(testId(1), { familyName: 'Renamed', middleName: undefined });

    const args = callArgs(port, 'patient', 'updateMany') as Prisma.PatientUpdateManyArgs;
    expect(Object.keys(args.data)).toEqual(['familyName']);
  });
});

describe('the Prisma appointment repository', () => {
  it('pages, filters and counts consistently', async () => {
    const { port, repos } = harness();
    await repos.appointments.list({
      page: 2,
      pageSize: 5,
      facilityId: DEMO_FACILITY_A,
      sort: 'start',
      order: 'asc',
    });

    const findMany = callArgs(port, 'appointment', 'findMany') as Prisma.AppointmentFindManyArgs;
    expect(findMany.skip).toBe(5);
    expect(findMany.where).toEqual({ facilityId: DEMO_FACILITY_A });
  });

  it('reads one appointment, or null', async () => {
    const { port, repos } = harness();

    await expect(repos.appointments.findById(testId(101))).resolves.toBeNull();
    port.appointments.push(makeAppointmentRow({ id: testId(101) }) as AppointmentRecord);
    await expect(repos.appointments.findById(testId(101))).resolves.toMatchObject({
      id: testId(101),
    });
  });

  it('books inside a transaction and serialises the recurrence rule as JSON', async () => {
    const { port, repos, unitsOfWork } = harness();
    await repos.appointments.create({
      facilityId: DEMO_FACILITY_A,
      patientId: testId(1),
      providerId: testId(900),
      typeCode: 'OFFICE-30',
      typeDisplay: 'Office visit, 30 minutes',
      start: new Date('2026-08-14T15:00:00.000Z'),
      end: new Date('2026-08-14T15:30:00.000Z'),
      durationMinutes: 30,
      recurrenceGroupId: testId(700),
      recurrenceRule: { freq: 'WEEKLY' },
    });

    const args = callArgs(port, 'appointment', 'create') as Prisma.AppointmentCreateArgs;
    expect(args.data).toMatchObject({
      recurrenceGroupId: testId(700),
      recurrenceRule: { freq: 'WEEKLY' },
      tenantId: '',
    });
    expect(unitsOfWork).toEqual([port.tx]);
  });

  it('omits an absent patient and recurrence rather than writing nulls', async () => {
    const { port, repos } = harness();
    await repos.appointments.create({
      facilityId: DEMO_FACILITY_A,
      providerId: testId(900),
      typeCode: 'OFFICE-30',
      typeDisplay: 'Office visit',
      start: new Date('2026-08-14T15:00:00.000Z'),
      end: new Date('2026-08-14T15:30:00.000Z'),
      durationMinutes: 30,
    });

    const data = (callArgs(port, 'appointment', 'create') as Prisma.AppointmentCreateArgs).data;
    expect(data).not.toHaveProperty('patientId');
    expect(data).not.toHaveProperty('recurrenceRule');
  });

  it('resolves update to null when the appointment is not in this tenant', async () => {
    const { repos } = harness();

    await expect(repos.appointments.update(testId(101), { room: '4' })).resolves.toBeNull();
  });

  it('stamps checkedInAt on the first check-in and lists the columns it wrote', async () => {
    const { port, repos, sink } = harness();
    port.appointments.push(makeAppointmentRow({ id: testId(101) }) as AppointmentRecord);

    await repos.appointments.update(testId(101), { status: 'CHECKED_IN' });

    const data = (callArgs(port, 'appointment', 'updateMany') as Prisma.AppointmentUpdateManyArgs)
      .data as { checkedInAt?: Date };
    expect(data.checkedInAt).toBeInstanceOf(Date);
    expect(sink.writes()[0]?.event.metadata.fields).toEqual(['status', 'checkedInAt']);
  });

  it('does not re-stamp checkedInAt once it is set', async () => {
    const { port, repos } = harness();
    port.appointments.push(
      makeAppointmentRow({
        id: testId(101),
        checkedInAt: new Date('2026-08-14T14:55:00.000Z'),
      }) as AppointmentRecord
    );

    await repos.appointments.update(testId(101), { status: 'CHECKED_IN' });

    const data = (callArgs(port, 'appointment', 'updateMany') as Prisma.AppointmentUpdateManyArgs)
      .data as { checkedInAt?: Date };
    expect(data.checkedInAt).toBeUndefined();
  });
});
