#!/usr/bin/env node
// Every root script is either in `pnpm verify` or excluded on purpose.
//
// `_repo.yaml`'s own header says every command it runs "has a matching root
// package.json script so a contributor can run the identical check locally".
// It ran seven and `verify` chained two, so a green local `verify` was not the
// local half of CI - and the only way to discover that was to fail a check
// after pushing. `roadmap:check` cost exactly that on #286: `docs/roadmap.md`
// is generated from the message catalogues, splitting two keys into four made
// the committed page stale, and nothing local said so.
//
// ## Why this asserts over the scripts rather than over the workflows
//
// The obvious test scans `.github/workflows` for what CI runs and demands
// `verify` cover it. That scan cannot be written honestly. Matching a script by
// its leading binary makes `node` and `git` match every workflow in the
// repository - the first draft of this reported `ops:restore` and `dev` as CI
// gates - and excluding the generic leads then loses `lint:shell` and
// `lint:docker`, whose commands are `git ls-files | xargs shellcheck` and only
// name their real tool at the far end of a pipe. Every version of that scan is
// a guess about what "CI runs this" means, dressed as a measurement. #132
// recorded the same hazard about sweeping source with a loose pattern.
//
// Inverting it needs no pattern at all. Every script is on exactly one of two
// lists, and a new one is on neither until somebody puts it somewhere. That
// also catches the direction a workflow scan cannot see: a check added to CI
// whose script nobody wired into `verify` is red here by existing, before it is
// ever red on a pull request.
//
// The reasons below are the point of the table. An exclusion with no reason is
// how a gate leaves `verify` quietly; one that has to be written down is a
// decision somebody can disagree with in review.
//
// ## But a reason that never has to stay true is the same silence with prose
//
// Most of those reasons are judgements - `restores over a running deployment`
// is a claim only a human can settle, and prose is the right medium for it.
// Two are not. `globbed by check:ci-scripts:test` is a fact about the
// filesystem, and it stops being true the moment somebody moves a file: repoint
// `check:phi:test` at `scripts/phi/` and 37 assertions stop running in `verify`
// and in CI - `check:ci-scripts:test` goes from 127 to 90 - while the exclusion
// still reads as coverage. `_repo.yaml` runs the glob and not the individual
// script, so nothing picks them up.
//
// So the factual exclusions are checked as facts, keyed on the shape of the
// command rather than on the sentence beside it. A reworded reason cannot
// switch it off, and a third `node --test` script excluded tomorrow is covered
// without anyone remembering to add it to a list. An exemption is the cheapest
// place to put an unchecked claim, because the claim is the reason you are
// allowed to skip the check.
//
// Run with `node --test scripts/ci/verify-covers-gates.test.mjs`, or
// `pnpm run check:ci-scripts:test`.

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const root = new URL('../../', import.meta.url);
const manifest = JSON.parse(readFileSync(fileURLToPath(new URL('package.json', root)), 'utf8'));
const scripts = manifest.scripts ?? {};

/**
 * Why a root script is not in `verify`.
 *
 * Anything not here has to be in the chain. Adding a script means choosing a
 * side, which is the whole mechanism - the failure this replaces was nobody
 * being asked.
 */
