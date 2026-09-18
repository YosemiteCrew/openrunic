#!/usr/bin/env node
// The parser in `empty-files.mjs`, over the record shapes `git ls-tree -r -l`
// actually produces. The spawn is not the subject: what this guard can get
// wrong is reading the size off the wrong field or losing a path, and both are
// decided here.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { emptyBlobs } from './empty-files.mjs';

const sha = 'a'.repeat(40);
const blob = (size, file) => `100644 blob ${sha} ${size.toString().padStart(7)}\t${file}`;
// `git ls-tree` terminates the LAST record too, so the output always ends in a
// newline and splitting it always yields a trailing empty string. Every fixture
// here goes through this rather than `join`, so the skip that swallows it is
// exercised by all of them - written as `join` first, and then nothing failed
// when the skip was removed.
const tree = (...records) => `${records.join('\n')}\n`;

describe('emptyBlobs', () => {
  it('finds a zero-byte blob among files that have content', () => {
    const out = tree(blob(34523, 'LICENSE'), blob(0, 'README.md'), blob(12, 'a.txt'));

    assert.deepEqual(emptyBlobs(out), ['README.md']);
  });

  it('says nothing about a tree with no empty file in it', () => {
    // The negative the gate spends most of its life in. Without it every
    // assertion above is satisfied by a parser that returns its whole input.
    const out = tree(blob(34523, 'LICENSE'), blob(1, 'a.txt'));

    assert.deepEqual(emptyBlobs(out), []);
  });

  it('keeps the whole path when it contains a space', () => {
    // The reason the record is split on the TAB rather than on whitespace. A
    // guard that names `docs/my` for `docs/my file.md` is one nobody acts on.
    const out = tree(blob(0, 'docs/release notes.md'));

    assert.deepEqual(emptyBlobs(out), ['docs/release notes.md']);
  });

  it('does not read a submodule as an empty file', () => {
    // `-` is where a blob's byte count is, and a commit entry carries no size.
    // Matching on the field's position alone would report every submodule.
    const out = tree(`160000 commit ${sha}       -\tvendor/thing`);

    assert.deepEqual(emptyBlobs(out), []);
  });

  it('reads a one-record tree, newline and all', () => {
    // The smallest real output there is. Named on its own because the trailing
    // newline is the input that decides whether the skip above is load-bearing,
    // and a fixture that happens to carry it proves nothing about intent.
    assert.deepEqual(emptyBlobs(tree(blob(0, 'LICENSE'))), ['LICENSE']);
  });

  it('refuses a record it cannot read rather than skipping it', () => {
    // Fail closed: a record that parses to nothing is a file that stopped being
    // checked with nothing counting the shortfall.
    assert.throws(() => emptyBlobs('not a git ls-tree record'), /cannot parse/u);
  });
});

/**
 * The whole tree, from wherever it is run.
 *
 * `git ls-tree` is scoped to the CURRENT DIRECTORY unless it is told otherwise,
 * so the version of this guard that went up for review read 36 records from
 * `scripts/ci` and 1645 from the root - and reported clean over a root file a
 * pull request had emptied. Nothing above can see that: the parser is handed
 * text, and the flag that decides which text it gets lives in the spawn. This
 * is the one arm that runs the real thing, and it runs it from a subdirectory
 * because the defect is invisible from the top.
 */
describe('the guard over a real repository', () => {
  const repo = (files) => {
    const root = mkdtempSync(path.join(tmpdir(), 'empty-files-'));
    const git = (...args) => {
      const done = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
      assert.equal(done.status, 0, `git ${args.join(' ')}: ${done.stderr}`);
    };
    git('init', '-q');
    git('config', 'user.email', 'test@example.invalid');
    git('config', 'user.name', 'Test');
    for (const [name, body] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
      writeFileSync(path.join(root, name), body);
    }
    git('add', '-A');
    git('commit', '-q', '-m', 'fixture');
    return root;
  };

  const runFrom = (cwd) =>
    spawnSync(process.execPath, [import.meta.dirname + '/empty-files.mjs'], {
      cwd,
      encoding: 'utf8',
    });

  it('names a root file emptied by someone else, run from a subdirectory', () => {
    const root = repo({ LICENSE: '', 'deep/nested/kept.txt': 'content\n' });

    const done = runFrom(path.join(root, 'deep/nested'));

    assert.equal(done.status, 1);
    assert.match(done.stderr, /LICENSE/u);
  });

  it('is silent on a tree whose files all have content', () => {
    // The negative control for the arm above: without it, a guard that failed
    // on every repository would satisfy it.
    const root = repo({ LICENSE: 'a license\n', 'deep/nested/kept.txt': 'content\n' });

    const done = runFrom(path.join(root, 'deep/nested'));

    assert.equal(done.status, 0);
    assert.match(done.stdout, /no tracked file is empty/u);
  });
});
