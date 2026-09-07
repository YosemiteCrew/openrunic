import {
  AUDIT_CHAINED_FIELDS,
  verifyAuditChain,
  withTenantSession,
  type PrismaClient,
} from '@openrunic/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AuditCollector } from '../audit/collector.js';
import type { AuditEvent, AuditSink } from '../audit/types.js';
import type { RepositoryRegistry } from '../repositories/types.js';
import { AUDIT_CHAIN_LOCK_CLASS } from '../repositories/db-port.js';
import { buildServerWiring } from '../server/wiring.js';

/**
 * The audit hash chain under concurrency, against a real Postgres. #399.
 *
 * This file exists because no other suite can fail the way #399 failed. The
 * HTTP suites run the memory port, which has neither the
 * `@@unique([tenantId, seq])` constraint nor a transaction, so every appender
 * wins; `repositories.database.test.ts` reaches a real database but hands the
 * repositories the memory audit sink, so the Prisma sink's own chain read never
 * runs. 4004 tests passed over a defect that made the clinician chart fail to
 * load at all: two concurrent reads in one tenant answered 500 about half the
 * time, and four concurrent registrations kept five patient rows out of twenty.
 *
 * So the wiring under test is the PRODUCTION wiring - `buildServerWiring`, the
 * same function `index.ts` calls - rather than a local reconstruction of it. A
 * reconstruction here would be testing this file's idea of how the sink is
 * assembled, and the defect was in the assembly.
 *
 * How to run it:
 *
 *   createdb openrunic_test
 *   DATABASE_URL=postgresql://localhost/openrunic_test \
 *     pnpm --filter @openrunic/database exec prisma migrate deploy
 *   DATABASE_URL=postgresql://localhost/openrunic_test pnpm --filter api test
 *
 * Without `DATABASE_URL` the file is skipped, exactly like the other two
 * database suites. CI sets the variable.
 */

const DATABASE_URL = process.env.DATABASE_URL;

/**
 * Its own organisations, not the ones `repositories.database.test.ts` uses.
 *
 * That file's `reset` deletes its tenants and recreates them, and vitest runs
 * files in parallel. Sharing an id would make the two suites delete each
 * other's rows mid-run, which fails as a flake and reads as a chain defect.
 */
const TENANT = '019f9900-0000-7000-8000-000000000399';
const OTHER_TENANT = '019f9900-0000-7000-8000-00000000039a';

/**
 * Eight, which is two more than the width the browser reproduced the defect at.
 * The measured failure rate at width 2 was about half, so eight appenders make
 * an unserialised chain fail this test essentially every run rather than
 * intermittently - a concurrency test that only usually fails is not a gate.
 */
const APPENDERS = 8;

function event(action: string, targetId: string): AuditEvent {
  return {
    actorType: 'user',
    actorId: '019f9900-0000-7000-8000-0000000000c1',
    action,
    targetType: 'Patient',
    targetId,
    outcome: 'success',
    metadata: {},
  };
}

interface Live {
  sink: AuditSink;
  repositories: RepositoryRegistry;
  client: PrismaClient;
  reset(): Promise<void>;
  close(): Promise<void>;
}

async function connect(): Promise<Live> {
  // Dynamic, so a run without a database never loads the generated client.
  const { createPrismaClient } = await import('@openrunic/database');
  const client = createPrismaClient();
  const wiring = buildServerWiring(
    { DATABASE_URL: DATABASE_URL ?? '', OPENRUNIC_AUTH_MODE: 'demo-tokens' },
    client
  );

  return {
    sink: wiring.auditSink,
    repositories: wiring.repositories,
    client,
    async reset(): Promise<void> {
      // Cascades to AuditEvent through the `onDelete: Cascade` on `tenantId`,
      // so each run starts from an empty chain and `seq` starts at 1 again.
      await client.organisation.deleteMany({ where: { id: { in: [TENANT, OTHER_TENANT] } } });
      for (const [id, slug] of [
        [TENANT, 'chain-399'],
        [OTHER_TENANT, 'chain-399-other'],
      ] as const) {
        await client.organisation.create({ data: { id, slug, name: `Chain ${slug}` } });
      }
    },
    close: () => wiring.close(),
  };
}

/**
 * The columns the verifier needs, derived from the package's own list rather
 * than typed out here.
 *
 * Written by hand first, and it cost a red run that looked exactly like a
 * defect: the select omitted `patientId`, which every mutation event carries
 * and every hash covers, so `verifyAuditChain` reported the chain broken at the
 * first registration row. The chain was intact; the instrument was short a
 * column. A hand-copied list of hashed fields can only ever drift in that
 * direction - silently, and toward a false accusation - so it is derived.
 */
const CHAIN_SELECT = Object.fromEntries(
  [...AUDIT_CHAINED_FIELDS, 'prevHash', 'hash'].map((field) => [field, true])
);

