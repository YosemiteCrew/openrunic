import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The tracked `next-env.d.ts` must be the one `next build` writes, not the one
 * `next dev` writes.
 *
 * Next generates this file and the two commands disagree about it: `build`
 * emits `./.next/types/…` and `dev` emits `./.next/dev/types/…`. Both lines
 * flip together. The file is tracked and its own header says it should not be
 * edited, so the dev variant rides into a diff about something else and is
 * waved through — it has reached `dev` twice already, in `2abc8ce` (a font-face
 * removal) and back out in `19ae465` (an unrelated refactor), fifteen commits
 * apart (#301).
 *
 * This does not decide whether the file should stay tracked. That is the
 * question #301 asks and it is open. Under the option the repository is
 * currently on, this makes the state that actually merged twice unmergeable;
 * under the other, the file stops being tracked and this case goes with it.
 *
 * Asserted positively rather than as an absence: a case that only forbids the
 * dev spelling passes just as happily on a file that has lost the import
 * altogether, which is a different broken state with the same green.
 */
/* Resolved from the vitest root rather than from `import.meta.url`: under this
   app's transform that is not a `file:` URL, and `readFileSync` rejects it with
   `The URL must be of scheme file` - which surfaces as `Tests no tests`, a
   count a crash cannot forge but also cannot explain. */
const NEXT_ENV = resolve(process.cwd(), 'next-env.d.ts');

describe('the tracked next-env.d.ts is the build variant', () => {
  /* Named before it is read, so a wrong root fails as "this file is not here"
     rather than as an assertion about content nobody loaded. */
  it('is where this case expects it', () => {
    expect(existsSync(NEXT_ENV)).toBe(true);
  });

  const source = existsSync(NEXT_ENV) ? readFileSync(NEXT_ENV, 'utf8') : '';

  it('references the build type paths', () => {
    expect(source).toContain('import "./.next/types/routes.d.ts";');
    expect(source).toContain('import "./.next/types/root-params.d.ts";');
  });

  it('references no dev-server type path', () => {
    // The two lines flip together, so either spelling is the whole failure.
    expect(source).not.toContain('.next/dev/types/');
  });
});
