#!/usr/bin/env node
// Which clinical screens the drill needs, and whether this branch has them.
//
// The drill exercises the practice EMR surface. That surface is built by its
// own workstream and not every branch carries it, so run-drill.mjs checks for
// the screens first and exits zero with a loud notice when they are absent -
// which keeps a branch with nothing to drive from failing on a drill it cannot
// run, and switches the drill on by itself the moment the screens land.
//
// That exemption is the whole subject of this file, because for fifteen days it
// was not an exemption at all. #26 wrote the list against the bare paths; #160
// moved every screen into the `(app)` route group and the list did not move
// with it. So the check reported `Missing 11 of 11 required routes` and exited
// zero on a branch that carried all eleven, the acceptance test for the product
// did not run from 2026-08-23 to 2026-09-07, and its job was green throughout.
//
// The path list was wrong, and fixing it was one commit. What made that cost
// fifteen days rather than one run is here: `existsSync` on a list of literal
// paths answers ONE question, and the notice printed for a `false` answered a
// different one. "The screens are not here yet" and "I am looking in the wrong
// place" produced the same output and the same exit code, and only one of them
// is a reason not to fail. An early return is an unlogged exemption unless
// something can distinguish it from a broken probe.
//
// So the exemption is now something the check PROVES rather than assumes. It
// looks at the whole route tree, not at eleven literal strings, and it has
// three answers instead of one:
//
//   run        every required screen is where the list says. Drive the day.
//   absent     no required screen exists under ANY route grouping. The branch
//              genuinely has no clinical surface: exempt, exit zero.
//   stale      a required screen exists, but not at the listed path - or some
//              are present and some are not. The list is wrong, or the surface
//              is half here. Either way the drill cannot be trusted to have
//              driven the day, so this FAILS.
//
// `absent` is the only one that exits zero, and it now means what it says.
//
// Deliberately dependency-free and importable without side effects: its tests
// run in the `CI scripts (node --test)` job, which installs nothing.

import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { resolveWithin } from '../../../scripts/ci/safe-path.mjs';

/**
 * The Next application's route root, relative to the repository root. Every
 * path below is relative to the repository root too, so the two can be
 * compared without either side knowing where the checkout lives.
 */
export const APP_DIR = 'apps/web/src/app';

/**
 * One route per clinical area. All of them have to exist: a partial surface
 * would produce a drill that passes having skipped half the day, which is why
 * `stale` covers "some present, some missing" as well as "moved".
 */
const CLINICAL_ROUTES = [
  '(app)/schedule/page.tsx',
  '(app)/schedule/flow-board/page.tsx',
  '(app)/patients/[id]/page.tsx',
  '(app)/encounters/[id]/page.tsx',
  '(app)/orders/new/page.tsx',
  '(app)/results/page.tsx',
  '(app)/billing/charges/page.tsx',
  '(app)/billing/claims/page.tsx',
  '(app)/billing/remittance/page.tsx',
  '(app)/billing/payments/page.tsx',
  '(app)/admin/audit/page.tsx',
];

/**
 * Derived from `APP_DIR` rather than written out, so the two cannot drift.
 *
 * They could, and following this file's own advice was the way in: the
 * `unrooted` notice says "fix APP_DIR", and doing exactly that - and only that -
 * used to leave eleven required paths still carrying the OLD root, so the found
 * keys and the required keys could never meet again. Thirty served pages,
 * verdict `absent`, exit zero: the original defect, reached by following the
 * remedy. Deriving one from the other makes that unreachable rather than
 * asserted.
 */
export const REQUIRED_ROUTES = CLINICAL_ROUTES.map((route) => `${APP_DIR}/${route}`);

/**
 * The URL a route file serves, expressed as a path with the route groups taken
 * out. A directory whose name is in parentheses groups files without appearing
 * in the URL, so `(app)/schedule/page.tsx` and `schedule/page.tsx` are the same
 * screen and `(clinical)/schedule/page.tsx` is that screen regrouped.
 *
 * Only a fully parenthesised segment is a group. `[id]` is a dynamic segment
 * and DOES appear in the URL, so it must survive - dropping it would make
 * `patients/[id]/page.tsx` and `patients/page.tsx` the same key and let a
 * missing patient chart pass as a present one.
 */
export function routeKey(routePath) {
  return routePath
    .split('/')
    .filter((segment) => !(segment.startsWith('(') && segment.endsWith(')') && segment.length > 2))
    .join('/');
}

