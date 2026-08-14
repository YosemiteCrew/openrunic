import { describe, expect, it } from 'vitest';

import { createAuditChainStore } from '../audit/chain-store.js';
import { AuditCollector } from '../audit/collector.js';
import { createMemoryAuditSink, type MemoryAuditSink } from '../audit/memory-sink.js';
import type { AuditUnitOfWork } from '../audit/types.js';
import { createPrismaAuditQuery } from '../repositories/audit-query.js';
import { childBatch, type CollectionSpec, type Writable } from '../repositories/collection.js';
import {
  createDbPort,
  delegateKey,
  tenantClientSatisfiesPort,
  type DbPort,
} from '../repositories/db-port.js';
import { createEmptyDataset, type MemoryDataset } from '../repositories/memory.js';
import { createPrismaCollection, createPrismaRepositoryRegistry } from '../repositories/prisma.js';
import type { ScopedRow } from '../repositories/rows.js';
import type { RequestScope } from '../repositories/registry.js';
import { patientSpec } from '../repositories/specs/core.js';

import { createFakePort, matchesWhere, type FakePort } from './fake-port.js';
import {
  DEMO_FACILITY_A,
  DEMO_TENANT_A,
  FIXED_NOW,
  makeAppointmentRow,
  makePatientRow,
  testId,
} from './support.js';

/**
 * The Prisma adapter, driven by a fake {@link DbPort}.
 *
 * The fake evaluates the filters it is handed and applies the tenant narrowing
 * the extension applies in production, so what is under test here is the thing
 * the adapter actually owns: which arguments it sends, what it does with the
 * rows that come back, and whether the audit event lands in the same unit of
 * work as the mutation.
 */

interface Harness {
  port: FakePort;
  dataset: MemoryDataset;
  sink: MemoryAuditSink;
  scope: RequestScope;
  /** Every unit of work the repositories handed to the audit sink. */
  unitsOfWork: (AuditUnitOfWork | undefined)[];
}

function harness(compartmentPatientId?: string): Harness {
  const dataset = createEmptyDataset();
  const inner = createMemoryAuditSink({ now: () => FIXED_NOW });
  const unitsOfWork: (AuditUnitOfWork | undefined)[] = [];
  const sink: MemoryAuditSink = {
    ...inner,
    recordWrite(tenantId, event, unitOfWork) {
      unitsOfWork.push(unitOfWork);
      return inner.recordWrite(tenantId, event, unitOfWork);
    },
  };
  const port = createFakePort({ dataset, tenantId: DEMO_TENANT_A, now: () => FIXED_NOW });
  const scope: RequestScope = {
    tenantId: DEMO_TENANT_A,
    ...(compartmentPatientId === undefined ? {} : { compartmentPatientId }),
    audit: new AuditCollector(sink, {
      tenantId: DEMO_TENANT_A,
      actorType: 'user',
      actorId: testId(900),
      requestId: 'req-1',
      method: 'GET',
      path: '/test',
    }),
  };
  return { port, dataset, sink, scope, unitsOfWork };
}

function patients(h: Harness) {
  return createPrismaCollection(patientSpec, h.port, h.scope);
}

function callArgs(port: FakePort, model: string, operation: string): unknown {
  return port.calls.find((call) => call.model === model && call.operation === operation)?.args;
}

const NEW_PATIENT = {
  mrn: 'OR-100482',
  givenName: 'Testina',
  familyName: 'Patientsson',
  birthDate: new Date('1994-03-02T00:00:00.000Z'),
};

