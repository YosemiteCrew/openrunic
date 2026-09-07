import type { Prisma, TenantClient } from '@openrunic/database';

import type {
  CountArgs,
  CreateArgs,
  FindFirstArgs,
  FindManyArgs,
  ModelRecord,
  PrismaModelName,
  UpdateManyArgs,
} from './rows.js';

/**
 * The narrow slice of the Prisma client the API actually uses.
 *
 * Written as an interface rather than taken as `TenantClient` directly for two
 * reasons. It documents the exact surface the API depends on, so a Prisma
 * upgrade that changes something outside this slice cannot break the API
 * silently. And it makes the Prisma adapter testable: the suite drives it with
 * a hand-written fake port, which is why `prisma.ts` needs no database and is
 * covered like any other module.
 *
 * The safety of that arrangement rests on {@link tenantClientSatisfiesPort}
 * below: it is a compile-time assertion that the real tenant-scoped client
 * still satisfies this port. If Prisma changes an argument or return type, the
 * fake keeps passing but `type-check` fails, which is the correct place to find
 * out.
 */

/**
 * Reads are `findFirst`, never `findUnique`, and writes are `updateMany`,
 * never `update`. Both choices are forced by the tenant extension in
 * `packages/database`: it narrows a query by rewriting `where` into
 * `AND: [original, { tenantId }]`, which is a legal filter but not a legal
 * *unique* filter, so the by-unique-key operations would be the one shape the
 * isolation layer cannot scope. Filter-shaped operations keep every query on
 * the scoped path.
 */
export interface ModelDelegate<M extends PrismaModelName> {
  findMany(args: FindManyArgs<M>): Promise<ModelRecord<M>[]>;
  count(args: CountArgs<M>): Promise<number>;
  findFirst(args: FindFirstArgs<M>): Promise<ModelRecord<M> | null>;
  create(args: CreateArgs<M>): Promise<ModelRecord<M>>;
  updateMany(args: UpdateManyArgs<M>): Promise<{ count: number }>;
}

/** The property name a model is reached by on the client, e.g. `medicationRequest`. */
export type DelegateKey = Prisma.TypeMap['meta']['modelProps'];

/**
 * The whole client, as this API needs it: one delegate per model, keyed the way
 * Prisma keys them. Only the compile-time assertion below consumes this type;
 * repositories reach a delegate through {@link DbTransaction.model} instead, so
 * a fake port implements one method rather than forty-seven.
 */
export type PrismaDelegates = {
  [K in DelegateKey]: ModelDelegate<Capitalize<K> & PrismaModelName>;
};

export interface AuditEventDelegate {
  create(args: Prisma.AuditEventCreateArgs): Promise<{ id: string }>;
  /** Reads the tenant's chain tail so the next event can link to it. */
  findFirst(args: Prisma.AuditEventFindFirstArgs): Promise<{ seq: bigint; hash: string } | null>;
}

/** What a repository sees inside a transaction. */
export interface DbTransaction {
  model<M extends PrismaModelName>(name: M): ModelDelegate<M>;
  auditEvent: AuditEventDelegate;
  /**
   * Serialises this tenant's audit chain against every other appender, for the
   * duration of the surrounding transaction.
   *
   * The chain is a total order, so an append has to read the tail and write the
   * next `seq` with nothing between them. `@@unique([tenantId, seq])` was doing
   * that on its own, and it does it by failing: two concurrent appenders both
   * read the same tail, both write the same `seq`, and the loser gets `P2002`.
   * That refusal is correct - the chain never forks - but it reaches the caller
   * as a 500, and the caller is a clinician opening a chart or registering a
   * patient. Measured on Postgres before this existed: two concurrent chart
   * reads in one tenant answered 500 about half the time, and four concurrent
   * registrations kept five rows out of twenty.
   *
   * Taking the lock first turns the race into a queue. The constraint stays
   * exactly where it was, as the backstop it was written to be, rather than as
   * the mechanism.
   *
   * The queue is bounded, and the bound is worth stating rather than leaving to
   * be found. `pg_advisory_xact_lock` blocks, and Prisma's interactive
   * transactions expire after 5000 ms, so an append that waits longer than that
   * fails its caller. Measured with a second connection holding the lock:
   *
   *     hold 1000 ms  ->  appended after 1057 ms
   *     hold 6000 ms  ->  failed   after 6029 ms, at the tail read
   *
   * Note WHERE the second one fails. The transaction expires at 5000 ms but
   * nothing notices until the lock is released and the next statement runs, so
   * the caller waits out the whole block and only then gets an error - it is
   * not a five-second cutoff, it is a five-second budget checked late.
   *
   * Reaching it needs one tenant's queue to exceed five seconds of appends, on
   * the order of a thousand queued in one organisation - three orders of
   * magnitude past the widths that produced the defect. Strictly better than
   * what it replaces, which failed at a burst of two, and it blocks rather than
   * losing a row. But it is a fuse, not the absence of one. Found by
   * `@Claude L2 Dunexploration` while building the independence arm.
   *
   * On {@link DbTransaction} and deliberately NOT on {@link DbPort}: an
   * advisory lock scoped to a transaction is released at COMMIT, so one taken
   * outside a transaction is released before the statement that needed it runs.
   * A method that cannot do what its name says is worse than an absent one, so
   * the port that has no transaction does not offer it.
   */
  lockAuditChain(tenantId: string): Promise<void>;
}

