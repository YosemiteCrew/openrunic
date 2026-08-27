import { afterEach, describe, expect, it, vi } from 'vitest';

import { clinicNow } from '@/lib/api/chart/clock';
import { MOCK_NOW } from '@/lib/api';

/**
 * "Now", as the chart reads it.
 *
 * Screens call this instead of `new Date()` so an age, a wait timer and a next
 * appointment render identically on every machine. The mock branch is what
 * every other test in this app runs on; the live branch is what runs in a
 * clinic and was reached by nothing.
 */

afterEach(() => {
  vi.resetModules();
  vi.doUnmock('@/lib/api/config');
});

describe('clinicNow', () => {
  it('freezes at the fixtures instant in mock mode', () => {
    expect(clinicNow()).toBe(MOCK_NOW);
    expect(clinicNow()).toBe(clinicNow());
  });

  it('reads the wall clock in live mode, as an ISO instant', async () => {
    vi.doMock('@/lib/api/config', async () => {
      const actual = await vi.importActual<typeof import('@/lib/api/config')>('@/lib/api/config');
      return { ...actual, IS_MOCK_MODE: false };
    });

    const clock = await import('@/lib/api/chart/clock');

    const before = Date.now();
    const now = clock.clinicNow();
    const after = Date.now();

    expect(now).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/u);
    expect(Date.parse(now)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(now)).toBeLessThanOrEqual(after);
    expect(now).not.toBe(MOCK_NOW);
  });
});
