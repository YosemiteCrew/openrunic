import type { PrismaClient } from './generated/prisma/client.js';
import { createTenantClient } from './tenant.js';
import type { TenantClient, TenantContext } from './tenant.js';

/**
 * The session half of Postgres row-level security: layer 2 of the isolation
 * model documented at the top of `prisma/schema.prisma`.
 *
 * The migration `20260813120000_row_level_security` puts a policy on every
 * table that reads one Postgres setting. This module is the only place that
 * ever writes it, and it writes it in the one form that is safe on a pooled
 * connection.
 */

/**
 * The Postgres customized option every `tenant_isolation` policy reads.
 *
 * Namespaced to the project rather than to a generic `app.` prefix: customized
 * options share one flat namespace per session, and a prefix another library
 * might also claim is a prefix that can be set by something other than us.
 */
export const TENANT_SETTING = 'openrunic.tenant_id';

/**
 * What `withTenantSession` hands its callback: a tenant-scoped client bound to
 * one transaction, so `$connect`, `$transaction` and friends are out of reach.
 */
export type TenantTransactionClient = Parameters<Parameters<TenantClient['$transaction']>[0]>[0];

/**
 * Runs `run` inside a transaction that has already declared its tenant.
 *
 * Three properties, in the order they matter:
 *
 * 1. **The setting is transaction-local.** `set_config(name, value, true)` is
 *    the parameterised form of `SET LOCAL`, and Postgres discards it at COMMIT
 *    or ROLLBACK. A connection returned to the pool therefore cannot carry one
 *    request's organisation into the next request that checks it out. This is
 *    the whole reason the codebase never issues a session-level `SET`: that
 *    variant survives the checkout and turns a pool into a cross-tenant leak
 *    that only appears under concurrency.
 *
 * 2. **It is the first statement in the transaction.** Nothing in `run` can
 *    execute before it, because `run` is not called until the `await` above it
 *    has resolved on the same connection the transaction holds.
 *
 * 3. **Forgetting it is an outage, not a breach.** The policies fail closed on
 *    an unset setting, so a query issued outside this helper reads zero rows
 *    and writes nothing. That is the property that makes the arrangement safe
 *    even where a caller is wrong.
 *
 * The tenant is still ANDed into every query by `createTenantClient`, so a row
 * has to satisfy both layers. The two are deliberately redundant: layer 1 keeps
 * the SQL sensible and the plans narrow, layer 2 is what holds when layer 1 has
 * a bug.
 *
 * Cost: one extra round trip per transaction, plus the BEGIN/COMMIT pair for
 * work that would otherwise have been a single autocommit statement. That is
 * the price of the setting being transaction-scoped, and it is the right trade;
 * a request that issues several queries should be widened to one transaction
 * per request rather than paying it repeatedly.
 */
export function withTenantSession<R>(
  client: PrismaClient,
  context: TenantContext,
  run: (tx: TenantTransactionClient) => Promise<R>
): Promise<R> {
  const scoped = createTenantClient(client, context);
  return scoped.$transaction(async (tx) => {
    // Parameterised, so a tenant id can never be concatenated into SQL. An id
    // that is not a uuid is rejected by the policy's cast rather than silently
    // matching nothing.
    await tx.$executeRaw`SELECT set_config(${TENANT_SETTING}, ${context.tenantId}, true)`;
    return run(tx);
  });
}
