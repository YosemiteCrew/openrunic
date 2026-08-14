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
 * When the surface IS present, a failure here fails the build. This is the
 * acceptance test for the product; it is not advisory.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');

/**
 * One route per clinical area. All of them have to exist: a partial surface
 * would produce a drill that passes having skipped half the day.
 */
const REQUIRED_ROUTES = [
  'apps/web/src/app/schedule/page.tsx',
  'apps/web/src/app/schedule/flow-board/page.tsx',
  'apps/web/src/app/patients/[id]/page.tsx',
  'apps/web/src/app/encounters/[id]/page.tsx',
  'apps/web/src/app/orders/new/page.tsx',
  'apps/web/src/app/results/page.tsx',
  'apps/web/src/app/billing/charges/page.tsx',
  'apps/web/src/app/billing/claims/page.tsx',
  'apps/web/src/app/billing/remittance/page.tsx',
  'apps/web/src/app/billing/payments/page.tsx',
  'apps/web/src/app/admin/audit/page.tsx',
];

const missing = REQUIRED_ROUTES.filter((route) => !existsSync(path.join(repoRoot, route)));

if (missing.length > 0) {
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
    `  Missing ${String(missing.length)} of ${String(REQUIRED_ROUTES.length)} required routes, including:`,
    ...missing.slice(0, 4).map((route) => `    ${route}`),
    '',
    '  This check switches itself on as soon as those screens merge.',
    '  ============================================================',
    '',
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
  process.exit(0);
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
