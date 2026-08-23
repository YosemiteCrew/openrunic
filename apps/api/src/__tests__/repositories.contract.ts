import { describe, expect, it } from 'vitest';

import { AuditCollector } from '../audit/collector.js';
import { createMemoryAuditSink } from '../audit/memory-sink.js';
import type { BaseQuery, CollectionSpec } from '../repositories/collection.js';
import type { MemoryDataset } from '../repositories/memory.js';
import type { PrismaModelName, ScopedRow } from '../repositories/rows.js';
import { COLLECTION_SPECS } from '../repositories/specs/index.js';
import type { Repositories, RepositoryRegistry } from '../repositories/types.js';

import { DEMO_TENANT_A, DEMO_TENANT_B, FIXED_NOW, testId } from './support.js';

/**
 * The isolation contract, run against every storage implementation.
 *
 * "Every query is tenant-scoped by construction" is a claim about all
 * twenty-odd repositories, and a claim about all of them is worth exactly as
 * much as the least-tested one. So this suite is generated from the spec map
 * rather than written per aggregate: adding a repository adds its isolation
 * test automatically, and there is no way to ship one that was never asked the
 * question.
 *
 * The rows it seeds carry only the storage columns. That is deliberate and it
 * is sufficient: isolation depends on `tenantId` alone, so a fixture that also
 * had to satisfy each model's column list would couple this suite to forty
 * schemas without testing anything more.
 */

/** A spec with its parameters erased, which is all a generic walk can hold. */
type ErasedSpec = CollectionSpec<PrismaModelName, unknown, unknown, BaseQuery>;

/** A repository with its parameters erased, reached by key off the registry. */
interface ErasedCollection {
  list(query: BaseQuery): Promise<{ rows: unknown[]; total: number }>;
  findById(id: string): Promise<unknown>;
  findByIds(ids: readonly string[]): Promise<unknown[]>;
  update(id: string, patch: unknown): Promise<unknown>;
}

export const SPEC_ENTRIES: readonly (readonly [string, ErasedSpec])[] = Object.entries(
  COLLECTION_SPECS
) as unknown as readonly (readonly [string, ErasedSpec])[];

const BASE_QUERY: BaseQuery = { page: 1, pageSize: 25, sort: 'createdAt', order: 'asc' };

function collectionOf(repositories: Repositories, key: string): ErasedCollection {
  return (repositories as unknown as Record<string, ErasedCollection>)[key] as ErasedCollection;
}

/** A row that exists, belongs to `tenantId`, and asserts nothing else. */
function bareRow(model: PrismaModelName, id: string, tenantId: string): ScopedRow<PrismaModelName> {
  return { id, tenantId, createdAt: FIXED_NOW, updatedAt: FIXED_NOW };
}

export interface IsolationSubject {
  name: string;
  dataset: MemoryDataset;
  registry: RepositoryRegistry;
}

function scopedRepositories(registry: RepositoryRegistry, tenantId: string): Repositories {
  return registry.forRequest({
    tenantId,
    audit: new AuditCollector(createMemoryAuditSink(), {
      tenantId,
      actorType: 'user',
      actorId: testId(900),
      requestId: 'req-isolation',
      method: 'GET',
      path: '/test',
    }),
  });
}

/**
 * Asserts, for every repository in the registry, that a row belonging to
 * another organisation is unreachable in every direction the interface offers.
 */
export function runIsolationContract(subject: () => IsolationSubject): void {
  describe.each(SPEC_ENTRIES.map(([key, spec]) => [key, spec.model] as const))(
    '%s',
    (key, model) => {
      it("does not list another organisation's rows", async () => {
        const { dataset, registry } = subject();
        dataset.table(model).push(bareRow(model, testId(1), DEMO_TENANT_B));

        const page = await collectionOf(scopedRepositories(registry, DEMO_TENANT_A), key).list(
          BASE_QUERY
        );

        expect(page.total).toBe(0);
        expect(page.rows).toEqual([]);
      });

      it("reads another organisation's row as absent, not as forbidden", async () => {
        const { dataset, registry } = subject();
        dataset.table(model).push(bareRow(model, testId(1), DEMO_TENANT_B));

        const repositories = scopedRepositories(registry, DEMO_TENANT_A);

        await expect(collectionOf(repositories, key).findById(testId(1))).resolves.toBeNull();
      });

      it("cannot amend another organisation's row", async () => {
        const { dataset, registry } = subject();
        dataset.table(model).push(bareRow(model, testId(1), DEMO_TENANT_B));

        const repositories = scopedRepositories(registry, DEMO_TENANT_A);

        await expect(collectionOf(repositories, key).update(testId(1), {})).resolves.toBeNull();
        // The row is not merely unreported: it is untouched.
        expect(dataset.table(model)[0]?.updatedAt).toEqual(FIXED_NOW);
      });

      it('reaches its own row', async () => {
        const { dataset, registry } = subject();
        dataset.table(model).push(bareRow(model, testId(1), DEMO_TENANT_A));

        const repositories = scopedRepositories(registry, DEMO_TENANT_A);

        await expect(collectionOf(repositories, key).findById(testId(1))).resolves.toMatchObject({
          id: testId(1),
        });
      });

      /**
       * The set read has to narrow exactly as the single read does. A batched
       * query is the classic place for a scope check to be skipped, because the
       * filter that used to name one row now names many and it is easy to build
       * the second without the first's guards.
       *
       * So these are the same three questions the single-id path is asked
       * above, put to `findByIds` with the same fixtures.
       */
      it("does not reach another organisation's row by id set", async () => {
        const { dataset, registry } = subject();
        dataset.table(model).push(bareRow(model, testId(1), DEMO_TENANT_B));

        const repositories = scopedRepositories(registry, DEMO_TENANT_A);

        await expect(collectionOf(repositories, key).findByIds([testId(1)])).resolves.toEqual([]);
      });

      it('reaches its own row by id set, and agrees with the single read', async () => {
        const { dataset, registry } = subject();
        dataset.table(model).push(bareRow(model, testId(1), DEMO_TENANT_A));

        const repositories = scopedRepositories(registry, DEMO_TENANT_A);
        const one = await collectionOf(repositories, key).findById(testId(1));
        const many = await collectionOf(repositories, key).findByIds([testId(1)]);

        expect(many).toHaveLength(1);
        expect(many[0]).toEqual(one);
      });

      it('mixes its own and another organisation, and returns only its own', async () => {
        const { dataset, registry } = subject();
        dataset.table(model).push(bareRow(model, testId(1), DEMO_TENANT_A));
        dataset.table(model).push(bareRow(model, testId(2), DEMO_TENANT_B));

        const repositories = scopedRepositories(registry, DEMO_TENANT_A);

        // The interesting shape: one id the caller may see and one it may not,
        // in a single call. A set read that ANDed the tenant only when the set
        // was homogeneous would pass every test above and fail this one.
        await expect(
          collectionOf(repositories, key).findByIds([testId(1), testId(2)])
        ).resolves.toMatchObject([{ id: testId(1) }]);
      });

      it('asks nothing at all for an empty id set', async () => {
        const { dataset, registry } = subject();
        dataset.table(model).push(bareRow(model, testId(1), DEMO_TENANT_A));

        const repositories = scopedRepositories(registry, DEMO_TENANT_A);

        await expect(collectionOf(repositories, key).findByIds([])).resolves.toEqual([]);
      });
    }
  );
}
