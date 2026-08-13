import { createMiddleware } from 'hono/factory';

import type { AppEnv } from '../context.js';
import { ApiError } from '../errors.js';

/**
 * Header a client may send to state which organisation it believes it is
 * addressing. It is an assertion to be checked, never a source of scope.
 */
export const TENANT_HEADER = 'x-openrunic-tenant';

/**
 * Stage 3 of the chain. Fixes the organisation for the rest of the request.
 *
 * The tenant comes from the verified principal and from nowhere else. If the
 * request also *names* a tenant - a multi-tenant console sending the header, a
 * probe trying its luck - the two must agree, and a mismatch is a 403 rather
 * than a silent fallback to the principal's own tenant. A silent fallback would
 * make the header look like it worked, and the difference between "ignored" and
 * "honoured" is the difference between a bug report and a breach.
 *
 * Cross-tenant *data* access is not defended here. It is defended by the fact
 * that the repositories this middleware installs are already bound to
 * `tenantId`, so no handler can name another organisation (see
 * `repositories/types.ts`), and by RLS underneath that.
 */
export function tenantScope() {
  return createMiddleware<AppEnv>(async (c, next) => {
    const principal = c.get('principal');
    if (principal === undefined) {
      await next();
      return;
    }

    const asserted = c.req.header(TENANT_HEADER);
    if (asserted !== undefined && asserted !== principal.tenantId) {
      throw ApiError.forbidden('The request names an organisation this principal cannot access.');
    }

    c.set('tenantId', principal.tenantId);
    await next();
  });
}
