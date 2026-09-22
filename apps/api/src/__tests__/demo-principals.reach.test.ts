import { describe, expect, it } from 'vitest';

import { buildDemoPractice } from '@openrunic/database/seed';

import { DEMO_PRINCIPALS } from '../auth/static-resolver.js';
import { PERMISSIONS, ROLE_PERMISSIONS, type Permission } from '../policy/permissions.js';
import { DEMO_TOKENS } from '../server/demo-principals.js';

/**
 * What the tokens this project publishes can and cannot reach.
 *
 * Every permission in the catalogue is enforced by a route. A permission no
 * published principal holds is a route nobody can drive: `audit.read` gated the
 * audit trail the API writes correctly and had no reader, and `inventory.adjust`
 * gated the reconciliation half of the stock ledger and had no counter. Neither
 * was a missing role - `auditor` and `stock-keeper` were both in
 * `ROLE_PERMISSIONS` already. What was missing was a principal.
 *
 * The assertions here name identifiers rather than counting them, on purpose. A
 * count moves for two unrelated reasons - a permission arriving, and a principal
 * arriving - and reports the same number for both, so the failure message says
 * `expected 5 to be 6` about a change nobody can identify from it. Naming the
 * set makes the diff the answer.
 */

/** Every permission the given role bundles put together. */
function reachedBy(roleLists: readonly (readonly string[])[]): ReadonlySet<string> {
  return new Set(
    roleLists.flatMap((roles) => roles.flatMap((role) => ROLE_PERMISSIONS[role] ?? []))
  );
}

function unreachableBy(roleLists: readonly (readonly string[])[]): Permission[] {
  const reached = reachedBy(roleLists);
  return PERMISSIONS.filter((permission) => !reached.has(permission));
}

const PRODUCTION_ROLES = DEMO_TOKENS.map((spec) => spec.roles);
const DEVELOPMENT_ROLES = [...DEMO_PRINCIPALS.values()].map((principal) => principal.roles);

/**
 * What no published token reaches, and why each entry is deliberate.
 *
 * All five are administrative: creating a user, granting a role, adding a site,
 * editing the terminology, and reading across every facility at once. Reaching
 * them means publishing an `admin` token, and `admin` is `PERMISSIONS` entire -
 * including `patient.breakGlass`. Minting a principal that can take deliberate
 * access to any chart in the practice, in order to make five administrative
 * permissions reachable, is a larger decision than this list, and it wants its
 * own argument rather than arriving as a side effect of one.
 *
 * `role.read` is NOT on this list, and it is the entry most likely to surprise:
 * it ends in `.read` and is not supervisory, so `READ_EVERYTHING` holds it and
 * `read-only` reaches it. Granting a role still needs `role.write`.
 */
const NOT_REACHABLE_BY_ANY_PUBLISHED_TOKEN: readonly Permission[] = [
  'user.write',
  'role.write',
  'facility.write',
  'terminology.write',
  'facility.all',
];

describe('what the published demo tokens can reach', () => {
  it('leaves exactly the administrative permissions out of reach, named', () => {
    expect(unreachableBy(PRODUCTION_ROLES)).toStrictEqual([
      ...NOT_REACHABLE_BY_ANY_PUBLISHED_TOKEN,
    ]);
  });

  /**
   * The parity that matters, and it is not the one about token names.
   *
   * The two tables are different objects by design: the static one hardcodes two
   * tenants and synthetic subjects, the production one takes its subject and
   * tenant from seeded rows, and it publishes no second tenant and no portal
   * login. Asserting the token sets are equal would be false. What must never
   * differ is which permissions a deployment can exercise - a principal added to
   * one table and not the other is reachable in exactly the environment where
   * nobody needs it, and every unit test would still pass.
   */
  it('puts the same permissions within reach in development as in production', () => {
    expect(unreachableBy(DEVELOPMENT_ROLES)).toStrictEqual(unreachableBy(PRODUCTION_ROLES));
  });

  /**
   * Drop-one, because "the set is right" does not say any principal earned its
   * place. Removing the auditor has to take `audit.read` out of reach with it;
   * if it does not, something else is granting it and the role is decoration.
   */
  it.each([
    ['auditor', 'audit.read'],
    ['stock-keeper', 'inventory.adjust'],
    ['read-only', 'role.read'],
  ])('is the only reason %s puts %s within reach', (role, permission) => {
    const without = PRODUCTION_ROLES.filter((roles) => !roles.includes(role));

    expect(reachedBy(PRODUCTION_ROLES).has(permission)).toBe(true);
    expect(reachedBy(without).has(permission)).toBe(false);
  });

  /**
   * Every test in this package that authenticates does so against the static
   * table: `createApp` installs it, and `support.ts` spreads it into the map the
   * HTTP suites use. So a token published only by the production resolver is
   * exercised by nothing at all - it ships to self-hosters having never been
   * driven once.
   */
  it('publishes no production token the test suite never authenticates with', () => {
    const development = new Set(DEMO_PRINCIPALS.keys());

    expect(
      DEMO_TOKENS.filter((spec) => !development.has(spec.token)).map((s) => s.token)
    ).toStrictEqual([]);
    expect(development.size).toBeGreaterThan(0);
  });

  /**
   * Scopes, which the reach assertions above cannot see.
   *
   * `unreachableBy` reads roles, and a role says what the product offers. A
   * scope says what the FHIR boundary allows, and `requireScope` decides from it
   * alone - so a token carrying `user/*.write` in one table and `user/*.read` in
   * the other writes FHIR resources in development and is refused in production,
   * or the reverse, with every permission assertion in this file still green.
   */
  it('grants a shared token the same scopes in both tables', () => {
    const development = new Map([...DEMO_PRINCIPALS].map(([token, p]) => [token, p.scopes]));

    expect(
      DEMO_TOKENS.map((spec) => [spec.token, spec.scopes] as const).filter(
        ([token, scopes]) => JSON.stringify(development.get(token)) !== JSON.stringify(scopes)
      )
    ).toStrictEqual([]);
  });

  it('names only roles the catalogue defines', () => {
    const named = [...PRODUCTION_ROLES, ...DEVELOPMENT_ROLES].flat();

    expect(named.filter((role) => ROLE_PERMISSIONS[role] === undefined)).toStrictEqual([]);
    // A typo would otherwise contribute nothing and look like a policy gap.
    expect(named.length).toBeGreaterThan(0);
  });
});

/**
 * THE FAILURE THIS FILE EXISTS FOR SECOND.
 *
 * `createDemoPrincipalResolver` maps a spec onto a seeded `User` by email and
 * `continue`s past any spec whose email has no row - no throw, no log. So a
 * principal added to `demo-principals.ts` without a matching seed user resolves
 * to nothing on a real database while every test in the suite stays green, and
 * the operator's diagnostic is a 401 with no explanation anywhere.
 *
 * The check reads the seed's own builder rather than a fixture that describes
 * it, because a hand-written mirror of the seed is the thing being guarded
 * against.
 */
describe('the seed behind the demo tokens', () => {
  it('seeds a user for every published token, or the token 401s in silence', () => {
    const seeded = new Set(buildDemoPractice().users.map((user) => String(user.email)));

    expect(
      DEMO_TOKENS.filter((spec) => !seeded.has(spec.email)).map((spec) => spec.token)
    ).toStrictEqual([]);
    expect(seeded.size).toBeGreaterThan(0);
  });
});
