import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Every BFF route addressed by a patient id consults the care relationship.
 *
 * ADR-0007 said the rule should live where a new route inherits it rather than
 * in something a route can forget to call, and gave the reason: "not in
 * middleware that a new route can forget to apply". This implementation put it
 * in a call the handler makes, and the prediction came true twice inside one
 * pull request - `/patients/:id/ccd` and `/patients/:id/growth` both took the
 * same id, returned more of the chart than the gated read, and did not ask.
 *
 * Moving the check into the repository layer, as the ADR wants, is a larger
 * change than the one that introduced it. This is the property without the
 * rewrite: a route matching `/patients/:id/...` must either call
 * `assertCareRelationship` or say in `NOT_A_CHART_READ` why it does not.
 *
 * A source scan rather than a request, deliberately. The failure being caught is
 * a route nobody thought about, and a test that drives requests only covers the
 * routes somebody remembered to drive.
 */

const ROUTES_DIR = new URL('../routes/', import.meta.url).pathname;

/** Routes on a patient id that legitimately make no relationship check. */
const NOT_A_CHART_READ: Readonly<Record<string, string>> = {
  '/patients/:id/break-glass':
    'this is the route you take because you have no relationship, so gating it on one would be circular. What bounds it instead is a separate permission, a staff-only actor check, a ceiling on concurrent grants, and an audited refusal.',
};

function routeFiles(): string[] {
  return readdirSync(ROUTES_DIR)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .map((name) => join(ROUTES_DIR, name));
}

/**
 * Every `'/patients/:id/...'` route a file registers, with the handler that
 * follows it.
 *
 * The handler is taken as the source from the path literal to the next route
 * registration, because what matters is whether THIS route asks, not whether
 * some other route in the same file does. An earlier version looked at the
 * whole file and passed on the import line alone: deleting the call from the
 * growth handler left the suite green, which is the exact failure this is
 * supposed to catch.
 */
function patientAddressedRoutes(): { path: string; file: string; handler: string }[] {
  const found: { path: string; file: string; handler: string }[] = [];
  for (const file of routeFiles()) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/'(\/patients\/:id(?:\/[a-z-]+)?)'/g)) {
      const from = match.index ?? 0;
      const next = source.slice(from + 1).search(/\brouter\.(get|post|patch|put|delete)\(/);
      const handler = source.slice(from, next === -1 ? source.length : from + 1 + next);
      found.push({ path: match[1] ?? '', file, handler });
    }
  }
  return found;
}

describe('every patient-addressed BFF route asks about the care relationship', () => {
  const routes = patientAddressedRoutes();

  it('finds the routes at all, so the scan cannot pass by matching nothing', () => {
    /* The guard on the guard. A rename that broke the pattern would leave this
       suite green while checking nothing, which is the failure mode of every
       test that greps. */
    expect(routes.length).toBeGreaterThanOrEqual(3);
    expect(routes.map((route) => route.path)).toContain('/patients/:id');
  });

  it.each([...new Set(routes.map((route) => route.path))])('%s', (path) => {
    const reason = NOT_A_CHART_READ[path];
    const files = routes.filter((route) => route.path === path);

    if (reason !== undefined) {
      expect(reason.length, `${path} is exempted with an empty reason`).toBeGreaterThan(20);
      return;
    }

    /* The call, not the identifier: an import satisfies `includes` and proves
       nothing about whether this handler runs it. */
    for (const { file, handler } of files) {
      expect(
        handler.includes('assertCareRelationship('),
        `${path} in ${file.split('/').pop() ?? file} reads a chart by id and never ` +
          'calls assertCareRelationship. Call it, or add the path to NOT_A_CHART_READ ' +
          'with the reason it is not a chart read.'
      ).toBe(true);
    }
  });
});
