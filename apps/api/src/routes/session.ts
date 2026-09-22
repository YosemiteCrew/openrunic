import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context.js';
import { ApiError } from '../errors.js';
import type { RouteContract } from '../openapi/registry.js';
import { byPermissionId } from '../policy/permissions.js';
import { policyOf } from './helpers.js';

/**
 * What the caller may do, as the API decided it.
 *
 * This exists so a client can stop offering an action the server is going to
 * refuse. Before it, the staff application carried role keys it never read -
 * `lib/auth/session.ts` says so in a comment - so a biller was shown "Sign
 * orders", pressed it, and learned the answer from a 403 after composing the
 * whole order.
 *
 * It returns the SET, not the rule that produced it. Publishing
 * `ROLE_PERMISSIONS` instead would hand the browser a table without the loop
 * that reads it, and the browser would have to re-implement
 * `buildPolicyContext` - including its decision that an unknown role
 * contributes nothing rather than throwing. Two implementations of one
 * authorisation rule, both citing the same source, is a divergence with nothing
 * to grep for.
 *
 * It is also downstream of how roles are resolved, which is deliberate: the
 * resolvers are being changed (#302), and a client reading this route is
 * unaffected by that work, where a client re-deriving from roles would not be.
 *
 * NOT a security boundary. Every route this informs still enforces its own
 * permission; this only stops the client offering what it already knows will be
 * refused.
 */
export const principalCapabilitiesDtoSchema = z
  .strictObject({
    /** Role keys, exactly as the principal carries them. */
    roles: z.array(z.string()),
    /**
     * Every permission this principal holds, sorted, so two calls that mean the
     * same thing are byte-identical and a client may compare them.
     */
    permissions: z.array(z.string()),
    /**
     * The caller's own `User` id, when the caller is a member of staff.
     *
     * Null for a patient or a service principal, whose subject identifies a
     * different table entirely. It is here because several staff surfaces are
     * defined in terms of the caller - a personal task inbox is
     * `assigneeUserId` equal to this - and the browser had no way to name
     * itself: it holds a bearer token that the API resolves to a subject, and
     * nothing in the token is the API's own identifier for that person.
     *
     * Publishing it discloses nothing: it is the id of whoever is already
     * holding the token.
     */
    userId: z.uuid().nullable(),
  })
  .meta({ id: 'PrincipalCapabilities' });

export function sessionRoutes(): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  router.get('/me', (c) => {
    const policy = policyOf(c);
    const principal = c.get('principal');
    if (policy === undefined) {
      /* A wiring assertion, not a path a client can reach: the policy context is
         built by middleware for every route under this mount. */
      throw ApiError.unauthenticated('A bearer token is required.');
    }

    return c.json({
      roles: [...policy.roles],
      /* `byPermissionId`, never `localeCompare`: this order is promised to be
         byte-identical to the browser mirror's, and those are two runtimes with
         independently configured locales. See the comparator for the
         measurement. */
      permissions: [...policy.permissions].sort(byPermissionId),
      /* `actorType`, not a uuid shape test: a Patient id is a uuid too, and
         answering one here would point a staff query at the wrong table. */
      userId: principal?.actorType === 'user' ? principal.subject : null,
    });
  });

  return router;
}

export function sessionRouteContracts(): RouteContract[] {
  return [
    {
      method: 'get',
      path: '/bff/v0/me',
      operationId: 'readOwnCapabilities',
      summary: 'What the caller may do.',
      description:
        "Returns the caller's own roles and the permissions the API resolved from them. Requires a bearer token and no capability: a principal may always read its own. Published so a client can disable an action it knows will be refused rather than offering it and failing after the click. It is not a security boundary - every route still enforces its own permission. It also carries the caller's own `User` id, null unless the caller is staff, because a surface defined in terms of the caller - a personal inbox, work assigned to me - cannot be asked for by a client that cannot name itself.",
      tags: ['platform'],
      authenticatedOnly: true,
      responses: [
        {
          status: 200,
          description: 'The caller, as this deployment sees them.',
          schema: principalCapabilitiesDtoSchema,
        },
        { status: 401, description: 'No bearer token, or not a valid one.' },
      ],
    },
  ];
}
