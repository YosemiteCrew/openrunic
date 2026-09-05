import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import {
  EXCLUDED_PATHS,
  findCitations,
  main,
  parseIndexRecords,
  PLACEHOLDERS,
  resolveAll,
  readBlobs,
  resolveOne,
  scan,
  scanProblems,
  SCHEMES,
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

/**
 * A real git repository, because `scan` reads blobs rather than the working
 * tree. Building one is not ceremony: it is what makes these tests exercise the
 * same path production does, tracked-ness included.
 */
function gitRepo(files, links = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'advisory-ids-'));
  const git = (...args) => {
    const done = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
    assert.equal(done.status, 0, `git ${args.join(' ')}: ${done.stderr}`);
  };
  git('init', '-q');
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    writeFileSync(path.join(root, name), body);
  }
  for (const [name, target] of Object.entries(links)) {
    symlinkSync(target, path.join(root, name));
  }
  git('add', '-A');
  return root;
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

/**
 * A real tracked file, and both halves asserted.
 *
 * The first version of this named a path that does not exist. The file was
 * skipped, and `cited.length === 0` then held for a reason with nothing to do
 * with EXCLUDED_PATHS - it passed with the list emptied. Asserting what went
 * INTO the exemption is what reads the rail; the count coming back out only
 * says the file was never opened.
 */
test('a citation in a guard test fixture is exempt by path, not resolved', () => {
  const fixture = 'scripts/ci/advisory-ids.test.mjs';
  const scanned = scan(
    REPO_ROOT,
    trackedFiles(REPO_ROOT).filter((entry) => entry.file === fixture)
  );

  assert.equal(scanned.excludedByPath.length > 0, true, `${fixture} cites no identifier`);
  assert.equal(
    scanned.excludedByPath.every((citation) => citation.file === fixture),
    true
  );
  assert.equal(scanned.cited.length, 0);
});

/**
 * The exemption is the pair, not the identifier.
 *
 * The worked example is exempt because the guard's own prose NAMES it as a
 * fabrication. Exempting it everywhere exempts it in `pnpm-workspace.yaml`,
 * where citing it to justify the mysql2 override is the exact defect - same id,
 * same spelling - this guard was written for. Measured before this assertion
 * existed: putting that line back gave `8 identifier(s) across 15 citation(s),
 * all resolve.` and exit 0.
 */
