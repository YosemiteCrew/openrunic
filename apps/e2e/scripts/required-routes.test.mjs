// The presence check's own tests.
//
// These exist because the thing that failed was not the drill and not the
// eleven paths - it was that `Missing 11 of 11, exit 0` is indistinguishable
// from `no clinical surface here, exit 0`, and nothing could tell the
// difference including the person reading the log. So the cases below are
// mostly pairs: the same counts, reached two ways, with different verdicts.
//
// The one that matters is `the 2026-08-23 regression`. Run it against the
// check as it stood on 2026-09-06 and it returns `absent` and exits zero.

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { APP_DIR, classify, findPages, REQUIRED_ROUTES, routeKey } from './required-routes.mjs';

/** Build a repository root containing exactly the given files. */
function treeWith(files) {
  const root = mkdtempSync(path.join(tmpdir(), 'drill-routes-'));
  for (const file of files) {
    const full = path.join(root, file);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, '// fixture\n');
  }
  return root;
}

/** The same eleven screens, with the `(app)` group replaced by `group`. */
function regrouped(group) {
  return REQUIRED_ROUTES.map((route) =>
    route.replace('apps/web/src/app/(app)/', `apps/web/src/app/${group}`)
  );
}

test('a route group is dropped from the key and a dynamic segment is not', () => {
  assert.equal(
    routeKey('apps/web/src/app/(app)/patients/[id]/page.tsx'),
    'apps/web/src/app/patients/[id]/page.tsx'
  );
  // The control. `[id]` appears in the URL, so it has to survive: dropping it
  // would give `patients/page.tsx` the same key as the patient chart, and a
  // missing chart would be found as a moved one.
  assert.notEqual(
    routeKey('apps/web/src/app/(app)/patients/[id]/page.tsx'),
    routeKey('apps/web/src/app/(app)/patients/page.tsx')
  );
  // Two different groupings of one screen agree.
  assert.equal(
    routeKey('apps/web/src/app/(app)/results/page.tsx'),
    routeKey('apps/web/src/app/(clinical)/results/page.tsx')
  );
  // A bare `()` is not a route group - Next requires a name - so it is kept.
  assert.equal(routeKey('a/()/b'), 'a/()/b');
});

