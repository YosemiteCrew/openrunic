import { IS_MOCK_MODE, MOCK_CLINIC_DAY, MOCK_NOW } from '@/lib/api';
import { CLINIC_TIME_ZONE, calendarDay } from '@/lib/format';

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

/**
 * Today, as `YYYY-MM-DD` in the clinic's timezone.
 *
 * `calendarDay` is nullable because it is given instants that may not parse.
 * The one here is `new Date()`, which is the machine's own clock and always
 * reads, so the null branch cannot be taken. It throws rather than substituting
 * a day: every schedule surface pages from this value, and a wrong today puts
 * the whole front desk in front of somebody else's list.
 */
export function clinicToday(): string {
  if (IS_MOCK_MODE) return MOCK_CLINIC_DAY;
  const today = calendarDay(new Date(), CLINIC_TIME_ZONE);
  if (today === null) throw new Error('The clinic clock could not be read.');
  return today;
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