test('a declared placeholder is not exempt in a file it was not declared for', () => {
  const example = [...PLACEHOLDERS.keys()][1];
  // A tree written for this test rather than the repository's own, so the
  // citation under test is one this test put there. Asserting it is absent from
  // the real `pnpm-workspace.yaml` would pass for the reason it is absent -
  // which is the whole state this is trying to distinguish from.
  const root = gitRepo({
    'pnpm-workspace.yaml': `  # ${example}: mysql2 override\n`,
    'scripts/ci/advisory-ids.mjs': `// ${example} is unreal\n`,
  });
  try {
    const entries = trackedFiles(root);
    const declared = scan(
      root,
      entries.filter((entry) => entry.file === 'scripts/ci/advisory-ids.mjs')
    );
    const elsewhere = scan(
      root,
      entries.filter((entry) => entry.file === 'pnpm-workspace.yaml')
    );

    assert.deepEqual(
      declared.placeheld.map((citation) => citation.id),
      [example]
    );
    assert.deepEqual(declared.cited, []);

    assert.deepEqual(elsewhere.placeheld, []);
    assert.deepEqual(
      elsewhere.cited.map((citation) => [citation.id, citation.file]),
      [[example, 'pnpm-workspace.yaml']]
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the documented placeholder is exempt by identifier', () => {
  const [id] = [...PLACEHOLDERS.keys()];
  const scanned = scan(
    REPO_ROOT,
    trackedFiles(REPO_ROOT).filter((entry) => entry.file === '.grype.yaml')
  );

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

  // No declared-unreal identifier is on the resolve list at all. A `where` too
  // narrow to cover a document that legitimately names its id would otherwise
  // only surface as a 404 on the networked gate, minutes away and against a
  // registry - this says it offline, inside `verify`, and it is what caught the
  // declaration block citing its own key on the first run.
  assert.deepEqual(
    scanned.cited.filter((citation) => PLACEHOLDERS.has(citation.id)),
    []
  );
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

/**
 * The guard's own false red, refused. Having no path exemption at all is a
 * legitimate configuration, and failing on it would be exactly what this guard
 * declines to do to an unreachable registry - condemn a correct state for
 * producing no evidence.
 */
test('having no path exemptions at all is not a failure', () => {
  const previous = EXCLUDED_PATHS.splice(0, EXCLUDED_PATHS.length);
  try {
    const problems = scanProblems({ cited: [{}], excludedByPath: [], placeheld: allPlaceheld });

    assert.deepEqual(problems, []);
  } finally {
    EXCLUDED_PATHS.push(...previous);
  }
});

/**
 * The guard run over its own documentation.
 *
 * The header of advisory-ids.mjs and of advisory-ids.yml both NAME
 * `GHSA-r8f6-24hv-cj3g` as the worked example of a fabricated identifier, so
 * without an exemption the guard reports itself. That was invisible until the
 * guard was committed: `git ls-files` does not list an untracked file, so the
 * first green run was over a tree that did not yet contain the thing being
 * tested. This is the assertion that would have said so.
 */
test('the guard does not report its own worked example as a finding', () => {
  const example = 'GHSA-r8f6-24hv-cj3g';
  const scanned = scan(REPO_ROOT, trackedFiles(REPO_ROOT));

  // Present, so this test is reading something. If the worked example is ever
  // rewritten out of the headers, this fails rather than passing vacuously -
  // and the PLACEHOLDERS entry covering it is then dead weight, which
  // scanProblems fails on separately.
  assert.equal(
    scanned.placeheld.some((citation) => citation.id === example),
    true,
    `${example} is no longer named anywhere: drop its PLACEHOLDERS entry`
  );

  // Exempt, so it is never sent to a registry that would correctly 404 it.
  assert.equal(
    scanned.cited.some((citation) => citation.id === example),
    false
  );

  // And the real identifiers in the same headers are still resolved, so the
  // exemption is one id and not "the guard stops reading its own files".
  assert.equal(
    scanned.cited.some((citation) => /advisory-ids\.(mjs|yml)$/u.test(citation.file)),
    true
  );
});

/**
 * `resolveOne` is exported, so it is reachable by a caller that did not come
 * through the scan. The identifier arrives from a file in the repository and
 * leaves as a URL, and a function that is safe because of who calls it is safe
 * until somebody else calls it.
 */
test('an identifier that does not match its scheme is never requested', async () => {
  const impl = stubFetch(status(200));
  const result = await resolveOne('GHSA-3f6p-5ww8-9rcr/../../users', 'ghsa', impl);

  assert.equal(result.state, 'unavailable');
  assert.match(result.detail, /not a well-formed ghsa identifier/u);
  assert.equal(impl.calls.length, 0, 'the registry was asked about a malformed identifier');
});

/** Anchored, so containing a valid id is not the same as being one. */
test('a string that merely contains a valid identifier is refused', async () => {
  const impl = stubFetch(status(200));
  const result = await resolveOne('see GHSA-3f6p-5ww8-9rcr for detail', 'ghsa', impl);

  assert.equal(result.state, 'unavailable');
  assert.equal(impl.calls.length, 0);
});

/** Defence in depth behind the anchor: nothing unencoded reaches the path. */
test('the identifier is percent-encoded into the registry URL', () => {
  const [ghsa] = SCHEMES;

  assert.equal(
    ghsa.url('GHSA-3f6p-5ww8-9rcr'),
    'https://api.github.com/advisories/GHSA-3f6p-5ww8-9rcr'
  );
  assert.equal(ghsa.url('a/b').endsWith('a%2Fb'), true);
});

/**
 * A tracked symlink never becomes a file this guard reads, and it is closed by
 * construction rather than by a check somebody has to keep.
 *
 * An earlier revision resolved each path and called `readFileSync`, which
 * FOLLOWS a link - so a pull request adding a tracked link to a file on the
 * runner would have had the guard read it. `safe-path.mjs` could not see that:
 * it is documented as reasoning about path strings and never touching the disk,
 * so a link is an ordinary name inside the root to it.
 *
 * Two independent things stop it now, and both are asserted. `trackedFiles`
 * drops mode 120000; and even reaching the blob could not disclose anything,
 * because a symlink's blob is the target PATH rather than the target's
 * contents.
 *
 * The control matters as much as the case: a regular file in the same repo is
 * still read, so this is "does not follow links" and not "stopped reading".
 */
test('a tracked symlink is never read, by mode and by blob', () => {
  const outside = mkdtempSync(path.join(tmpdir(), 'advisory-outside-'));
  try {
    const outsideFile = path.join(outside, 'outside.txt');
    writeFileSync(outsideFile, 'GHSA-3f6p-5ww8-9rcr\n');
    const root = gitRepo({ 'plain.txt': 'GHSA-3f6p-5ww8-9rcr\n' }, { 'link.txt': outsideFile });
    try {
      const entries = trackedFiles(root);

      assert.deepEqual(
        entries.map((entry) => entry.file),
        ['plain.txt'],
        'the symlink was not dropped by mode'
      );

      const listed = spawnSync('git', ['-C', root, 'ls-files', '-s', '-z'], { encoding: 'utf8' });
      const linkSha = /(?<sha>[0-9a-f]{40,64}) \d\tlink\.txt/u.exec(listed.stdout)?.groups?.sha;
      assert.equal(typeof linkSha, 'string', 'the symlink is not tracked, so this reads nothing');

      const blob = readBlobs(root, [{ file: 'link.txt', sha: linkSha }]).get(linkSha);
      assert.equal(blob, outsideFile);
      assert.equal(blob.includes('GHSA-'), false);

      assert.equal(scan(root, entries).cited.length, 1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
});

// ------------------------------------------------- reading the tree from git

test('an index record git could not have produced is refused, not skipped', () => {
  const sha = 'a'.repeat(40);
  const good = `100644 ${sha} 0\tkept.md\0`;

  assert.deepEqual(parseIndexRecords(good), [{ file: 'kept.md', sha }]);
  assert.throws(
    () => parseIndexRecords(`${good}not-an-index-record\0`),
    /cannot parse a git ls-files record/u
  );
});

test('a submodule is dropped by mode, like a symlink', () => {
  const sha = 'b'.repeat(40);

  assert.deepEqual(parseIndexRecords(`160000 ${sha} 0\tvendor\0`), []);
  assert.deepEqual(parseIndexRecords(`120000 ${sha} 0\tlink\0`), []);
  assert.equal(parseIndexRecords(`100755 ${sha} 0\trun.sh\0`).length, 1);
});

/**
 * `cat-file --batch` answers `<sha> missing` for an object it does not have,
 * and that line carries no size. Read as a blob it gives `Number(undefined)` -
 * NaN - which walks the cursor off the end and returns fewer blobs than were
 * asked for: files stop being scanned and nothing says so.
 */
test('a sha the object store does not have is refused', () => {
  const root = gitRepo({ 'plain.txt': 'GHSA-3f6p-5ww8-9rcr\n' });
  try {
    assert.throws(() => readBlobs(root, [{ file: 'gone.txt', sha: 'c'.repeat(40) }]), /non-blob/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/** A blob with a NUL byte is binary; git's own heuristic, and not scanned. */
test('a binary blob is not scanned for identifiers', () => {
  const root = gitRepo({ 'blob.bin': `GHSA-3f6p-5ww8-9rcr\0\n` });
  try {
    const entries = trackedFiles(root);

    assert.equal(entries.length, 1, 'the fixture is not tracked, so this reads nothing');
    assert.deepEqual(scan(root, entries).cited, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
