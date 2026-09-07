import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { COLLECTION_SPECS } from '../repositories/specs/index.js';

import {
  bearer,
  createTestApp,
  DEMO_FACILITY_A,
  DEMO_FACILITY_B,
  DEMO_TENANT_A,
  FIXED_NOW,
  makePatientRow,
  seed,
  seedCareRelationship,
  testId,
  TOKENS,
} from './support.js';

/**
 * The BFF gates a clinical read by the care relationship, not by knowing the id.
 *
 * #247 established that a chart read needs a relationship, and closed it on the
 * FHIR boundary and on `/patients/:id`. It did not reach the generic BFF CRUD
 * resources: `GET /bff/v0/problems/:id`, `?patientId=`, and the amendments,
 * across every clinical, order and financial aggregate. Those took the same id
 * `GET /fhir/Condition/{id}` refuses and answered 200, so a clinician with the
 * plain read permission could open any chart in the tenant - a different
 * facility's included, because a condition carries no facility of its own.
 *
 * The gate lives in the CRUD seam, keyed off each aggregate's `chartFrom`. The
 * enumeration guard below is what keeps it from rotting: an aggregate whose spec
 * says it is chart data (a `patientColumn`) and whose route forgets `chartFrom`
 * fails here rather than in production.
 */

const ROUTES_DIR = new URL('../routes/', import.meta.url).pathname;

interface CrudDecl {
  readonly file: string;
  readonly key: string;
  readonly chartFrom: string | undefined;
  /**
   * The URL segment the resource mounts on, so `/bff/v0/${segment}` is its
   * base. Read here rather than in a second scan because it comes out of the
   * same chunk as the key: the two describe one `defineCrud` call, and a scan
   * that found one and not the other would be describing two different lists.
   */
  readonly segment: string | undefined;
}

/**
 * Every `defineCrud` in the route files, with the collection key it serves and
 * the `chartFrom` it declares (if any).
 *
 * A source scan, and split on `defineCrud(` so each chunk holds exactly one
 * call's body: the failure being caught is an aggregate nobody thought to gate,
 * and a test that drives requests only covers the ones somebody drove.
 */
function crudDeclarations(): CrudDecl[] {
  const decls: CrudDecl[] = [];
  const files = readdirSync(ROUTES_DIR).filter(
    (name) => name.endsWith('.ts') && !name.endsWith('.test.ts')
  );
  for (const name of files) {
    const source = readFileSync(join(ROUTES_DIR, name), 'utf8');
    const chunks = source.split('defineCrud(');
    for (let i = 1; i < chunks.length; i += 1) {
      const chunk = chunks[i] ?? '';
      const key = /collection:\s*\(repos[^)]*\)\s*=>\s*repos\.(\w+)/.exec(chunk)?.[1];
      if (key === undefined) continue;
      const chartFrom = /chartFrom:\s*'(\w+)'/.exec(chunk)?.[1];
      const segment = /segment:\s*'([^']+)'/.exec(chunk)?.[1];
      decls.push({ file: name, key, chartFrom, segment });
    }
  }
  return decls;
}

describe('every chart-bearing BFF aggregate declares its chart', () => {
  const decls = crudDeclarations();

  it('found the CRUD declarations to check', () => {
    // A guard whose scan silently matched nothing would pass forever. There are
    // well over a dozen CRUD aggregates across the route files.
    expect(decls.length).toBeGreaterThan(15);
  });

  it.each(decls.map((d) => [`${d.file}:${d.key}`, d] as const))(
    '%s gates iff its spec is chart data',
    (_label, decl) => {
      const spec = (COLLECTION_SPECS as Record<string, { patientColumn?: string }>)[decl.key];
      expect(spec, `no spec named ${decl.key}`).toBeDefined();
      const isChart = spec?.patientColumn !== undefined;

      if (isChart) {
        expect(
          decl.chartFrom,
          `${decl.key} is chart data (patientColumn) but its route sets no chartFrom, so its reads bypass the care-relationship gate`
        ).toBe(decl.key);
      } else {
        expect(
          decl.chartFrom,
          `${decl.key} is not chart data but declares chartFrom, which would refuse it for want of a relationship it can never have`
        ).toBeUndefined();
      }
    }
  );
});

