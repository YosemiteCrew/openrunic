#!/usr/bin/env node
// Assert that the coverage report handed to Sonar actually points at real files.
//
// Usage:
//   node scripts/ci/lcov-check.mjs --resolve <app-dir> <lcov>
//
// Sonar does not error when it cannot resolve a coverage path. It reports 0%
// for the project and the quality gate passes, having measured nothing. That
// failure is invisible in the scanner's exit code and in the gate result, so it
// is caught here instead, before the scan runs.
//
// Coverage floors are not enforced here; merge-coverage.mjs applies them to the
// merged istanbul map, where a true statements count is available.

import { existsSync, readFileSync } from 'node:fs';
import { resolveWithin } from './safe-path.mjs';

function fail(message) {
  console.error(`lcov-check: ${message}`);
  process.exit(1);
}

const [mode, dir, lcov] = process.argv.slice(2);
if (mode !== '--resolve' || !dir || !lcov) fail('usage: --resolve <app-dir> <lcov>');
if (!existsSync(lcov)) fail(`${lcov} does not exist`);

const raw = readFileSync(lcov, 'utf8');
if (raw.trim() === '') fail(`${lcov} is empty`);

const files = raw
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line.startsWith('SF:'))
  .map((line) => line.slice(3));

if (files.length === 0) fail(`${lcov} records no SF: entries, so it measures nothing`);

// An entry that escapes the app directory is mis-rooted by definition, so it
// counts as unresolved rather than being probed on disk - otherwise a report
// full of ../ paths that happen to exist would read as healthy coverage.
const unresolved = files.filter((entry) => {
  const target = resolveWithin(dir, entry);
  return target === null || !existsSync(target);
});
const resolved = files.length - unresolved.length;
const share = resolved / files.length;

console.log(`lcov-check: ${lcov}`);
console.log(`  SF entries:     ${files.length}`);
console.log(`  resolved under: ${dir}`);
console.log(`  resolved:       ${resolved} (${(share * 100).toFixed(1)}%)`);
console.log(`  sample SF:      ${files.slice(0, 3).join('\n                  ')}`);

if (resolved === 0) {
  fail(
    `no SF: path resolves under '${dir}'. Sonar would report 0% coverage for this ` +
      'project and pass its gate without measuring anything.'
  );
}
// Every path, not most of them. This used to tolerate up to half the report
// going unresolved, for paths that "vanish when files are deleted between
// runs" - but the two trees are the same commit, so there is no between: the
// job checks out `pull_request.head.sha`, and the coverage artifact it
// downloads was produced from that same sha earlier in the same run. The base
// checkout is a separate path holding only these scripts.
//
// Measured before removing it: 34 sonar jobs across 2026-08-25 to 2026-09-06
// printed `resolved: N (100.0%)`, every one, over reports of 46 to 236 files.
// The tolerance had never been used, and at the observed sizes it would have
// admitted 46 unresolved files for the API and 118 for the web app while the
// gate stayed green.
//
// The cost of this is a red build if a generated or untracked file under an
// app's `src/**` ever becomes instrumented. That is the right outcome: it
// means Sonar is scoring lines the tests measured and it cannot see, and the
// message below names them.
if (unresolved.length > 0) {
  fail(
    `${unresolved.length} of ${files.length} SF: paths do not resolve under '${dir}', so Sonar ` +
      `would score less code than the tests measured. First unresolved: ` +
      unresolved.slice(0, 3).join(', ')
  );
}
