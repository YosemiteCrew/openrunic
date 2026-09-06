#!/usr/bin/env node
// Resolve a path against a base directory, refusing anything that escapes it.
//
// resolveWithin(root, target) returns the absolute resolved path when the
// target lies within `root` (or is `root` itself), and null otherwise.
// Callers treat null as "hostile or mis-rooted input" and fail or skip
// accordingly - affected-matrix.mjs, exception-expiry.mjs, lcov-check.mjs and
// merge-coverage.mjs, which are all of them. git-blobs.mjs names this file to
// explain why it does NOT use it: a string-only helper cannot see a tracked
// symlink, so it reads blobs instead.
//
// The boundary is pinned by safe-path.test.mjs. Removing `path.sep` from it
// admits a sibling whose name extends the root's and was green across the whole
// ci-script suite before that file existed.
//
// Deliberately dependency-free and free of filesystem access: it reasons about
// path strings only, so callers can use it before probing the disk.

import path from 'node:path';

export function resolveWithin(root, target) {
  const base = path.resolve(root);
  const resolved = path.resolve(base, target);
  if (resolved === base) return resolved;
  return resolved.startsWith(base + path.sep) ? resolved : null;
}