/**
 * The routes the enumeration above cannot see, and the reason it cannot.
 *
 * `crudDeclarations` splits the route files on `defineCrud(`, so a route
 * registered by hand - `router.post('/notes/:id/sign', ...)` - produces no
 * chunk at all and the guard above has no opinion on it. Its canary,
 * `decls.length > 15`, is derived from that same scan, so it can confirm the
 * scan found what the scan looks for and can say nothing about a door the scan
 * does not enumerate. That is how six hand-registered routes in `clinical.ts`
 * served writes on charts whose own read was refused (#315) while this file was
 * green, and how three more in `financial.ts` did the same for reads (#300).
 *
 * The independent input is Hono's OWN route table, taken from a mounted app.
 * It is not a regex over source, so it cannot be blind to a REGISTRATION
 * syntax - a multi-line registration, a template-literal path and a route
 * mounted under a prefix all appear in it identically - and it cannot report a
 * route that is not actually served. It can still be blind to a PATH, which is
 * a different claim and a narrower one: see `isSubResource`, which is keyed on
 * the shape `/:<param>/` rather than on the literal `:id/` that every one of
 * these routes happens to use today.
 *
 * SCOPE, stated because a guard that implies more than it checks is the thing
 * this file keeps getting wrong: this covers routes with a path segment AFTER
 * `:id`, which is the shape every instance of the bypass has had - a sub-
 * resource or an action on a parent row that the CRUD seam does not generate.
 * It does NOT cover a hand-registered route with no `:id`, of which
 * `POST /bff/v0/medications/screen` is one; that route takes its chart from the
 * body and is gated and driven in `policy.care-relationship.test.ts`.
 *
 * What this asserts is that the inventory is COMPLETE, not that each row is
 * gated. Adding a route without classifying it fails here, and classifying it
 * puts its parent's chart-bearing status in front of whoever adds it. Which
 * rows have a driven refusal is a separate question, answered by the cases in
 * `policy.care-relationship.test.ts` rather than by a field here that nothing
 * could check.
 */
