import { describe, expect, it, vi } from 'vitest';
import { hidePage } from '@/__tests__/visibility';

/**
 * Ordered pairs: the first case of each leaves global state behind, and the one
 * after it asserts the state was put back anyway.
 *
 * This is #517 as a guard. Both contract suites hid the page and showed it again
 * on the case's own last line, so an assertion failing in between leaves every
 * later test in the file running against a permanently hidden page. No test is
 * damaged by that today - `usePageHidden` reads `document.visibilityState` only
 * from inside its `visibilitychange` listener, so a leftover shadow is inert -
 * which is what this guard is for: it fails on the restore going missing, not
 * on a consumer happening to notice.
 *
 * The restores live in `vitest.setup.ts` and `vitest.config.mts` rather than in
 * each file, so no case can forget one and a new test file inherits them. Delete
 * either and exactly the second case of that pair goes red.
 */
describe('state a case leaves behind', () => {
  const realFetch = globalThis.fetch;
  const realNodeEnv = process.env.NODE_ENV;

  it('hides the page and never shows it again', () => {
    hidePage();
    expect(document.visibilityState).toBe('hidden');
  });

  it('still starts from a visible page', () => {
    expect(document.visibilityState).toBe('visible');
  });

  it('stubs a global and never unstubs it', () => {
    const stub = vi.fn();
    vi.stubGlobal('fetch', stub);
    expect(globalThis.fetch).toBe(stub);
  });

  it('still starts from the real fetch', () => {
    expect(globalThis.fetch).toBe(realFetch);
  });

  it('stubs an environment variable and never unstubs it', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(process.env.NODE_ENV).toBe('production');
  });

  it('still starts from the real NODE_ENV', () => {
    expect(process.env.NODE_ENV).toBe(realNodeEnv);
  });
});
