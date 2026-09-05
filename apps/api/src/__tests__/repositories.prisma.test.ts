import { describe, expect, it } from 'vitest';

import { createAuditChainStore } from '../audit/chain-store.js';
import { AuditCollector } from '../audit/collector.js';
import { createMemoryAuditSink, type MemoryAuditSink } from '../audit/memory-sink.js';
import type { AuditUnitOfWork } from '../audit/types.js';
import { createPrismaAuditQuery } from '../repositories/audit-query.js';
import { createPrismaOrganisationQuery } from '../repositories/organisation-query.js';
import {
  childBatch,
  childPatch,
  type CollectionSpec,
  type Writable,
} from '../repositories/collection.js';
import {
  createDbPort,
  delegateKey,
  tenantClientSatisfiesPort,
  type DbPort,
  type DbTransaction,
} from '../repositories/db-port.js';
import { createEmptyDataset, type MemoryDataset } from '../repositories/memory.js';
import { createPrismaCollection, createPrismaRepositoryRegistry } from '../repositories/prisma.js';
import type { PrismaModelName, ScopedRow } from '../repositories/rows.js';
import type { RequestScope } from '../repositories/registry.js';
import { appointmentSpec, patientSpec } from '../repositories/specs/core.js';

import { createFakePort, matchesWhere, type FakePort } from './fake-port.js';
import {
  DEMO_FACILITY_A,
  DEMO_FACILITY_B,
  DEMO_TENANT_A,
  DEMO_TENANT_B,
  FIXED_NOW,
  makeAppointmentRow,
  makePatientRow,
  storageColumns,
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

  it('records the read of every row a set read returned', async () => {
    const h = harness();
    h.dataset.table('Patient').push(makePatientRow({ id: testId(1) }));
    h.dataset.table('Patient').push(makePatientRow({ id: testId(2), mrn: 'OR-2' }));

    await patients(h).findByIds([testId(1), testId(2)]);
    await h.scope.audit.flush();

    // Every row, not the call. A batched read that recorded nothing would put a
    // chart in front of somebody with no trace that it happened, which is the
    // one thing this layer cannot do quietly.
    expect(h.sink.reads()[0]?.event.metadata).toMatchObject({
      targets: [
        { type: 'Patient', id: testId(1) },
        { type: 'Patient', id: testId(2) },
      ],
    });
  });
});

/**
 * A row addressed by id is hidden from a facility-limited caller only when the
 * scope asks for it - see `RequestScope.hideFacilityRows`. Whatever the answer
 * is for `findById`, it has to be the same for the set read, because a set read
 * is an addressed read with more than one address.
 */
