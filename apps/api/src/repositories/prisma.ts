import { uuidv7 } from '@openrunic/database';

import { ApiError } from '../errors.js';

import { createPrismaAuditQuery } from './audit-query.js';
import { createPrismaOrganisationQuery } from './organisation-query.js';
import {
  type BaseQuery,
  type ChildBatch,
  type Collection,
  type CollectionSpec,
  type Page,
  type RowContext,
} from './collection.js';
import type { DbPort, DbTransaction } from './db-port.js';
import { buildRepositories, type RequestScope } from './registry.js';
import {
  toPlainRow,
  type CreateArgs,
  type FindFirstArgs,
  type PrismaModelName,
  type ScopedRow,
} from './rows.js';
import type { Repositories, RepositoryRegistry } from './types.js';

/**
 * The Prisma-backed repositories.
 *
 * Everything here goes through {@link DbPort}, the narrow port the tenant-scoped
 * client satisfies. Two consequences: this file never sees an unscoped client,
 * and the suite can drive it with a fake port, so the where-clause construction
 * and the row mapping are proved rather than assumed.
 *
 * Mutations run inside `$transaction` with their audit event, which is what
 * makes "audited in the same transaction as the mutation" a property of the
 * code rather than a convention.
 */

/**
 * Opens a tenant-scoped port. In production this is
 * `(tenantId) => createDbPort(createTenantClient(prisma, { tenantId }))`; the
 * indirection is what lets the tests supply a fake without this module
 * importing Prisma's runtime.
 */
export type DbPortFactory = (tenantId: string) => DbPort;

