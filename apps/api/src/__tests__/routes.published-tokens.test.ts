import { describe, expect, it } from 'vitest';

import type { ScopedRow } from '../repositories/rows.js';
import {
  bearer,
  createTestApp,
  jsonBearer,
  storageColumns,
  DEMO_FACILITY_A,
  type TestApp,
} from './support.js';

type App = TestApp['app'];

/**
 * The published demo tokens, driven through real routes.
 *
 * `demo-principals.reach.test.ts` proves a role bundle *contains* a permission
 * string. That is one layer out from the thing anybody cares about: whether a
 * request carrying the token gets past `requirePermission`. A bundle can name
 * `audit.read` while the route is gated on something else, or on nothing, and
 * every assertion in that file stays green.
 *
 * So each principal is exercised against the door it exists for, and against a
 * door it must not open. **The refusals are what make the successes mean
 * anything**: a token that opened everything would satisfy every 200 here.
 *
 * Only tokens this project publishes appear below - no synthetic principal from
 * `support.ts`. The suite's own `test-auditor-a` spreads the admin principal and
 * so inherits `user/*.write`, which the shipped `dev-auditor-a` does not have;
 * an assertion driven with it is about a principal no deployment resolves.
 */

/** Tokens a deployment actually publishes, from the two demo tables. */
const PUBLISHED = {
  clinicianA: 'dev-clinician-a',
  auditorA: 'dev-auditor-a',
  stockKeeperA: 'dev-stockkeeper-a',
  readOnlyA: 'dev-readonly-a',
} as const;

async function statusOf(app: App, path: string, token: string): Promise<number> {
  return (await app.request(path, { headers: bearer(token) })).status;
}

describe('the audit trail, which had no reader before these tokens existed', () => {
  it('opens for the auditor and refuses every other published principal', async () => {
    const { app } = createTestApp();

    expect(await statusOf(app, '/bff/v0/audit', PUBLISHED.auditorA)).toBe(200);
    // The controls. Without them a 200 is equally consistent with a route that
    // asks for nothing at all.
    expect(await statusOf(app, '/bff/v0/audit', PUBLISHED.clinicianA)).toBe(403);
    expect(await statusOf(app, '/bff/v0/audit', PUBLISHED.stockKeeperA)).toBe(403);
    // 401, not 403: an unpublished token resolves to no principal, and the
    // difference is what says the 403s above came from the permission layer
    // rather than from authentication.
    expect(await statusOf(app, '/bff/v0/audit', 'dev-not-a-published-token')).toBe(401);
  });

  /**
   * `SUPERVISORY_READS`, exercised through a real token for the first time.
   *
   * `read-only` is built by suffix - every permission ending in `.read` - minus
   * the ones named as supervisory, and `audit.read` is the only member of that
   * set. Before this token existed the filter was exercised by nothing: no
   * principal held the `read-only` bundle, so deleting `SUPERVISORY_READS`
   * changed no test. Now removing `audit.read` from it turns this 403 into a
   * 200, and the audit trail doubles as a who-saw-whom log for every read-only
   * account in the tenant.
   */
  it('refuses the read-only principal, because reading the log is not an ordinary read', async () => {
    const { app } = createTestApp();

    expect(await statusOf(app, '/bff/v0/audit', PUBLISHED.readOnlyA)).toBe(403);
    // The premise: this principal is not simply locked out of everything.
    expect(await statusOf(app, '/bff/v0/patients', PUBLISHED.readOnlyA)).toBe(200);
  });
});

describe('the stock ledger, whose reconciliation half had no counter', () => {
  it('lets the stock-keeper read the ledger and refuses the auditor', async () => {
    const { app, dataset } = createTestApp();
    // The site the ledger is read at. Without it the route answers 404 for
    // everyone, which would pass the refusal half of this test while proving
    // nothing about the permission - a 404 and a 403 are both "not 200".
    const facility: ScopedRow<'Facility'> = {
      ...storageColumns(DEMO_FACILITY_A),
      name: 'Testville Clinic',
      code: 'TVC',
      npi: null,
      posCode: '11',
      timezone: 'UTC',
      addressLine1: null,
      addressLine2: null,
      city: null,
      state: null,
      postalCode: null,
      country: 'US',
      phone: null,
      active: true,
    };
    dataset.table('Facility').push(facility);
    // The facility is required by the query schema, and it is the one this
    // principal is granted - so a 200 here says the permission gate AND the
    // facility narrowing both let it through, not merely the first.
    const lots = `/bff/v0/inventory/lots?facilityId=${DEMO_FACILITY_A}`;

    expect(await statusOf(app, lots, PUBLISHED.stockKeeperA)).toBe(200);
    expect(await statusOf(app, lots, PUBLISHED.auditorA)).toBe(403);
  });

  /**
   * The write door, and the status is the discriminator rather than an accident.
   *
   * `POST /inventory/counts` is gated on `inventory.adjust` - deliberately not
   * `inventory.write`, so that the person who dispenses is not the person who
   * reconciles the difference away. An empty body is refused by the schema, and
   * a schema refusal can only happen *after* the permission gate opened. So 422
   * for the stock-keeper and 403 for everyone else is the whole claim: exactly
   * one published principal reaches the reconciliation half of the ledger.
   */
  it('opens the count door for the stock-keeper alone', async () => {
    const { app } = createTestApp();
    const counts = async (token: string): Promise<number> =>
      (
        await app.request('/bff/v0/inventory/counts', {
          method: 'POST',
          headers: jsonBearer(token),
          body: '{}',
        })
      ).status;

    expect(await counts(PUBLISHED.stockKeeperA)).toBe(422);
    expect(await counts(PUBLISHED.clinicianA)).toBe(403);
    expect(await counts(PUBLISHED.readOnlyA)).toBe(403);
    expect(await counts(PUBLISHED.auditorA)).toBe(403);
  });
});
