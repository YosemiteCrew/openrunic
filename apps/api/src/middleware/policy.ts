import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';

import type { AppEnv } from '../context.js';
import { ApiError } from '../errors.js';
import { buildPolicyContext } from '../policy/policy.js';
import type { Permission } from '../policy/permissions.js';

/**
 * Stage 4 of the chain. Resolves the principal's roles into a
 * {@link PolicyContext} once per request.
 *
 * The middleware only *builds* the context; it enforces nothing, because what
 * is required differs per route. Routes declare their requirement with
 * {@link requirePermission}, which is the only place a 403 for a missing
 * capability is raised.
 */
export function policyContext() {
  return createMiddleware<AppEnv>(async (c, next) => {
    const principal = c.get('principal');
    if (principal !== undefined) {
      c.set('policy', buildPolicyContext(principal));
    }
    await next();
  });
}

/**
 * Route guard: the request must carry `permission`.
 *
 * Fails closed in both directions. No principal is a 401 even if the route was
 * never listed as public, and no policy context is a 403 rather than a pass,
 * so mounting a route outside the chain denies instead of exposing.
 *
 * Denials are audited before the error propagates: an attempt that was refused
 * is exactly the event a breach investigation needs, and it is the one an
 * error-path shortcut would drop.
 */
export function requirePermission(permission: Permission) {
  return createMiddleware<AppEnv>(async (c, next) => {
    await enforce(c, permission);
    await next();
  });
}

/**
 * The same guard, asked from inside a handler.
 *
 * For a route whose requirement depends on what was asked for rather than on
 * which route it is: releasing a lot back into use needs `inventory.adjust`
 * while quarantining one needs only `inventory.write`, and the two arrive at
 * the same path. Sharing {@link enforce} is the point - a second copy would be
 * a second place the denial audit could be forgotten, and the denial is the
 * event a breach investigation reads.
 *
 * Only ever a narrowing. The route's own `requirePermission` has already run,
 * so this cannot be the only check standing between a caller and a write.
 */
export function assertPermission(c: Context<AppEnv>, permission: Permission): Promise<void> {
  return enforce(c, permission);
}

async function enforce(c: Context<AppEnv>, permission: Permission): Promise<void> {
  const principal = c.get('principal');
  if (principal === undefined) {
    throw ApiError.unauthenticated('A bearer token is required.');
  }

  const policy = c.get('policy');
  if (policy === undefined || !policy.can(permission)) {
    await c.get('audit')?.denial({
      action: 'authorisation.denied',
      targetType: 'Route',
      targetId: c.req.path,
      metadata: { permission, roles: [...principal.roles] },
    });
    throw ApiError.forbidden(`This role does not hold the ${permission} permission.`);
  }
}

/**
 * Route guard for facility-scoped rows: the principal must hold a grant for
 * `facilityId`, or the organisation-wide `facility.all` permission.
 *
 * Absence denies, the same way {@link requirePermission} treats it: the
 * optional call yields `undefined` when there is no policy context at all, and
 * that is a 403 rather than a pass, so a route mounted outside the chain
 * refuses instead of exposing.
 */
export function assertFacilityAccess(
  policy: ReturnType<typeof buildPolicyContext> | undefined,
  facilityId: string
): void {
  if (!policy?.canAccessFacility(facilityId)) {
    throw ApiError.forbidden('This principal has no grant for that facility.');
  }
}
