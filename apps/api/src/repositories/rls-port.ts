import { withTenantSession } from '@openrunic/database';
import type { PrismaClient, TenantTransactionClient } from '@openrunic/database';

import type { DbPort, DbTransaction } from './db-port.js';
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
 * on the port below - not just `$transaction`, but each individual read and
 * write - opens a transaction through `withTenantSession`, whose first
 * statement declares the tenant. The repositories never hold a Prisma delegate;
 * they hold this port, and this port has no method that reaches the database
 * outside a declared session. There is no bypass to forget, because there is no
 * unwrapped delegate to reach for.
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
 * Compile-time proof that a tenant-scoped transaction still satisfies the
 * narrow port the repositories use. Type-only: it erases, and it exists so a
 * Prisma upgrade that changes a delegate signature fails `type-check` rather
 * than production.
 */
export type TenantTransactionSatisfiesPort = TenantTransactionClient extends DbTransaction
  ? true
  : never;

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
    withTenantSession(client, { tenantId }, (tx) => run(tx))
  );
}

/**
 * Refuses an `updateMany` that carries no filter.
 *
 * Prisma reads a missing `where` as "every row", so a forgotten filter and a
 * deliberate mass update are the same call. Row-level security bounds the
 * damage to one tenant - the difference between a catastrophe and an incident -
 * but "every patient in this practice" is still not something any caller here
 * intends, and nothing else in the stack would notice.
 *
 * It runs before the session opens, so a refused call never reaches Postgres,
 * and the method stays `async` so the refusal arrives as a rejected promise
 * rather than a synchronous throw from an interface that promises one.
 *
 * This is the right layer for the check precisely because this wrapper forwards
 * an `args` it did not build: the repository above it always passes an identity
 * filter, and the guarantee that it did has to be made where the two meet.
 */
function withFilter<A extends { readonly where?: unknown }>(args: A, operation: string): A {
  const { where } = args;
  const filtered =
    typeof where === 'object' && where !== null && !Array.isArray(where)
      ? Object.keys(where).length > 0
      : false;

  if (!filtered) {
    throw new TypeError(
      `${operation}: refusing an update with no filter. An unfiltered updateMany rewrites every row the session can see.`
    );
  }

  return args;
}

/** The wiring, with the session mechanism left as a parameter. */
export function createSessionBoundPortFactory(runSession: TenantSessionRunner): DbPortFactory {
  return (tenantId: string): DbPort => {
    const inSession = <R>(run: (tx: DbTransaction) => Promise<R>): Promise<R> =>
      runSession(tenantId, run);

    return {
      patient: {
        findMany: (args) => inSession((tx) => tx.patient.findMany(args)),
        count: (args) => inSession((tx) => tx.patient.count(args)),
        findFirst: (args) => inSession((tx) => tx.patient.findFirst(args)),
        create: (args) => inSession((tx) => tx.patient.create(args)),
        updateMany: async (args) => {
          withFilter(args, 'patient.updateMany');
          return inSession((tx) => tx.patient.updateMany(args));
        },
      },
      appointment: {
        findMany: (args) => inSession((tx) => tx.appointment.findMany(args)),
        count: (args) => inSession((tx) => tx.appointment.count(args)),
        findFirst: (args) => inSession((tx) => tx.appointment.findFirst(args)),
        create: (args) => inSession((tx) => tx.appointment.create(args)),
        updateMany: async (args) => {
          withFilter(args, 'appointment.updateMany');
          return inSession((tx) => tx.appointment.updateMany(args));
        },
      },
      auditEvent: {
        create: (args) => inSession((tx) => tx.auditEvent.create(args)),
        findFirst: (args) => inSession((tx) => tx.auditEvent.findFirst(args)),
      },
      $transaction: inSession,
    };
  };
}