export function createPrismaRepositoryRegistry(connect: DbPortFactory): RepositoryRegistry {
  return {
    forRequest(scope: RequestScope): Repositories {
      const port = connect(scope.tenantId);
      return buildRepositories(
        scope,
        (spec) => createPrismaCollection(spec, port, scope),
        createPrismaAuditQuery(port, scope),
        createPrismaOrganisationQuery(port, scope)
      );
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
 * at the call site.
 */
const TENANT_STAMPED_BY_CLIENT = '';

/**
 * An identity filter written the long way, on purpose.
 *
 * `{ id }` is shorthand for `{ id: { equals: id } }` only while `id` is a
 * scalar. Hand Prisma an object there and it reads the keys as filter
 * operators, so a value that reached this layer as `{ not: '' }` would select
 * every row rather than none - the ORM equivalent of operator injection. Every
 * route already parses the parameter with `z.uuid()`, so this cannot happen
 * today; spelling the operator out means it stays impossible if a future caller
 * arrives from somewhere other than a route.
 */
const byId = (id: string): Record<string, unknown> => ({ id: { equals: id } });

/**
 * The same rule for a set. Deduplicated because the caller's list is theirs and
 * a repeated id would otherwise widen the `IN` for no reason.
 */
const byIds = (ids: readonly string[]): Record<string, unknown> => ({
  id: { in: [...new Set(ids)] },
});

export function createPrismaCollection<
  M extends PrismaModelName,
  TCreate,
  TPatch,
  TQuery extends BaseQuery,
>(
  spec: CollectionSpec<M, TCreate, TPatch, TQuery>,
  port: DbPort,
  scope: RequestScope
): Collection<ScopedRow<M>, TCreate, TPatch, TQuery> {
  const { audit } = scope;
  const compartment = scope.compartmentPatientId;
  /**
   * A compartment-restricted principal reading a model with no chart column is
   * refused wholesale rather than served the table, and it is refused here
   * rather than by an unsatisfiable filter: a query that cannot return a row
   * should not be sent to Postgres at all.
   */
  const closed = compartment !== undefined && spec.compartment === 'closed';

  /**
   * The caller's facility narrowing, or null when there is none to apply.
   *
   * Null covers three cases that all mean "do not filter": the spec did not opt
   * in, the principal holds `facility.all` so `scope.facilityIds` is undefined,
   * or the spec has no column to filter on.
   */
  const facilityClause = (): Record<string, unknown> | null => {
    if (spec.facilityScoped !== true) return null;
    if (scope.facilityIds === undefined) return null;
    const column = spec.facilityColumn;
    if (column === undefined) return null;
    // Null stays visible: on several tables it means the row is not sited at
    // all, and hiding those from everyone fails in the direction that looks
    // like an empty result rather than like a refusal.
    return { OR: [{ [column]: { in: [...scope.facilityIds] } }, { [column]: null }] };
  };

  /**
   * A list is always narrowed; a row addressed by id only when the scope says to
   * hide it. See `RequestScope.hideFacilityRows` for why the two differ - the
   * short version is that a list names no facility, so there is nothing for a
   * route to refuse and nothing but the narrowing standing between a
   * facility-limited caller and the rest of the tenant.
   */
  const hideAddressed = scope.hideFacilityRows === true;

  const scoped = (
    where: Record<string, unknown> | undefined,
    narrowFacility: boolean
  ): Record<string, unknown> => {
    const facility = narrowFacility ? facilityClause() : null;
    const compartmented =
      compartment === undefined || spec.compartment === 'open' || spec.compartment === 'closed'
        ? (where ?? {})
        : {
            // ANDed rather than merged, so a filter the caller supplied on the
            // same column cannot widen the compartment: the outer AND still has
            // to hold.
            AND: [
              where ?? {},
              {
                [spec.model === 'Patient' ? 'id' : spec.compartment.column]: {
                  equals: compartment,
                },
              },
            ],
          };
    // Same reasoning again one level out: the facility narrowing is ANDed on
    // top, so nothing a caller sends can widen it either.
    return facility === null ? compartmented : { AND: [compartmented, facility] };
  };

  const delegate = port.model(spec.model);

  const recordRead = (row: ScopedRow<M>): void => {
    audit.read({ targetType: spec.targetType, targetId: row.id, ...patientOf(spec, row) });
  };

  const writeEvent = (
    row: ScopedRow<M>,
    before: ScopedRow<M> | null,
    fields: readonly string[]
  ): Parameters<RequestScope['audit']['write']>[0] => ({
    action: `${spec.action}.${before === null ? 'created' : 'updated'}`,
    targetType: spec.targetType,
    targetId: row.id,
    ...patientOf(spec, row),
    ...facilityOf(spec, row),
    ...encounterOf(spec, row),
    metadata: { fields: [...fields], ...spec.writeMetadata?.(row, before) },
  });

  return {
    async list(query: TQuery): Promise<Page<ScopedRow<M>>> {
      if (closed) return { rows: [], total: 0, page: query.page, pageSize: query.pageSize };

      const where = scoped(spec.where(query), true);
      const [records, total] = await Promise.all([
        delegate.findMany({
          where,
          orderBy: spec.orderBy(query),
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        delegate.count({ where }),
      ]);
      const rows = records.map((record) => toPlainRow<M>(record) as ScopedRow<M>);
      rows.forEach(recordRead);
      return { rows, total, page: query.page, pageSize: query.pageSize };
    },

    async findById(id: string): Promise<ScopedRow<M> | null> {
      if (closed) return null;
      const record = await delegate.findFirst({ where: scoped(byId(id), hideAddressed) });
      if (record === null) return null;
      const row = toPlainRow<M>(record) as ScopedRow<M>;
      recordRead(row);
      return row;
    },

    async findByIds(ids: readonly string[]): Promise<ScopedRow<M>[]> {
      // Both guards come first and in this order, so a compartment-refused
      // caller and an empty set each cost no query at all.
      if (closed) return [];
      if (ids.length === 0) return [];
      const records = await delegate.findMany({
        where: scoped(byIds(ids), hideAddressed),
      });
      const rows = records.map((record) => toPlainRow<M>(record) as ScopedRow<M>);
      rows.forEach(recordRead);
      return rows;
    },

    create(input: TCreate): Promise<ScopedRow<M>> {
      return port.$transaction(async (tx) => {
        const unique = spec.uniqueBy;
        if (unique !== undefined) {
          // `NoInfer` keeps the spec's `where` from re-deriving the model, so
          // its result reads back as the union of every model's filter. It is
          // this model's filter; the assertion says so.
          const clash = await tx.model(spec.model).findFirst({
            where: unique.where(input),
          } as FindFirstArgs<M>);
          if (clash !== null) throw ApiError.conflict(unique.message(input));
        }

        const now = new Date();
        const context: RowContext = { tenantId: scope.tenantId, now, nextId: uuidv7 };
        const columns = spec.newRow(input, context);
        const record = await tx.model(spec.model).create({
          data: {
            ...omitNulls(columns),
            id: uuidv7(),
            tenantId: TENANT_STAMPED_BY_CLIENT,
          },
        } as CreateArgs<M>);
        const row = toPlainRow<M>(record) as ScopedRow<M>;

        for (const batch of spec.childRows?.(input, row, context) ?? []) {
          await writeChildren(tx, batch);
        }

        await audit.write(writeEvent(row, null, Object.keys(columns)), tx);
        return row;
      });
    },

    update(id: string, patch: TPatch): Promise<ScopedRow<M> | null> {
      return port.$transaction(async (tx) => {
        if (closed) return null;
        const scopedDelegate = tx.model(spec.model);
        const existing = await scopedDelegate.findFirst({
          where: scoped(byId(id), hideAddressed),
        });
        if (existing === null) return null;

        const before = toPlainRow<M>(existing) as ScopedRow<M>;
        const data = spec.patchData(patch, before, {
          tenantId: scope.tenantId,
          now: new Date(),
          nextId: uuidv7,
        });
        const result = await scopedDelegate.updateMany({
          where: scoped(byId(id), hideAddressed),
          data,
        });
        if (result.count === 0) return null;

        // Re-read rather than trust the patch: defaults, triggers and the
        // `updatedAt` column are the database's to decide.
        const record = await scopedDelegate.findFirst({
          where: scoped(byId(id), hideAddressed),
        });
        if (record === null) return null;
        const row = toPlainRow<M>(record) as ScopedRow<M>;

        await audit.write(writeEvent(row, before, Object.keys(data)), tx);
        return row;
      });
    },
  };
}

async function writeChildren(tx: DbTransaction, batch: ChildBatch): Promise<void> {
  for (const child of batch.rows) {
    await tx.model(batch.model).create({
      data: { ...omitNulls(child), tenantId: TENANT_STAMPED_BY_CLIENT },
    } as CreateArgs<PrismaModelName>);
  }
}

/**
 * Drops the columns a create left null.
 *
 * A spec returns the whole row, nulls included, so the two implementations
 * agree about defaults. Postgres does not need those nulls - a nullable column
 * in this schema never carries a non-null default, so omitting one lands on
 * exactly the same value - and Prisma refuses a literal `null` on a nullable
 * JSON column, which would turn an unset recurrence rule into a write error.
 */
function omitNulls(columns: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(columns).filter(([, value]) => value !== null));
}

function readColumn(row: Record<string, unknown>, column: string | undefined): string | undefined {
  if (column === undefined) return undefined;
  const value = row[column];
  return typeof value === 'string' ? value : undefined;
}

function patientOf<M extends PrismaModelName, TCreate, TPatch, TQuery extends BaseQuery>(
  spec: CollectionSpec<M, TCreate, TPatch, TQuery>,
  row: ScopedRow<M>
): { patientId?: string } {
  const patientId = spec.model === 'Patient' ? row.id : readColumn(row, spec.patientColumn);
  return patientId === undefined ? {} : { patientId };
}

function facilityOf<M extends PrismaModelName, TCreate, TPatch, TQuery extends BaseQuery>(
  spec: CollectionSpec<M, TCreate, TPatch, TQuery>,
  row: ScopedRow<M>
): { facilityId?: string } {
  const facilityId = readColumn(row, spec.facilityColumn);
  return facilityId === undefined ? {} : { facilityId };
}

function encounterOf<M extends PrismaModelName, TCreate, TPatch, TQuery extends BaseQuery>(
  spec: CollectionSpec<M, TCreate, TPatch, TQuery>,
  row: ScopedRow<M>
): { encounterId?: string } {
  const encounterId = readColumn(row, spec.encounterColumn);
  return encounterId === undefined ? {} : { encounterId };
}