describe('the facility narrowing on an addressed set read', () => {
  function seedTwoSites(h: Harness): void {
    h.dataset
      .table('Appointment')
      .push(
        makeAppointmentRow({ id: testId(1), facilityId: DEMO_FACILITY_A }),
        makeAppointmentRow({ id: testId(2), facilityId: DEMO_FACILITY_B })
      );
  }

  const confined = (h: Harness, hide: boolean): RequestScope => ({
    ...h.scope,
    facilityIds: [DEMO_FACILITY_A],
    ...(hide ? { hideFacilityRows: true } : {}),
  });

  it('hides the other site by id set when the scope hides it by id', async () => {
    const h = harness();
    seedTwoSites(h);
    const scope = confined(h, true);
    const registry = createPrismaRepositoryRegistry(() => h.port);

    // The single-id answer first, so the set read is measured against it rather
    // than against an assumption about what the rule is.
    await expect(registry.forRequest(scope).appointments.findById(testId(2))).resolves.toBeNull();
    await expect(
      registry.forRequest(scope).appointments.findByIds([testId(1), testId(2)])
    ).resolves.toMatchObject([{ id: testId(1) }]);
  });

  it('serves the other site by id set when the scope serves it by id', async () => {
    const h = harness();
    seedTwoSites(h);
    const scope = confined(h, false);
    const registry = createPrismaRepositoryRegistry(() => h.port);

    // The other half of the rule, and the reason this is two tests: a set read
    // that always hid would be wrong in the direction nobody notices, because
    // it looks like a stricter version of correct.
    await expect(
      registry.forRequest(scope).appointments.findById(testId(2))
    ).resolves.not.toBeNull();
    await expect(
      registry.forRequest(scope).appointments.findByIds([testId(1), testId(2)])
    ).resolves.toHaveLength(2);
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
    // And by set, asking for both at once. The compartment column is applied by
    // `scoped()` rather than by the tenant client, so a batched read that built
    // its own `where` would reach the chart the launch context excludes while
    // every tenant-isolation test in the suite stayed green.
    await expect(patients(h).findByIds([testId(1), testId(2)])).resolves.toMatchObject([
      { id: testId(1) },
    ]);
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
    // The set read is refused on the same terms. A batched path that checked
    // the compartment only on the single-id route would answer here.
    await expect(collection.findByIds([testId(3)])).resolves.toEqual([]);
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

  /**
   * The amendment half, which exists for a denormalised column a child insert
   * makes stale: a lot's status lives in its history and the lot list narrows on
   * the column, so the two have to move together or neither does.
   */
  it('amends the row it names, in the same transaction', async () => {
    const h = harness();
    h.dataset.table('Patient').push(makePatientRow({ id: testId(1), familyName: 'Before' }));
    const collection = createPrismaCollection(childBearingSpec(), h.port, h.scope);

    await collection.create({ note: 'After', amends: testId(1) });

    expect(h.dataset.table('Patient')[0]?.familyName).toBe('After');
    expect(h.port.transactions).toBe(1);
  });

  /**
   * A row in another organisation is not there to amend, and it must not be a
   * quiet no-op that leaves the parent written: half of a composite write is the
   * state the whole hook exists to prevent.
   */
  it('refuses an amendment that matches no row in scope', async () => {
    const h = harness();
    h.dataset.table('Patient').push({
      ...makePatientRow({ id: testId(1), familyName: 'Before' }),
      tenantId: DEMO_TENANT_B,
    });
    const collection = createPrismaCollection(childBearingSpec(), h.port, h.scope);

    await expect(collection.create({ note: 'After', amends: testId(1) })).rejects.toThrow(
      /to amend/u
    );
    expect(h.dataset.table('Patient')[0]?.familyName).toBe('Before');
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
  { note: string; amends?: string },
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
    childPatches(input) {
      return input.amends === undefined
        ? []
        : [childPatch('Patient', input.amends, { familyName: input.note })];
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
  /**
   * Three linked events. `facilities` sites them, positionally, and is passed
   * through `append` rather than stamped on the row afterwards so the chain
   * hash covers the facility like it does in production.
   */
  function seedChain(h: Harness, facilities: readonly (string | undefined)[] = []): void {
    const store = createAuditChainStore(() => testId(700));
    const rows = [
      { action: 'patient.created', patientId: testId(1), outcome: 'success' as const },
      { action: 'patient.updated', patientId: testId(2), outcome: 'success' as const },
      { action: 'authorisation.denied', outcome: 'failure' as const },
    ];
    let index = 0;
    for (const entry of rows) {
      index += 1;
      const facilityId = facilities[index - 1];
      const stored = store.append(
        DEMO_TENANT_A,
        {
          actorType: 'user',
          actorId: testId(900),
          action: entry.action,
          targetType: 'Patient',
          targetId: testId(index),
          ...(entry.patientId === undefined ? {} : { patientId: entry.patientId }),
          ...(facilityId === undefined ? {} : { facilityId }),
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
        facilityId: stored.facilityId ?? null,
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

  it('narrows a site-confined principal to its own sites, and to the unsited events', async () => {
    const h = harness();
    seedChain(h, [DEMO_FACILITY_A, DEMO_FACILITY_B, undefined]);
    const scope: RequestScope = { ...h.scope, facilityIds: [DEMO_FACILITY_A] };
    const query = createPrismaAuditQuery(h.port, scope);

    const page = await query.list({ page: 1, pageSize: 25, sort: 'seq', order: 'asc' });

    // Site A's event and the unsited one. The unsited event stays because an
    // event with no facility is an organisation-wide act, and hiding those
    // would empty an auditor's page of exactly what they most need to see.
    expect(page.rows.map((row) => row.facilityId)).toEqual([DEMO_FACILITY_A, null]);
    expect(page.total).toBe(2);
  });

  it('reports another site event as absent rather than serving it by id', async () => {
    const h = harness();
    seedChain(h, [DEMO_FACILITY_A, DEMO_FACILITY_B, undefined]);
    const query = createPrismaAuditQuery(h.port, {
      ...h.scope,
      facilityIds: [DEMO_FACILITY_A],
    });

    await expect(query.findById(testId(602))).resolves.toBeNull();
    await expect(query.findById(testId(601))).resolves.toMatchObject({
      facilityId: DEMO_FACILITY_A,
    });
  });

  it('leaves a principal holding every facility unnarrowed', async () => {
    const h = harness();
    seedChain(h, [DEMO_FACILITY_A, DEMO_FACILITY_B, undefined]);
    // `facilityIds` undefined is how the middleware represents `facility.all`.
    const query = createPrismaAuditQuery(h.port, h.scope);

    const page = await query.list({ page: 1, pageSize: 25, sort: 'seq', order: 'asc' });

    expect(page.total).toBe(3);
    await expect(query.findById(testId(602))).resolves.not.toBeNull();
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

/**
 * The organisation read, through the Prisma port.
 *
 * The memory port is what every HTTP test exercises, so without this the
 * production path for the one collection whose narrowing is hand-written would
 * have no test at all. The fake ANDs `tenantId` only for the models
 * `createTenantClient` actually scopes, and `Organisation` is not one of them,
 * so the narrowing under test here is the repository's own `id === tenantId`
 * and nothing else.
 */
describe('the Prisma organisation query', () => {
  const organisationRow = (id: string, name: string): ScopedRow<'Organisation'> =>
    ({
      id,
      slug: name.toLowerCase().replaceAll(' ', '-'),
      name,
      mode: 'SELF_HOST',
      status: 'ACTIVE',
      timezone: 'UTC',
      flags: {},
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    }) as unknown as ScopedRow<'Organisation'>;

  function seedBoth(h: Harness): void {
    h.dataset.table('Organisation').push(organisationRow(DEMO_TENANT_A, 'Practice A'));
    h.dataset.table('Organisation').push(organisationRow(DEMO_TENANT_B, 'Practice B'));
  }

  const query = { page: 1, pageSize: 25, sort: 'name', order: 'asc' } as const;

  it('reads the caller own organisation and no other', async () => {
    const h = harness();
    seedBoth(h);

    const page = await createPrismaOrganisationQuery(h.port, h.scope).list(query);

    expect(page.total).toBe(1);
    expect(page.rows[0]?.id).toBe(DEMO_TENANT_A);
  });

  it('asks the database for the id rather than filtering afterwards', async () => {
    const h = harness();
    seedBoth(h);

    await createPrismaOrganisationQuery(h.port, h.scope).list(query);

    // The narrowing has to be in the query the database sees. A repository that
    // read every row and picked one would pass the test above and leak under
    // any port that does not happen to be a fake in the same process.
    const call = h.port.calls.find((entry) => entry.model === 'Organisation');
    expect(call?.args).toMatchObject({ where: { id: DEMO_TENANT_A } });
  });

  it('reports another organisation as absent by id', async () => {
    const h = harness();
    seedBoth(h);
    const repository = createPrismaOrganisationQuery(h.port, h.scope);

    await expect(repository.findById(DEMO_TENANT_B)).resolves.toBeNull();
    await expect(repository.findById(DEMO_TENANT_A)).resolves.toMatchObject({
      name: 'Practice A',
    });
  });

  it('applies the name filter, and an empty result is a page of none', async () => {
    const h = harness();
    seedBoth(h);
    const repository = createPrismaOrganisationQuery(h.port, h.scope);

    await expect(repository.list({ ...query, name: 'practice a' })).resolves.toMatchObject({
      total: 1,
    });
    // Practice B's name, which this caller must not match on.
    await expect(repository.list({ ...query, name: 'Practice B' })).resolves.toMatchObject({
      total: 0,
    });
  });
});

/**
 * The property `findByIds` exists for: a page's worth of ids costs one query.
 *
 * `prepareRoles` used to dedupe ids and issue `findById` for each, which bought
 * nothing on a page where every grant belonged to a different practitioner. A
 * five-hundred-row bulk-export page put up to a thousand concurrent reads
 * through a connection pool sized for far fewer, and the fix had to be at the
 * repository layer because every `prepare` hook wants the same thing.
 */
describe('the Prisma set read', () => {
  const PEOPLE = 200;

  function seedPeople(h: Harness): string[] {
    const ids: string[] = [];
    for (let index = 0; index < PEOPLE; index += 1) {
      const id = testId(30_000 + index);
      ids.push(id);
      h.dataset.table('User').push({
        ...storageColumns(id),
        email: `person-${index}@example.invalid`,
        givenName: 'Person',
        familyName: String(index),
        credential: null,
        npi: null,
        dea: null,
        taxonomyCode: null,
        isProvider: true,
        locale: 'en-US',
        status: 'ACTIVE',
        lastLoginAt: null,
      } as unknown as ScopedRow<'User'>);
    }
    return ids;
  }

  it('reads two hundred distinct ids in a single query', async () => {
    const h = harness();
    const ids = seedPeople(h);
    const repositories = createPrismaRepositoryRegistry(() => h.port).forRequest(h.scope);

    const rows = await repositories.users.findByIds(ids);

    expect(rows).toHaveLength(PEOPLE);
    const userReads = h.port.calls.filter((call) => call.model === 'User');
    // One. Not two hundred, and not two hundred deduped down to some smaller
    // number that still grows with the page.
    expect(userReads).toHaveLength(1);
    expect(userReads[0]?.operation).toBe('findMany');
  });

  it('costs no query at all for an empty set', async () => {
    const h = harness();
    seedPeople(h);
    const repositories = createPrismaRepositoryRegistry(() => h.port).forRequest(h.scope);

    await expect(repositories.users.findByIds([])).resolves.toEqual([]);

    expect(h.port.calls.filter((call) => call.model === 'User')).toHaveLength(0);
  });

  it('sends the ids deduplicated, so a repeated id does not widen the query', async () => {
    const h = harness();
    const ids = seedPeople(h);
    const first = ids[0] ?? '';
    const repositories = createPrismaRepositoryRegistry(() => h.port).forRequest(h.scope);

    await repositories.users.findByIds([first, first, first]);

    const where = h.port.calls.find((call) => call.model === 'User')?.args as {
      where?: { AND?: { id?: { in?: string[] } }[]; id?: { in?: string[] } };
    };
    const flattened = JSON.stringify(where);
    expect(flattened).toContain(first);
    // Three copies in, one out.
    expect(flattened.split(first).length - 1).toBe(1);
  });
});

/**
 * Losing the race to a natural key.
 *
 * The `uniqueBy` check runs inside the create's transaction and is followed by
 * an insert, so under READ COMMITTED it is check-then-write: two connections
 * both find no clash, both insert, and the table's unique index decides. That
 * cannot be reproduced against the fake port, which has no concurrency - so
 * what is reproduced here is the state the loser arrives in. The insert fails
 * with Prisma's unique-violation code, and by then the winner's row is
 * committed and visible.
 *
 * The fake stands in for the database rather than for a second request: it
 * pushes the winner's row and then throws, which is exactly what the loser
 * sees. The two-connection half - that Postgres really raises this for this
 * constraint, and that Prisma really spells it `P2002` - is asserted against a
 * real server in `packages/database/src/rls.integration.test.ts`, because no
 * fake can be evidence for how another process reports an error.
 */
describe('a create that loses a race to the unique index', () => {
  const CLASHING_MRN = 'OR-100482';

  /** Prisma's shape for a unique violation. Only `code` is read. */
  function uniqueViolation(): Error & { code: string } {
    return Object.assign(new Error('Unique constraint failed on the fields: (`mrn`)'), {
      code: 'P2002',
    });
  }

  /**
   * A port whose insert fails the way the loser's does.
   *
   * `onCreate` runs before the throw, which is where the winner's row is
   * pushed: the point of the test is the order, since a re-read that happened
   * before the winner committed would find nothing and rethrow.
   */
  function racingPort(h: Harness, error: Error, onCreate?: () => void): DbPort {
    const failing = (tx: DbTransaction): DbTransaction => ({
      ...tx,
      model<M extends PrismaModelName>(name: M) {
        const delegate = tx.model(name);
        if (name !== 'Patient') return delegate;
        return {
          ...delegate,
          create: () => {
            onCreate?.();
            return Promise.reject(error);
          },
        };
      },
    });
    return {
      ...h.port,
      $transaction: <R>(fn: (tx: DbTransaction) => Promise<R>): Promise<R> =>
        h.port.$transaction((tx) => fn(failing(tx))),
    };
  }

  function winner(h: Harness): void {
    h.dataset
      .table('Patient')
      .push(makePatientRow({ id: testId(77), mrn: CLASHING_MRN, tenantId: DEMO_TENANT_A }));
  }

  it('answers a conflict carrying the spec its own message, not a raw error', async () => {
    const h = harness();
    const collection = createPrismaCollection(
      patientSpec,
      racingPort(h, uniqueViolation(), () => {
        winner(h);
      }),
      h.scope
    );

    await expect(collection.create({ ...NEW_PATIENT, mrn: CLASHING_MRN })).rejects.toMatchObject({
      kind: 'conflict',
      status: 409,
    });
  });

  it('rethrows when the key is not in fact taken', async () => {
    /*
     * The reason the mapping re-reads instead of trusting the code. `P2002` is
     * raised for a violation of any unique constraint on the table, the primary
     * key included, so an id collision would otherwise be reported to a client
     * as "that already exists" - a server fault dressed up as their mistake.
     * Nothing is pushed here, so the key is free and the original error stands.
     */
    const h = harness();
    const error = uniqueViolation();
    const collection = createPrismaCollection(patientSpec, racingPort(h, error), h.scope);

    await expect(collection.create({ ...NEW_PATIENT, mrn: CLASHING_MRN })).rejects.toBe(error);
  });

  it('rethrows an error that is not a unique violation, clash or no clash', async () => {
    // A deadlock, a dropped connection, a check constraint. The re-read must
    // not turn an unrelated failure into a 409 just because the row exists -
    // and a row does exist here, so this is the case that would.
    const h = harness();
    const error = Object.assign(new Error('deadlock detected'), { code: 'P2034' });
    const collection = createPrismaCollection(
      patientSpec,
      racingPort(h, error, () => {
        winner(h);
      }),
      h.scope
    );

    await expect(collection.create({ ...NEW_PATIENT, mrn: CLASHING_MRN })).rejects.toBe(error);
  });

  it('leaves a spec with no natural key alone', async () => {
    /*
     * Nothing has declared a conflict to be a client-facing outcome on such a
     * model, so there is no message to answer with and a unique violation is
     * what it looks like: this server failing. Appointments carry no
     * `uniqueBy`.
     */
    const h = harness();
    expect(appointmentSpec.uniqueBy).toBeUndefined();
    const error = uniqueViolation();
    const failing: DbPort = {
      ...h.port,
      $transaction: <R>(fn: (tx: DbTransaction) => Promise<R>): Promise<R> =>
        h.port.$transaction((tx) =>
          fn({
            ...tx,
            model<M extends PrismaModelName>(name: M) {
              const delegate = tx.model(name);
              if (name !== 'Appointment') return delegate;
              return { ...delegate, create: () => Promise.reject(error) };
            },
          })
        ),
    };
    const collection = createPrismaCollection(appointmentSpec, failing, h.scope);

    await expect(
      collection.create({
        patientId: testId(1),
        facilityId: DEMO_FACILITY_A,
        providerId: testId(900),
        typeCode: 'FOLLOWUP',
        typeDisplay: 'Follow-up',
        durationMinutes: 15,
        start: FIXED_NOW,
        end: new Date(FIXED_NOW.getTime() + 900_000),
      })
    ).rejects.toBe(error);
  });
});
