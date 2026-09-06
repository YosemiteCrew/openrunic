#!/usr/bin/env node
// Unit tests for the shared path-containment helper.
//
// `resolveWithin` is what five CI scripts use to decide whether a path they
// were handed belongs to the tree they are allowed to touch - affected-matrix,
// exception-expiry, git-blobs, lcov-check and merge-coverage. It had no test of
// its own, and the case that matters is the one a plain prefix comparison gets
// wrong: a *sibling* directory whose name starts with the root's name. Dropping
// the separator from the boundary passed all 286 ci-script tests, so the
// boundary itself is pinned here rather than through a caller.
//
// The helper touches no filesystem by design, so neither does this.
//
// Run with `node --test scripts/ci/safe-path.test.mjs`, or
// `pnpm run check:ci-scripts:test`.

import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';

import { resolveWithin } from './safe-path.mjs';

const ROOT = path.resolve('/tmp/openrunic-safe-path/apps/api');

describe('a target inside the root', () => {
  it('resolves to the absolute path', () => {
    assert.equal(resolveWithin(ROOT, 'src/a.ts'), path.join(ROOT, 'src/a.ts'));
  });

  it('accepts the root itself', () => {
    assert.equal(resolveWithin(ROOT, '.'), ROOT);
  });

  it('accepts an absolute target already under the root', () => {
    const inside = path.join(ROOT, 'src/a.ts');
    assert.equal(resolveWithin(ROOT, inside), inside);
  });
});

describe('a target outside the root', () => {
  it('refuses a path that climbs out', () => {
    assert.equal(resolveWithin(ROOT, '../web/src/a.ts'), null);
  });

  it('refuses an absolute path elsewhere', () => {
    assert.equal(resolveWithin(ROOT, '/etc/passwd'), null);
  });
});

describe('a sibling whose name extends the root', () => {
  // The boundary case. `/tmp/.../apps/api-generated` starts with the root
  // string `/tmp/.../apps/api`, so a containment test written as a bare
  // `startsWith(base)` admits it. It is a different directory and must not
  // resolve. Every other case in this file passes with or without the
  // separator; this is the only one that separates the two readings.
  it('refuses it, because a shared name prefix is not containment', () => {
    assert.equal(resolveWithin(ROOT, '../api-generated/src/a.ts'), null);
  });

  it('refuses a sibling file with the same prefix', () => {
    assert.equal(resolveWithin(ROOT, '../api.bak'), null);
  });
});
