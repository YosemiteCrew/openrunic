import { uuidv7 } from '@openrunic/database';

import { createAuditChainStore, type AuditChainStore } from '../audit/chain-store.js';
import { ApiError } from '../errors.js';

import { createMemoryAuditQuery } from './audit-query.js';
import { createMemoryOrganisationQuery } from './organisation-query.js';
import {
  paginate,
  type BaseQuery,
  type ChildBatch,
  type Collection,
  type CollectionSpec,
  type Page,
  type RowContext,
} from './collection.js';
import type { PrismaModelName, ScopedRow } from './rows.js';
import { buildRepositories, type RequestScope } from './registry.js';
import type { Repositories, RepositoryRegistry } from './types.js';

/**
 * The in-memory repository implementation.
 *
 * It is not a mock: it is a real implementation of the same interfaces, holding
 * rows in arrays and enforcing the same rules - tenant narrowing, compartment
 * narrowing, natural-key uniqueness, pagination, sorting, audit emission. The
 * whole HTTP test suite runs against it, which is why none of those tests need
 * Postgres and none of them can be green because a stub said yes.
 *
 * Rows for every tenant live in one array per model, on purpose. If isolation
 * were achieved by handing each tenant its own array, the isolation tests would
 * be proving the harness rather than the code.
 */

/** The tables, keyed by model. Created on first use, so an empty dataset is empty. */
export interface MemoryDataset {
  table<M extends PrismaModelName>(model: M): ScopedRow<M>[];
  /** Every model that has been touched. For diagnostics and for fixtures. */
  models(): PrismaModelName[];
}

export function createEmptyDataset(): MemoryDataset {
  const tables = new Map<PrismaModelName, unknown[]>();

  return {
    table<M extends PrismaModelName>(model: M): ScopedRow<M>[] {
      const existing = tables.get(model);
      if (existing !== undefined) return existing as ScopedRow<M>[];
      const created: ScopedRow<M>[] = [];
      tables.set(model, created);
      return created;
    },
    models(): PrismaModelName[] {
      return [...tables.keys()];
    },
  };
}

export interface Clock {
  now(): Date;
}

export interface MemoryRegistryOptions {
  dataset?: MemoryDataset;
  clock?: Clock;
  nextId?: () => string;
  /**
   * The chain the audit sink appends to. Supplying the same store to both is
   * what makes `/bff/v0/audit` read the events this process actually wrote,
   * rather than a second, plausible-looking copy of them.
   */
  auditStore?: AuditChainStore;
}

export interface MemoryRepositoryRegistry extends RepositoryRegistry {
  readonly dataset: MemoryDataset;
}

export function createMemoryRepositoryRegistry(
  options: MemoryRegistryOptions = {}
): MemoryRepositoryRegistry {
  const dataset = options.dataset ?? createEmptyDataset();
  const clock: Clock = options.clock ?? { now: (): Date => new Date() };
  const nextId = options.nextId ?? uuidv7;
  const auditStore = options.auditStore ?? createAuditChainStore();

  return {
    dataset,
    forRequest(scope: RequestScope): Repositories {
      return buildRepositories(
        scope,
        (spec) => createMemoryCollection(spec, dataset, scope, clock, nextId),
        createMemoryAuditQuery(auditStore, scope),
        createMemoryOrganisationQuery(dataset, scope)
      );
    },
  };
}

/**
 * Stands in for "same transaction as the mutation".
 *
 * The in-memory store has no transactions, but the array push above has already
 * completed and nothing can interleave, so the write and its audit event are
 * atomic in the only sense this implementation can offer. A sentinel is passed
 * as the unit of work so the sink records the write as transactional, exactly
 * as the Prisma implementation does.
 */
const MEMORY_UNIT_OF_WORK = { kind: 'memory' } as const;

export function createMemoryCollection<
  M extends PrismaModelName,
  TCreate,
  TPatch,
  TQuery extends BaseQuery,