const NOT_IN_VERIFY = {
  // Not checks.
  prepare: 'a lifecycle hook, not a check',
  dev: 'starts the dev servers',
  format: 'the writing half of format:check, which is in the chain',
  'lint:css:fix': 'the writing half of lint:css, which is in the chain',
  verify: 'the chain itself',
  roadmap: 'the writing half of roadmap:check, which is in the chain',
  capabilities: 'the writing half of check:capabilities, which is in the chain',

  // External binaries that are not pnpm dependencies. Left out deliberately: a
  // `verify` that skipped them when the binary is absent would report clean
  // because it could not run, which is the failure every gate here exists to
  // prevent. Run them by hand when touching a workflow, a shell script or a
  // Dockerfile; CI installs each one pinned and checksum-verified.
  'lint:workflows': 'needs actionlint, which is not a pnpm dependency',
  'lint:shell': 'needs shellcheck, which is not a pnpm dependency',
  'lint:docker': 'needs hadolint, which is not a pnpm dependency',

  // Already covered by something the chain runs.
  'check:secrets:tracked':
    'the CI-ignore-file variant of check:secrets, which the chain runs over the working tree',
  'check:phi:test': 'globbed by check:ci-scripts:test',
  'check:compose:test': 'globbed by check:ci-scripts:test',

  // Operate on a deployment rather than on the tree, and several are
  // destructive. A contributor must never reach these by running `verify`.
  'setup:selfhost': 'provisions a self-hosted install',
  'ops:doctor': 'inspects a running deployment',
  'ops:backup': 'writes a backup of a running deployment',
  'ops:verify-backup': 'restores a backup to check it, against a live database',
  'ops:restore': 'restores over a running deployment',
  'ops:upgrade': 'upgrades a running deployment',
  'ops:lint-migrations': 'reads a deployment’s migration history',

  // Needs the network, because the question it asks cannot be answered without
  // one: a fabricated advisory id passes every pattern a local check could
  // apply, so the guard resolves each id against the registry that issued it.
  // Putting that in `verify` would make the chain fail on a train. The half
  // that CAN run offline is not excluded - the walk, the patterns and both
  // exemptions are asserted against the real tree in advisory-ids.test.mjs,
  // which check:ci-scripts:test globs.
  'check:advisories': 'resolves advisory ids against three registries; has its own workflow',

  // Advisory, and slow enough to belong in its own workflow.
  doctor: 'react-doctor, advisory, has its own workflow',
  'doctor:json': 'the machine-readable form of doctor',

  // Needs browsers installed and a built application to drive.
  e2e: 'needs Playwright browsers and a running application',
  'e2e:install': 'installs those browsers',

  // Codegen with its own gate.
  'agent:conform': 'generates and checks the agent conformance surface in its own workflow',
};

/**
 * The test files a `node --test <paths and globs>` script actually runs.
 *
 * Keyed on the shape of the command rather than on the prose beside it. Two of
 * the exclusions below - `check:phi:test` and `check:compose:test` - are the
 * only entries in that table asserting a fact about the filesystem rather than
 * a judgement, and `globbed by check:ci-scripts:test` is a claim that stops
 * being true the moment somebody moves a file. A reworded reason must not be
 * able to switch the check off, and a third `node --test` script excluded
 * tomorrow is covered without anyone remembering to add it anywhere.
 */
function testFilesRunBy(script) {
  /* Drops the interpreter, then every flag by shape rather than by counting
     them: `node --test x` and `node --experimental-strip-types --test x` name
     the same file, and a fixed `slice(2)` reads the second one as one flag
     short. */
  const args = script
    .split(/\s+/u)
    .slice(1)
    .filter((arg) => !arg.startsWith('-'));
  const files = new Set();
  for (const arg of args) {
    if (!arg.includes('*')) {
      files.add(arg);
      continue;
    }
    const directory = path.posix.dirname(arg);
    const suffix = path.posix.basename(arg).replace(/^\*/u, '');
    for (const entry of readdirSync(fileURLToPath(new URL(directory, root)))) {
      if (entry.endsWith(suffix)) files.add(path.posix.join(directory, entry));
    }
  }
  return files;
}

/* `--test` anywhere in the node invocation, not only immediately after it:
   anchoring on the prefix made `check:ci-scripts:test` invisible to this file
   the moment it gained a flag, and the canary below caught exactly that. */
const isNodeTest = (name) => /^node( --[a-z-]+)* --test /u.test(scripts[name] ?? '');

/** The scripts `verify` runs, in the order it runs them. */
const chained = [...(scripts.verify ?? '').matchAll(/pnpm run ([a-z0-9:._-]+)/gu)].map(
  (match) => match[1]
);

