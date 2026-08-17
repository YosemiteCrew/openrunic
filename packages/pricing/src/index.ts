/**
 * What a practice charges, and what it will actually be paid.
 *
 * Two halves that meet at the same charge line. A fee schedule says what goes on
 * the claim and what the contract with that payer allows - the gap between them
 * is the contractual adjustment, and a practice that cannot see it before the
 * remittance arrives cannot tell an underpayment from a discount it agreed to. A
 * sliding scale says what a patient without insurance is asked to pay, which for
 * a community health centre is a condition of funding rather than a kindness.
 *
 * Pure and IO-free: it reads no clock, opens no socket and knows no database, so
 * every determination in it is reproducible from its inputs. That matters more
 * here than in most places, because a patient asking why they were charged what
 * they were charged is entitled to an answer.
 */

export { coversDate, itemFor, priceFor, scheduleOn } from './fee-schedule.js';
export type { Cents, ChargeLine, FeeSchedule, FeeScheduleItem, Price } from './fee-schedule.js';

export {
  applyScale,
  bandFor,
  isRefused,
  percentOfGuideline,
  validateScale,
} from './sliding-scale.js';
export type {
  Determination,
  DeterminationRefused,
  DiscountedCharge,
  HouseholdFinancials,
  SlidingScale,
  SlidingScaleBand,
} from './sliding-scale.js';