>(
  spec: CollectionSpec<M, TCreate, TPatch, TQuery>,
  dataset: MemoryDataset,
  scope: RequestScope,
  clock: Clock,
  nextId: () => string
): Collection<ScopedRow<M>, TCreate, TPatch, TQuery> {
  const { tenantId, audit } = scope;
  const compartment = scope.compartmentPatientId;
  const table = (): ScopedRow<M>[] => dataset.table(spec.model);

  /**
   * The facility narrowing, mirroring the Prisma port's `facilityClause`.
   *
   * The two have to agree. This one backs the tests and the in-browser mock, so
   * a difference between them would be a rule the suite proves and production
   * does not have, which is worse than having no rule in either.
   */
  const inFacility = (row: ScopedRow<M>): boolean => {
    if (spec.facilityScoped !== true) return true;
    if (scope.facilityIds === undefined) return true;
    const column = spec.facilityColumn;
    if (column === undefined) return true;
    const value = readColumn(row, column);
    // Null stays visible to the whole tenant, as in the Prisma port.
    if (value === null || value === undefined) return true;
    // Anything that is not a facility id fails closed. A column typed wider than
    // this rule expects means the spec and the schema have drifted, and guessing
    // that an unreadable value is in scope is the wrong way to be wrong.
    return typeof value === 'string' && scope.facilityIds.includes(value);
  };

  /** Mirrors the Prisma port: a list is always narrowed, a row by id only when
   * the scope says to hide it rather than let the route refuse it. */
  const hideAddressed = scope.hideFacilityRows === true;

  const inScope = (row: ScopedRow<M>, narrowFacility: boolean): boolean => {
    if (row.tenantId !== tenantId) return false;
    if (narrowFacility && !inFacility(row)) return false;
    if (compartment === undefined || spec.compartment === 'open') return true;
    if (spec.compartment === 'closed') return false;
    return readColumn(row, spec.compartment.column) === compartment;
  };

  const mine = (narrowFacility: boolean): ScopedRow<M>[] =>
    table().filter((row) => inScope(row, narrowFacility));

  const recordRead = (row: ScopedRow<M>): void => {
    audit.read({ targetType: spec.targetType, targetId: row.id, ...patientOf(spec, row) });
  };

  const recordWrite = async (
    row: ScopedRow<M>,
    before: ScopedRow<M> | null,
    fields: readonly string[]
  ): Promise<void> => {
    await audit.write(
      {
        action: `${spec.action}.${before === null ? 'created' : 'updated'}`,
        targetType: spec.targetType,
        targetId: row.id,
        ...patientOf(spec, row),
        ...facilityOf(spec, row),
        ...encounterOf(spec, row),
        metadata: { fields: [...fields], ...spec.writeMetadata?.(row, before) },
      },
      MEMORY_UNIT_OF_WORK
    );
  };

  return {
    list(query: TQuery): Promise<Page<ScopedRow<M>>> {
      const matched = mine(true).filter((row) => spec.matches(row, query));
      sortRows(matched, spec, query);
      const page = paginate(matched, query.page, query.pageSize);
      page.rows.forEach(recordRead);
      return Promise.resolve(page);
    },

    findById(id: string): Promise<ScopedRow<M> | null> {
      const row = mine(hideAddressed).find((candidate) => candidate.id === id) ?? null;
      if (row !== null) recordRead(row);
      return Promise.resolve(row);
    },

    async create(input: TCreate): Promise<ScopedRow<M>> {
      const unique = spec.uniqueBy;
      if (unique !== undefined && mine(false).some((row) => unique.matches(row, input))) {
        // Mirrors the table's unique constraint. Raised here rather than left
        // to the handler so both implementations fail the same way.
        throw ApiError.conflict(unique.message(input));
      }

      const now = clock.now();
      const context: RowContext = { tenantId, now, nextId };
      const columns = spec.newRow(input, context);
      // `Writable<M>` is `Row<M>` minus the storage columns, so adding them
      // back reconstitutes the row. The compiler cannot see that through an
      // unresolved model parameter, which is what this assertion restores.
      const row = {
        ...columns,
        id: nextId(),
        tenantId,
        createdAt: now,
        updatedAt: now,
      } as ScopedRow<M>;
      table().push(row);

      for (const batch of spec.childRows?.(input, row, context) ?? []) {
        appendChildren(dataset, batch, tenantId, now);
      }

      await recordWrite(row, null, Object.keys(columns));
      return row;
    },

    async update(id: string, patch: TPatch): Promise<ScopedRow<M> | null> {
      const row = mine(hideAddressed).find((candidate) => candidate.id === id);
      if (row === undefined) return null;

      const now = clock.now();
      const before = { ...row };
      const data = spec.patchData(patch, before, { tenantId, now, nextId });
      Object.assign(row, data, { updatedAt: now });

      await recordWrite(row, before, Object.keys(data));
      return row;
    },
  };
}

