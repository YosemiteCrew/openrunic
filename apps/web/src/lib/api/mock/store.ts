import { notFound } from './protocol';

/**
 * The in-memory record the mock client writes to.
 *
 * Until now the mock client implemented reads only, on the argument that a
 * fixture which accepts writes teaches screens to trust state the server never
 * saw. That argument was right about the danger and wrong about the remedy. A
 * client that silently drops a write teaches a screen the same lie in the other
 * direction: it lets a save look successful because nothing ever contradicts
 * it. What actually protects a screen is a fixture that behaves like the server
 * - one that assigns an id, refuses a transition the state machine forbids,
 * and shows the write on the next read - so that a screen which is wrong about
 * persistence is wrong in the demo too.
 *
 * The store is per-session and per-client. Reloading the page restores the
 * fixtures, and two `createMockClient()` calls do not see each other's writes,
 * which is what keeps one test from leaking into the next.
 */

/** The three columns every aggregate carries, and which the store maintains itself. */
export interface Stamped {
  id: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * A deterministic clock and id source.
 *
 * Not `Date.now()` and not `crypto.randomUUID()`: a screenshot taken twice has
 * to be the same screenshot, and a test that asserts on the second of two
 * writes has to know which one it got. The clock advances one second per write
 * so that "newest first" is a stable ordering rather than a coin toss between
 * two rows written in the same millisecond.
 */
export interface MockClock {
  /** The instant this write happens, advancing the clock. */
  next: () => string;
  /** The current instant, without advancing. */
  now: () => string;
}

export function createClock(start: string): MockClock {
  let ticks = 0;
  const base = new Date(start).getTime();
  const at = (): string => new Date(base + ticks * 1000).toISOString();
  return {
    next: () => {
      ticks += 1;
      return at();
    },
    now: at,
  };
}

/**
 * A UUIDv7-shaped id, in the fixtures' own family.
 *
 * Real enough that a screen rendering `.slice(0, 8)` of one looks right, and
 * obviously synthetic to anyone reading the database, which is the same
 * property the seeded ids have.
 */
export function createIdFactory(prefix: string): () => string {
  let issued = 0;
  return () => {
    issued += 1;
    const tail = `${prefix}${issued.toString().padStart(4, '0')}`.slice(-12).padStart(12, '0');
    return `0192f1a0-0000-7000-9000-${tail}`;
  };
}

/**
 * One aggregate's rows, with the four operations every aggregate needs.
 *
 * Filtering and sorting stay outside: what "matches" means is the API's rule
 * for that aggregate, and pushing it in here would mean inventing a query
 * language that has to agree with Postgres. The table holds rows and identity;
 * the client holds the semantics.
 */
export interface MockTable<T extends Stamped> {
  /** Every row, in insertion order. */
  all: () => readonly T[];
  find: (id: string) => T | undefined;
  /** The row, or the same 404 the API answers for a row in another organisation. */
  require: (id: string, missing: string) => T;
  insert: (row: Omit<T, 'id' | 'createdAt' | 'updatedAt'> & Partial<Stamped>) => T;
  /** Applies a patch and bumps `updatedAt`. Returns the stored row. */
  patch: (id: string, changes: Partial<T>, missing: string) => T;
}

export function createTable<T extends Stamped>(
  seed: readonly T[],
  clock: MockClock,
  nextId: () => string
): MockTable<T> {
  const rows: T[] = seed.map((row) => ({ ...row }));
  const indexOf = (id: string): number => rows.findIndex((row) => row.id === id);

  const find = (id: string): T | undefined => rows.find((row) => row.id === id);

  const require = (id: string, missing: string): T => {
    const row = find(id);
    if (row === undefined) throw notFound(missing);
    return row;
  };

  return {
    all: () => rows,
    find,
    require,
    insert: (input) => {
      const at = clock.next();
      const row = {
        ...input,
        id: input.id ?? nextId(),
        createdAt: input.createdAt ?? at,
        updatedAt: input.updatedAt ?? at,
      } as T;
      rows.push(row);
      return row;
    },
    patch: (id, changes, missing) => {
      const index = indexOf(id);
      if (index === -1) throw notFound(missing);
      const existing = rows[index] as T;
      // Replaced rather than mutated, so a screen holding the previous object
      // sees the value it read rather than one that changed underneath it.
      const updated: T = { ...existing, ...changes, updatedAt: clock.next() };
      rows[index] = updated;
      return updated;
    },
  };
}

/**
 * Drops undefined values from a patch body.
 *
 * The API's patch schemas are strict objects and an absent key means "leave
 * this alone", so a body built by spreading optional form fields must not carry
 * `{ room: undefined }` into the store and blank a room nobody touched.
 */
export function defined<T extends object>(input: T): Partial<T> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) output[key] = value;
  }
  return output as Partial<T>;
}
