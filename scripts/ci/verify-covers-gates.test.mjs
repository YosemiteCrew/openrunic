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
// Run with `node --test scripts/ci/verify-covers-gates.test.mjs`, or
// `pnpm run check:ci-scripts:test`.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

  // Advisory, and slow enough to belong in its own workflow.
  doctor: 'react-doctor, advisory, has its own workflow',
  'doctor:json': 'the machine-readable form of doctor',

  // Needs browsers installed and a built application to drive.
  e2e: 'needs Playwright browsers and a running application',
  'e2e:install': 'installs those browsers',

  // Codegen with its own gate.
  'agent:conform': 'generates and checks the agent conformance surface in its own workflow',
};

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

  it('gives every exclusion a reason somebody wrote', () => {
    const empty = Object.entries(NOT_IN_VERIFY)
      .filter(([, reason]) => typeof reason !== 'string' || reason.trim().length < 10)
      .map(([name]) => name);
    assert.deepEqual(empty, [], `excluded with no usable reason: ${empty.join(', ')}`);
  });
});
