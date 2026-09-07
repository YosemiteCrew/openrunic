import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * The database suites must gate on a FALSY `DATABASE_URL`, not on an absent one.
 *
 * `describe.skipIf(DATABASE_URL === undefined)` tests identity, so an empty
 * string is neither a skip nor a connection: the suites run and
 * `@openrunic/database` throws `DATABASE_URL is not set`. The job is still
 * caught - `_migration.yaml` requires a passing count rather than a clean exit -
 * but it is caught with an error saying the variable was not supplied while it
 * was supplied and empty, which sends the reader looking for the wrong thing
 * (#433).
 *
 * The two names are listed rather than globbed, and that is load-bearing: this
 * file contains the needles it searches for. A scan over `__tests__/*.test.ts`
 * would read itself and report on itself instead of on the suites (#433).
 *
 * Guarded here rather than by a case, because the difference between the two
 * spellings is invisible to every run that sets a real URL and to every run that
 * sets none: only the empty string separates them, and a suite cannot re-evaluate
 * its own module-scope `skipIf` to try it.
 */
const GATED = ['audit-chain.database.test.ts', 'repositories.database.test.ts'] as const;

describe('the database suites gate on a falsy DATABASE_URL', () => {
  it.each(GATED)('%s skips on an empty string as well as an absent one', (name) => {
    const source = readFileSync(new URL(name, import.meta.url), 'utf8');

    /* The canary. Without it a renamed helper or a reworded gate leaves the
       assertion below matching nothing and passing for it, which is the failure
       this whole file exists to describe one level up. */
    expect(source).toContain('describe.skipIf(');

    expect(source).toMatch(/describe\.skipIf\(!DATABASE_URL\)/);
  });

  /**
   * Why `GATED` is a list and not a glob, as an assertion rather than a claim.
   *
   * The two needles behave differently on this file and the difference decides
   * the failure mode. The canary's needle is a STRING literal, so it appears
   * here verbatim; the pattern's is a REGEX literal, whose source carries `\.`
   * and `\(` escapes and therefore does NOT contain what it matches. A glob
   * would satisfy the canary on this file and fail the pattern - loud rather
   * than silent, but still a guard reporting on itself.
   *
   * Both directions are pinned, because a later rewrite of either needle into
   * the other form changes which of those it is.
   */
  it('names its files rather than globbing, because its own needles are here', () => {
    const self = readFileSync(new URL(import.meta.url), 'utf8');

    expect(self).toContain('describe.skipIf(');
    expect(/describe\.skipIf\(!DATABASE_URL\)/.test(self)).toBe(false);
    expect([...GATED]).not.toContain('database-suite-gate.test.ts');
  });
});