describe('every hand-registered sub-resource route is accounted for', () => {
  interface SubResourceRoute {
    /** `METHOD /path`, exactly as Hono reports it. */
    readonly route: string;
    /**
     * The collection whose row the `:id` names, or `undefined` when the parent
     * is not a repository collection at all.
     */
    readonly parent: string | undefined;
  }

  const INVENTORY: readonly SubResourceRoute[] = [
    { route: 'GET /bff/v0/claims/:id/history', parent: 'claims' },
    { route: 'GET /bff/v0/claims/:id/lines', parent: 'claims' },
    { route: 'GET /bff/v0/inventory/items/:id/stock', parent: 'stockItems' },
    { route: 'GET /bff/v0/messages/threads/:id/messages', parent: 'messageThreads' },
    { route: 'GET /bff/v0/notes/:id/addenda', parent: 'notes' },
    { route: 'GET /bff/v0/patients/:id/ccd', parent: 'patients' },
    { route: 'GET /bff/v0/patients/:id/growth', parent: 'patients' },
    { route: 'GET /bff/v0/payments/:id/allocations', parent: 'payments' },
    { route: 'GET /bff/v0/quality/measures/:id/report', parent: undefined },
    { route: 'GET /bff/v0/remittances/:id/lines', parent: 'remittances' },
    { route: 'GET /bff/v0/results/:id/observations', parent: 'reports' },
    { route: 'GET /bff/v0/users/:id/roles', parent: 'users' },
    { route: 'POST /bff/v0/appointments/:id/telehealth', parent: 'appointments' },
    { route: 'POST /bff/v0/charges/:id/void', parent: 'charges' },
    { route: 'POST /bff/v0/claims/:id/scrub', parent: 'claims' },
    { route: 'POST /bff/v0/claims/:id/status', parent: 'claims' },
    { route: 'POST /bff/v0/claims/:id/submit', parent: 'claims' },
    { route: 'POST /bff/v0/coverage/:id/eligibility', parent: 'coverages' },
    { route: 'POST /bff/v0/documents/:id/file', parent: 'documents' },
    { route: 'POST /bff/v0/documents/:id/reject', parent: 'documents' },
    { route: 'POST /bff/v0/documents/:id/supersede', parent: 'documents' },
    { route: 'POST /bff/v0/encounters/:id/sign', parent: 'encounters' },
    { route: 'POST /bff/v0/forms/definitions/:id/publish', parent: 'formDefinitions' },
    { route: 'POST /bff/v0/forms/definitions/:id/retire', parent: 'formDefinitions' },
    { route: 'POST /bff/v0/forms/submissions/:id/amend', parent: 'formSubmissions' },
    { route: 'POST /bff/v0/forms/submissions/:id/complete', parent: 'formSubmissions' },
    { route: 'POST /bff/v0/forms/submissions/:id/sign', parent: 'formSubmissions' },
    { route: 'POST /bff/v0/medications/prescriptions/:id/cancel', parent: 'prescriptions' },
    { route: 'POST /bff/v0/medications/prescriptions/:id/sign', parent: 'prescriptions' },
    { route: 'POST /bff/v0/medications/prescriptions/:id/transmit', parent: 'prescriptions' },
    { route: 'POST /bff/v0/messages/:id/read', parent: 'messages' },
    { route: 'POST /bff/v0/messages/threads/:id/close', parent: 'messageThreads' },
    { route: 'POST /bff/v0/messages/threads/:id/messages', parent: 'messageThreads' },
    { route: 'POST /bff/v0/notes/:id/addenda', parent: 'notes' },
    { route: 'POST /bff/v0/notes/:id/sign', parent: 'notes' },
    { route: 'POST /bff/v0/orders/:id/cancel', parent: 'orders' },
    { route: 'POST /bff/v0/orders/:id/sign', parent: 'orders' },
    { route: 'POST /bff/v0/orders/:id/transmit', parent: 'orders' },
    { route: 'POST /bff/v0/patients/:id/break-glass', parent: 'patients' },
    { route: 'POST /bff/v0/payments/:id/post', parent: 'payments' },
    { route: 'POST /bff/v0/payments/:id/refund', parent: 'payments' },
    { route: 'POST /bff/v0/payments/:id/void', parent: 'payments' },
    { route: 'POST /bff/v0/referrals/:id/accept', parent: 'referrals' },
    { route: 'POST /bff/v0/referrals/:id/cancel', parent: 'referrals' },
    { route: 'POST /bff/v0/referrals/:id/decline', parent: 'referrals' },
    { route: 'POST /bff/v0/referrals/:id/report', parent: 'referrals' },
    { route: 'POST /bff/v0/referrals/:id/schedule', parent: 'referrals' },
    { route: 'POST /bff/v0/referrals/:id/seen', parent: 'referrals' },
    { route: 'POST /bff/v0/referrals/:id/send', parent: 'referrals' },
    { route: 'POST /bff/v0/remittances/:id/parse', parent: 'remittances' },
    { route: 'POST /bff/v0/remittances/:id/post', parent: 'remittances' },
    { route: 'POST /bff/v0/results/:id/review', parent: 'reports' },
    { route: 'POST /bff/v0/specimens/:id/receive', parent: 'specimens' },
    { route: 'POST /bff/v0/specimens/:id/reject', parent: 'specimens' },
    { route: 'POST /bff/v0/statements/:id/generate', parent: 'statements' },
    { route: 'POST /bff/v0/statements/:id/hold', parent: 'statements' },
    { route: 'POST /bff/v0/statements/:id/notice', parent: 'statements' },
    { route: 'POST /bff/v0/statements/:id/send', parent: 'statements' },
    { route: 'POST /bff/v0/statements/:id/write-off', parent: 'statements' },
    { route: 'POST /bff/v0/tasks/:id/cancel', parent: 'tasks' },
    { route: 'POST /bff/v0/tasks/:id/complete', parent: 'tasks' },
    { route: 'POST /bff/v0/telehealth/:id/end', parent: 'telehealthVisits' },
    { route: 'POST /bff/v0/telehealth/:id/join', parent: 'telehealthVisits' },
    { route: 'POST /bff/v0/users/:id/roles', parent: 'users' },
  ];

  /**
   * A route with ANY named parameter followed by a further segment.
   *
   * `:id` by name would be the same mistake one level in. Every one of these 64
   * routes happens to spell it `:id` today, and nothing enforces that -
   * `router.post('/notes/:noteId/escalate', ...)` is the identical handler with
   * the identical missing gate, and a filter keyed on the literal `:id/` leaves
   * this file green through it. Keyed on the SHAPE instead, which is what the
   * bypass has actually been: a parent row addressed by a parameter, with an
   * action or a sub-collection hanging off it.
   *
   * Exported as its own function so it can be asked about a route the app does
   * not serve - a live table cannot demonstrate that a `:noteId` route would be
   * caught, because there is no such route to add from a test.
   */
  function isSubResource(route: string): boolean {
    return route.includes(' /bff/v0/') && /\/:[A-Za-z0-9_]+\//u.test(route);
  }

  function bffRoutes(): string[] {
    const { app } = createTestApp();
    const rows = (app as unknown as { routes: readonly { method: string; path: string }[] }).routes;
    return [
      ...new Set(
        rows.map((row) => `${row.method} ${row.path}`).filter((row) => row.includes(' /bff/v0/'))
      ),
    ].sort();
  }

  function liveRoutes(): string[] {
    return bffRoutes().filter(isSubResource);
  }

  it('found the route table, and it is the app’s own', () => {
    /*
     * Counted BEFORE the sub-resource filter, on purpose. `liveRoutes().length`
     * would be the output of the same filter this file's whole subject is, so
     * it could only confirm that the filter found what the filter looks for -
     * which is the exact sentence written above about `decls.length > 15`, and
     * getting it wrong here would be that mistake committed inside its own
     * correction. An app that failed to mount reports no BFF routes at all,
     * which is a different defect from an inventory that has drifted.
     *
     * The filter itself is pinned by the set equality below rather than by a
     * count: the inventory is 64 literal rows, so a filter that stopped
     * matching would report all 64 as stale.
     */
    expect(bffRoutes().length, 'the mounted app reported no BFF routes at all').toBeGreaterThan(0);
  });

  it.each([
    ['POST /bff/v0/notes/:id/escalate', true],
    ['POST /bff/v0/notes/:noteId/escalate', true],
    ['POST /bff/v0/notes/:id', false],
    ['POST /bff/v0/medications/screen', false],
    ['GET /fhir/Patient/:id/$everything', false],
  ] as const)('classifies %s as a sub-resource: %s', (route, expected) => {
    /*
     * Asked of strings rather than of the app, because the case that matters is
     * a route the app does not serve: every parameter in the table today is
     * spelled `:id`, so a live-table assertion cannot tell a filter keyed on
     * the shape from one keyed on that literal. The `:noteId` row is the whole
     * point of this test; the rest are the boundaries it must not cross - a
     * bare `:id` at the end of a path is CRUD and is the other guard's subject,
     * and `/fhir` is a different boundary with its own gate.
     */
    expect(isSubResource(route)).toBe(expected);
  });

  it('the inventory names exactly the routes the app serves', () => {
    const live = liveRoutes();
    const declared = INVENTORY.map((entry) => entry.route).sort();

    const missing = live.filter((route) => !declared.includes(route));
    const stale = declared.filter((route) => !live.includes(route));

    // Both directions. A new route absent from the inventory is the failure
    // this exists for; an inventory row naming a route that no longer exists is
    // how the list stops describing the app and starts describing its history.
    expect(
      missing,
      `these routes are served and are in no inventory: a hand-registered route with a segment after :id reads or writes a parent row, and the CRUD seam's chart gate does not run on it - classify each one and give it a driven case in policy.care-relationship.test.ts if its parent is chart data`
    ).toEqual([]);
    expect(stale, 'these inventory rows name routes the app no longer serves').toEqual([]);
  });

  it.each(INVENTORY.map((entry) => [entry.route, entry] as const))(
    '%s names a parent the spec table knows',
    (_label, entry) => {
      if (entry.parent === undefined) return;
      const spec = (COLLECTION_SPECS as Record<string, { patientColumn?: string } | undefined>)[
        entry.parent
      ];
      expect(
        spec,
        `${entry.route} names parent collection '${entry.parent}', which is not in COLLECTION_SPECS`
      ).toBeDefined();
    }
  );

  it('the chart-bearing half of the inventory is the majority of it', () => {
    /*
     * Not a threshold dressed as a canary - it is the sentence the inventory
     * exists to make sayable. Most of these routes hang off a row that names a
     * patient, so most of them are a chart read or a chart write, and the
     * enumeration above cannot see any of them. If this ever inverts, either
     * the spec table has lost its `patientColumn`s or the inventory has stopped
     * describing the app, and both are worth stopping for.
     */
    const specs = COLLECTION_SPECS as Record<string, { patientColumn?: string } | undefined>;
    const chartBearing = INVENTORY.filter(
      (entry) => entry.parent !== undefined && specs[entry.parent]?.patientColumn !== undefined
    );
    expect(chartBearing.length).toBeGreaterThan(INVENTORY.length / 2);
  });
});