/** The tenant's chain, in order, read inside a declared session like any other query. */
async function chainOf(
  client: PrismaClient,
  tenantId: string
): Promise<{ seq: bigint; prevHash: string; hash: string }[]> {
  // `CHAIN_SELECT` is built at runtime, so Prisma cannot infer which columns
  // come back and types the rows as empty; the cast on the result is what
  // restores what the select actually asked for. Derived-and-cast is still the
  // right trade against a hand-written literal, which type-checks perfectly and
  // can silently omit a hashed column - which is exactly what it did.
  const rows = await withTenantSession(client, { tenantId }, (tx) =>
    tx.auditEvent.findMany({ where: { tenantId }, orderBy: { seq: 'asc' }, select: CHAIN_SELECT })
  );
  return rows as unknown as { seq: bigint; prevHash: string; hash: string }[];
}

describe.skipIf(DATABASE_URL === undefined)('the audit chain under concurrency', () => {
  let live: Live;

  beforeAll(async () => {
    live = await connect();
    await live.reset();
  }, 60_000);

  afterAll(async () => {
    await live.close();
  });

  /**
   * The acceptance criterion from #399, at the door that failed: a read batch
   * is flushed through the standalone path, and the `chart.access` decision the
   * policy middleware records goes through the same one inside the request.
   */
  it('answers every concurrent read-batch append for one tenant', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: APPENDERS }, (_, i) =>
        live.sink.recordReadBatch(TENANT, event('phi.read', `read-${i}`))
      )
    );

    expect(results.filter((r) => r.status === 'rejected')).toEqual([]);
  });

  it('answers every concurrent denial append for one tenant', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: APPENDERS }, (_, i) =>
        live.sink.recordWrite(TENANT, event('chart.access.denied', `denied-${i}`))
      )
    );

    expect(results.filter((r) => r.status === 'rejected')).toEqual([]);
  });

  /**
   * The mutation door. A fix sited only where the 500 was measured would leave
   * this one racing: the audit event is written inside the mutation's own
   * transaction, so a lost race rolls the mutation back and the patient is
   * never registered. Four concurrent registrations kept five rows of twenty
   * before the lock existed, so this asserts the ROWS and not only the absence
   * of a rejection - a registration that returns without persisting is the
   * failure worth naming.
   */
  it('persists every concurrent registration in one tenant', async () => {
    const scope = live.repositories.forRequest({
      tenantId: TENANT,
      audit: new AuditCollector(live.sink, {
        tenantId: TENANT,
        actorType: 'user',
        actorId: '019f9900-0000-7000-8000-0000000000c1',
        requestId: 'req-399',
        method: 'POST',
        path: '/bff/v0/patients',
      }),
    });

    const results = await Promise.allSettled(
      Array.from({ length: APPENDERS }, (_, i) =>
        scope.patients.create({
          mrn: `OR-399-${i}`,
          givenName: 'Synthetic',
          familyName: 'Testperson',
          birthDate: new Date('1980-01-01T00:00:00.000Z'),
        })
      )
    );

    expect(results.filter((r) => r.status === 'rejected')).toEqual([]);
    const stored = await withTenantSession(live.client, { tenantId: TENANT }, (tx) =>
      tx.patient.count({ where: { tenantId: TENANT, mrn: { startsWith: 'OR-399-' } } })
    );
    expect(stored).toBe(APPENDERS);
  });

  /**
   * The other half, and the reason the constraint stays exactly where it was.
   * Serialising appends is only worth anything if the chain it produces is
   * still a chain - contiguous `seq`, and every `prevHash` naming the row
   * before it. Verified by the database package's own verifier rather than by
   * this file's idea of the rule.
   */
  it('leaves one contiguous verifiable chain behind', async () => {
    const rows = await chainOf(live.client, TENANT);

    expect(rows.length).toBeGreaterThanOrEqual(APPENDERS * 3);
    expect(rows.map((row) => row.seq)).toEqual(rows.map((_, i) => BigInt(i + 1)));
    expect(verifyAuditChain(rows as never)).toMatchObject({ valid: true });
  });

  /**
   * A second connection holding one tenant's chain lock open.
   *
   * `acquired` resolves only AFTER the lock statement has returned, and the
   * caller must await it. Without that the probe races the holder's own setup:
   * `$transaction` returns as soon as it is called, so the lock may not be
   * taken yet when the probe runs, and the probe then succeeds because nothing
   * was locked. That is not a hypothetical - it is what the first version of
   * this helper did, and only the must-block control below caught it.
   */
  async function holdChainLock(tenantId: string): Promise<{ release: () => Promise<void> }> {
    const { createPrismaClient } = await import('@openrunic/database');
    const holder = createPrismaClient();
    let signalAcquired = (): void => {};
    let signalRelease = (): void => {};
    const acquired = new Promise<void>((resolve) => {
      signalAcquired = resolve;
    });
    const releasedWhen = new Promise<void>((resolve) => {
      signalRelease = resolve;
    });

    // Held well inside Prisma's 5000 ms interactive-transaction timeout, which
    // is the queue's own ceiling and is documented on `lockAuditChain`.
    const held = holder.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${AUDIT_CHAIN_LOCK_CLASS}::int, hashtext(${tenantId}))`;
      signalAcquired();
      await releasedWhen;
    });

    await acquired;
    return {
      release: async (): Promise<void> => {
        signalRelease();
        await held;
        await holder.$disconnect();
      },
    };
  }

  /**
   * Per tenant, and DETERMINISTICALLY so - `@Claude L2 Dunexploration`'s arm,
   * taken into the suite because it closes the one property the concurrency
   * cases structurally cannot reach.
   *
   * Every other case here varies concurrency, and a lock on a constant key
   * answers all of them: a global queue serialises correctly, it just
   * serialises far too much. Independence is not a throughput claim, so it does
   * not need load or a clock to measure. Hold one tenant's lock open on a
   * second connection and ask for a different tenant; per tenant it returns,
   * global it blocks.
   *
   * The failure mode is a BLOCK, not a wrong answer, so a constant key makes
   * this case time out rather than assert. A timeout here is a real red and not
   * a flake - do not raise the timeout to make it pass.
   *
   * One thing this case CANNOT do, measured rather than assumed: it does not
   * fire when the production key derivation is mutated. The helper below
   * derives the key the same way the production code does, so changing the
   * production side makes the two disagree and the probe stops blocking for a
   * reason that has nothing to do with the property. Mutating
   * `hashtext(tenantId)` to a constant leaves this case GREEN and turns the
   * control below RED. The pair catches it; this half alone does not.
   */
  it("does not make one tenant wait on another tenant's lock", async () => {
    const lock = await holdChainLock(TENANT);
    try {
      await live.sink.recordReadBatch(OTHER_TENANT, event('phi.read', 'across-tenants'));
    } finally {
      // In `finally`, so a failed assertion cannot leave the lock held. It was
      // not, once, and the next case then failed at 5005 ms against a holder
      // that was still open - one broken case reading as two.
      await lock.release();
    }

    const other = await chainOf(live.client, OTHER_TENANT);
    expect(other.length).toBeGreaterThan(0);
  });

  /**
   * The control for the case above, and it is what makes it worth anything.
   *
   * A probe that silently failed to take the lock at all - wrong class, wrong
   * connection, a statement that had not run yet - lets the case above pass for
   * entirely the wrong reason and reads as proof of per-tenant-ness. So the
   * SAME tenant is asked for while its lock is held, and it must NOT complete
   * until the holder lets go. This is the case that caught exactly that bug in
   * the helper above.
   */
  it('does make the same tenant wait, which is what proves the lock is held', async () => {
    const lock = await holdChainLock(TENANT);
    const queued = live.sink.recordReadBatch(TENANT, event('phi.read', 'behind-the-lock'));
    const stillWaiting = Symbol('still-waiting');

    try {
      const raced = await Promise.race([
        queued.then(() => 'completed' as const),
        new Promise<typeof stillWaiting>((resolve) => setTimeout(() => resolve(stillWaiting), 750)),
      ]);
      expect(raced).toBe(stillWaiting);
    } finally {
      await lock.release();
    }

    await expect(queued).resolves.toBeUndefined();
  });

  /**
   * The lock is per tenant, not global. A single lock would make every
   * organisation on a deployment queue behind every other one, which is a
   * throughput ceiling nothing asks for - the chain is per tenant, so the
   * serialisation is too.
   */
  it('keeps two tenants on their own chains', async () => {
    // Measured as a DELTA rather than as an absolute count. The independence
    // arm above appends one row to this tenant, so a case asserting
    // `toHaveLength(APPENDERS)` here is asserting the order the file's cases
    // happen to run in - it went red for exactly that reason, which is a
    // coupling and not a defect.
    const before = (await chainOf(live.client, OTHER_TENANT)).length;

    const results = await Promise.allSettled([
      ...Array.from({ length: APPENDERS }, (_, i) =>
        live.sink.recordReadBatch(TENANT, event('phi.read', `both-a-${i}`))
      ),
      ...Array.from({ length: APPENDERS }, (_, i) =>
        live.sink.recordReadBatch(OTHER_TENANT, event('phi.read', `both-b-${i}`))
      ),
    ]);

    expect(results.filter((r) => r.status === 'rejected')).toEqual([]);
    const other = await chainOf(live.client, OTHER_TENANT);
    expect(other.map((row) => row.seq)).toEqual(other.map((_, i) => BigInt(i + 1)));
    expect(other).toHaveLength(before + APPENDERS);
  });
});
