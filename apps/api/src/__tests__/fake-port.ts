import type {
  AuditEventDelegate,
  DbPort,
  DbTransaction,
  ModelDelegate,
} from '../repositories/db-port.js';
import { isTenantScopedModel } from '@openrunic/database';

import type { MemoryDataset } from '../repositories/memory.js';
import type { ModelRecord, PrismaModelName } from '../repositories/rows.js';

/**
 * A fake {@link DbPort} that really evaluates the queries it is given.
 *
 * The point is not to avoid a database for its own sake. It is that the thing
 * most worth testing about the Prisma adapter is whether the `where` clause it
 * builds selects the same rows as the in-memory predicate it is supposed to
 * agree with, and a fake that ignored the clause would answer that question
 * with "yes" no matter what. So this evaluates the subset of the Prisma filter
 * grammar the specs actually emit, over the same dataset the in-memory
 * repositories use, and the contract suite runs against both.
 *
 * It also plays the part of the tenant extension. `createTenantClient` is what
 * narrows a query in production, and the adapter deliberately never mentions
 * `tenantId`; a fake that skipped the narrowing would make every isolation
 * assertion vacuous, so the narrowing happens here, in the same place and in
 * the same way: the caller's filter ANDed with the tenant, and the tenant
 * stamped onto create data last.
 *
 * What it does not do is roll back. `$transaction` runs the callback and
 * returns; a failure part-way leaves the earlier writes in place. Transaction
 * *semantics* are Postgres's to provide and are covered by the suite that runs
 * against a real one; what this fake proves is that the writes and their audit
 * event are handed the same unit of work.
 */

export interface FakePortCall {
  model: string;
  operation: string;
  args: unknown;
}

export interface FakePort extends DbPort {
  /** Every delegate call, in order, for assertions about what was sent. */
  readonly calls: FakePortCall[];
  /** How many transactions were opened. */
  readonly transactions: number;
  /** The transaction handle, so a test can prove an audit event joined *it*. */
  readonly tx: DbTransaction;
}

type Row = Record<string, unknown>;

function isRecord(value: unknown): value is Row {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function comparableOf(value: unknown): number | string | boolean | null {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  return null;
}

function equal(left: unknown, right: unknown): boolean {
  if (left instanceof Date && right instanceof Date) return left.getTime() === right.getTime();
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, index) => equal(item, right[index]));
  }
  return left === right;
}

/** Evaluates one column's condition, which is either a literal or an operator object. */
/** The operand of a `contains` / `startsWith`, as the pattern Prisma splices it into. */
function asPattern(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * `contains` and `startsWith` as Postgres actually answers them.
 *
 * These used to be `String.includes` and `String.startsWith`, which made this
 * fake agree with the in-memory port and disagree with the database both were
 * standing in for. Prisma compiles them to `ILIKE ('%' || $1 || '%')` and
 * `ILIKE ($1 || '%')`, splicing the operand into a LIKE pattern, so a `%` in it
 * matches any run of characters and a `_` matches exactly one. Modelling them
 * as literal substring tests made a whole class of divergence invisible: both
 * test ports said one thing and only production said the other.
 *
 * The backslash is Postgres's default escape character, and Prisma emits no
 * `ESCAPE` clause, so `\%` here is a literal per cent exactly as it is there.
 */
function likeMatches(actual: unknown, pattern: string, mode: unknown): boolean {
  if (typeof actual !== 'string') return false;
  const quote = (char: string): string => char.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  let source = '';
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index] ?? '';
    if (char === '\\') {
      const escaped = pattern[index + 1];
      if (escaped === undefined) {
        source += quote('\\');
      } else {
        source += quote(escaped);
        index += 1;
      }
      continue;
    }
    if (char === '%') {
      source += '[\\s\\S]*';
      continue;
    }
    if (char === '_') {
      source += '[\\s\\S]';
      continue;
    }
    source += quote(char);
  }
  return new RegExp(`^${source}$`, mode === 'insensitive' ? 'iu' : 'u').test(actual);
}

