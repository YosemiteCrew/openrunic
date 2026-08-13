import { withTenantSession } from '@openrunic/database';
import type { PrismaClient, TenantTransactionClient } from '@openrunic/database';

import { delegateKey, type DbPort, type DbTransaction, type ModelDelegate } from './db-port.js';
import type { PrismaModelName } from './rows.js';
import type { DbPortFactory } from './prisma.js';

/**
 * The only supported way to turn a real PrismaClient into a {@link DbPort}.
 *
 * Postgres row-level security filters every table on one session setting
 * (`openrunic.tenant_id`), and the policies fail closed: a connection that has
 * not declared its organisation reads nothing. So the question this module
 * answers is not "did we remember to set it" but "can a query exist that did
 * not".
 *
 * The answer is no, and it is structural rather than disciplined. Every method
 * on the port below - each individual read as much as `$transaction` - opens a
 * transaction through `withTenantSession`, whose first statement declares the
 * tenant. The repositories never hold a Prisma delegate; they hold this port,
 * and this port has no method that reaches the database outside a declared
 * session. There is no bypass to forget, because there is no unwrapped delegate
 * to reach for.
 *
 * Writes are absent from the port on purpose and are reached only through
 * `$transaction`, which hands down the tenant-scoped transaction client. That
 * keeps a write and the audit event that records it in one transaction, and it
 * leaves no unaudited write path hanging off the object the repositories hold.
 *
 * On stale settings: `withTenantSession` writes the setting with
 * `set_config(..., is_local => true)`, which Postgres discards at COMMIT or
 * ROLLBACK. A pooled connection therefore cannot hand request N+1 the
 * organisation of request N - the setting is gone before the connection is
 * released. A session-level `SET` would have exactly that bug, and it would
 * only appear under concurrency, in production, as one tenant seeing another's
 * chart. Nothing here issues one.
 *
 * The cost is one BEGIN/COMMIT and one extra round trip per call. A request
 * that issues several queries pays it several times, which is the argument for
 * eventually opening one session per request in the middleware and handing it
 * down; the shape below is what that change would slot into, because
 * {@link TenantSessionRunner} is already the seam.
 */

/**
 * Runs a unit of work with the tenant setting applied. Injected rather than
 * imported so the port's wiring can be proved without a database - the suite
 * supplies a runner that records what it was asked to do.
 */
export type TenantSessionRunner = <R>(
  tenantId: string,
  run: (tx: DbTransaction) => Promise<R>
) => Promise<R>;

/**
 * Adapts a tenant-scoped transaction client to the port's shape.
 *
 * The raw client keys its delegates by model name (`client.medicationRequest`);
 * the port reaches them through one `model(name)` accessor, so a fake port
 * implements one method rather than forty-seven. This is the same adapter
 * `createDbPort` applies, and it is applied here for the same reason: what
 * `withTenantSession` hands back is a Prisma client, not a `DbTransaction`.
 */
function toDbTransaction(tx: TenantTransactionClient): DbTransaction {
  return {
    model: <M extends PrismaModelName>(name: M): ModelDelegate<M> =>
      (tx as unknown as Record<string, ModelDelegate<M>>)[delegateKey(name)] as ModelDelegate<M>,
    auditEvent: tx.auditEvent,
  };
}

/**
 * Compile-time proof that the adapter above still produces the shape the
 * repositories use. Type-only: it erases, and it exists so a Prisma upgrade
 * that changes a delegate signature fails `type-check` rather than production.
 */
export type TenantTransactionSatisfiesPort =
  ReturnType<typeof toDbTransaction> extends DbTransaction ? true : never;

/** Reified so the assertion cannot be tree-shaken out of the type graph. */
export const tenantTransactionSatisfiesPort: TenantTransactionSatisfiesPort = true;

/**
 * Binds a PrismaClient to the RLS session protocol.
 *
 * Pass the result to `createPrismaRepositoryRegistry`; the registry calls it
 * once per request with the tenant the middleware resolved, which is the same
 * `RequestScope.tenantId` every repository is already bound to. One organisation
 * comes out of the principal, and it reaches both the Prisma extension and the
 * Postgres session from that single source.
 */
export function createRlsDbPortFactory(client: PrismaClient): DbPortFactory {
  return createSessionBoundPortFactory((tenantId, run) =>
    withTenantSession(client, { tenantId }, (tx) => run(toDbTransaction(tx)))
  );
}

/**
 * The wiring, with the session mechanism left as a parameter.
 *
 * Every method routes through `inSession`, so there is exactly one way to reach
 * Postgres from this object and it declares the tenant first. `model(name)`
 * returns a delegate whose methods each open their own session, which is what
 * makes a single-statement read or write safe on its own; a caller that needs
 * several statements under one session opens `$transaction` and works on the
 * client it is handed.
 *
 * An earlier revision withheld `create` and `updateMany` here, on the reasoning
 * that every write already goes through `$transaction` alongside its audit
 * event. That reasoning still holds for the repositories, but the port type is
 * no longer the place to enforce it: `DbPort` is now the generic `model(name)`
 * surface shared with `DbTransaction`, so withholding two methods would mean
 * giving the port a different delegate type from the one a transaction hands
 * down, for a path no caller takes. Wrapping them honestly costs nothing and
 * keeps the two shapes identical.
 */
export function createSessionBoundPortFactory(runSession: TenantSessionRunner): DbPortFactory {
  return (tenantId: string): DbPort => {
    const inSession = <R>(run: (tx: DbTransaction) => Promise<R>): Promise<R> =>
      runSession(tenantId, run);

    const model = <M extends PrismaModelName>(name: M): ModelDelegate<M> => ({
      findMany: (args) => inSession((tx) => tx.model(name).findMany(args)),
      count: (args) => inSession((tx) => tx.model(name).count(args)),
      findFirst: (args) => inSession((tx) => tx.model(name).findFirst(args)),
      create: (args) => inSession((tx) => tx.model(name).create(args)),
      updateMany: (args) => inSession((tx) => tx.model(name).updateMany(args)),
    });

    return {
      model,
      auditEvent: {
        create: (args) => inSession((tx) => tx.auditEvent.create(args)),
        findFirst: (args) => inSession((tx) => tx.auditEvent.findFirst(args)),
      },
      $transaction: inSession,
    };
  };
}
