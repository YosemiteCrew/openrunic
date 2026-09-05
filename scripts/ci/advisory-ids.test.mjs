import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import {
  EXCLUDED_PATHS,
  findCitations,
  main,
  PLACEHOLDERS,
  resolveAll,
  resolveOne,
  scan,
  scanProblems,
  trackedFiles,
} from './advisory-ids.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** A response object with only the field {@link resolveOne} reads. */
const status = (code) => ({ status: code });

/** A fetch stub that returns the given outcomes in order and counts its calls. */
function stubFetch(...outcomes) {
  const calls = [];
  const impl = (url, init) => {
    calls.push({ url, init });
    const next = outcomes[calls.length - 1];
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve(next);
  };
  impl.calls = calls;
  return impl;
}

// ---------------------------------------------------------------- parsing

test('finds every scheme this repository cites', () => {
  const found = findCitations(
    ['# GHSA-3f6p-5ww8-9rcr in mysql2', '# CVE-2025-60876 in busybox', '# GO-2026-4337'].join('\n'),
    'notes.md'
  );

  assert.deepEqual(
    found.map((citation) => [citation.id, citation.kind, citation.line]),
    [
      ['GHSA-3f6p-5ww8-9rcr', 'ghsa', 1],
      ['CVE-2025-60876', 'cve', 2],
      ['GO-2026-4337', 'go', 3],
    ]
  );
});

/**
 * Three on one line is the shape `pnpm-workspace.yaml` actually uses for
 * fast-uri, and it is what a one-match-per-line reader silently gets wrong -
 * two of the three simply never appear, and the guard reports clean over them.
 *
 * The reason this comment says that rather than something about `lastIndex`:
 * the first version did claim a `lastIndex` hazard, and the mutation written to
 * prove it - sharing one global regex across every line - stayed GREEN, because
 * `matchAll` iterates a clone. A single `exec` per line is the mutation that
 * goes red here, and it is also the realistic one, so it is the one this test
 * is actually for.
 */
test('finds every identifier on a line, not just the first', () => {
  const found = findCitations(
    '# GHSA-f65p-4m7j-42xc / GHSA-fph4-wmhf-6fwf / GHSA-5jgf-p345-68v8: fast-uri',
    'pnpm-workspace.yaml'
  );

  assert.equal(found.length, 3);
  assert.deepEqual(new Set(found.map((citation) => citation.line)), new Set([1]));
});

/**
 * The alphabet is the issuing authority's, so a transcription inventing a
 * character outside it never reaches the network. This is the only class of
 * wrong identifier a pattern CAN catch, which is the reason the rest of this
 * guard is a resolution.
 */
test('a GHSA id using characters GitHub does not issue is not a citation', () => {
  assert.deepEqual(findCitations('GHSA-a0b1-i8l0-uuuu', 'notes.md'), []);
  assert.deepEqual(findCitations('CVE-2025-123', 'notes.md'), []);
});

// ---------------------------------------------------------------- scanning

test('a citation in a guard test fixture is exempt by path, not resolved', () => {
  const scanned = scan(REPO_ROOT, ['scripts/ci/made-up.test.mjs']);

  assert.equal(scanned.cited.length, 0);
});

test('the documented placeholder is exempt by identifier', () => {
  const [id] = [...PLACEHOLDERS.keys()];
  const scanned = scan(REPO_ROOT, ['.grype.yaml']);

  assert.equal(
    scanned.placeheld.some((citation) => citation.id === id),
    true
  );
  assert.equal(
    scanned.cited.some((citation) => citation.id === id),
    false
  );
});

/**
 * Zero and not a threshold. A guard reporting clean having read nothing is
 * byte-identical to one reporting clean having read everything, and every
 * failure of the walk - a changed pattern, a broken `git ls-files`, a rename -
 * arrives as zero.
 */
test('finding no citation at all is a failure, not a clean scan', () => {
  const problems = scanProblems({ cited: [], excludedByPath: [{}], placeheld: [] });

  assert.equal(problems.length > 0, true);
  assert.match(problems[0].reason, /read nothing/u);
});

/** Every declared placeholder, so only the exclusion under test is unsatisfied. */
const allPlaceheld = [...PLACEHOLDERS.keys()].map((id) => ({ id }));

test('an exclusion that matches nothing is a failure', () => {
  const problems = scanProblems({ cited: [{}], excludedByPath: [], placeheld: allPlaceheld });

  assert.equal(problems.length, 1);
  assert.match(problems[0].reason, /EXCLUDED_PATHS matched no citation/u);
});

test('a declared placeholder that appears nowhere is a failure', () => {
  const problems = scanProblems({ cited: [{}], excludedByPath: [{}], placeheld: [] });

  assert.equal(problems.length, PLACEHOLDERS.size);
  assert.match(problems[0].reason, /appears nowhere/u);
});

/**
 * The guard run against the tree it guards, with no network. If the walk, the
 * patterns or either exemption stops working, this is where it shows - and it
 * runs inside `pnpm verify` through the `scripts/ci/*.test.mjs` glob, so it
 * fails locally rather than on a scheduled run somebody reads on Monday.
 */
test('the real tree scans without any structural problem', () => {
  const scanned = scan(REPO_ROOT, trackedFiles(REPO_ROOT));

  assert.deepEqual(scanProblems(scanned), []);
  assert.equal(scanned.cited.length > 0, true);
  assert.equal(EXCLUDED_PATHS.length > 0, true);
});

// ---------------------------------------------------------------- resolving

test('200 is exists and 404 is missing', async () => {
  const exists = await resolveOne('GHSA-3f6p-5ww8-9rcr', 'ghsa', stubFetch(status(200)));
  const absent = await resolveOne('GHSA-3f6p-5ww8-9rcr', 'ghsa', stubFetch(status(404)));

  assert.equal(exists.state, 'exists');
  assert.equal(absent.state, 'missing');
});

