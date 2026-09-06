import { describe, expect, it } from 'vitest';

import { buildPolicyContext } from '../policy/policy.js';
import { PERMISSIONS } from '../policy/permissions.js';
import { DEMO_PRINCIPALS } from '../auth/static-resolver.js';
import { sessionRouteContracts } from '../routes/session.js';

import { bearer, createTestApp, TOKENS, type TestApp } from './support.js';

/**
 * `/bff/v0/me` PUBLISHES THE SET THE API ENFORCES, NOT A COPY OF IT.
 *
 * The route exists so a client can stop offering an action the server will
 * refuse - #313, where the staff application carried role keys it never read and
 * showed a biller "Sign orders". Its whole value is that the answer comes from
 * the same place the refusal does, so these tests assert against
 * `buildPolicyContext` rather than against a list written here: a list written
 * here would be the second table the route exists to avoid.
 */
describe('GET /bff/v0/me', () => {
  function app(): TestApp['app'] {
    return createTestApp().app;
  }

  it('answers with exactly what buildPolicyContext resolved, not a copy', async () => {
    /* Every demo principal, not one: a route that happened to be right for the
       clinician and wrong for the biller is the defect this closes. */
    for (const [token, principal] of DEMO_PRINCIPALS) {
      const response = await app().request('/bff/v0/me', { headers: bearer(token) });
      expect(response.status, token).toBe(200);

      const body = (await response.json()) as { roles: string[]; permissions: string[] };
      const expected = [...buildPolicyContext(principal).permissions].sort((a, b) =>
        a.localeCompare(b)
      );

      expect(body.permissions, token).toStrictEqual(expected);
      expect(body.roles, token).toStrictEqual([...principal.roles]);
    }
  });

  it('separates the roles the UI has to tell apart', async () => {
    /* The one fact #313 turns on: the clinician may sign an order and the biller
       may not. Asserted as a difference rather than as two memberships, because
       a route returning every permission to everybody would satisfy both
       memberships and none of the point. */
    const read = async (token: string): Promise<string[]> => {
      const response = await app().request('/bff/v0/me', { headers: bearer(token) });
      return ((await response.json()) as { permissions: string[] }).permissions;
    };

    const clinician = await read(TOKENS.clinicianA);
    const biller = await read(TOKENS.billerA);

    expect(clinician).toContain('order.write');
    expect(biller).not.toContain('order.write');
  });

  it('refuses an anonymous caller', async () => {
    const response = await app().request('/bff/v0/me');
    expect(response.status).toBe(401);
  });

  it('returns permissions sorted, so two calls are comparable', async () => {
    const response = await app().request('/bff/v0/me', { headers: bearer(TOKENS.clinicianA) });
    const { permissions } = (await response.json()) as { permissions: string[] };
    expect(permissions).toStrictEqual([...permissions].sort((a, b) => a.localeCompare(b)));
    expect(new Set(permissions).size).toBe(permissions.length);
  });

  it('publishes only identifiers the API enforces', async () => {
    /* The subset assertion that fails when a hand-typed or renamed identifier
       arrives. A client keys its own behaviour off these strings, so an id that
       exists nowhere in `PERMISSIONS` is a capability nothing will ever grant. */
    const enforced = new Set<string>(PERMISSIONS);
    for (const [token] of DEMO_PRINCIPALS) {
      const response = await app().request('/bff/v0/me', { headers: bearer(token) });
      const { permissions } = (await response.json()) as { permissions: string[] };
      for (const permission of permissions) {
        expect(enforced.has(permission), `${token}: ${permission}`).toBe(true);
      }
    }
  });

  it('is published as a route that needs a token and no capability', () => {
    /* `permission: undefined` reads as PUBLIC to anyone scanning `RouteContract`,
       so the description has to say what is actually true of this one. */
    const [contract] = sessionRouteContracts();
    expect(contract?.path).toBe('/bff/v0/me');
    expect(contract?.permission).toBeUndefined();
    expect(contract?.description).toContain('bearer token and no capability');
    expect(contract?.responses.map((response) => response.status)).toContain(401);
  });
});