/**
 * The same surface without {@link DbTransaction.lockAuditChain}: see that
 * method for why a port with no transaction of its own must not offer it.
 */
export interface DbPort extends Omit<DbTransaction, 'lockAuditChain'> {
  $transaction<R>(fn: (tx: DbTransaction) => Promise<R>): Promise<R>;
}

/**
 * Compile-time proof that the tenant-scoped Prisma client satisfies every
 * delegate this API reaches for. Type-only: it erases, and it exists so a drift
 * between the port and the generated client fails `type-check` rather than
 * production.
 */
export type TenantClientSatisfiesPort = TenantClient extends PrismaDelegates ? true : never;

/** Reified so the assertion cannot be tree-shaken out of the type graph. */
export const tenantClientSatisfiesPort: TenantClientSatisfiesPort = true;

/** `Encounter` to `encounter`, which is how Prisma names the delegate property. */
export function delegateKey(model: PrismaModelName): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
}

/**
 * Adapts a tenant-scoped client to the port.
 *
 * The single cast in this file lives here. `PrismaDelegates` is a mapped type
 * over a literal union of forty-seven keys, and indexing it with a value the
 * compiler only knows as `PrismaModelName` produces the union of every
 * delegate, which no single narrowed delegate satisfies. The assertion above
 * is what makes the cast safe: it proves the client really does carry a
 * conforming delegate under every one of those keys, so the only thing being
 * asserted here is that the key was derived correctly, which the line above it
 * does.
 */
export function createDbPort(client: TenantClient): DbPort {
  const model = <M extends PrismaModelName>(name: M): ModelDelegate<M> =>
    (client as unknown as Record<string, ModelDelegate<M>>)[delegateKey(name)] as ModelDelegate<M>;

  return {
    model,
    auditEvent: client.auditEvent,
    $transaction: <R>(fn: (tx: DbTransaction) => Promise<R>): Promise<R> =>
      client.$transaction((tx) =>
        fn({
          model: <M extends PrismaModelName>(name: M): ModelDelegate<M> =>
            (tx as unknown as Record<string, ModelDelegate<M>>)[
              delegateKey(name)
            ] as ModelDelegate<M>,
          auditEvent: tx.auditEvent,
          lockAuditChain: (tenantId) => lockAuditChain(tx, tenantId),
        })
      ),
  };
}

/**
 * The `pg_advisory_xact_lock` class this project takes audit-chain locks under.
 *
 * Advisory locks share one flat space per cluster, so the two-argument form is
 * used rather than the one-argument one: the class narrows the key to this
 * subsystem, and a collision would otherwise be with anything else in the
 * database that happened to hash a string the same way.
 */
export const AUDIT_CHAIN_LOCK_CLASS = 0x0a4d17;

/** The slice of a transaction client the lock needs. */
interface RawExecutor {
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<number>;
}

/**
 * Takes the per-tenant audit chain lock on `tx`.
 *
 * `pg_advisory_xact_lock` blocks rather than failing, and Postgres releases it
 * at COMMIT or ROLLBACK, so no caller can leak one by throwing. `hashtext`
 * narrows the tenant to the `int` the two-argument form takes; a collision
 * between two tenants costs one of them a short wait and nothing else, because
 * the lock is a serialiser and not an identity.
 *
 * The cast on the class id is what picks the `(int, int)` overload. Without it
 * the bound parameter arrives untyped and Postgres cannot choose between that
 * and `(bigint)`.
 */
export function lockAuditChain(tx: RawExecutor, tenantId: string): Promise<void> {
  return tx.$executeRaw`SELECT pg_advisory_xact_lock(${AUDIT_CHAIN_LOCK_CLASS}::int, hashtext(${tenantId}))`.then(
    () => undefined
  );
}