describe('pnpm verify', () => {
  it('is a chain this test can actually read', () => {
    // The guard on the guard. Every assertion below is about the difference
    // between two sets, and an empty `chained` makes the first one vacuous
    // while the second reports every script in the repository - so a change to
    // how `verify` is spelled must fail here rather than change the meaning of
    // the rest of the file.
    assert.ok(chained.length >= 5, `read ${chained.length} steps out of the verify chain`);
    assert.ok(Object.keys(scripts).length >= 20, 'read too few root scripts to be reading them');
    assert.ok(chained.includes('test'), 'the verify chain does not appear to run the tests');
  });

  it('runs every step it names', () => {
    const missing = chained.filter((name) => scripts[name] === undefined);
    assert.deepEqual(missing, [], `verify names scripts that do not exist: ${missing.join(', ')}`);
  });

  it('covers every root script that is not excluded with a reason', () => {
    const uncovered = Object.keys(scripts).filter(
      (name) => !chained.includes(name) && NOT_IN_VERIFY[name] === undefined
    );
    assert.deepEqual(
      uncovered,
      [],
      `these root scripts are in neither the verify chain nor NOT_IN_VERIFY: ${uncovered.join(', ')}. ` +
        'Add it to the chain, or add it to NOT_IN_VERIFY with the reason it does not belong there.'
    );
  });

  it('excludes nothing it also runs, and nothing that has been deleted', () => {
    const both = chained.filter((name) => NOT_IN_VERIFY[name] !== undefined);
    assert.deepEqual(both, [], `excluded and chained at once: ${both.join(', ')}`);

    const gone = Object.keys(NOT_IN_VERIFY).filter((name) => scripts[name] === undefined);
    assert.deepEqual(
      gone,
      [],
      `NOT_IN_VERIFY names scripts that no longer exist: ${gone.join(', ')}. ` +
        'A stale exclusion is an exemption nobody asked for, waiting for the name to come back.'
    );
  });

  it('still runs the test files it excludes as already covered', () => {
    // The reason is prose and this is the fact under it. `check:phi:test` and
    // `check:compose:test` are out of the chain because `check:ci-scripts:test`
    // globs the same files - move `phi-guard.test.mjs` one directory and
    // repoint its own script, an ordinary tidy-up, and 37 assertions stop
    // running in `verify` and in CI while the exclusion still says they are
    // covered. Measured: `check:ci-scripts:test` goes from 127 to 90.
    const covered = new Set(
      chained.filter(isNodeTest).flatMap((name) => [...testFilesRunBy(scripts[name])])
    );
    /*
     * The canary, and it is here for the naming rather than for the silence.
     * With nothing read, the loop below fails anyway - saying every excluded
     * gate runs nowhere, which sends the next reader to move files around
     * instead of to the chain that stopped being readable.
     *
     * It asks whether the chain is READABLE and deliberately not whether it is
     * BIG. A threshold here answers the wrong question: narrowing
     * `check:ci-scripts:test` from its glob to one file leaves two files
     * covered and is a real defect, but it is the coverage loop's defect, and a
     * `>= 5` canary reports it as `read 2 test files out of the verify chain` -
     * the symptom of a different cause, one line before the assertion that
     * would have named the uncovered file.
     */
    assert.ok(
      chained.some(isNodeTest),
      'no step in the verify chain runs node --test: this assertion is reading nothing'
    );
    assert.ok(covered.size > 0, 'the verify chain runs node --test over no files at all');

    const excludedTestScripts = Object.keys(NOT_IN_VERIFY).filter(isNodeTest);
    assert.ok(
      excludedTestScripts.length > 0,
      'no excluded script runs node --test: this assertion is reading nothing'
    );

    for (const name of excludedTestScripts) {
      const missing = [...testFilesRunBy(scripts[name])].filter((file) => !covered.has(file));
      assert.deepEqual(
        missing,
        [],
        `${name} is excluded from verify as already covered, but ${missing.join(', ')} is run by ` +
          'nothing in the chain. The exclusion is false and the gate now runs nowhere.'
      );
    }
  });

  it('gives every exclusion a reason somebody wrote', () => {
    const empty = Object.entries(NOT_IN_VERIFY)
      .filter(([, reason]) => typeof reason !== 'string' || reason.trim().length < 10)
      .map(([name]) => name);
    assert.deepEqual(empty, [], `excluded with no usable reason: ${empty.join(', ')}`);
  });
});
