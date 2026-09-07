#!/usr/bin/env node
/**
 * Runs the full-day clinical drill.
 *
 * The drill exercises the practice EMR surface - schedule, chart, orders,
 * results, billing, audit. That surface is built by its own workstream, and
 * this repository's branches do not all carry it yet.
 *
 * So this checks for the surface before running. When it is absent the drill
 * reports loudly that it did not run and exits zero, which keeps a branch that
 * has nothing to drill from failing on it - and, more importantly, means the
 * drill switches itself on the moment the screens land, with nobody having to
 * remember to enable it.
 *
 * That exemption is narrow on purpose, and it used not to be: exiting zero for
 * "the screens are not here yet" also exited zero for "I am looking in the
 * wrong place", which is what this repository was actually in for fifteen days.
 * A surface that is present but not where this script expects it now FAILS.
 *
 * When the surface IS present, a failure here fails the build. This is the
 * acceptance test for the product; it is not advisory.
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { classify, findPages } from './required-routes.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');

/**
 * Which screens the drill needs, and whether this branch has them, live in
 * required-routes.mjs - with the reasoning and the tests. The short version is
 * that this check used to answer `existsSync` on eleven literal paths, so a
 * list that went out of date and a branch with no clinical surface produced the
 * same notice and the same exit code. It now distinguishes them, and only one
 * of the two exits zero.
 */
const { verdict, moved, missing, present } = classify(findPages(repoRoot));

if (verdict === 'absent') {
  const lines = [
    '',
    '  ============================================================',
    '  THE FULL-DAY CLINICAL DRILL DID NOT RUN',
    '  ============================================================',
    '',
    '  The practice EMR screens are not present on this branch, so',
    '  there is nothing for the drill to drive. It has not passed;',
    '  it has not run.',
    '',
    `  None of the ${String(missing.length)} required routes exists under any route`,
    '  grouping, which is what makes this an empty branch rather than a',
    '  stale list. Checked, and absent:',
    ...missing.slice(0, 4).map((route) => `    ${route}`),
    '',
    '  This check switches itself on as soon as those screens merge.',
    '  ============================================================',
    '',
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
  process.exit(0);
}

if (verdict === 'stale') {
  const lines = [
    '',
    '  ============================================================',
    '  THE DRILL CANNOT TELL WHETHER IT DROVE THE DAY',
    '  ============================================================',
    '',
    '  The clinical surface is present on this branch, but not where',
    '  this script expects it. That is a stale list, not an empty',
    '  branch, so it fails rather than exempting itself - the failure',
    '  this replaces was fifteen days of a green job over a drill that',
    '  never ran.',
    '',
    ...(moved.length > 0
      ? [
          `  ${String(moved.length)} route(s) exist somewhere else:`,
          ...moved.map((route) => `    expected  ${route.expected}\n    found     ${route.found}`),
          '',
        ]
      : []),
    ...(missing.length > 0
      ? [
          `  ${String(missing.length)} route(s) do not exist under any grouping, while`,
          `  ${String(present.length + moved.length)} of the others do - a half-present surface would`,
          '  produce a drill that passes having skipped part of the day:',
          ...missing.map((route) => `    ${route}`),
          '',
        ]
      : []),
    '  Fix REQUIRED_ROUTES in apps/e2e/scripts/required-routes.mjs to name',
    '  where the screens actually are, then run this again.',
    '  ============================================================',
    '',
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
  process.exit(1);
}

/**
 * Next inlines NEXT_PUBLIC_* at build time, so mock mode is a property of the
 * build, not of the run. Building here rather than expecting a prior build is
 * what stops the drill from silently running against a live-mode bundle and
 * failing on a missing API.
 */
function run(command, args, { cwd = repoRoot, env = {} } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    env: { ...process.env, ...env },
    shell: false,
  });
  return result.status ?? 1;
}

// The build is driven from the repository root, because `pnpm --filter` needs
// the workspace root to resolve the filter.
process.stdout.write('Building the web application in mock mode\n');
const built = run('pnpm', ['--filter', 'web', 'run', 'build'], {
  env: { NEXT_PUBLIC_API_MODE: 'mock', NEXT_TELEMETRY_DISABLED: '1' },
});
if (built !== 0) {
  process.stdout.write('\nThe web application did not build; the drill cannot run.\n');
  process.exit(built);
}

// Playwright runs from THIS package, and the working directory is load-bearing.
// Playwright discovers its config by walking up from the working directory; run
// it from the repository root and it finds no config, falls back to defaults,
// and its default testDir is the whole repository - at which point it collects
// every *.test.ts in every workspace and tries to execute Vitest suites as
// browser tests. The failure is a wall of "Cannot read properties of undefined"
// that looks like a broken application and is nothing of the kind.
process.stdout.write('\nRunning the full-day clinical drill\n');
process.exit(
  run('pnpm', ['exec', 'playwright', 'test'], {
    cwd: path.resolve(here, '..'),
    env: { NEXT_PUBLIC_API_MODE: 'mock' },
  })
);
