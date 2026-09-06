import { describe, expect, it } from 'vitest';

import { PERMISSIONS, ROLE_MODEL_CAVEAT } from '../policy/permissions.js';
import { internalRouteContracts } from '../routes/index.js';

/**
 * Every permission in the catalogue gates at least one published operation.
 *
 * This is the mirror of `demo-principals.reach.test.ts`, which asks whether a
 * permission is reachable by a token. This one asks the other half: whether it
 * decides anything at all. A permission that gates no route is a capability the
 * product describes and never enforces, and the two failures compose - a
 * permission that is neither reachable nor enforced is a sentence in a
 * catalogue.
 *
 * The assertion is an empty list rather than a count. A count moves when a
 * permission is added and when a route is removed and reports the same number
 * for both; the list names the identifier, which is the only thing that says
 * what to do next.
 */

function permissionsGatingARoute(): ReadonlyMap<string, string[]> {
  const gated = new Map<string, string[]>();
  for (const contract of internalRouteContracts()) {
    const permission = (contract as { permission?: string }).permission;
    if (permission === undefined) continue;
    const operation = `${String(contract.method).toUpperCase()} ${contract.path}`;
    gated.set(permission, [...(gated.get(permission) ?? []), operation]);
  }
  return gated;
}

describe('the permission catalogue against the published routes', () => {
  it('leaves no permission gating nothing', () => {
    const gated = permissionsGatingARoute();

    expect(PERMISSIONS.filter((permission) => !gated.has(permission))).toStrictEqual([]);
    // The premise. An empty expectation is satisfied by an empty catalogue and
    // by a registry that produced no contracts, and neither would be this
    // assertion passing.
    expect(PERMISSIONS.length).toBeGreaterThan(0);
    expect(gated.size).toBe(PERMISSIONS.length);
  });

  it('gates every operation on a permission the catalogue defines', () => {
    const known: ReadonlySet<string> = new Set<string>(PERMISSIONS);

    expect([...permissionsGatingARoute().keys()].filter((p) => !known.has(p))).toStrictEqual([]);
  });
});

/**
 * THE STATEMENT THIS PR EXISTS TO MAKE, PINNED WHERE IT IS PUBLISHED.
 *
 * `Role` and `RoleAssignment` are written by six operations and read by none of
 * the enforcement path, so the document has to say that a grant recorded there
 * changes nothing yet. A seventh operation added on either permission without
 * the caveat would publish the false statement again, and nothing else in the
 * suite would notice - the route would be documented, mounted, permission-gated
 * and wrong only in what it implies.
 */
describe('the role model the enforcement path does not read', () => {
  it('carries the caveat on every operation gated on a role permission', () => {
    const rolish = internalRouteContracts().filter((contract) => {
      const permission = (contract as { permission?: string }).permission;
      return permission === 'role.read' || permission === 'role.write';
    });

    const missing = rolish
      .filter(
        (contract) =>
          !((contract as { description?: string }).description ?? '').includes(ROLE_MODEL_CAVEAT)
      )
      .map((contract) => `${String(contract.method).toUpperCase()} ${contract.path}`);

    expect(missing).toStrictEqual([]);
    // Six today. Named rather than counted so that adding one is visible here
    // as an identifier, and so an empty `rolish` cannot pass the check above.
    expect(rolish.map((c) => `${String(c.method).toUpperCase()} ${c.path}`).sort()).toStrictEqual([
      'GET /bff/v0/roles',
      'GET /bff/v0/roles/{id}',
      'GET /bff/v0/users/{id}/roles',
      'PATCH /bff/v0/roles/{id}',
      'POST /bff/v0/roles',
      'POST /bff/v0/users/{id}/roles',
    ]);
  });

  it('says what is true rather than only that something is unfinished', () => {
    // The sentence has to name the mechanism, or a reader cannot tell whether
    // their grant is pending, ignored, or applied somewhere else.
    expect(ROLE_MODEL_CAVEAT).toContain('roles on the caller');
    expect(ROLE_MODEL_CAVEAT).toContain('does not change what any user may do');
  });
});