/**
 * The finding this whole guard exists for, in reverse. A rate limit, a timeout
 * and a 502 all mean the registry was not asked; calling any of them `missing`
 * turns an outage into an accusation against a correct comment, which is the
 * failure mode that gets a security gate deleted rather than fixed.
 */
test('a rate limit is unavailable, never missing', async () => {
  const limited = await resolveOne(
    'GHSA-3f6p-5ww8-9rcr',
    'ghsa',
    stubFetch(status(403), status(403))
  );

  assert.equal(limited.state, 'unavailable');
  assert.match(limited.detail, /HTTP 403/u);
});

test('a transport failure twice is unavailable, and it was retried', async () => {
  const impl = stubFetch(new Error('ECONNRESET'), new Error('ECONNRESET'));
  const result = await resolveOne('GO-2026-4337', 'go', impl);

  assert.equal(result.state, 'unavailable');
  assert.equal(impl.calls.length, 2);
});

test('one transient failure does not condemn an identifier', async () => {
  const impl = stubFetch(new Error('ETIMEDOUT'), status(200));
  const result = await resolveOne('GO-2026-4337', 'go', impl);

  assert.equal(result.state, 'exists');
  assert.equal(impl.calls.length, 2);
});

/**
 * Each identifier goes to the registry that ISSUES it. Asking GitHub about a
 * CVE is the documented false red: GitHub's advisory database is organised by
 * language ecosystem, so a real operating-system CVE - and both of the ones in
 * `.grype.yaml` are that shape - comes back with no match and reads as invented.
 */
test('each scheme is asked of its own registry', async () => {
  const ghsa = stubFetch(status(200));
  const cve = stubFetch(status(200));
  const go = stubFetch(status(200));

  await resolveOne('GHSA-3f6p-5ww8-9rcr', 'ghsa', ghsa);
  await resolveOne('CVE-2025-60876', 'cve', cve);
  await resolveOne('GO-2026-4337', 'go', go);

  assert.match(ghsa.calls[0].url, /^https:\/\/api\.github\.com\/advisories\//u);
  assert.match(cve.calls[0].url, /^https:\/\/cveawg\.mitre\.org\/api\/cve\//u);
  assert.match(go.calls[0].url, /^https:\/\/vuln\.go\.dev\/ID\//u);
});

test('no credential is sent to a registry that does not take one', async () => {
  const previous = process.env['GITHUB_TOKEN'];
  process.env['GITHUB_TOKEN'] = 'not-a-real-token';
  try {
    const cve = stubFetch(status(200));
    await resolveOne('CVE-2025-60876', 'cve', cve);

    assert.equal('authorization' in cve.calls[0].init.headers, false);
  } finally {
    if (previous === undefined) delete process.env['GITHUB_TOKEN'];
    else process.env['GITHUB_TOKEN'] = previous;
  }
});

test('an identifier cited twice is resolved once and keeps both sites', async () => {
  let asked = 0;
  const results = await resolveAll(
    [
      { id: 'CVE-2026-14456', kind: 'cve', file: 'a', line: 1 },
      { id: 'CVE-2026-14456', kind: 'cve', file: 'b', line: 2 },
    ],
    (id) => {
      asked += 1;
      return Promise.resolve({ id, state: 'exists' });
    }
  );

  assert.equal(asked, 1);
  assert.equal(results.length, 1);
  assert.deepEqual(
    results[0].sites.map((site) => site.file),
    ['a', 'b']
  );
});

// ---------------------------------------------------------------- exit codes

/** Run main against the real tree with a stubbed registry, keeping the output. */
async function run(resolver) {
  const written = [];
  const out = process.stdout.write.bind(process.stdout);
  const err = process.stderr.write.bind(process.stderr);
  process.stdout.write = (chunk) => written.push(String(chunk)) > 0;
  process.stderr.write = (chunk) => written.push(String(chunk)) > 0;
  try {
    const code = await main([], { root: REPO_ROOT, resolver });
    return { code, output: written.join('') };
  } finally {
    process.stdout.write = out;
    process.stderr.write = err;
  }
}

test('every identifier resolving is exit 0', async () => {
  const { code } = await run((id) => Promise.resolve({ id, state: 'exists' }));

  assert.equal(code, 0);
});

test('a missing identifier is exit 1 and names where it is cited', async () => {
  const { code, output } = await run((id) =>
    Promise.resolve(
      id.startsWith('GHSA')
        ? { id, state: 'missing', registry: 'somewhere' }
        : { id, state: 'exists' }
    )
  );

  assert.equal(code, 1);
  assert.match(output, /pnpm-workspace\.yaml:\d+/u);
});

test('a registry that could not be reached is exit 2, not a pass', async () => {
  const { code, output } = await run((id) =>
    Promise.resolve({ id, state: 'unavailable', detail: 'HTTP 503' })
  );

  assert.equal(code, 2);
  assert.match(output, /could not run, not a guard that passed/u);
});

/**
 * A confirmed fabrication outranks an incomplete scan for the exit code, and
 * the incomplete half is still printed. Absorbing it silently into the finding
 * would let the next run's "fixed that one" read as a clean tree.
 */
test('a missing identifier alongside an unreachable one still reports both', async () => {
  const { code, output } = await run((id) =>
    Promise.resolve(
      id.startsWith('GHSA')
        ? { id, state: 'missing', registry: 'somewhere' }
        : { id, state: 'unavailable', detail: 'HTTP 503' }
    )
  );

  assert.equal(code, 1);
  assert.match(output, /could not check CVE-/u);
  assert.match(output, /do not exist/u);
});