function matchesCondition(actual: unknown, condition: unknown): boolean {
  if (!isRecord(condition) || condition instanceof Date) return equal(actual, condition);

  const mode = condition.mode;
  const checks: boolean[] = [];

  if ('equals' in condition) checks.push(equal(actual, condition.equals));
  if ('not' in condition) checks.push(!equal(actual, condition.not));
  if ('in' in condition) {
    const list = Array.isArray(condition.in) ? condition.in : [];
    checks.push(list.some((candidate) => equal(actual, candidate)));
  }
  /* `notIn` is a real Prisma operator and the specs now use it to exclude a
     withdrawn workflow state. A fake that ignored an operator the code emits
     would answer a filtered query with unfiltered rows, and the port-agreement
     suite would report the two implementations agreeing on the wrong answer. */
  if ('notIn' in condition) {
    const list = Array.isArray(condition.notIn) ? condition.notIn : [];
    checks.push(!list.some((candidate) => equal(actual, candidate)));
  }
  if ('has' in condition) {
    checks.push(Array.isArray(actual) && actual.some((item) => equal(item, condition.has)));
  }
  if ('startsWith' in condition) {
    checks.push(likeMatches(actual, `${asPattern(condition.startsWith)}%`, mode));
  }
  if ('contains' in condition) {
    checks.push(likeMatches(actual, `%${asPattern(condition.contains)}%`, mode));
  }
  for (const [key, compare] of [
    ['gte', (a: number | string, b: number | string): boolean => a >= b],
    ['gt', (a: number | string, b: number | string): boolean => a > b],
    ['lte', (a: number | string, b: number | string): boolean => a <= b],
    ['lt', (a: number | string, b: number | string): boolean => a < b],
  ] as const) {
    if (!(key in condition)) continue;
    const left = comparableOf(actual);
    const right = comparableOf(condition[key]);
    checks.push(
      left !== null &&
        right !== null &&
        typeof left !== 'boolean' &&
        typeof right !== 'boolean' &&
        compare(left, right)
    );
  }

  // An operator object with no operator this evaluator knows is a filter the
  // fake would silently ignore, which is the one failure mode it must not
  // have: an ignored filter turns a scoped query into an unscoped one.
  if (checks.length === 0) {
    throw new Error(`fakePort: unsupported filter ${JSON.stringify(condition)}`);
  }
  return checks.every(Boolean);
}

export function matchesWhere(row: Row, where: unknown): boolean {
  if (!isRecord(where)) return true;

  return Object.entries(where).every(([key, condition]) => {
    if (key === 'AND') {
      const clauses = Array.isArray(condition) ? condition : [condition];
      return clauses.every((clause) => matchesWhere(row, clause));
    }
    if (key === 'OR') {
      const clauses = Array.isArray(condition) ? condition : [condition];
      return clauses.some((clause) => matchesWhere(row, clause));
    }
    if (key === 'NOT') return !matchesWhere(row, condition);
    return matchesCondition(row[key], condition);
  });
}

function compareRows(left: Row, right: Row, orderBy: unknown): number {
  const clauses = Array.isArray(orderBy) ? orderBy : [orderBy];
  for (const clause of clauses) {
    if (!isRecord(clause)) continue;
    for (const [column, direction] of Object.entries(clause)) {
      const a = comparableOf(left[column]);
      const b = comparableOf(right[column]);
      if (a === b) continue;
      if (a === null) return 1;
      if (b === null) return -1;
      const primary = a < b ? -1 : 1;
      return direction === 'desc' ? -primary : primary;
    }
  }
  return 0;
}

export interface FakePortOptions {
  dataset: MemoryDataset;
  tenantId: string;
  /** Ids for rows the port creates. Deterministic in the suite. */
  nextId?: () => string;
  now?: () => Date;
}

