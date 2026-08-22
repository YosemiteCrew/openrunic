#!/usr/bin/env node
// Holds .secretlintignore.ci to being .secretlintignore and nothing else.
//
// The two files exist because one question is asked of a working tree and a
// different one is asked of the repository. `.secretlintignore` may excuse a
// developer's own untracked .env, because `pnpm verify` scans with
// --no-gitignore and would otherwise fail on the file README.md just told them
// to write. CI may not excuse it, because the policy CI enforces is that no
// environment file but .env.example is in git at all, and
// @secretlint/secretlint-rule-no-dotenv is the only scanner that enforces that
// by name rather than by pattern.
//
// The failure mode this test exists for is quiet: someone widens
// .secretlintignore for a local convenience, the widening reaches CI because
// secretlint honours the same file there, and a scanner that still runs and
// still passes now proves less than it did. Deriving the CI file by truncation
// makes the boundary a line in a file rather than a convention, and this test
// makes moving that line a red build rather than a diff nobody read.
//
// Run with `node --test scripts/ci/secretlint-ignore.test.mjs`, or
// `pnpm run check:ci-scripts:test`.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

/** The line below which an exemption is local-only. Duplicated in both files. */
const SENTINEL = '# >>> local-only, stripped from .secretlintignore.ci <<<';

const root = new URL('../../', import.meta.url);
const read = (name) => readFileSync(fileURLToPath(new URL(name, root)), 'utf8');

/** A pattern line: not blank, not a comment. */
const patterns = (text) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));

describe('.secretlintignore.ci', () => {
  const working = read('.secretlintignore');
  const ci = read('.secretlintignore.ci');

  it('is derived from a sentinel the working-tree file actually carries', () => {
    assert.ok(
      working.includes(SENTINEL),
      '.secretlintignore no longer carries the local-only sentinel, so nothing marks where CI stops reading'
    );
  });

  it('carries every pattern above the sentinel', () => {
    const shared = patterns(working.split(SENTINEL)[0]);
    assert.deepEqual(patterns(ci), shared);
  });

  it('carries none of the patterns below the sentinel', () => {
    const localOnly = patterns(working.split(SENTINEL)[1] ?? '');
    // The point of the split: these are the ones CI must still scan.
    assert.ok(
      localOnly.length > 0,
      'nothing is exempted locally; the sentinel has become decorative'
    );
    for (const pattern of localOnly) {
      assert.ok(
        !patterns(ci).includes(pattern),
        `${pattern} is exempted locally and has leaked into the CI ignore file`
      );
    }
  });

  it('still exempts the dotenv files locally, which is the whole reason for the split', () => {
    const localOnly = patterns(working.split(SENTINEL)[1] ?? '');
    assert.ok(localOnly.includes('.env'));
    assert.ok(localOnly.includes('packages/database/.env'));
  });
});
