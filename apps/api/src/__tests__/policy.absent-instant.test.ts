import type { Context } from 'hono';
import { describe, expect, it } from 'vitest';

import type { Principal } from '../auth/principal.js';
import type { AppEnv, AppVariables } from '../context.js';
import { assertCareRelationship } from '../middleware/policy.js';
import type { PolicyContext } from '../policy/policy.js';
import type { Repositories } from '../repositories/types.js';

import { testId } from './support.js';

/**
 * The chart gate when the context carries no instant (#436).
 *
 * `AppVariables` declares `receivedAt: Date`, not `receivedAt?: Date`, so
 * `c.get('receivedAt')` is typed non-optional and an absent one is not a type
 * error anywhere - the declaration was doing the work of a check. The chain
 * sets it in stage 1, so the only way to reach this is a route mounted outside
 * the chain, which is the same wiring assertion the `policy` and `repositories`
 * arms of that condition exist for.
 *
 * It is not the same COST, which is why it has cases of its own rather than a
 * line in `helpers.test.ts`. An absent `policy` or `repositories` decides
 * nothing. An absent instant decides WRONGLY: it reaches `findCareRelationship`
 * as `at: undefined`, both ports read `unexpiredAt === undefined` as no expiry
 * filter at all (`repositories/specs/core.ts:741` and `:749`), and an EXPIRED
 * break-glass grant then authorises the read - recorded as
 * `chart.access.breakGlass`, the loudest line in the trail, on a grant that
 * had run out.
 *
 * A hand-built stub rather than a request against the app, for the reason
 * `helpers.test.ts` gives: the live chain cannot produce this context, so the
 * only way to reach the branch is to build one it could not have made.
 */
function contextWith(variables: Partial<AppVariables>): Context<AppEnv> {
  return {
    get: (key: keyof AppVariables) => variables[key],
  } as unknown as Context<AppEnv>;
}

const PRINCIPAL: Principal = {
  subject: testId(900),
  tenantId: testId(1),
  actorType: 'user',
  roles: ['clinician'],
  facilityIds: [],
  scopes: [],
  purposeOfUse: 'TREAT',
};

const NOW = new Date('2026-08-13T09:00:00.000Z');
/** An hour before `NOW`: the grant has run out. */
const EXPIRES_AT = new Date(NOW.getTime() - 60 * 60 * 1000);

/**
 * Repositories answering only the break-glass source, applying the expiry the
 * memory port applies (`core.ts:741`) - a row is a hit unless `unexpiredAt` is
 * given AND the grant expired at or before it. Break-glass is first in
 * `RELATIONSHIP_SOURCES` and short-circuits, so nothing else is reached.
 */
function repositoriesHoldingOneExpiredGrant(): Repositories {
  return {
    breakGlassGrants: {
      list: (query: { unexpiredAt?: Date }) =>
        Promise.resolve({
          total: query.unexpiredAt !== undefined && EXPIRES_AT <= query.unexpiredAt ? 0 : 1,
        }),
    },
  } as unknown as Repositories;
}

describe('the chart gate with no instant on the context', () => {
  it('refuses instead of letting an expired break-glass grant authorise', async () => {
    const context = contextWith({
      principal: PRINCIPAL,
      policy: {} as PolicyContext,
      repositories: repositoriesHoldingOneExpiredGrant(),
      // receivedAt deliberately absent - the whole case.
    });

    await expect(assertCareRelationship(context, testId(1))).rejects.toThrow('No such patient.');
  });

  it('still authorises a live grant when the instant is there', async () => {
    /* Must not fire. Without it the case above is equally satisfied by a gate
       that refuses everything, and the arm would read as covered while
       measuring nothing. */
    const context = contextWith({
      principal: PRINCIPAL,
      policy: {} as PolicyContext,
      repositories: repositoriesHoldingOneExpiredGrant(),
      /* An hour before the grant ran out, so the same fixture is a hit. */
      receivedAt: new Date(EXPIRES_AT.getTime() - 60 * 60 * 1000),
    });

    await expect(assertCareRelationship(context, testId(1))).resolves.toBeUndefined();
  });

  it('has a fixture that reports the expired grant as a hit when asked without one', async () => {
    /* The fixture's own control. If the stub returned 0 either way, the first
       case would pass on a repository that authorises nobody rather than on
       the guard, and the mutation that removes the guard would stay green. */
    const grants = repositoriesHoldingOneExpiredGrant().breakGlassGrants;

    await expect(grants.list({} as never)).resolves.toMatchObject({ total: 1 });
    await expect(grants.list({ unexpiredAt: NOW } as never)).resolves.toMatchObject({ total: 0 });
  });
});
