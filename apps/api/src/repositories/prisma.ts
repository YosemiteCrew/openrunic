import { uuidv7 } from '@openrunic/database';

import { ApiError } from '../errors.js';

import { createPrismaAuditQuery } from './audit-query.js';
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
        createPrismaAuditQuery(port, scope)
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

  const scoped = (where: Record<string, unknown> | undefined): Record<string, unknown> => {
    if (compartment === undefined || spec.compartment === 'open' || spec.compartment === 'closed') {
      return where ?? {};
    }
    const column = spec.model === 'Patient' ? 'id' : spec.compartment.column;
    // ANDed rather than merged, so a filter the caller supplied on the same
    // column cannot widen the compartment: the outer AND still has to hold.
    return { AND: [where ?? {}, { [column]: compartment }] };
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

      const where = scoped(spec.where(query));
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
      const record = await delegate.findFirst({ where: scoped({ id }) });
      if (record === null) return null;
      const row = toPlainRow<M>(record) as ScopedRow<M>;
      recordRead(row);
      return row;
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
        const existing = await scopedDelegate.findFirst({ where: scoped({ id }) });
        if (existing === null) return null;

        const before = toPlainRow<M>(existing) as ScopedRow<M>;
        const data = spec.patchData(patch, before, {
          tenantId: scope.tenantId,
          now: new Date(),
          nextId: uuidv7,
        });
        const result = await scopedDelegate.updateMany({ where: scoped({ id }), data });
        if (result.count === 0) return null;

        // Re-read rather than trust the patch: defaults, triggers and the
        // `updatedAt` column are the database's to decide.
        const record = await scopedDelegate.findFirst({ where: scoped({ id }) });
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