describe('the port', () => {
  it('is satisfied by the real tenant-scoped client at compile time', () => {
    expect(tenantClientSatisfiesPort).toBe(true);
  });

  it('reaches a model by the property name Prisma gives it', () => {
    expect(delegateKey('Patient')).toBe('patient');
    expect(delegateKey('MedicationRequest')).toBe('medicationRequest');
  });

  it('adapts a client, inside and outside a transaction', async () => {
    const seen: string[] = [];
    const delegate = {
      findFirst: (): Promise<null> => {
        seen.push('outer');
        return Promise.resolve(null);
      },
    };
    const inner = {
      findFirst: (): Promise<null> => {
        seen.push('inner');
        return Promise.resolve(null);
      },
    };
    // A structural stand-in for the generated client. The compile-time
    // assertion above is what proves the real one fits; this only exercises the
    // property-name arithmetic and the transaction hand-off.
    const client = {
      patient: delegate,
      auditEvent: { create: () => Promise.resolve({ id: testId(1) }), findFirst: () => null },
      $transaction: (fn: (tx: unknown) => unknown) =>
        fn({ patient: inner, auditEvent: { create: () => null, findFirst: () => null } }),
    };
    const port: DbPort = createDbPort(client as unknown as Parameters<typeof createDbPort>[0]);

    await port.model('Patient').findFirst({});
    await port.$transaction(async (tx) => {
      await tx.model('Patient').findFirst({});
    });

    expect(seen).toEqual(['outer', 'inner']);
  });
});

describe('the fake port itself', () => {
  it('refuses a filter it does not understand rather than ignoring it', () => {
    expect(() => matchesWhere({ id: 'a' }, { id: { unsupported: 1 } })).toThrow(/unsupported/);
  });

  it('evaluates the operators the specs emit', () => {
    const row = { name: 'Patientsson', count: 3, tags: ['a'], at: new Date('2026-01-01') };

    expect(matchesWhere(row, { name: { startsWith: 'patients', mode: 'insensitive' } })).toBe(true);
    expect(matchesWhere(row, { name: { contains: 'SSO', mode: 'insensitive' } })).toBe(true);
    expect(matchesWhere(row, { name: { contains: 'SSO' } })).toBe(false);
    expect(matchesWhere(row, { count: { gte: 3, lt: 4 } })).toBe(true);
    expect(matchesWhere(row, { count: { gt: 3 } })).toBe(false);
    expect(matchesWhere(row, { count: { lte: 3 } })).toBe(true);
    expect(matchesWhere(row, { tags: { has: 'a' } })).toBe(true);
    expect(matchesWhere(row, { count: { in: [1, 3] } })).toBe(true);
    expect(matchesWhere(row, { count: { not: 3 } })).toBe(false);
    expect(matchesWhere(row, { at: new Date('2026-01-01') })).toBe(true);
    expect(matchesWhere(row, { NOT: { count: 3 } })).toBe(false);
    expect(matchesWhere(row, { OR: [{ count: 9 }, { count: 3 }] })).toBe(true);
  });
});

