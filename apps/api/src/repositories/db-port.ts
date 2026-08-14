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
}

export interface DbPort extends DbTransaction {
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
        })
      ),
  };
}