/**
 * The third shape, and the one that fell between the two guards above: a route
 * addressed by a parameter with NOTHING after it, registered by hand.
 *
 * `GET /bff/v0/appointments/:id` is served from `appointments.ts` rather than
 * generated, so `crudDeclarations` produces no chunk for it and the first guard
 * has no opinion. `isSubResource` is keyed on `/:<param>/` - a parameter with a
 * further segment - so a path that ENDS at the parameter is not in the second
 * inventory either. The route was therefore exempt from the care-relationship
 * gate by omission from two lists rather than by anybody's decision, which is
 * what #431 asks about.
 *
 * `isAddressed` is the same filter one character shorter: the parameter at the
 * END of the path instead of followed by a segment. Keyed on the shape and not
 * on `:id` for the reason `isSubResource` is - every one of these spells it
 * `:id` today and nothing makes that true.
 *
 * The exclusion is the only new machinery, and its failure directions are not
 * symmetric, which is why both are asserted:
 *
 * - A `defineCrud` the scan MISSES leaves its two addressed routes outside
 *   `crudAddressed`, so they land in the inventory below unclassified and the
 *   set equality fails. Fail-closed, and it reads as "classify this route".
 * - A segment the scan INVENTS would silently excuse a hand-registered route of
 *   the same name. That is fail-OPEN and nothing about the inventory could see
 *   it - so it is caught on the other side instead: every route the exclusion
 *   claims is CRUD-generated must actually be served by the app, and a segment
 *   nobody mounts is not.
 *
 * SCOPE, in the same terms as above: this asserts the inventory is COMPLETE.
 * It asserts nothing about whether a row runs the gate - `parent`
 * puts the chart-bearing status of the row's collection in front of whoever
 * adds the route, and the driven refusals live in the route files' own tests.
 * The one thing it does pin is WHICH of these routes address chart data, as a
 * set derived from `COLLECTION_SPECS` rather than as a field somebody types:
 * hand-registering an addressed route on a chart-bearing aggregate cannot be
 * done without editing that literal.
 */
