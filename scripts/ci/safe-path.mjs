#!/usr/bin/env node
// Resolve a path against a base directory, refusing anything that escapes it.
//
// resolveWithin(root, target) returns the absolute resolved path when the
// target lies within `root` (or is `root` itself), and null otherwise.
// Callers treat null as "hostile or mis-rooted input" and fail or skip
// accordingly - see affected-matrix.mjs, merge-coverage.mjs and
// lcov-check.mjs.
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
