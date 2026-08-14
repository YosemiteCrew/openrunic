#!/usr/bin/env node
// Expand the core affected matrix into test legs.
//
// Usage:
//   node scripts/ci/test-matrix.mjs --matrix <file>
//
// Emits key=value lines on stdout for the caller to append to $GITHUB_OUTPUT:
//   matrix={"include":[{workspace,dir,app_key,shard,shards,coverage,uses_vitest,needs_prisma}]}
//   apps_with_coverage=[{"app_key":"web","dir":"apps/web"},...]
//   has_any=<bool>
//
// apps_with_coverage is derived here, from the same entries that produce the
// shard legs, so the set that uploads coverage and the set Sonar later scans are
// the same set by construction rather than by two lists agreeing. It carries
// each app's directory so the merge and scan stages never have to re-derive a
// workspace-to-path mapping of their own.

import { readFileSync } from 'node:fs';
import path from 'node:path';

// Shard counts are per app, sized to its suite. Anything not listed runs
// unsharded. Sharding an app whose suite is already short only adds runner
// startup overhead, so every app starts at 1; raise a count here as its suite
// grows - the merge stage already handles any number of shards.
const SHARDS = new Map([
  ['web', 1],
  ['api', 1],
  ['portal', 1],
]);

function fail(message) {
  console.error(`test-matrix: ${message}`);
  process.exit(1);
}

const argv = process.argv.slice(2);
if (argv[0] !== '--matrix' || !argv[1]) fail('usage: --matrix <file>');

let core;
try {
  core = JSON.parse(readFileSync(argv[1], 'utf8'));
} catch (error) {
  fail(`cannot read matrix: ${error.message}`);
}
if (!Array.isArray(core?.include)) fail('matrix has no include array');

const include = [];
const appsWithCoverage = [];

for (const entry of core.include) {
  if (!entry.has_test) continue;

  // Every workspace is on vitest today, but read the script rather than assume
  // it: a runner that is not vitest (e.g. `node --test`) rejects vitest's
  // shard and coverage flags, so _test runs its script unmodified instead.
  let testScript = '';
  try {
    testScript =
      JSON.parse(readFileSync(path.join(entry.dir, 'package.json'), 'utf8')).scripts?.test ?? '';
  } catch (error) {
    fail(`cannot read package.json for ${entry.workspace}: ${error.message}`);
  }
  const usesVitest = /\bvitest\b/.test(testScript);

  // Only apps report to Sonar, and only vitest emits the istanbul JSON the
  // merge consumes, so only that intersection is worth collecting coverage
  // for. Shared packages run their tests and upload nothing, which is what
  // keeps orphan shard artifacts out of the coverage merge.
  const collectsCoverage = Boolean(entry.app_key) && usesVitest;
  if (collectsCoverage) {
    appsWithCoverage.push({
      app_key: entry.app_key,
      dir: entry.dir,
    });
  }

  const shards = collectsCoverage ? (SHARDS.get(entry.app_key) ?? 1) : 1;
  for (let shard = 1; shard <= shards; shard += 1) {
    include.push({
      workspace: entry.workspace,
      dir: entry.dir,
      app_key: entry.app_key,
      shard,
      shards,
      coverage: collectsCoverage,
      uses_vitest: usesVitest,
      needs_prisma: Boolean(entry.needs_prisma),
    });
  }
}

process.stdout.write(
  [
    `matrix=${JSON.stringify({ include })}`,
    `apps_with_coverage=${JSON.stringify(
      [...new Map(appsWithCoverage.map((app) => [app.app_key, app])).values()].sort((a, b) =>
        a.app_key.localeCompare(b.app_key)
      )
    )}`,
    `has_any=${include.length > 0}`,
    '',
  ].join('\n')
);