describe('every hand-registered addressed route is accounted for', () => {
  interface AddressedRoute {
    /** `METHOD /path`, exactly as Hono reports it. */
    readonly route: string;
    /**
     * The collection whose row the parameter names, or `undefined` when it is
     * not a repository collection at all.
     */
    readonly parent: string | undefined;
  }

  const INVENTORY: readonly AddressedRoute[] = [
    { route: 'GET /bff/v0/appointments/:id', parent: 'appointments' },
    { route: 'GET /bff/v0/audit/:id', parent: undefined },
    { route: 'GET /bff/v0/patients/:id', parent: 'patients' },
    { route: 'GET /bff/v0/referrals/:id', parent: 'referrals' },
    { route: 'GET /bff/v0/telehealth/:id', parent: 'telehealthVisits' },
    { route: 'PATCH /bff/v0/appointments/:id', parent: 'appointments' },
    { route: 'PATCH /bff/v0/patients/:id', parent: 'patients' },
  ];

  /**
   * The rows whose parent collection declares a `patientColumn`, so the route
   * addresses chart data and the care-relationship gate is the question.
   *
   * Written out rather than computed into the assertion, because the whole
   * point is that the list changes when the app does: the check compares this
   * literal against the same predicate applied to `COLLECTION_SPECS`, so
   * neither half can drift without the other being edited to match.
   *
   * `patients` is absent on purpose and is not an omission - the patient spec
   * carries no `patientColumn` because the row IS the patient, and both its
   * routes gate on `assertCareRelationship` directly. `telehealthVisits` and
   * the audit log are absent because neither names a patient.
   */
  const CHART_BEARING: readonly string[] = [
    'GET /bff/v0/appointments/:id',
    'GET /bff/v0/referrals/:id',
    'PATCH /bff/v0/appointments/:id',
  ];

  /**
   * A route addressed by a named parameter with no further segment.
   *
   * The `$` is the whole difference from `isSubResource`, and the two are
   * disjoint by construction: a parameter cannot both end the path and be
   * followed by a segment.
   */
  function isAddressed(route: string): boolean {
    return route.includes(' /bff/v0/') && /\/:[A-Za-z0-9_]+$/u.test(route);
  }

  function bffRoutes(): string[] {
    const { app } = createTestApp();
    const rows = (app as unknown as { routes: readonly { method: string; path: string }[] }).routes;
    return [
      ...new Set(
        rows.map((row) => `${row.method} ${row.path}`).filter((row) => row.includes(' /bff/v0/'))
      ),
    ].sort();
  }

  /**
   * The addressed routes the CRUD seam generates, derived from the segments the
   * `defineCrud` scan found. `crudRoutes` registers `GET` and `PATCH` on
   * `${base}/:id` unconditionally, so a segment implies exactly these two.
   */
  function crudAddressed(): string[] {
    const segments = [
      ...new Set(
        crudDeclarations()
          .map((decl) => decl.segment)
          .filter((segment): segment is string => segment !== undefined)
      ),
    ];
    return segments
      .flatMap((segment) => [`GET /bff/v0/${segment}/:id`, `PATCH /bff/v0/${segment}/:id`])
      .sort();
  }

  function handRegistered(): string[] {
    const generated = new Set(crudAddressed());
    return bffRoutes()
      .filter(isAddressed)
      .filter((route) => !generated.has(route));
  }

  it('the CRUD exclusion names routes the app actually serves', () => {
    /*
     * The fail-OPEN direction, and the only one the inventory below cannot
     * report. A `segment:` matched out of the wrong place in a chunk would
     * subtract a hand-registered route from the set that has to be classified,
     * silently and in the dangerous direction. A segment nobody mounts is the
     * signature of that, because every real one is served.
     *
     * Also the scan's canary, and unlike `decls.length > 15` it is not derived
     * from the scan alone: it is the scan checked against the route table.
     */
    const generated = crudAddressed();
    const served = new Set(bffRoutes());
    expect(generated.length, 'the defineCrud scan found no segments at all').toBeGreaterThan(0);
    expect(
      generated.filter((route) => !served.has(route)),
      'the exclusion claims these are CRUD-generated, but the app serves no such route - a `segment:` was read out of the wrong place and is excusing a hand-registered route of that name'
    ).toEqual([]);
  });

  it.each([
    ['GET /bff/v0/notes/:id', true],
    ['GET /bff/v0/notes/:noteId', true],
    ['POST /bff/v0/notes/:id/sign', false],
    ['POST /bff/v0/medications/screen', false],
    ['GET /fhir/Patient/:id', false],
  ] as const)('classifies %s as addressed: %s', (route, expected) => {
    /*
     * Asked of strings for `isSubResource`'s reason: the `:noteId` row is a
     * route the app does not serve, so a live-table assertion could not tell a
     * filter keyed on the shape from one keyed on the literal `:id`. The
     * `/sign` row is the boundary between this guard and the one above, and
     * `/fhir` is a different boundary with its own gate.
     */
    expect(isAddressed(route)).toBe(expected);
  });

  it('the inventory names exactly the hand-registered addressed routes', () => {
    const live = handRegistered();
    const declared = INVENTORY.map((entry) => entry.route).sort();

    expect(
      live.filter((route) => !declared.includes(route)),
      'these routes are served and are in no inventory: a hand-registered route addressed by :id reads or writes a row the CRUD seam did not generate, so no chartFrom runs on it - classify each one, and if its parent is chart data give it a driven case in that route file’s tests'
    ).toEqual([]);
    expect(
      declared.filter((route) => !live.includes(route)),
      'these inventory rows name routes the app no longer serves by hand - either the route is gone, or it moved into the CRUD seam and the guard above now covers it'
    ).toEqual([]);
  });

  it.each(INVENTORY.map((entry) => [entry.route, entry] as const))(
    '%s names a parent the spec table knows',
    (_label, entry) => {
      if (entry.parent === undefined) return;
      const spec = (COLLECTION_SPECS as Record<string, { patientColumn?: string } | undefined>)[
        entry.parent
      ];
      expect(
        spec,
        `${entry.route} names parent collection '${entry.parent}', which is not in COLLECTION_SPECS`
      ).toBeDefined();
    }
  );

  it('the chart-bearing rows are the ones the spec table says they are', () => {
    /*
     * Both directions, against `COLLECTION_SPECS` rather than against a typed
     * field. A row appearing here is the sentence "this hand-registered route
     * addresses chart data", which is #431's subject; a row leaving is a spec
     * that stopped declaring a `patientColumn`, which is worth stopping for on
     * its own.
     */
    const specs = COLLECTION_SPECS as Record<string, { patientColumn?: string } | undefined>;
    const derived = INVENTORY.filter(
      (entry) => entry.parent !== undefined && specs[entry.parent]?.patientColumn !== undefined
    )
      .map((entry) => entry.route)
      .sort();
    expect(derived).toEqual([...CHART_BEARING].sort());
  });
});

