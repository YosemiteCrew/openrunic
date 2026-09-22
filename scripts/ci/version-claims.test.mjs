#!/usr/bin/env node
// Tests for the default-branch version-claim guard.
//
// Two halves. The unit half pins the pattern's boundary in both directions -
// what counts as naming a version and what is generic prose about a release
// line - because a pattern that has drifted either way is a guard reporting
// clean for the wrong reason. The tree half asserts the scope still selects
// real files in THIS repository, which is the check the guard itself cannot
// usefully make about its own future.
//
// Run with `node --test scripts/ci/version-claims.test.mjs`, or
// `pnpm run check:ci-scripts:test`.

import assert from 'node:assert/strict';
import { rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { trackedFiles } from './git-blobs.mjs';
import { gitRepo } from './git-repo-fixture.mjs';
import { SCOPE, VERSION, findClaims, inScope, main, scopeProblems } from './version-claims.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));

describe('VERSION', () => {
  // The spellings the retired SECURITY.md table and the release tags actually
  // used. Each of these is a claim that a named version is current.
  for (const claim of ['0.1.0', '0.1.x', '0.2.0', 'v0.3.0', 'api-v0.2.0', 'web-v0.2.0', '1.0.0']) {
    it(`recognises ${claim}`, () => {
      assert.equal(VERSION.test(claim), true);
    });
  }

  // The other side of the boundary, and the reason the pattern needs three
  // segments. These are sentences SECURITY.md is supposed to keep: the policy
  // is about the 0.x major and about release lines in general, and a guard
  // that banned them would be demanding the document say less than it means.
  for (const prose of ['0.x', 'a 0.2 install', 'Semantic Versioning', 'semver.org', '90 days']) {
    it(`leaves ${prose} alone`, () => {
      assert.equal(VERSION.test(prose), false);
    });
  }
});

describe('inScope', () => {
  it('selects the documents GitHub serves from the default branch', () => {
    const selected = inScope([
      'SECURITY.md',
      '.github/ISSUE_TEMPLATE/bug_report.yml',
      '.github/ISSUE_TEMPLATE/config.yml',
      '.github/PULL_REQUEST_TEMPLATE.md',
    ]);
    assert.deepEqual(
      selected.map((one) => one.file),
      [
        'SECURITY.md',
        '.github/ISSUE_TEMPLATE/bug_report.yml',
        '.github/ISSUE_TEMPLATE/config.yml',
        '.github/PULL_REQUEST_TEMPLATE.md',
      ]
    );
    for (const one of selected) assert.match(one.why, /default branch/u);
  });

  // The files that name versions correctly. README reports the released
  // version on purpose, verifying-releases pastes real image tags, roadmap.md
  // is generated and gated by roadmap:check, and workflows pin runtimes. If
  // any of these were selected the guard would be unkeepable and the first
  // exemption would reopen the hole it closes.
  for (const file of [
    'README.md',
    'RELEASING.md',
    'docs/roadmap.md',
    'docs/verifying-releases.md',
    '.github/workflows/ci.yaml',
    '.github/dependabot.yml',
    '.github/CODEOWNERS',
    'scripts/ci/version-claims.mjs',
    'package.json',
  ]) {
    it(`does not select ${file}`, () => {
      assert.deepEqual(inScope([file]), []);
    });
  }

  it('does not select a nested path under ISSUE_TEMPLATE', () => {
    // The pattern is one level deep on purpose: GitHub reads the forms
    // directly in that directory and nothing else there is served.
    assert.deepEqual(inScope(['.github/ISSUE_TEMPLATE/archive/old_form.yml']), []);
  });
});

describe('findClaims', () => {
  it('reports the file, the line and the claim', () => {
    const found = findClaims('supported\n| 0.1.x | current |\n', 'SECURITY.md', 'because');
    assert.deepEqual(found, [{ file: 'SECURITY.md', why: 'because', line: 2, claim: '0.1.x' }]);
  });

  it('reports every claim on a line, not the first', () => {
    // The row that shipped the defect carried both numbers.
    const found = findClaims('| When 0.2.0 ships, 0.1.x stops |', 'SECURITY.md', 'because');
    assert.deepEqual(
      found.map((one) => one.claim),
      ['0.2.0', '0.1.x']
    );
  });

  it('finds nothing in a document that states the rule', () => {
    const rule = 'Security fixes are made on the most recent release line only.\nSee Releases.\n';
    assert.deepEqual(findClaims(rule, 'SECURITY.md', 'because'), []);
  });
});

describe('scopeProblems', () => {
  it('is silent when every entry matched a file', () => {
    assert.deepEqual(
      scopeProblems([
        'SECURITY.md',
        '.github/ISSUE_TEMPLATE/config.yml',
        '.github/PULL_REQUEST_TEMPLATE.md',
      ]),
      []
    );
  });

  it('names the entry that matched nothing', () => {
    // The renamed-document case: the entry still reads correctly and selects
    // no file, so without this the guard passes having opened nothing.
    const problems = scopeProblems(['.github/ISSUE_TEMPLATE/config.yml']);
    assert.equal(problems.length, 2);
    assert.ok(problems.some((problem) => problem.includes('SECURITY')));
    assert.ok(problems.every((problem) => problem.includes('matched no tracked file')));
  });
});

describe('this repository', () => {
  const files = trackedFiles(root).map((entry) => entry.file);

  it('tracks a file for every scope entry', () => {
    assert.deepEqual(scopeProblems(files), []);
  });

  it('puts more than one document in scope', () => {
    // Guards against a scope that has quietly collapsed to a single file while
    // still passing the entry-by-entry check above.
    assert.ok(inScope(files).length >= SCOPE.length);
  });
});

// ---------------------------------------------------------------- the guard

/**
 * `main` over a temporary repository, with both streams captured.
 *
 * The unit half above proves `scopeProblems` computes the right answer. It
 * cannot prove `main` asks it the question, and that gap is not theoretical:
 * replacing the call with `const problems = []` left all thirty unit tests
 * green and the guard exit 0 over a `SECURITY.md` it never opened (#548). Only
 * a test that drives `main` itself distinguishes the two.
 *
 * The streams are swapped rather than mocked because `main` writes to them
 * directly, and the swap is synchronous around the call, so the runner's own
 * reporting is never inside it.
 */
function run(root) {
  const out = [];
  const err = [];
  const realOut = process.stdout.write;
  const realErr = process.stderr.write;
  process.stdout.write = (chunk) => {
    out.push(String(chunk));
    return true;
  };
  process.stderr.write = (chunk) => {
    err.push(String(chunk));
    return true;
  };
  try {
    return { code: main([], { root }), out: out.join(''), err: err.join('') };
  } finally {
    process.stdout.write = realOut;
    process.stderr.write = realErr;
  }
}

/**
 * A tree that satisfies every scope entry and states the rule rather than the
 * number - what `SECURITY.md` was rewritten to say.
 *
 * `README.md` names a version on purpose. It is the negative control for the
 * scope: a guard that had quietly stopped filtering would report it, and the
 * clean-tree assertion below would go red rather than merely stay green for a
 * reason nobody checked.
 */
const stateTheRule = {
  'SECURITY.md': 'Security fixes are made on the most recent release line only.\n',
  '.github/ISSUE_TEMPLATE/bug_report.yml': 'name: Bug report\ndescription: Report a defect\n',
  '.github/PULL_REQUEST_TEMPLATE.md': '## What changed\n\n## How it was verified\n',
  'README.md': 'openrunic 0.3.0 is the current release.\n',
};

describe('main', () => {
  it('reports clean, and counts the documents it read', () => {
    const root = gitRepo(stateTheRule);
    try {
      const { code, out, err } = run(root);
      assert.equal(code, 0);
      assert.equal(err, '');
      assert.match(out, /^version-claims: 3 default-branch document\(s\) name no version\.\n$/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('refuses when a scope entry matches no tracked file', () => {
    // The renamed document, end to end. This is the arm the unwiring mutant
    // fails: with `scopeProblems` unwired it exits 0 and prints the clean line
    // for the two files that are left, never saying one went missing.
    const { 'SECURITY.md': policy, ...rest } = stateTheRule;
    const root = gitRepo({ ...rest, 'SECURITY-POLICY.md': policy });
    try {
      const { code, out, err } = run(root);
      assert.equal(code, 1);
      assert.equal(out, '');
      assert.match(err, /did not run over what it claims to cover/u);
      assert.match(err, /\^SECURITY\\\.md\$.*matched no tracked file/u);
      assert.match(err, /Repoint SCOPE/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('names the file, the line and the claim when a document names a version', () => {
    const root = gitRepo({
      ...stateTheRule,
      'SECURITY.md': 'Supported versions\n\n0.1.x is the current line, until 0.2.0 ships.\n',
    });
    try {
      const { code, out, err } = run(root);
      assert.equal(code, 1);
      assert.equal(out, '');
      // Both claims on the line, not the first: the retired table put two on
      // one row and a first-match-only reader named one of them.
      assert.match(err, /SECURITY\.md:3\s+0\.1\.x/u);
      assert.match(err, /SECURITY\.md:3\s+0\.2\.0/u);
      // The reason travels with the finding, so the author is not left to
      // guess why this file and not the README beside it.
      assert.match(err, /Security tab serves it from the default branch/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('refuses a scoped blob it cannot read', () => {
    // A NUL byte is git's own binary heuristic, so `readBlobs` hands back
    // `null` here. Skipping it would leave the clean-tree count describing
    // files selected rather than files scanned.
    const root = gitRepo({ ...stateTheRule, 'SECURITY.md': 'Supported versions\0\n' });
    try {
      const { code, out, err } = run(root);
      assert.equal(code, 1);
      assert.equal(out, '');
      assert.match(err, /did not run over what it claims to cover/u);
      assert.match(err, /SECURITY\.md is a binary blob, so nothing scanned it/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('reads the index, not the working tree', () => {
    // Every reader here judges what was committed. An unstaged edit that adds
    // a claim is invisible, which is deliberate and worth pinning: a guard
    // that read the working tree could be made to fail by a file nobody
    // committed, and made to pass by deleting one.
    const root = gitRepo(stateTheRule);
    try {
      writeFileSync(path.join(root, 'SECURITY.md'), '0.1.x is the current line.\n');
      const { code, out } = run(root);
      assert.equal(code, 0);
      assert.match(out, /3 default-branch document\(s\) name no version/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
