#!/usr/bin/env node
// The `prepare` script. Runs husky, and puts `core.hooksPath` back if husky
// took it off something else.
//
// WHY THIS EXISTS
//
// `husky` unconditionally runs `git config core.hooksPath <dir>/_` (husky
// 9.1.7, index.js line 14). No `--global`, so that is REPOSITORY config - one
// `pnpm install` in one worktree redirects the hooks for every worktree of the
// clone at once.
//
// That is fine for a machine whose only hooks are husky's. It is not fine for a
// machine that installs an additional guard by pointing `core.hooksPath` at a
// directory OUTSIDE the working tree - which is how a check that must not be
// editable from inside a pull request has to be installed. Any routine install
// silently disarms it.
//
// AND THE DISARM IS SILENT BY CONSTRUCTION, which is why it went unnoticed. The
// external wrapper chains FORWARD: it runs its own check and then calls
// `.husky/_/<hook>`, so while it is active both sets of hooks run. `.husky/*`
// chains nowhere. So after the flip, lint-staged, commitlint, prettier and
// secretlint all still run and all still pass, and the only thing that stopped
// happening is a check that prints nothing when it succeeds.
//
// WHAT THIS DOES NOT DO: guess where the external hooks live. Deriving
// `~/.githooks/<repo>` from a repository name would bake a machine-local
// convention into a tracked file, and a wrong guess restores nothing while
// reporting success - the same silent-failure shape as the bug. So this reads
// the value that was there BEFORE husky ran and puts that back. No convention,
// nothing to keep in sync, and a no-op for anyone who never had it: a fresh
// clone and CI both read an empty value and get plain husky.

import { spawnSync } from 'node:child_process';
import process from 'node:process';

/** `git config core.hooksPath`, or '' when unset. Never throws. */
export function readHooksPath(run = git) {
  const { status, stdout } = run(['config', 'core.hooksPath']);
  return status === 0 ? stdout.trim() : '';
}

/**
 * Whether `before` is a setting husky replaced and we should restore.
 *
 * Empty means nothing was configured, so there is nothing to put back. Equal
 * means husky landed on the same place it already was. Anything else is a
 * setting that existed before this install and that husky has just taken over.
 */
export function shouldRestore(before, after) {
  return before !== '' && before !== after;
}

function git(args) {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  return { status: result.status ?? 1, stdout: result.stdout ?? '' };
}

function main() {
  const before = readHooksPath();

  const husky = spawnSync('husky', [], { stdio: 'inherit', shell: true });
  if (husky.status !== 0) return husky.status ?? 1;

  const after = readHooksPath();
  if (!shouldRestore(before, after)) return 0;

  const { status } = git(['config', 'core.hooksPath', before]);
  if (status !== 0) {
    // Loud rather than silent. A failure here leaves the machine with the guard
    // disarmed, which is the state this script exists to prevent, so it must
    // not be reported as a successful install.
    process.stderr.write(
      `prepare: husky moved core.hooksPath to '${after}' and it could not be put ` +
        `back to '${before}'. Restore it by hand before committing.\n`
    );
    return 1;
  }
  process.stderr.write(`prepare: core.hooksPath kept at '${before}' (husky wanted '${after}').\n`);
  return 0;
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  process.exit(main());
}