describe('the generic Prisma collection', () => {
  it('pages with skip and take and counts the same filter', async () => {
    const h = harness();
    await patients(h).list({
      page: 3,
      pageSize: 10,
      family: 'Pat',
      sort: 'familyName',
      order: 'asc',
    });

    const findMany = callArgs(h.port, 'Patient', 'findMany') as { skip: number; take: number };
    const count = callArgs(h.port, 'Patient', 'count') as { where: unknown };
    expect(findMany.skip).toBe(20);
    expect(findMany.take).toBe(10);
    expect(count.where).toEqual((findMany as unknown as { where: unknown }).where);
  });

  it('selects the rows the in-memory predicate would have selected', async () => {
    const h = harness();
    h.dataset
      .table('Patient')
      .push(
        makePatientRow({ id: testId(1), familyName: 'Patientsson' }),
        makePatientRow({ id: testId(2), mrn: 'OR-100483', familyName: 'Other' })
      );

    const page = await patients(h).list({
      page: 1,
      pageSize: 25,
      family: 'pat',
      sort: 'familyName',
      order: 'asc',
    });

    expect(page.rows.map((row) => row.id)).toEqual([testId(1)]);
    expect(page.total).toBe(1);
  });

  it('reads by id with findFirst, never findUnique', async () => {
    const h = harness();
    h.dataset.table('Patient').push(makePatientRow({ id: testId(1) }));

    await expect(patients(h).findById(testId(1))).resolves.toMatchObject({ id: testId(1) });
    expect(h.port.calls.some((call) => call.operation === 'findUnique')).toBe(false);
  });

  it('resolves to null when the scoped query finds nothing', async () => {
    const h = harness();

    await expect(patients(h).findById(testId(1))).resolves.toBeNull();
  });

  it('creates inside a transaction, with the audit event in that same transaction', async () => {
    const h = harness();

    await patients(h).create(NEW_PATIENT);

    expect(h.port.transactions).toBe(1);
    expect(h.sink.writes()[0]?.transactional).toBe(true);
    // Not merely "a" transaction: the one the insert ran in.
    expect(h.unitsOfWork).toEqual([h.port.tx]);
  });

  it('lets the tenant extension own the tenant column rather than naming one', async () => {
    const h = harness();

    await patients(h).create(NEW_PATIENT);

    const data = (callArgs(h.port, 'Patient', 'create') as { data: Record<string, unknown> }).data;
    expect(data.tenantId).toBe('');
    expect(String(data.id)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('omits the columns a create left null, so a JSON column is not written as null', async () => {
    const h = harness();

    await patients(h).create(NEW_PATIENT);

    const data = (callArgs(h.port, 'Patient', 'create') as { data: Record<string, unknown> }).data;
    expect(data).not.toHaveProperty('middleName');
    expect(data.country).toBe('US');
  });

  it('refuses a duplicate natural key before it reaches the insert', async () => {
    const h = harness();
    h.dataset.table('Patient').push(makePatientRow());

    await expect(patients(h).create(NEW_PATIENT)).rejects.toThrow(/already exists/);
    expect(callArgs(h.port, 'Patient', 'create')).toBeUndefined();
  });

  it('updates with updateMany, then re-reads what the database actually stored', async () => {
    const h = harness();
    h.dataset.table('Patient').push(makePatientRow({ id: testId(1) }));

    const row = await patients(h).update(testId(1), { familyName: 'Renamed' });

    const args = callArgs(h.port, 'Patient', 'updateMany') as { data: Record<string, unknown> };
    expect(args.data).toEqual({ familyName: 'Renamed' });
    expect(row?.familyName).toBe('Renamed');
    expect(h.unitsOfWork).toEqual([h.port.tx]);
  });

  it('resolves an update to null when the scoped read matched nothing', async () => {
    const h = harness();

    await expect(patients(h).update(testId(1), { familyName: 'Renamed' })).resolves.toBeNull();
  });

  it('drops explicitly-undefined patch keys so "not mentioned" never clears a column', async () => {
    const h = harness();
    h.dataset.table('Patient').push(makePatientRow({ id: testId(1) }));

    await patients(h).update(testId(1), { familyName: 'Renamed', middleName: undefined });

    const args = callArgs(h.port, 'Patient', 'updateMany') as { data: Record<string, unknown> };
    expect(Object.keys(args.data)).toEqual(['familyName']);
  });

  it('records the read of every row a page returned', async () => {
    const h = harness();
    h.dataset.table('Patient').push(makePatientRow({ id: testId(1) }));

    await patients(h).list({ page: 1, pageSize: 25, sort: 'familyName', order: 'asc' });
    await h.scope.audit.flush();

    expect(h.sink.reads()[0]?.event.metadata).toMatchObject({
      targets: [{ type: 'Patient', id: testId(1) }],
    });
  });
});

describe('the patient compartment', () => {
  it('narrows a chart-bearing collection to the launch context', async () => {
    const h = harness(testId(1));
    h.dataset
      .table('Patient')
      .push(makePatientRow({ id: testId(1) }), makePatientRow({ id: testId(2), mrn: 'OR-2' }));

    const page = await patients(h).list({
      page: 1,
      pageSize: 25,
      sort: 'familyName',
      order: 'asc',
    });

    expect(page.rows.map((row) => row.id)).toEqual([testId(1)]);
    await expect(patients(h).findById(testId(2))).resolves.toBeNull();
  });

  it('refuses a collection that reaches a chart only through a join', async () => {
    const h = harness(testId(1));
    const spec = closedSpec();
    const collection = createPrismaCollection(spec, h.port, h.scope);
    h.dataset.table('Message').push({
      id: testId(3),
      tenantId: DEMO_TENANT_A,
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    } as ScopedRow<'Message'>);

    await expect(
      collection.list({ page: 1, pageSize: 25, sort: 'sentAt', order: 'asc' })
    ).resolves.toMatchObject({ total: 0 });
    await expect(collection.findById(testId(3))).resolves.toBeNull();
    await expect(collection.update(testId(3), {})).resolves.toBeNull();
    // Refused without asking Postgres: a query that cannot return a row should
    // not be sent at all.
    expect(h.port.calls).toEqual([]);
  });
});

describe('composite writes', () => {
  it('writes the child rows in the parent transaction', async () => {
    const h = harness();
    const registry = createPrismaRepositoryRegistry(() => h.port);
    const repositories = registry.forRequest(h.scope);
    h.dataset.table('Patient').push(makePatientRow({ id: testId(1) }));

    await repositories.appointments.create({
      facilityId: DEMO_FACILITY_A,
      patientId: testId(1),
      providerId: testId(900),
      typeCode: 'OFFICE-30',
      typeDisplay: 'Office visit, 30 minutes',
      start: new Date('2026-08-14T15:00:00.000Z'),
      end: new Date('2026-08-14T15:30:00.000Z'),
      durationMinutes: 30,
    });

    expect(h.dataset.table('Appointment')).toHaveLength(1);
    expect(h.port.transactions).toBe(1);
  });

  it('stamps the tenant on a child row too', async () => {
    const h = harness();
    const collection = createPrismaCollection(childBearingSpec(), h.port, h.scope);

    await collection.create({ note: 'a claim with one line' });

    const line = h.dataset.table('ClaimStatusHistory')[0];
    expect(line?.tenantId).toBe(DEMO_TENANT_A);
  });
});

/** A spec whose rows reach a chart only through a join, for the closed-compartment path. */
function closedSpec(): CollectionSpec<
  'Message',
  never,
  Record<string, never>,
  {
    page: number;
    pageSize: number;
    sort: 'sentAt';
    order: 'asc' | 'desc';
  }
> {
  return {
    model: 'Message',
    targetType: 'Message',
    action: 'message',
    compartment: 'closed',
    newRow(): Writable<'Message'> {
      throw new Error('not used');
    },
    patchData: () => ({}),
    matches: () => true,
    where: () => ({}),
    sortValue: (row) => row.id,
    orderBy: () => [{ id: 'asc' }],
  };
}

/** A minimal composite spec, so the child-row path is exercised in isolation. */
function childBearingSpec(): CollectionSpec<
  'Claim',
  { note: string },
  Record<string, never>,
  { page: number; pageSize: number; sort: 'createdAt'; order: 'asc' | 'desc' }
> {
  return {
    model: 'Claim',
    targetType: 'Claim',
    action: 'claim',
    patientColumn: 'patientId',
    compartment: { column: 'patientId' },
    newRow(): Writable<'Claim'> {
      return {
        patientId: testId(1),
        encounterId: testId(2),
        coverageId: testId(3),
        payerId: testId(4),
        status: 'DRAFT',
        frequency: 'ORIGINAL',
        diagnosisCodes: ['Z00.00'],
        totalChargedCents: 0,
        totalPaidCents: 0,
        totalAdjustedCents: 0,
        patientResponsibilityCents: 0,
        secondaryOfId: null,
        priorClaimId: null,
        controlNumbers: {},
        snapshot: {},
        statusReason: null,
        submittedAt: null,
        acknowledgedAt: null,
        adjudicatedAt: null,
      };
    },
    childRows(input, parent, context) {
      return [
        childBatch('ClaimStatusHistory', [
          {
            id: context.nextId(),
            claimId: parent.id,
            status: 'DRAFT',
            occurredAt: context.now,
            source: 'system',
            detail: { note: input.note },
            byUserId: null,
          },
        ]),
      ];
    },
    patchData: () => ({}),
    matches: () => true,
    where: () => ({}),
    sortValue: (row) => row.createdAt.getTime(),
    orderBy: () => [{ createdAt: 'asc' }],
  };
}

describe('appointment rows survive the round trip', () => {
  it('maps a stored record onto the row the API serves', async () => {
    const h = harness();
    h.dataset.table('Appointment').push(makeAppointmentRow({ id: testId(101) }));
    const registry = createPrismaRepositoryRegistry(() => h.port);

    await expect(
      registry.forRequest(h.scope).appointments.findById(testId(101))
    ).resolves.toMatchObject({ id: testId(101), typeCode: 'OFFICE-30' });
  });
});

describe('the Prisma audit query', () => {
  function seedChain(h: Harness): void {
    const store = createAuditChainStore(() => testId(700));
    const rows = [
      { action: 'patient.created', patientId: testId(1), outcome: 'success' as const },
      { action: 'patient.updated', patientId: testId(2), outcome: 'success' as const },
      { action: 'authorisation.denied', outcome: 'failure' as const },
    ];
    let index = 0;
    for (const entry of rows) {
      index += 1;
      const stored = store.append(
        DEMO_TENANT_A,
        {
          actorType: 'user',
          actorId: testId(900),
          action: entry.action,
          targetType: 'Patient',
          targetId: testId(index),
          ...(entry.patientId === undefined ? {} : { patientId: entry.patientId }),
          outcome: entry.outcome,
          metadata: {},
        },
        FIXED_NOW
      );
      h.dataset.table('AuditEvent').push({
        ...stored,
        id: testId(600 + index),
        actorDisplay: null,
        encounterId: null,
        facilityId: null,
        purposeOfUse: null,
        breakglass: false,
        sourceIp: null,
        userAgent: null,
        patientId: stored.patientId ?? null,
        targetId: stored.targetId ?? null,
        createdAt: FIXED_NOW,
        updatedAt: FIXED_NOW,
      } as ScopedRow<'AuditEvent'>);
    }
  }

  it('pages and filters the log', async () => {
    const h = harness();
    seedChain(h);
    const query = createPrismaAuditQuery(h.port, h.scope);

    const all = await query.list({ page: 1, pageSize: 25, sort: 'seq', order: 'asc' });
    const denials = await query.list({
      page: 1,
      pageSize: 25,
      outcome: 'failure',
      sort: 'occurredAt',
      order: 'desc',
    });

    expect(all.total).toBe(3);
    expect(denials.total).toBe(1);
    expect(denials.rows[0]?.action).toBe('authorisation.denied');
  });

  it('narrows every filter it advertises', async () => {
    const h = harness();
    seedChain(h);
    const query = createPrismaAuditQuery(h.port, h.scope);

    const filtered = await query.list({
      page: 1,
      pageSize: 25,
      patientId: testId(2),
      actorId: testId(900),
      action: 'patient.updated',
      targetType: 'Patient',
      targetId: testId(2),
      breakglass: false,
      from: new Date('2026-08-13T00:00:00.000Z'),
      to: new Date('2026-08-14T00:00:00.000Z'),
      sort: 'occurredAt',
      order: 'asc',
    });

    expect(filtered.total).toBe(1);
  });

  it('reads one event, and reports an unknown id as absent', async () => {
    const h = harness();
    seedChain(h);
    const query = createPrismaAuditQuery(h.port, h.scope);

    await expect(query.findById(testId(601))).resolves.toMatchObject({ seq: 1n });
    await expect(query.findById(testId(999))).resolves.toBeNull();
  });

  it('confines a compartment-restricted principal to events about its own chart', async () => {
    const h = harness(testId(1));
    seedChain(h);
    const query = createPrismaAuditQuery(h.port, h.scope);

    const page = await query.list({ page: 1, pageSize: 25, sort: 'seq', order: 'asc' });

    expect(page.total).toBe(1);
    await expect(query.findById(testId(602))).resolves.toBeNull();
  });

  it('verifies the chain it reads back', async () => {
    const h = harness();
    seedChain(h);
    const query = createPrismaAuditQuery(h.port, h.scope);

    await expect(query.verifyChain()).resolves.toMatchObject({ valid: true, checked: 3 });
  });

  it('reports where a tampered chain first breaks', async () => {
    const h = harness();
    seedChain(h);
    const tampered = h.dataset.table('AuditEvent')[1] as unknown as { action: string };
    tampered.action = 'patient.definitely-not-deleted';

    await expect(createPrismaAuditQuery(h.port, h.scope).verifyChain()).resolves.toMatchObject({
      valid: false,
      brokenAtSeq: 2n,
      reason: 'hash-mismatch',
    });
  });
});
