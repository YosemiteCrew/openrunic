import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Every tracked `next-env.d.ts` must be the one `next build` writes, not the one
 * `next dev` writes.
 *
 * Next generates this file and the two commands disagree about it: `build` emits
 * `./.next/types/…` and `dev` emits `./.next/dev/types/…`. Both lines flip
 * together. The file is tracked and its own header says it should not be edited,
 * so the dev variant rides into a diff about something else — it reached `dev`
 * twice already, in `2abc8ce` (a font-face removal) and back out in `19ae465`
 * (an unrelated refactor), fifteen commits apart (#301).
 *
 * REPO-WIDE, and that is the whole of the change from the first version. That
 * one resolved `process.cwd()`, so it guarded `apps/web` and nothing else — and
 * `apps/portal` holds the identical tracked file. Running the portal's dev
 * server reproduced the flip on it within minutes of the first guard merging:
 * the instance was fixed and the class was left, which is this repository's
 * named failure mode.
 *
 * It lives under `apps/web` because that is where it started and there is no
 * repo-level suite to move it to. It is not about `apps/web`.
 *
 * Asserted positively as well as negatively: a case that only forbids the dev
 * spelling is equally green on a file that has lost the import altogether, which
 * is a different broken state with the same output.
 */

/** The workspace root, found by the file that only the root has. */
function repoRoot(): string {
  let dir = process.cwd();
  for (let up = 0; up < 8; up += 1) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    dir = dirname(dir);
  }
  throw new Error('next-env drift guard: no pnpm-workspace.yaml above the vitest root');
}

const ROOT = repoRoot();
const APPS = join(ROOT, 'apps');

/** Every Next app, by the config file each one must have. */
/* `withFileTypes`, because the alternative scans every entry in `apps/` and a
   stray FILE there throws `ENOTDIR` at module scope - which takes the whole
   guard with it and reports `no tests`. `.DS_Store` is gitignored so CI cannot
   meet it; a desk that has opened `apps/` in Finder can, and would get a
   baffling local failure rather than a drift report. */
const nextApps = readdirSync(APPS, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((app) => readdirSync(join(APPS, app)).some((f) => f.startsWith('next.config.')));

const guarded = nextApps.map((app) => [app, join(APPS, app, 'next-env.d.ts')] as const);

describe('every next-env.d.ts is the build variant', () => {
  /**
   * The canary, on an input the guard below does not derive.
   *
   * A discovery that stopped matching would leave the cases sweeping nothing and
   * reporting no drift, which is what a clean run looks like. Counted against
   * `next.config.*` rather than against the same glob: a Next app must have one,
   * so the two counts are independent statements about the same set and can
   * disagree. Zero is not the threshold — a MISMATCH is, because a new app whose
   * `next-env.d.ts` is missing is exactly the case this has to name.
   */
  it('finds one next-env.d.ts per Next app', () => {
    expect(nextApps.length).toBeGreaterThan(0);
    expect(guarded.filter(([, path]) => !existsSync(path)).map(([app]) => app)).toEqual([]);
  });

  /* Read through a helper that answers '' for a missing file: the canary above
     already names that case, and letting these throw `ENOENT` buries its message
     under stack traces from cases reading a file it just reported absent. */
  const read = (path: string): string => (existsSync(path) ? readFileSync(path, 'utf8') : '');

  it.each(guarded)('%s references the build type paths', (_app, path) => {
    const source = read(path);
    expect(source).toContain('import "./.next/types/routes.d.ts";');
    expect(source).toContain('import "./.next/types/root-params.d.ts";');
  });

  it.each(guarded)('%s references no dev-server type path', (_app, path) => {
    // The two lines flip together, so either spelling is the whole failure.
    expect(read(path)).not.toContain('.next/dev/types/');
  });
});
