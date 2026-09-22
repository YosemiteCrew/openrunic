#!/usr/bin/env node
// No document GitHub serves from the default branch names a concrete openrunic
// version.
//
// WHY THIS EXISTS
//
// `SECURITY.md` told every vulnerability reporter that `0.1.x` was the current
// supported line, and went on telling them for three weeks after the next minor
// shipped and retired it. By the policy written two paragraphs above the table,
// the line it named as supported was not. Nothing caught it: the document is
// prose, prose is not generated, and `RELEASING.md` step 3 - the step that
// exists to retire statements a release makes false - greps for
// `nothing (is )?(released|tagged)` and structurally cannot match a named older
// version asserted as current.
//
// The defect class is not "this sentence was wrong". It is a claim about the
// current version, written into a file that no release step edits, in a
// document GitHub publishes from `main` regardless of what a reader is looking
// at. Every release makes it more wrong, and nothing in the repository knows.
//
// WHY THE REMEDY IS A BAN AND NOT A COMPARISON
//
// The obvious guard checks the number against the truth. There is no truth to
// check it against: the released version lives in a git tag, and the version in
// `package.json` is the UNRELEASED one being prepared - those two are different
// numbers for most of the life of `dev`, and a guard that equated them would
// have demanded `SECURITY.md` advertise a release that does not exist. A guard
// that could only run where tags are fetched would also be skipped in every
// shallow checkout, which is a guard that is green because it did not run.
//
// So the invariant is the absence, which needs no truth source and cannot go
// stale: these documents state the RULE and point at the Releases page for the
// number. A rule has no release at which it becomes false.
//
// WHY THE SCOPE IS NOT THE WHOLE TREE
//
// Naming a version is correct nearly everywhere else. `README.md` reports the
// released version on purpose, `docs/verifying-releases.md` shows real image
// tags a reader pastes, `docs/roadmap.md` is generated and already has
// `roadmap:check` behind it, and every workflow pins action and runtime
// versions. Banning the shape tree-wide would be a gate nobody could keep
// green, and the first exemption would reopen the hole.
//
// What separates the files below is not that they are documentation. It is that
// GitHub serves them from the default branch - so a stale copy is published to
// people who never looked at the repository - and that no step in
// `RELEASING.md` opens them. `RELEASING.md` already lists them together, under
// "Files that must stay identical on dev and main", for the first half of that
// reason.
//
// EVERY SCOPE ENTRY MUST MATCH SOMETHING. A guard whose scope silently stops
// matching is green forever, and a path pattern outlives the file it was
// written for. A moved or renamed document is reported here rather than
// discovered by the next reporter.
//
// Run with `pnpm run check:version-claims`; the tests are in
// `version-claims.test.mjs`.
//
// Exit codes:
//   0  nothing in scope names a version
//   1  something does, or a scope entry matched no tracked file

import path from 'node:path';
import process from 'node:process';

import { readBlobs, trackedFiles } from './git-blobs.mjs';

/**
 * A concrete openrunic version as a reader recognises one.
 *
 * Three segments, because two is a release LINE spoken about generically -
 * `0.x`, `a 0.2 install` - and banning that would ban the sentences these
 * documents are supposed to contain. `x` is accepted as the patch segment
 * because `0.1.x` is how the retired table named a line, and an optional `v`
 * because `v0.2.0` and `api-v0.2.0` are how tags spell the same claim.
 */
export const VERSION = /\bv?\d+\.\d+\.(?:\d+|x)\b/u;

/**
 * The documents GitHub serves from the default branch, and why each is here.
 *
 * `why` is printed with the finding. A path in a list with no reason beside it
 * is the next thing somebody deletes to make a gate go green.
 */
