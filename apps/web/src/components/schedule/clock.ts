import { IS_MOCK_MODE, MOCK_CLINIC_DAY, MOCK_NOW } from '@/lib/api';
import { CLINIC_TIME_ZONE, formatDate } from '@/lib/format';

/**
 * The clinic's clock.
 *
 * Two screens read "now": the day grid draws a current-time rule, and the flow
 * board counts how long people have been waiting. In mock mode both must be the
 * fixtures' fixed instant, or a screenshot taken twice would differ and a test
 * would drift past its own thresholds by lunchtime.
 */

/** The instant every front-desk surface treats as now. */
export function clinicNow(): Date {
  return IS_MOCK_MODE ? new Date(MOCK_NOW) : new Date();
}

/** Today, as `YYYY-MM-DD` in the clinic's timezone. */
export function clinicToday(): string {
  return IS_MOCK_MODE ? MOCK_CLINIC_DAY : formatDate(new Date(), 'iso', CLINIC_TIME_ZONE);
}

/** `YYYY-MM-DD` shifted by whole days, for the day pager. */
export function shiftDay(day: string, days: number): string {
  const shifted = new Date(`${day}T00:00:00.000Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

export interface DayBounds {
  /** Inclusive lower bound on `start`. */
  from: string;
  /** Exclusive upper bound, so one day is `[00:00, next 00:00)`. */
  to: string;
}

/** The half-open instant range the appointments list query wants for one day. */
export function dayBounds(day: string): DayBounds {
  return { from: `${day}T00:00:00.000Z`, to: `${shiftDay(day, 1)}T00:00:00.000Z` };
}
