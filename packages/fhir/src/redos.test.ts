import { describe, expect, it } from 'vitest';

import { base64ToHex } from './primitives.js';

/**
 * Linearity, held as a property.
 *
 * The padding strip used to be `value.replace(/=+$/, '')`: anchored at the end
 * but not the start, so the engine retried the run from every position and cost
 * grew with the square of the input. CodeQL named it, and the value arrives
 * inside a FHIR resource posted by another system.
 *
 * The threshold is loose enough to survive a loaded CI runner and tight enough
 * that a reintroduced backtracker cannot pass.
 */
const BUDGET_MS = 1_000;
const RUN = 200_000;

function elapsed(work: () => void): number {
  const started = performance.now();
  work();
  return performance.now() - started;
}

describe('base64ToHex stays linear on pathological padding', () => {
  it('handles a long run of padding characters', () => {
    const value = '='.repeat(RUN);

    expect(elapsed(() => base64ToHex(value))).toBeLessThan(BUDGET_MS);
  });

  it('handles padding that follows real content', () => {
    const value = `AAAA${'='.repeat(RUN)}`;

    expect(elapsed(() => base64ToHex(value))).toBeLessThan(BUDGET_MS);
  });

  it('still round-trips a real digest to lowercase hex', () => {
    // Correctness, not merely speed: the padding strip is load-bearing for the
    // decode that follows it.
    expect(base64ToHex('3q2+7w==')).toBe('deadbeef');
  });

  it('leaves an unpadded value alone', () => {
    expect(base64ToHex('3q2+7w')).toBe('deadbeef');
  });

  it('returns undefined for absent or empty input', () => {
    expect(base64ToHex(undefined)).toBeUndefined();
    expect(base64ToHex('')).toBeUndefined();
  });
});