export const SCOPE = [
  {
    pattern: /^SECURITY\.md$/u,
    why: 'the Security tab serves it from the default branch, to vulnerability reporters',
  },
  {
    pattern: /^\.github\/ISSUE_TEMPLATE\/[^/]+$/u,
    why: 'issue forms are served from the default branch',
  },
  {
    pattern: /^\.github\/PULL_REQUEST_TEMPLATE\.md$/u,
    why: 'the pull-request template is served from the default branch',
  },
];

/** The scoped files, paired with the SCOPE entry that selected each one. */
export function inScope(files, scope = SCOPE) {
  const selected = [];
  for (const file of files) {
    const entry = scope.find((candidate) => candidate.pattern.test(file));
    if (entry !== undefined) selected.push({ file, why: entry.why });
  }
  return selected;
}

/**
 * Every version-shaped string in one file's text, with the line it sits on.
 *
 * Every match on the line rather than the first. The retired `SECURITY.md`
 * table put `0.2.0` and `0.1.x` on one row, and a first-match-only scan would
 * have named one of them and left the author to rediscover the other on the
 * next run. `advisory-ids.mjs` carries the same note for the same reason.
 */
export function findClaims(text, file, why) {
  const every = new RegExp(VERSION.source, 'gu');
  const found = [];
  for (const [index, line] of text.split('\n').entries()) {
    for (const match of line.matchAll(every)) {
      found.push({ file, why, line: index + 1, claim: match[0] });
    }
  }
  return found;
}

/**
 * The reasons this guard did not run, as distinct from finding nothing.
 *
 * A scope entry that matches no tracked file is the failure this separation
 * exists for: the document was renamed or moved, the entry went on looking
 * correct, and the guard reported clean over a file it never opened.
 */
export function scopeProblems(files, scope = SCOPE) {
  return scope
    .filter((entry) => !files.some((file) => entry.pattern.test(file)))
    .map((entry) => `scope entry ${String(entry.pattern)} matched no tracked file (${entry.why})`);
}

export function main(_argv, { root = process.cwd() } = {}) {
  // The pattern is the guard. If it stops recognising a version this reports
  // clean over anything, so it is exercised on a known claim and a known
  // non-claim before it is trusted on the tree - the tests pin the boundary in
  // detail, this refuses to run at all on a pattern that has lost it.
  if (!VERSION.test('0.1.x') || !VERSION.test('api-v0.2.0') || VERSION.test('0.x major')) {
    process.stderr.write('version-claims: VERSION no longer recognises a version claim\n');
    return 1;
  }

  const entries = trackedFiles(root);
  const files = entries.map((entry) => entry.file);

  const problems = scopeProblems(files);
  if (problems.length > 0) {
    process.stderr.write('version-claims: this guard did not run over what it claims to cover:\n');
    for (const problem of problems) process.stderr.write(`  ${problem}\n`);
    process.stderr.write('Repoint SCOPE at where the document lives now, or delete the entry.\n');
    return 1;
  }

  const scoped = inScope(files);
  const blobs = readBlobs(
    root,
    entries.filter((entry) => scoped.some((one) => one.file === entry.file))
  );

  const found = [];
  for (const { file, why } of scoped) {
    const sha = entries.find((entry) => entry.file === file).sha;
    const text = blobs.get(sha);
    if (text === null) continue;
    found.push(...findClaims(text, file, why));
  }

  if (found.length === 0) {
    process.stdout.write(
      `version-claims: ${String(scoped.length)} default-branch document(s) name no version.\n`
    );
    return 0;
  }

  process.stderr.write('version-claims: these name a concrete version:\n\n');
  for (const claim of found) {
    process.stderr.write(`  ${claim.file}:${String(claim.line)}  ${claim.claim}\n`);
    process.stderr.write(`    ${claim.why}\n\n`);
  }
  process.stderr.write(
    'Nothing bumps these files at release time, so the number is right for one release\n' +
      'and wrong for every one after it. State the rule and link the Releases page\n' +
      'instead of naming the version.\n'
  );
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  process.exit(main(process.argv.slice(2)));
}
