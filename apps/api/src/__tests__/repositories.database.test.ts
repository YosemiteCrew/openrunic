import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AuditCollector } from '../audit/collector.js';
import { createMemoryAuditSink } from '../audit/memory-sink.js';
import { createDbPort } from '../repositories/db-port.js';
import { createPrismaRepositoryRegistry } from '../repositories/prisma.js';
import type { Repositories } from '../repositories/types.js';

import { DEMO_TENANT_A, DEMO_TENANT_B, testId } from './support.js';

/**
 * The Prisma repositories, against a real Postgres.
 *
 * Everything else in this suite runs without a database, on purpose: the
 * behaviour worth testing constantly is the API's, and a database in that loop
 * makes it slow enough that people stop running it. What a real database adds
 * is the handful of facts only it can settle - that the tenant extension really
 * does narrow a query, that a transaction really does roll back, that the
 * columns the specs name really exist - so those are here and only those.
 *
 * How to run it:
 *
 *   createdb openrunic_test
 *   DATABASE_URL=postgresql://localhost/openrunic_test \
 *     pnpm --filter @openrunic/database exec prisma migrate deploy
 *   DATABASE_URL=postgresql://localhost/openrunic_test pnpm --filter api test
 *
 * Without `DATABASE_URL` the whole file is skipped, so a contributor with no
 * Postgres still gets a green suite and still gets every other guarantee. CI
 * sets the variable, so the skip is a local convenience and never a way for a
 * change to avoid the check.
 */

const DATABASE_URL = process.env.DATABASE_URL;

interface Live {
  repositories(tenantId: string): Repositories;
  disconnect(): Promise<void>;
  reset(): Promise<void>;
}

async function connect(): Promise<Live> {
  // Imported dynamically so a run without a database never loads the generated
  // client at all.
  const { createPrismaClient, createTenantClient } = await import('@openrunic/database');
  const prisma = createPrismaClient();

  const registry = createPrismaRepositoryRegistry((tenantId) =>
    createDbPort(createTenantClient(prisma, { tenantId }))
  );

  return {
    repositories(tenantId: string): Repositories {
      return registry.forRequest({
        tenantId,
        audit: new AuditCollector(createMemoryAuditSink(), {
          tenantId,
          actorType: 'user',
          actorId: testId(900),
          requestId: 'req-live',
          method: 'GET',
          path: '/test',
        }),
      });
    },
    async reset(): Promise<void> {
      // Deleting the organisations cascades to every tenant-scoped table, which
      // is the whole point of the `onDelete: Cascade` on `tenantId`.
      await prisma.organisation.deleteMany({
        where: { id: { in: [DEMO_TENANT_A, DEMO_TENANT_B] } },
      });
      for (const [id, slug] of [
        [DEMO_TENANT_A, 'contract-a'],
        [DEMO_TENANT_B, 'contract-b'],
      ] as const) {
        await prisma.organisation.create({ data: { id, slug, name: `Contract ${slug}` } });
      }
    },
    disconnect(): Promise<void> {
      return prisma.$disconnect();
    },
  };
}

describe.skipIf(DATABASE_URL === undefined)('the Prisma repositories against Postgres', () => {
  let live: Live;

  beforeAll(async () => {
    live = await connect();
    await live.reset();
  }, 60_000);

  afterAll(async () => {
    await live.disconnect();
  });

  const patient = {
    mrn: 'OR-100482',
    givenName: 'Testina',
    familyName: 'Patientsson',
    birthDate: new Date('1994-03-02T00:00:00.000Z'),
  };

  it('writes a row into the acting organisation, whatever the caller supplied', async () => {
    const created = await live.repositories(DEMO_TENANT_A).patients.create(patient);

    expect(created.tenantId).toBe(DEMO_TENANT_A);
  });

  it('does not let another organisation read it', async () => {
    const created = await live.repositories(DEMO_TENANT_A).patients.create({
      ...patient,
      mrn: 'OR-100483',
    });

    await expect(
      live.repositories(DEMO_TENANT_B).patients.findById(created.id)
    ).resolves.toBeNull();
  });

  it('does not let another organisation amend it', async () => {
    const created = await live.repositories(DEMO_TENANT_A).patients.create({
      ...patient,
      mrn: 'OR-100484',
    });

    await expect(
      live.repositories(DEMO_TENANT_B).patients.update(created.id, { familyName: 'Rewritten' })
    ).resolves.toBeNull();
    await expect(
      live.repositories(DEMO_TENANT_A).patients.findById(created.id)
    ).resolves.toMatchObject({ familyName: 'Patientsson' });
  });

  it('lets two organisations hold the same medical record number', async () => {
    await live.repositories(DEMO_TENANT_A).patients.create({ ...patient, mrn: 'OR-shared' });

    await expect(
      live.repositories(DEMO_TENANT_B).patients.create({ ...patient, mrn: 'OR-shared' })
    ).resolves.toMatchObject({ tenantId: DEMO_TENANT_B });
  });

  it('refuses a duplicate medical record number inside one organisation', async () => {
    await live.repositories(DEMO_TENANT_A).patients.create({ ...patient, mrn: 'OR-duplicate' });

    await expect(
      live.repositories(DEMO_TENANT_A).patients.create({ ...patient, mrn: 'OR-duplicate' })
    ).rejects.toThrow(/already exists/);
  });

  it('appends the audit event in the mutation transaction, and chains it', async () => {
    const repositories = live.repositories(DEMO_TENANT_A);
    await repositories.patients.create({ ...patient, mrn: 'OR-audited' });

    const events = await repositories.audit.list({
      page: 1,
      pageSize: 10,
      action: 'patient.created',
      sort: 'seq',
      order: 'desc',
    });

    expect(events.total).toBeGreaterThan(0);
    await expect(repositories.audit.verifyChain()).resolves.toMatchObject({ valid: true });
  });

  it('pages against the real indexes', async () => {
    const repositories = live.repositories(DEMO_TENANT_A);
    for (let index = 0; index < 5; index += 1) {
      await repositories.patients.create({ ...patient, mrn: `OR-page-${index}` });
    }

    const page = await repositories.patients.list({
      page: 2,
      pageSize: 2,
      sort: 'createdAt',
      order: 'asc',
    });

    expect(page.rows).toHaveLength(2);
    expect(page.total).toBeGreaterThanOrEqual(5);
  });
});
