import { expect } from 'vitest';

import { formatX12Error } from '../errors.js';
import type { X12Error } from '../errors.js';
import type { Result } from '@openrunic/types';

/**
 * Narrowing helpers for `Result`.
 *
 * Without these, every assertion in the suite is preceded by three lines of
 * `if (!result.ok) throw`, which buries what a test is actually about. The
 * failure message renders the error through the package's own formatter, so a
 * red test reads the same way a production log line would.
 */

/** Asserts success and returns the value, narrowed. */
export function expectOk<T>(result: Result<T, X12Error>): T {
  if (!result.ok) {
    expect.fail(`expected success, received ${formatX12Error(result.error)}`);
  }
  return result.value;
}

/** Asserts failure and returns the error, narrowed. */
export function expectErr<T>(result: Result<T, X12Error>): X12Error {
  if (result.ok) {
    expect.fail(`expected a failure, received a successful result`);
  }
  return result.error;
}