/** Appends child rows, stamping the columns storage owns. */
function appendChildren(
  dataset: MemoryDataset,
  batch: ChildBatch,
  tenantId: string,
  now: Date
): void {
  const table = dataset.table(batch.model);
  for (const child of batch.rows) {
    table.push({
      ...child,
      tenantId,
      createdAt: now,
      updatedAt: now,
    } as ScopedRow<PrismaModelName>);
  }
}

function sortRows<M extends PrismaModelName, TCreate, TPatch, TQuery extends BaseQuery>(
  rows: ScopedRow<M>[],
  spec: CollectionSpec<M, TCreate, TPatch, TQuery>,
  query: TQuery
): void {
  const direction = query.order === 'desc' ? -1 : 1;
  rows.sort((a, b) => {
    const primary = compareValues(spec.sortValue(a, query.sort), spec.sortValue(b, query.sort));
    // Ties break on id so a page boundary never reorders between requests.
    return primary === 0 ? a.id.localeCompare(b.id) : primary * direction;
  });
}

function compareValues(left: number | string, right: number | string): number {
  if (typeof left === 'string' && typeof right === 'string') return left.localeCompare(right);
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return String(left).localeCompare(String(right));
}

/** Reads a column the spec named, without widening the row type at the call site. */
export function readColumn<M extends PrismaModelName>(row: ScopedRow<M>, column: string): unknown {
  return (row as Record<string, unknown>)[column];
}

function stringColumn<M extends PrismaModelName>(
  row: ScopedRow<M>,
  column: string | undefined
): string | undefined {
  if (column === undefined) return undefined;
  const value = readColumn(row, column);
  return typeof value === 'string' ? value : undefined;
}

/** The chart an event belongs to, omitted rather than nulled when there is none. */
export function patientOf<M extends PrismaModelName, TCreate, TPatch, TQuery extends BaseQuery>(
  spec: CollectionSpec<M, TCreate, TPatch, TQuery>,
  row: ScopedRow<M>
): { patientId?: string } {
  const patientId = spec.model === 'Patient' ? row.id : stringColumn(row, spec.patientColumn);
  return patientId === undefined ? {} : { patientId };
}

export function facilityOf<M extends PrismaModelName, TCreate, TPatch, TQuery extends BaseQuery>(
  spec: CollectionSpec<M, TCreate, TPatch, TQuery>,
  row: ScopedRow<M>
): { facilityId?: string } {
  const facilityId = stringColumn(row, spec.facilityColumn);
  return facilityId === undefined ? {} : { facilityId };
}

export function encounterOf<M extends PrismaModelName, TCreate, TPatch, TQuery extends BaseQuery>(
  spec: CollectionSpec<M, TCreate, TPatch, TQuery>,
  row: ScopedRow<M>
): { encounterId?: string } {
  const encounterId = stringColumn(row, spec.encounterColumn);
  return encounterId === undefined ? {} : { encounterId };
}

export type { AuditQueryRepository } from './audit-query.js';