export function createFakePort(options: FakePortOptions): FakePort {
  const { dataset, tenantId } = options;
  const now = options.now ?? ((): Date => new Date());
  const calls: FakePortCall[] = [];
  const state = { transactions: 0 };

  const table = (model: PrismaModelName): Row[] => dataset.table(model) as unknown as Row[];

  /**
   * The tenant extension's rule, reproduced: AND the caller's filter with the
   * tenant, but only for the models the extension actually scopes.
   *
   * `createTenantClient` returns `query(args)` untouched for anything outside
   * `TENANT_SCOPED_MODELS`, and `Organisation` is outside it because it has no
   * `tenantId` column - it IS the tenant. A fake that ANDed `tenantId` for
   * every model would make every read of that table return nothing here and
   * everything in production, which is the wrong way round for a fake whose
   * whole job is to be stricter than the thing it stands in for.
   */
  const scopedWhere = (model: PrismaModelName, where: unknown): unknown =>
    isTenantScopedModel(model) ? { AND: [where ?? {}, { tenantId }] } : (where ?? {});

  const select = (model: PrismaModelName, where: unknown): Row[] =>
    table(model).filter((row) => matchesWhere(row, scopedWhere(model, where)));

  const delegateFor = <M extends PrismaModelName>(model: M): ModelDelegate<M> => {
    const record = (operation: string, args: unknown): void => {
      calls.push({ model, operation, args });
    };
    // A stored row and a Prisma record differ only in the Decimal columns,
    // and nothing in this fake constructs one, so the two coincide here.
    const asRecord = (row: Row): ModelRecord<M> => row as unknown as ModelRecord<M>;

    return {
      findMany(args) {
        record('findMany', args);
        const found = select(model, args.where).sort((left, right) =>
          compareRows(left, right, args.orderBy)
        );
        const skip = args.skip ?? 0;
        const take = args.take ?? found.length;
        return Promise.resolve(found.slice(skip, skip + take).map(asRecord));
      },
      count(args) {
        record('count', args);
        return Promise.resolve(select(model, args.where).length);
      },
      findFirst(args) {
        record('findFirst', args);
        const found = select(model, args.where).sort((left, right) =>
          compareRows(left, right, args.orderBy)
        );
        return Promise.resolve(found.length === 0 ? null : asRecord(found[0] as Row));
      },
      create(args) {
        record('create', args);
        const data = isRecord(args.data) ? args.data : {};
        // The tenant stamp is applied last, exactly as the extension applies
        // it, so data naming another organisation is corrected rather than
        // honoured.
        const row: Row = { createdAt: now(), updatedAt: now(), ...data, tenantId };
        table(model).push(row);
        return Promise.resolve(asRecord(row));
      },
      updateMany(args) {
        record('updateMany', args);
        const data = isRecord(args.data) ? args.data : {};
        const found = select(model, args.where);
        for (const row of found) Object.assign(row, data, { updatedAt: now() });
        return Promise.resolve({ count: found.length });
      },
    };
  };

  const auditEvent: AuditEventDelegate = {
    create(args) {
      calls.push({ model: 'AuditEvent', operation: 'create', args });
      const data = isRecord(args.data) ? args.data : {};
      const row: Row = { createdAt: now(), updatedAt: now(), ...data, tenantId };
      table('AuditEvent').push(row);
      return Promise.resolve({ id: String(row.id) });
    },
    findFirst(args) {
      calls.push({ model: 'AuditEvent', operation: 'findFirst', args });
      const found = table('AuditEvent')
        .filter((row) => row.tenantId === tenantId)
        .sort((left, right) => Number(right.seq) - Number(left.seq));
      const tail = found[0];
      return Promise.resolve(
        tail === undefined ? null : { seq: tail.seq as bigint, hash: String(tail.hash) }
      );
    },
  };

  const transaction: DbTransaction = {
    model: delegateFor,
    auditEvent,
    // Recorded on `calls` like every delegate call, so a test can assert it was
    // taken AND that it was taken before the tail read. Order is the property
    // that matters: a lock acquired after `findFirst` serialises nothing.
    lockAuditChain(tenantId: string): Promise<void> {
      calls.push({ model: 'AuditEvent', operation: 'lockAuditChain', args: { tenantId } });
      return Promise.resolve();
    },
  };

  return {
    calls,
    tx: transaction,
    get transactions(): number {
      return state.transactions;
    },
    model: delegateFor,
    auditEvent,
    $transaction<R>(fn: (tx: DbTransaction) => Promise<R>): Promise<R> {
      state.transactions += 1;
      return fn(transaction);
    },
  };
}
