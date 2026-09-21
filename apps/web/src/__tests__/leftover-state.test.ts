import { describe, expect, it, vi } from 'vitest';

/**
 * Ordered pairs: the first case of each leaves global state behind, and the one
 * after it asserts the state was put back anyway.
 *
 * `vi.unstubAll*()` written on a case's own last line only runs when every
 * assertion above it passed, so one real failure leaves the stub standing and
 * every later test in the file runs against it - the same hole as the inline
 * page restore in openrunic#517. `unstubEnvs` and `unstubGlobals` in
 * `vitest.config.mts` restore from a hook no case can skip. Turn either off and
 * exactly the second case of that pair goes red.
 */
describe('state a case leaves behind', () => {
  const realFetch = globalThis.fetch;
  const realNodeEnv = process.env.NODE_ENV;

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
