import { afterEach, describe, expect, it, vi } from 'vitest';

import { clinicNow, clinicToday, shiftDay } from '@/components/schedule/clock';
import { MOCK_CLINIC_DAY, MOCK_NOW } from '@/lib/api';

/**
 * The clinic's clock, in both modes.
 *
 * Every schedule surface pages from `clinicToday`, so a wrong answer puts the
 * whole front desk in front of somebody else's list. The mock branch is
 * exercised by every other test in this app; the live branch is what actually
 * runs in a clinic and was reached by nothing.
 *
 * Live mode is reached by replacing the config module rather than by setting an
 * environment variable, because `IS_MOCK_MODE` is resolved once at import.
 */

afterEach(() => {
  vi.resetModules();
  vi.doUnmock('@/lib/api');
});

/** Re-imports the clock with `IS_MOCK_MODE` forced off. */
async function liveClock(): Promise<typeof import('@/components/schedule/clock')> {
  /* Before the mock, not only in `afterEach`. Running one live case by name, or
     a shuffled order that puts one first, leaves the top-level import's
     mock-mode module cached and the dynamic import would return it. */
  vi.resetModules();
  vi.doMock('@/lib/api', async () => {
    const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
    return { ...actual, IS_MOCK_MODE: false };
  });
  return import('@/components/schedule/clock');
}

describe('in mock mode', () => {
  it('freezes now at the fixtures instant', () => {
    /*
     * Fixed rather than merely close: the day grid draws a current-time rule and
     * the flow board counts waits from it, so a screenshot taken twice would
     * differ and a threshold test would drift past itself by lunchtime.
     */
    expect(clinicNow().toISOString()).toBe(new Date(MOCK_NOW).toISOString());
    expect(clinicNow().toISOString()).toBe(clinicNow().toISOString());
  });

  it('answers the fixtures day rather than the machine calendar', () => {
    expect(clinicToday()).toBe(MOCK_CLINIC_DAY);
  });
});

describe('in live mode', () => {
  it('reads the wall clock', async () => {
    const clock = await liveClock();

    const before = Date.now();
    const now = clock.clinicNow().getTime();
    const after = Date.now();

    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(after);
    expect(now).not.toBe(new Date(MOCK_NOW).getTime());
  });

  it('asks for the day in the clinic timezone, not the machine one', async () => {
    /*
     * Shape alone is not enough: a wrong timezone still yields YYYY-MM-DD, and
     * agrees with the right one for most of the day. The argument is what
     * decides whose midnight the front desk pages from, so it is what is
     * asserted.
     */
    vi.resetModules();
    const calendarDay = vi.fn(() => '2026-09-03');
    vi.doMock('@/lib/api', async () => {
      const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
      return { ...actual, IS_MOCK_MODE: false };
    });
    vi.doMock('@/lib/format', async () => {
      const actual = await vi.importActual<typeof import('@/lib/format')>('@/lib/format');
      return { ...actual, calendarDay };
    });

    const clock = await import('@/components/schedule/clock');
    const { CLINIC_TIME_ZONE } =
      await vi.importActual<typeof import('@/lib/format')>('@/lib/format');

    expect(clock.clinicToday()).toBe('2026-09-03');
    expect(calendarDay).toHaveBeenCalledWith(expect.any(Date), CLINIC_TIME_ZONE);
    vi.doUnmock('@/lib/format');
  });

  it('answers a real calendar day rather than the fixtures one', async () => {
    const clock = await liveClock();

    expect(clock.clinicToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
    expect(clock.clinicToday()).not.toBe(MOCK_CLINIC_DAY);
  });

  it('refuses to answer rather than substituting a day it could not read', async () => {
    /*
     * `calendarDay` is nullable because it is given instants that may not parse.
     * The one here is `new Date()`, so the branch is unreachable in practice -
     * which is exactly why it is worth pinning that it throws. Every schedule
     * surface pages from this value, and a substituted day would put the whole
     * front desk in front of somebody else's list without anything looking
     * wrong.
     */
    /* Before the mocks. Run alone or shuffled first, this would otherwise get
       the mock-mode module the top-level import already cached, and
       `clinicToday` would return MOCK_CLINIC_DAY instead of throwing. */
    vi.resetModules();
    vi.doMock('@/lib/api', async () => {
      const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
      return { ...actual, IS_MOCK_MODE: false };
    });
    vi.doMock('@/lib/format', async () => {
      const actual = await vi.importActual<typeof import('@/lib/format')>('@/lib/format');
      return { ...actual, calendarDay: () => null };
    });

    const clock = await import('@/components/schedule/clock');

    expect(() => clock.clinicToday()).toThrow('The clinic clock could not be read.');
    vi.doUnmock('@/lib/format');
  });
});

describe('shiftDay', () => {
  it('moves whole days in both directions', () => {
    expect(shiftDay('2026-09-03', 1)).toBe('2026-09-04');
    expect(shiftDay('2026-09-03', -1)).toBe('2026-09-02');
    expect(shiftDay('2026-09-03', 0)).toBe('2026-09-03');
  });

  it('crosses a month and a year boundary', () => {
    expect(shiftDay('2026-08-31', 1)).toBe('2026-09-01');
    expect(shiftDay('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('crosses a leap day', () => {
    /*
     * 2028 is a leap year. Paging across 29 February is the case a hand-rolled
     * date arithmetic gets wrong, and the pager is how a clerk reaches any day
     * that is not today.
     */
    expect(shiftDay('2028-02-28', 1)).toBe('2028-02-29');
    expect(shiftDay('2028-03-01', -1)).toBe('2028-02-29');
  });
});