/**
 * Every `page.tsx` under the route root, as repository-relative paths.
 *
 * Returns an empty array when the route root itself is absent, which is the
 * genuinely-no-surface case rather than an error.
 */
export function findPages(repoRoot, appDir = APP_DIR) {
  // `resolveWithin` refuses a route root that escapes the repository and returns
  // null, which is treated as "no surface here" rather than as a directory to
  // walk - the same helper and the same convention as the other ci scripts.
  // `path.join` alone would happily resolve `../..` and hand it to the walk.
  const root = resolveWithin(repoRoot, appDir);
  if (root === null || !existsSync(root)) return [];

  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      // `isDirectory()` is false for a symbolic link, so the walk cannot be led
      // out of the route root by one - which is why the guard above only has to
      // hold for the entry point.
      if (entry.isDirectory()) walk(full);
      else if (entry.name === 'page.tsx') found.push(path.relative(repoRoot, full));
    }
  };
  walk(root);
  return found;
}

/**
 * Decide whether the drill can run, given the pages that exist.
 *
 * `pages` is repository-relative paths, as findPages returns. The comparison is
 * on route keys rather than on literal strings, so a screen that has been
 * regrouped is found and reported as MOVED rather than counted as missing -
 * which is the whole point, and is the state this repository was in.
 */
export function classify(pages, requiredRoutes = REQUIRED_ROUTES) {
  const literal = new Set(pages);
  const byKey = new Map();
  for (const page of pages) {
    // First writer wins, so a second file with the same key cannot displace the
    // one already reported. Ordering is the walk's, which is deterministic.
    if (!byKey.has(routeKey(page))) byKey.set(routeKey(page), page);
  }

  const present = [];
  const moved = [];
  const missing = [];

  for (const route of requiredRoutes) {
    if (literal.has(route)) {
      present.push(route);
      continue;
    }
    const found = byKey.get(routeKey(route));
    if (found) moved.push({ expected: route, found });
    else missing.push(route);
  }

  // `present`, `moved` and `missing` partition the required list - each route
  // lands in exactly one - so these three tests are mutually exclusive and the
  // order they are written in is not load-bearing. That is worth saying because
  // the first draft of this comment claimed the opposite, on the reasoning that
  // a fully regrouped branch has eleven missing literal paths: it does, and none
  // of them reaches `missing`, because a route found under another grouping is
  // `moved`. An arm that swapped these two lines was GREEN, which is what said
  // so. What stops a regrouped branch being read as an empty one is the key
  // lookup above, not the sequence here.
  let verdict;
  if (moved.length > 0) verdict = 'stale';
  else if (missing.length > 0 && missing.length === requiredRoutes.length) verdict = 'absent';
  else if (missing.length > 0) verdict = 'stale';
  else verdict = 'run';

  return { verdict, present, moved, missing };
}

/**
 * The resolved route root, or null when it is not there.
 *
 * Separated out because `findPages` returning `[]` has two causes and they are
 * the same two this whole file exists to tell apart: the root holds no pages,
 * or **the root is not where `APP_DIR` says**. The eleven route paths are
 * proved against the tree; `APP_DIR` is the one literal that finds them and
 * nothing proved it. Move `apps/web/src/app` to `apps/web/app` - a documented
 * Next layout, and the same class of move as the one that cost fifteen days -
 * and every page is still present, `findPages` is still `[]`, and `classify`
 * still says `absent`, which is the verdict that exits zero.
 *
 * So the root gets the same treatment as the routes: found, or reported.
 */
export function findRouteRoot(repoRoot, appDir = APP_DIR) {
  const root = resolveWithin(repoRoot, appDir);
  return root !== null && existsSync(root) ? root : null;
}

/**
 * The whole check: read the tree, then decide. A fourth verdict, `unrooted`,
 * for a route root that is not there - which is a stale constant rather than a
 * branch with no clinical surface, because every branch that builds has this
 * directory. It fails, like `stale`.
 */
export function inspect(repoRoot, appDir = APP_DIR) {
  if (findRouteRoot(repoRoot, appDir) === null) {
    return { verdict: 'unrooted', appDir, present: [], moved: [], missing: [...REQUIRED_ROUTES] };
  }
  return { ...classify(findPages(repoRoot, appDir)), appDir };
}
