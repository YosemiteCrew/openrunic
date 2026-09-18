#!/usr/bin/env node
// The parser in `empty-files.mjs`, over the record shapes `git ls-tree -r -l`
// actually produces. The spawn is not the subject: what this guard can get
// wrong is reading the size off the wrong field or losing a path, and both are
// decided here.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { emptyBlobs } from './empty-files.mjs';

const sha = 'a'.repeat(40);
const blob = (size, file) => `100644 blob ${sha} ${size.toString().padStart(7)}\t${file}`;

describe('emptyBlobs', () => {
  it('finds a zero-byte blob among files that have content', () => {
    const out = [blob(34523, 'LICENSE'), blob(0, 'README.md'), blob(12, 'a.txt')].join('\n');

    assert.deepEqual(emptyBlobs(out), ['README.md']);
  });

  it('says nothing about a tree with no empty file in it', () => {
    // The negative the gate spends most of its life in. Without it every
    // assertion above is satisfied by a parser that returns its whole input.
    const out = [blob(34523, 'LICENSE'), blob(1, 'a.txt')].join('\n');

    assert.deepEqual(emptyBlobs(out), []);
  });

  it('keeps the whole path when it contains a space', () => {
    // The reason the record is split on the TAB rather than on whitespace. A
    // guard that names `docs/my` for `docs/my file.md` is one nobody acts on.
    const out = blob(0, 'docs/release notes.md');

    assert.deepEqual(emptyBlobs(out), ['docs/release notes.md']);
  });

  it('does not read a submodule as an empty file', () => {
    // `-` is where a blob's byte count is, and a commit entry carries no size.
    // Matching on the field's position alone would report every submodule.
    const out = `160000 commit ${sha}       -\tvendor/thing`;

    assert.deepEqual(emptyBlobs(out), []);
  });

  it('refuses a record it cannot read rather than skipping it', () => {
    // Fail closed: a record that parses to nothing is a file that stopped being
    // checked with nothing counting the shortfall.
    assert.throws(() => emptyBlobs('not a git ls-tree record'), /cannot parse/u);
  });
});
