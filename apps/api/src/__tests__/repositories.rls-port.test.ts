import type { Prisma, PrismaClient } from '@openrunic/database';
import { describe, expect, it } from 'vitest';

import type { DbPort, DbTransaction, ModelDelegate } from '../repositories/db-port.js';
import type { PrismaModelName } from '../repositories/rows.js';
import {
  createRlsDbPortFactory,
  createSessionBoundPortFactory,
  tenantTransactionSatisfiesPort,
  type TenantSessionRunner,
} from '../repositories/rls-port.js';

import { DEMO_TENANT_A, makePatientRow, testId } from './support.js';

/**
 * The RLS port, driven by a recording session runner.
 *
 * What is under test is a claim, not a behaviour: that no method on the port
 * can reach Postgres outside a transaction that has declared its tenant. The
 * runner below stands in for `withTenantSession`, so every call that would have
 * opened a session is recorded.
 *
 * The sweep is driven by the delegate's own keys rather than by a hand-written
 * list, so a method added to `ModelDelegate` is exercised the moment it exists.
 * Forget the session wrapper on it and the session count no longer matches the
 * number of keys, and this file fails.
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

/** Every operation a model delegate carries, as data. */
const OPERATIONS = ['findMany', 'count', 'findFirst', 'create', 'updateMany'] as const;

/** The delegate as a callable map, for sweeps that must not name methods. */
type AnyDelegate = Record<string, (args: unknown) => Promise<unknown>>;

function asMap(delegate: ModelDelegate<PrismaModelName>): AnyDelegate {
  return delegate as unknown as AnyDelegate;
}

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
    model: <M extends PrismaModelName>(name: M) => ({
      findMany: () => note(name, 'findMany')([makePatientRow({ id: testId(1) })]),
      count: () => note(name, 'count')(1),
      findFirst: () => note(name, 'findFirst')(makePatientRow({ id: testId(1) })),
      create: () => note(name, 'create')(makePatientRow({ id: testId(2) })),
      updateMany: () => note(name, 'updateMany')({ count: 1 }),
    }),
    auditEvent: {
      create: () => note('AuditEvent', 'create')({ id: testId(5) }),
      findFirst: () => note('AuditEvent', 'findFirst')({ seq: 1n, hash: 'f'.repeat(64) }),
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

describe('the RLS-bound port', () => {
  it('opens a declared session for every operation on a model delegate', async () => {
    const { runner, sessions, calls } = recorder();
    const port = createSessionBoundPortFactory(runner)(DEMO_TENANT_A);
    const delegate = asMap(port.model('Patient'));

    for (const operation of OPERATIONS) {
      await delegate[operation]?.({});
    }

    // One session per call, all of them naming the request's organisation.
    expect(sessions).toHaveLength(OPERATIONS.length);
    expect(new Set(sessions)).toEqual(new Set([DEMO_TENANT_A]));
    expect(calls).toEqual(OPERATIONS.map((operation) => ({ model: 'Patient', operation })));
  });

  it('wraps every key the delegate exposes, so a new method cannot slip past', async () => {
    const { runner, sessions } = recorder();
    const port = createSessionBoundPortFactory(runner)(DEMO_TENANT_A);
    const delegate = asMap(port.model('Appointment'));
    const keys = Object.keys(delegate);

    // The delegate's own shape drives this, not a list that can drift from it.
    expect(new Set(keys)).toEqual(new Set(OPERATIONS));

    for (const key of keys) {
      await delegate[key]?.({});
    }

    // Every key opened exactly one session. An unwrapped method would call
    // straight through and leave the count short.
    expect(sessions).toHaveLength(keys.length);
  });

  it('opens a declared session for the audit delegate too', async () => {
    const { runner, sessions, calls } = recorder();
    const port = createSessionBoundPortFactory(runner)(DEMO_TENANT_A);

    await port.auditEvent.create(AUDIT_CREATE);
    await port.auditEvent.findFirst({});

    // The audit log is where a bypass would matter most: an event written
    // outside the session is an event written with no tenant policy over it.
    expect(sessions).toEqual([DEMO_TENANT_A, DEMO_TENANT_A]);
    expect(calls.map((entry) => entry.operation)).toEqual(['create', 'findFirst']);
  });

  it('reaches the same delegate shape through a transaction as through the port', async () => {
    const { runner } = recorder();
    const port = createSessionBoundPortFactory(runner)(DEMO_TENANT_A);

    const throughPort = Object.keys(asMap(port.model('Patient'))).sort();
    const throughTx = await port.$transaction((tx) =>
      Promise.resolve(Object.keys(asMap(tx.model('Patient'))).sort())
    );

    // Identical on purpose: a repository written against one works against the
    // other, which is what lets `prisma.ts` take either without knowing which.
    expect(throughPort).toEqual(throughTx);
  });

  it('runs an explicit transaction inside one declared session', async () => {
    const { runner, sessions, calls } = recorder();
    const port = createSessionBoundPortFactory(runner)(DEMO_TENANT_A);

    const result = await port.$transaction(async (tx) => {
      await tx.model('Patient').create(PATIENT_CREATE);
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

    await factory('tenant-one').model('Patient').findMany({});
    await factory('tenant-two').model('Patient').findMany({});

    expect(sessions).toEqual(['tenant-one', 'tenant-two']);
  });

  it('builds a port from a PrismaClient without touching it', () => {
    // Constructing the port must not connect, query or extend: the registry
    // calls the factory once per request, long before a handler asks for
    // anything.
    const port: DbPort = createRlsDbPortFactory({} as unknown as PrismaClient)(DEMO_TENANT_A);

    expect(typeof port.$transaction).toBe('function');
    expect(typeof port.model('Patient').findMany).toBe('function');
    expect(tenantTransactionSatisfiesPort).toBe(true);
  });
});