describe('a BFF clinical read, driven through the app', () => {
  const STRANGER = testId(70801);
  const PROBLEM = testId(70802);

  function seedStrangerProblem(
    dataset: ReturnType<typeof createTestApp>['dataset'],
    facility: string
  ): void {
    seed(
      dataset,
      'Patient',
      makePatientRow({ id: STRANGER, mrn: 'OR-770801', primaryFacilityId: facility })
    );
    seed(dataset, 'Condition', {
      id: PROBLEM,
      tenantId: DEMO_TENANT_A,
      patientId: STRANGER,
      encounterId: null,
      category: 'PROBLEM_LIST_ITEM',
      code: 'C50.9',
      codeSystem: 'http://hl7.org/fhir/sid/icd-10-cm',
      display: 'Malignant neoplasm of breast',
      snomedCode: null,
      clinicalStatus: 'ACTIVE',
      verificationStatus: 'CONFIRMED',
      onsetDate: null,
      abatementDate: null,
      severityCode: null,
      bodySiteCode: null,
      note: null,
      recordedAt: FIXED_NOW,
      recordedById: null,
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    });
  }

  it('refuses a read of a chart nothing connects the reader to', async () => {
    const { app, dataset } = createTestApp();
    seedStrangerProblem(dataset, DEMO_FACILITY_A);
    const res = await app.request(`/bff/v0/problems/${PROBLEM}`, {
      headers: bearer(TOKENS.clinicianA),
    });
    // 404, not 403: a 403 would confirm the row exists to a reader who may not see it.
    expect(res.status).toBe(404);
  });

  it("refuses a read of a different facility's chart, which carries no facility of its own", async () => {
    const { app, dataset } = createTestApp();
    seedStrangerProblem(dataset, DEMO_FACILITY_B);
    const res = await app.request(`/bff/v0/problems/${PROBLEM}`, {
      headers: bearer(TOKENS.clinicianA),
    });
    expect(res.status).toBe(404);
  });

  it('answers once a relationship exists', async () => {
    const { app, dataset } = createTestApp();
    seedStrangerProblem(dataset, DEMO_FACILITY_B);
    seedCareRelationship(dataset, {
      patientId: STRANGER,
      providerId: '01890000-0000-7000-8000-000000000101',
      as: 'appointment',
      id: testId(70803),
    });
    const res = await app.request(`/bff/v0/problems/${PROBLEM}`, {
      headers: bearer(TOKENS.clinicianA),
    });
    expect(res.status).toBe(200);
  });

  it('refuses a list that names a chart the reader is not on', async () => {
    const { app, dataset } = createTestApp();
    seedStrangerProblem(dataset, DEMO_FACILITY_A);
    const res = await app.request(`/bff/v0/problems?patientId=${STRANGER}`, {
      headers: bearer(TOKENS.clinicianA),
    });
    expect(res.status).toBe(404);
  });

  it('refuses an amendment of a chart the reader is not on', async () => {
    const { app, dataset } = createTestApp();
    seedStrangerProblem(dataset, DEMO_FACILITY_A);
    const res = await app.request(`/bff/v0/problems/${PROBLEM}`, {
      method: 'PATCH',
      headers: { ...bearer(TOKENS.clinicianA), 'content-type': 'application/json' },
      body: JSON.stringify({ display: 'Edited' }),
    });
    expect(res.status).toBe(404);
  });

  it('refuses a broad list that spans a chart the reader is not on', async () => {
    // The residue the addressed gate left: `?patientId=` was gated, a bare list
    // was not, and a condition carries no facility to fall back on, so it
    // returned the tenant. The list is now gated on every chart it returns.
    const { app, dataset } = createTestApp();
    seedStrangerProblem(dataset, DEMO_FACILITY_A);
    const res = await app.request(`/bff/v0/problems`, { headers: bearer(TOKENS.clinicianA) });
    expect(res.status).toBe(404);
  });

  it('does not audit the relationship check as reads by the reader', async () => {
    // The check consults an appointment to authorise the read; that is the
    // system deciding, not the clinician accessing the appointment. The read
    // event names the problem alone, and the access is its own chart.access.
    const { app, dataset, sink } = createTestApp();
    seedStrangerProblem(dataset, DEMO_FACILITY_B);
    seedCareRelationship(dataset, {
      patientId: STRANGER,
      providerId: '01890000-0000-7000-8000-000000000101',
      as: 'appointment',
      id: testId(70804),
    });
    await app.request(`/bff/v0/problems/${PROBLEM}`, { headers: bearer(TOKENS.clinicianA) });

    const reads = sink.reads();
    expect(reads).toHaveLength(1);
    expect(reads[0]?.event.metadata.targets).toEqual([
      { type: 'Condition', id: PROBLEM, patientId: STRANGER },
    ]);
    const access = sink.writes().map((w) => w.event.action);
    expect(access).toContain('chart.access');
  });
});
