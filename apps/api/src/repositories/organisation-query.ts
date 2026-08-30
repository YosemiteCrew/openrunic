import type { BaseQuery, Page } from './collection.js';
import type { DbPort } from './db-port.js';
import type { MemoryDataset } from './memory.js';
import type { RequestScope } from './registry.js';
import type { Row } from './rows.js';

/**
 * The tenant's own organisation, read-only, and never anyone else's.
 *
 * `Organisation` is the one model in the schema that carries no `tenantId`,
 * because it *is* the tenant: its `id` is what every other row's `tenantId`
 * points at. That makes it the one collection a `CollectionSpec` cannot
 * express - a spec deliberately has no way to say "narrow on the primary key
 * instead of the tenant column", and the header of `collection.ts` says so on
 * purpose. So this is hand-written, on the same footing as the audit log,
 * rather than the tenant filter being made configurable for all 45 collections
 * to accommodate the one row that is different.
 *
 * The narrowing is therefore `id === scope.tenantId` and there is no other
 * path in. A search returns a page of one and a read of any other id is a 404,
 * which is the truthful answer: another practice's record does not exist as far
 * as this caller is concerned.
 */
/**
 * The only thing there is to ask about a page of one.
 *
 * It extends `BaseQuery` because the resource module's contract is written in
 * those terms, but `page`, `pageSize`, `sort` and `order` are inert here: the
 * result is one row or none, so there is no second page to ask for and no
 * ordering to choose between. They are accepted rather than refused so a
 * generic client can send its usual paging without getting an error about a
 * parameter that simply has nothing to do.
 */
export interface OrganisationQuery extends BaseQuery {
  /** Case-insensitive substring, as the FHIR `name` search parameter sends it. */
  name?: string;
}

export interface OrganisationQueryRepository {
  /** The caller's own organisation, as a page of one. */
  list(query: OrganisationQuery): Promise<Page<Row<'Organisation'>>>;
  /** The organisation by id, or null for anything but the caller's own. */
  findById(id: string): Promise<Row<'Organisation'> | null>;
}

/**
 * The name filter, applied to the single row rather than in the query.
 *
 * There is one candidate, so the difference between filtering in Postgres and
 * filtering here is nil, and doing it in one place keeps the two ports from
 * disagreeing about what `contains` means for case.
 */
function named(
  row: Row<'Organisation'> | null,
  query: OrganisationQuery
): Row<'Organisation'> | null {
  if (row === null || query.name === undefined) return row;
  return row.name.toLowerCase().includes(query.name.toLowerCase()) ? row : null;
}

const ONE = { page: 1, pageSize: 1 } as const;

function pageOfOne(row: Row<'Organisation'> | null): Page<Row<'Organisation'>> {
  return row === null ? { rows: [], total: 0, ...ONE } : { rows: [row], total: 1, ...ONE };
}

export function createMemoryOrganisationQuery(
  dataset: MemoryDataset,
  scope: RequestScope
): OrganisationQueryRepository {
  const own = (): Row<'Organisation'> | null =>
    (dataset.table('Organisation') as unknown as Row<'Organisation'>[]).find(
      (row) => row.id === scope.tenantId
    ) ?? null;

  return {
    list: (query: OrganisationQuery): Promise<Page<Row<'Organisation'>>> =>
      Promise.resolve(pageOfOne(named(own(), query))),
    findById: (id: string): Promise<Row<'Organisation'> | null> =>
      Promise.resolve(id === scope.tenantId ? own() : null),
  };
}

export function createPrismaOrganisationQuery(
  port: DbPort,
  scope: RequestScope
): OrganisationQueryRepository {
  // `findFirst` with the id spelled out rather than `findUnique`, so the
  // narrowing is in the query the database sees rather than in a branch this
  // module took first. A read of another tenant's id finds nothing because the
  // query asked for nothing else, not because a guard remembered to run.
  const delegate = port.model('Organisation');
  const own = async (): Promise<Row<'Organisation'> | null> => {
    const record = await delegate.findFirst({ where: { id: scope.tenantId } });
    return record;
  };

  return {
    async list(query: OrganisationQuery): Promise<Page<Row<'Organisation'>>> {
      return pageOfOne(named(await own(), query));
    },
    async findById(id: string): Promise<Row<'Organisation'> | null> {
      return id === scope.tenantId ? own() : null;
    },
  };
}