test('findPages returns every page.tsx under the route root and nothing else', () => {
  const root = treeWith([
    `${APP_DIR}/(app)/schedule/page.tsx`,
    `${APP_DIR}/(app)/schedule/layout.tsx`,
    `${APP_DIR}/(app)/billing/claims/page.tsx`,
    `${APP_DIR}/page.tsx`,
    'apps/web/src/components/page.tsx',
  ]);
  try {
    const pages = findPages(root).sort();

    assert.deepEqual(pages, [
      `${APP_DIR}/(app)/billing/claims/page.tsx`,
      `${APP_DIR}/(app)/schedule/page.tsx`,
      `${APP_DIR}/page.tsx`,
    ]);
    // layout.tsx is not a page, and a page.tsx outside the route root is not a
    // route - both are in the fixture so their absence above means something.
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('findPages refuses a route root that escapes the repository', () => {
  // The route root is a parameter, so it is worth one guard: `path.join` would
  // resolve `../..` and hand a directory outside the checkout to the walk. Two
  // controls, because "returns []" is also what a broken walker returns.
  const root = treeWith([`${APP_DIR}/(app)/schedule/page.tsx`]);
  try {
    assert.deepEqual(findPages(root, '../..'), []);
    assert.deepEqual(findPages(root, '/etc'), []);
    // control: the real route root still resolves and still finds the page.
    assert.deepEqual(findPages(root), [`${APP_DIR}/(app)/schedule/page.tsx`]);
    // control: the repository root itself is within itself, so it is allowed.
    assert.deepEqual(findPages(root, '.'), [`${APP_DIR}/(app)/schedule/page.tsx`]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('findPages returns nothing rather than throwing when there is no route root', () => {
  const root = treeWith(['package.json']);
  try {
    assert.deepEqual(findPages(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('every screen where the list says: run', () => {
  const result = classify(REQUIRED_ROUTES);

  assert.equal(result.verdict, 'run');
  assert.equal(result.present.length, REQUIRED_ROUTES.length);
  assert.deepEqual(result.moved, []);
  assert.deepEqual(result.missing, []);
});

test('no clinical surface at all: absent, which is the one case that exempts', () => {
  const result = classify([]);

  assert.equal(result.verdict, 'absent');
  assert.equal(result.missing.length, REQUIRED_ROUTES.length);
  assert.deepEqual(result.moved, []);
});

test('the 2026-08-23 regression: every screen at the bare path is stale, not absent', () => {
  // This is the state of this repository from #160 until #409, and the check it
  // replaces answered `Missing 11 of 11` and exited zero on exactly this input.
  const bare = regrouped('');
  const result = classify(bare);

  assert.equal(result.verdict, 'stale');
  assert.equal(result.moved.length, REQUIRED_ROUTES.length);
  assert.deepEqual(result.missing, []);
  // The report has to name both ends, because the fix is to edit the list and
  // a message that only says "missing" sends the reader to the wrong file.
  assert.deepEqual(result.moved[0], {
    expected: 'apps/web/src/app/(app)/schedule/page.tsx',
    found: 'apps/web/src/app/schedule/page.tsx',
  });
});

test('screens regrouped under a different name are stale, not absent', () => {
  const result = classify(regrouped('(clinical)/'));

  assert.equal(result.verdict, 'stale');
  assert.equal(result.moved.length, REQUIRED_ROUTES.length);
  assert.equal(result.moved[0].found, 'apps/web/src/app/(clinical)/schedule/page.tsx');
});

test('a half-present surface is stale rather than exempt', () => {
  const [dropped, ...rest] = REQUIRED_ROUTES;
  const result = classify(rest);

  assert.equal(result.verdict, 'stale');
  assert.deepEqual(result.missing, [dropped]);
  assert.equal(result.present.length, REQUIRED_ROUTES.length - 1);
  // Ten of eleven present is the case the old check also exited zero on, and it
  // is worse than the regrouping one: the drill would have driven most of a day
  // and reported a pass.
});

test('a missing dynamic route is not found as a moved one', () => {
  // `patients/page.tsx` exists, `patients/[id]/page.tsx` does not. If routeKey
  // dropped `[id]` these two would share a key and the chart would be reported
  // as merely moved, which is the same silence in a new place.
  const withoutChart = REQUIRED_ROUTES.filter(
    (route) => route !== 'apps/web/src/app/(app)/patients/[id]/page.tsx'
  ).concat('apps/web/src/app/(app)/patients/page.tsx');
  const result = classify(withoutChart);

  assert.equal(result.verdict, 'stale');
  assert.deepEqual(result.missing, ['apps/web/src/app/(app)/patients/[id]/page.tsx']);
  assert.deepEqual(result.moved, []);
});

test('unrelated screens alongside the required ones do not change the verdict', () => {
  // The must-not-fire case. A repository grows pages; that must not be able to
  // turn `run` into anything else.
  const result = classify([
    ...REQUIRED_ROUTES,
    'apps/web/src/app/(marketing)/pricing/page.tsx',
    'apps/web/src/app/(app)/settings/page.tsx',
    'apps/web/src/app/page.tsx',
  ]);

  assert.equal(result.verdict, 'run');
  assert.deepEqual(result.moved, []);
  assert.deepEqual(result.missing, []);
});

test('walk and classify together, on a tree rather than on a list', () => {
  // findPages and classify are tested apart above; this is the one case that
  // proves they agree, because a walker that returned absolute paths would
  // satisfy every test above and match nothing here.
  const root = treeWith(regrouped(''));
  try {
    const result = classify(findPages(root));

    assert.equal(result.verdict, 'stale');
    assert.equal(result.moved.length, REQUIRED_ROUTES.length);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
