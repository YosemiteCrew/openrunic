import type {
  TerminologyCodeCountArgs,
  TerminologyCodeFindFirstArgs,
  TerminologyCodeFindManyArgs,
  TerminologyCodeOrderBy,
  TerminologyCodeRow,
  TerminologyCodeStore,
  TerminologyCodeWhere,
  TerminologyStringFilter,
} from '../store.js';
import { FIXTURE_CONCEPTS, FIXTURE_TENANT_ID, OTHER_TENANT_ID, PROBLEM_SYSTEM } from './fixture.js';

/**
 * A hand-written store that answers queries and remembers them.
 *
 * The point is not to simulate Postgres. It is to make the QUERIES the
 * store-backed service builds into something a test can assert on, because
 * those queries are the part of that implementation nobody else can see: that
 * every clause carries the tenant, that a single-rule value set pages in the
 * database instead of in memory, that the expensive substring search only runs
 * when the cheap prefix search did not fill the page. A mock that only returned
 * rows would let all three of those regress silently.
 *
 * It implements exactly the predicates the port declares, and rows are held in
 * an array rather than indexed, so it stays small enough to read.
 */

/** A stored row, which unlike the port's read shape carries the tenant it belongs to. */
export interface FakeStoredCode extends TerminologyCodeRow {
  readonly tenantId: string;
}

/** One query as it arrived, flattened so assertions read as one object. */
export interface RecordedQuery {
  readonly method: 'findMany' | 'findFirst' | 'count';
  readonly where: TerminologyCodeWhere;
  readonly orderBy?: TerminologyCodeOrderBy[];
  readonly skip?: number;
  readonly take?: number;
}

/** The port, plus the log of everything asked of it. */
export interface RecordingTerminologyStore extends TerminologyCodeStore {
  readonly queries: RecordedQuery[];
}

const ORDER_FIELDS = ['system', 'display', 'code', 'version'] as const;

function matchesStringFilter(value: string, filter: TerminologyStringFilter): boolean {
  const insensitive = filter.mode === 'insensitive';
  const subject = insensitive ? value.toLowerCase() : value;
  if (filter.startsWith !== undefined) {
    const needle = insensitive ? filter.startsWith.toLowerCase() : filter.startsWith;
    if (!subject.startsWith(needle)) {
      return false;
    }
  }
  if (filter.contains !== undefined) {
    const needle = insensitive ? filter.contains.toLowerCase() : filter.contains;
    if (!subject.includes(needle)) {
      return false;
    }
  }
  return true;
}

function matchesWhere(row: FakeStoredCode, where: TerminologyCodeWhere): boolean {
  if (where.tenantId !== undefined && row.tenantId !== where.tenantId) {
    return false;
  }
  if (where.system !== undefined && row.system !== where.system) {
    return false;
  }
  if (where.code !== undefined) {
    const matched =
      typeof where.code === 'string' ? row.code === where.code : where.code.in.includes(row.code);
    if (!matched) {
      return false;
    }
  }
  if (where.version !== undefined && row.version !== where.version) {
    return false;
  }
  if (where.parentCode !== undefined && row.parentCode !== where.parentCode) {
    return false;
  }
  if (where.isActive !== undefined && row.isActive !== where.isActive) {
    return false;
  }
  if (where.display !== undefined && !matchesStringFilter(row.display, where.display)) {
    return false;
  }
  const notDisplay = where.NOT?.display;
  if (notDisplay !== undefined && matchesStringFilter(row.display, notDisplay)) {
    return false;
  }
  return true;
}

function compareRows(
  a: FakeStoredCode,
  b: FakeStoredCode,
  orderBy: TerminologyCodeOrderBy[]
): number {
  for (const clause of orderBy) {
    for (const field of ORDER_FIELDS) {
      const direction = clause[field];
      if (direction === undefined || a[field] === b[field]) {
        continue;
      }
      const ascending = a[field] < b[field] ? -1 : 1;
      return direction === 'asc' ? ascending : -ascending;
    }
  }
  return 0;
}

function selectRows(
  rows: readonly FakeStoredCode[],
  where: TerminologyCodeWhere,
  orderBy: TerminologyCodeOrderBy[] | undefined
): FakeStoredCode[] {
  const matched = rows.filter((row) => matchesWhere(row, where));
  if (orderBy !== undefined) {
    matched.sort((a, b) => compareRows(a, b, orderBy));
  }
  return matched;
}

/** Builds a store over an array of rows, recording every query it is asked. */
export function createRecordingTerminologyStore(
  rows: readonly FakeStoredCode[]
): RecordingTerminologyStore {
  const queries: RecordedQuery[] = [];

  return {
    queries,
    findMany(args: TerminologyCodeFindManyArgs): Promise<TerminologyCodeRow[]> {
      queries.push({
        method: 'findMany',
        where: args.where,
        orderBy: args.orderBy,
        skip: args.skip,
        take: args.take,
      });
      const matched = selectRows(rows, args.where, args.orderBy);
      const start = args.skip ?? 0;
      const end = args.take === undefined ? undefined : start + args.take;
      return Promise.resolve(matched.slice(start, end));
    },
    findFirst(args: TerminologyCodeFindFirstArgs): Promise<TerminologyCodeRow | null> {
      queries.push({ method: 'findFirst', where: args.where, orderBy: args.orderBy });
      return Promise.resolve(selectRows(rows, args.where, args.orderBy)[0] ?? null);
    },
    count(args: TerminologyCodeCountArgs): Promise<number> {
      queries.push({ method: 'count', where: args.where });
      return Promise.resolve(rows.filter((row) => matchesWhere(row, args.where)).length);
    },
  };
}

/** A store that always rejects, for the "the database is down" arm of every operation. */
export function createFailingTerminologyStore(message: string): TerminologyCodeStore {
  const fail = (): Promise<never> => Promise.reject(new Error(message));
  return { findMany: fail, findFirst: fail, count: fail };
}

/**
 * The fixture as stored rows, under the fixture tenant, plus two rows belonging
 * to a second tenant. The intruder rows overlap on system and code and their
 * displays match the search fixtures, so any query that forgets its tenant
 * fails a contract assertion rather than passing quietly.
 */
export const FIXTURE_STORED_CODES: readonly FakeStoredCode[] = [
  ...FIXTURE_CONCEPTS.map((concept) => ({ ...concept, tenantId: FIXTURE_TENANT_ID })),
  {
    tenantId: OTHER_TENANT_ID,
    system: PROBLEM_SYSTEM,
    code: 'PB-100',
    display: 'Aching elbow, other practice wording',
    version: '2027-01',
    parentCode: null,
    isActive: true,
    properties: null,
  },
  {
    tenantId: OTHER_TENANT_ID,
    system: PROBLEM_SYSTEM,
    code: 'PB-500',
    display: 'Elbow entry belonging to another practice',
    version: '2027-01',
    parentCode: null,
    isActive: true,
    properties: null,
  },
];
