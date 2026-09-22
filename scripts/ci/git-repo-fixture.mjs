// A real git repository in a temporary directory, for the guards that read
// blobs rather than the working tree.
//
// Extracted from `advisory-ids.test.mjs` when `version-claims.test.mjs` needed
// the same repository to drive `main` end to end. `git-blobs.mjs` already
// records that its own tests stayed in `advisory-ids.test.mjs` for want of this
// module; a third consumer is what made the move worth making.
//
// It is deliberately NOT named `*.test.mjs`. `check:ci-scripts:test` globs
// `scripts/ci/*.test.mjs`, so a test file importing a second test file to reach
// a helper would register that file's whole suite inside its own run.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * A real git repository, because these guards read blobs rather than the
 * working tree. Building one is not ceremony: it is what makes the tests
 * exercise the same path production does, tracked-ness included.
 *
 * Contents are STAGED and not committed, because everything in `git-blobs.mjs`
 * judges the index.
 *
 * The caller owns the directory and removes it; every caller does that in a
 * `finally`, because a test that fails should not also leak a tree.
 */
export function gitRepo(files, links = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'openrunic-ci-'));
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
