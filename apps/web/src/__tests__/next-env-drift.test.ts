import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * No Next app's `next-env.d.ts` is in the index, and each one is ignored.
 *
 * Next generates this file and the two commands disagree about it: `build` emits
 * `./.next/types/…` and `dev` emits `./.next/dev/types/…`. While it was tracked,
 * whichever command ran last rewrote it and the hunk rode into a diff about
 * something else - it reached `dev` in `2abc8ce` (a font-face removal) and back
 * out in `19ae465` (a refactor), fifteen commits apart, and its own header says
 * it should not be edited, which is what makes such a hunk easy to wave through
 * (#301).
 *
 * The previous form of this guard pinned the tracked copy to the build variant.
 * That held the ground while the question of whether to track it at all was
 * open; #301 answered it by measurement, so the invariant moved from *the
 * tracked copy is the right one* to *there is no tracked copy*. Measured at
 * `e896012` before the change: `tsc --noEmit` is clean without the file both
 * scoped to the app and repo-wide with no `.next` present, and `next build`
 * regenerates it byte-identically and leaves the tree clean.
 *
 * REPO-WIDE, which is the property the previous version had to be corrected to
 * acquire and the one worth keeping: `apps/portal` holds the identical file and
 * running its dev server reproduced the flip within minutes of the first,
 * app-scoped guard merging. It lives under `apps/web` because that is where it
 * started and there is no repo-level suite to move it to. It is not about
 * `apps/web`.
 *
 * Both halves are asserted because they fail differently. An untracked file that
 * is NOT ignored shows up as `??` in every `git status`, which is how it gets
 * `git add -A`-ed back into the index by somebody staging a change; an ignored
 * file that IS tracked is worse, because `.gitignore` has no effect on a path
 * already in the index and the guard would read as passing on the ignore rule
 * alone.
 */

/** The workspace root, found by the file that only the root has. */
function repoRoot(): string {
  let dir = process.cwd();
  for (let up = 0; up < 8; up += 1) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    dir = dirname(dir);
  }
  throw new Error('next-env guard: no pnpm-workspace.yaml above the vitest root');
}

const ROOT = repoRoot();
const APPS = join(ROOT, 'apps');

/** Every Next app, by the config file each one must have. */
/* `withFileTypes`, because the alternative scans every entry in `apps/` and a
   stray FILE there throws `ENOTDIR` at module scope - which takes the whole
   guard with it and reports `no tests`. `.DS_Store` is gitignored so CI cannot
   meet it; a desk that has opened `apps/` in Finder can, and would get a
   baffling local failure rather than a tracking report. */
const nextApps = readdirSync(APPS, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((app) => readdirSync(join(APPS, app)).some((f) => f.startsWith('next.config.')));

/** `apps/<app>/next-env.d.ts`, repo-relative and POSIX-spelled, as git reports paths. */
const guarded = nextApps.map(
  (app) =>
    [
      app,
      relative(ROOT, join(APPS, app, 'next-env.d.ts'))
        .split('\\')
        .join('/'),
    ] as const
);

/* argv form rather than a shell string, so a path never reaches a shell, and
   `cwd: ROOT` rather than an assembled `-C` argument for the same reason. */
function git(...args: readonly string[]): string {
  return execFileSync('git', [...args], { cwd: ROOT, encoding: 'utf8' }).trim();
}

describe('no next-env.d.ts is tracked', () => {
  /**
   * The canary, on an input the cases below do not derive.
   *
   * A discovery that stopped matching would leave the cases sweeping nothing and
   * reporting no tracked file, which is what a clean run looks like. Counted
   * against `next.config.*` rather than against the same list the cases use, so
   * the two are independent statements about the same set and can disagree.
   */
  it('finds the Next apps to check', () => {
    /* DO NOT DELETE AS REDUNDANT. `it.each` over an empty array generates no
       cases, so if discovery stops matching, the rows below do not fail - they
       cease to exist, and the suite reports `1 passed` at rc=0. Measured on the
       previous form of this file:

         discovery broken, this line present   1 failed (1)   <- the canary alone
         discovery broken, this line removed   1 passed (1)   <- nothing checked
         discovery intact, this line removed   4 passed (4)   <- inert, which is
                                                                 why it looks removable */
    expect(nextApps.length).toBeGreaterThan(0);
  });

  it.each(guarded)('%s has no next-env.d.ts in the index', (_app, path) => {
    // `ls-files <path>` prints the path when tracked and nothing when not, so an
    // empty answer is the passing one and a typo'd path fails open. That is why
    // the canary above counts the apps from `next.config.*` instead.
    expect(git('ls-files', '--', path)).toBe('');
  });

  it.each(guarded)('%s ignores next-env.d.ts', (_app, path) => {
    /* `check-ignore -q` exits 1 when the path is NOT ignored, which
       `execFileSync` raises, so the assertion is on the call not throwing.
       `--no-index` because `check-ignore` otherwise reports a TRACKED path as
       un-ignored whatever the rules say - which would make this case a second,
       weaker copy of the one above rather than the independent half it is. */
    expect(() => git('check-ignore', '-q', '--no-index', '--', path)).not.toThrow();
  });
});
