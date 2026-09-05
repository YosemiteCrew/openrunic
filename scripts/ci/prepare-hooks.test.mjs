import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { shouldRestore } from './prepare-hooks.mjs';

const SCRIPT = path.join(import.meta.dirname, 'prepare-hooks.mjs');

// ---------------------------------------------------------------------------
// The decision, on its own
// ---------------------------------------------------------------------------

test('restores only a setting that existed before husky and that husky changed', () => {
  // The two `false` rows are what keeps this a no-op for everyone who never had
  // an external hooks directory - a fresh clone and CI both read '' - and for a
  // machine where husky landed where it already was.
  assert.equal(shouldRestore('/outside/hooks', '.husky/_'), true);
  assert.equal(
    shouldRestore('', '.husky/_'),
    false,
    'nothing was configured, so nothing to put back'
  );
  assert.equal(shouldRestore('.husky/_', '.husky/_'), false, 'husky did not move it');
});

// ---------------------------------------------------------------------------
// The whole thing, against real git
// ---------------------------------------------------------------------------

/**
 * A repository with a stubbed `husky` on PATH.
 *
 * The stub does the ONE thing husky 9.1.7 does at index.js:14 - `git config
 * core.hooksPath <dir>/_`, no `--global`, so repository config. Stubbed rather
 * than installed because the assertion is about what this script does AFTER
 * husky, and depending on the real binary would make these cases fail for
 * reasons that have nothing to do with the subject.
 */
function repoWithStubHusky({ before, huskyExit = 0 }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'prepare-hooks-'));
  spawnSync('git', ['init', '-q'], { cwd: dir });
  if (before !== undefined) {
    spawnSync('git', ['config', 'core.hooksPath', before], { cwd: dir });
  }
  const bin = path.join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(
    path.join(bin, 'husky'),
    `#!/bin/sh\ngit config core.hooksPath .husky/_\nexit ${huskyExit}\n`
  );
  chmodSync(path.join(bin, 'husky'), 0o755);
  return { dir, bin };
}

const run = ({ dir, bin }) =>
  spawnSync(process.execPath, [SCRIPT], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env['PATH'] ?? ''}` },
  });

const hooksPath = (dir) =>
  spawnSync('git', ['config', 'core.hooksPath'], { cwd: dir, encoding: 'utf8' }).stdout.trim();

test('an external hooks directory survives the install husky would have taken it off', () => {
  const repo = repoWithStubHusky({ before: '/outside/the/tree' });

  // The control is inside the case rather than beside it: the stub is asserted
  // to have actually moved the value, so a green here cannot mean husky no
  // longer does the thing this script exists to undo.
  const result = run(repo);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /husky wanted '\.husky\/_'/u, 'the stub did not move the value');
  assert.equal(hooksPath(repo.dir), '/outside/the/tree');
});

test('a machine that never had one is left exactly as husky set it', () => {
  // The case an outside contributor and CI are in. Restoring anything here
  // would be this script inventing a setting nobody asked for.
  const repo = repoWithStubHusky({});
  const result = run(repo);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(hooksPath(repo.dir), '.husky/_');
  assert.doesNotMatch(result.stderr, /kept at/u);
});

test('a failing husky is a failing prepare, and the value is not touched', () => {
  // `prepare` must not report success when the install step under it failed -
  // and it must not restore either, because the state after a failed husky is
  // not a state this script has any claim about.
  const repo = repoWithStubHusky({ before: '/outside/the/tree', huskyExit: 3 });
  const result = run(repo);

  assert.equal(result.status, 3);
  assert.doesNotMatch(result.stderr, /kept at/u);
});
