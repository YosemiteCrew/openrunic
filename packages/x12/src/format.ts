import { err, ok } from '@openrunic/types';
import type { Result } from '@openrunic/types';

import type { X12Error, X12Location } from './errors.js';

/**
 * Wire formatting for the three data types that actually cause claim
 * rejections: money, dates and counts.
 *
 * Money is held everywhere else in this system as integer cents, because
 * floating-point dollars in a ledger is a defect waiting for an audit. X12
 * wants decimal dollars. That conversion happens here, once, in both
 * directions, so no mapper is ever tempted to do it inline with a `/ 100`.
 *
 * Dates are formatted in UTC on purpose. A service date is a calendar date,
 * not an instant, and formatting it in the server's local zone is how a claim
 * for a Monday appointment reaches the payer dated Sunday.
 */

/**
 * Renders integer cents as an X12 monetary amount.
 *
 * Trailing zeros after the decimal point are dropped and a whole-dollar amount
 * loses its point entirely, which is the conventional shape and keeps golden
 * files stable. Negative amounts keep their sign: 835 reversals and PLB
 * adjustments are genuinely negative, and stripping the sign there would
 * reverse the direction of money.
 */
export function formatAmount(cents: number): string {
  const negative = cents < 0;
  const absolute = Math.abs(cents);
  const dollars = Math.trunc(absolute / 100);
  const remainder = absolute % 100;
  const body =
    remainder === 0
      ? String(dollars)
      : remainder % 10 === 0
        ? `${dollars}.${String(remainder / 10)}`
        : `${dollars}.${String(remainder).padStart(2, '0')}`;
  return negative ? `-${body}` : body;
}

/**
 * Reads an X12 monetary amount back into integer cents.
 *
 * Rounds half away from zero rather than truncating, because a payer that
 * writes `12.005` means half a cent and truncation would quietly lose money on
 * every such line. Anything that is not a number is an error, never a zero:
 * a silently-zeroed payment is worse than a failed parse.
 */
export function parseAmount(
  value: string,
  at: X12Location,
  expected = 'a monetary amount'
): Result<number, X12Error> {
  if (value === '' || !/^-?\d+(\.\d+)?$/.test(value)) {
    return err({ kind: 'invalid_element', message: `expected ${expected}`, at, value, expected });
  }
  const numeric = Number(value) * 100;
  const rounded = numeric < 0 ? -Math.round(-numeric) : Math.round(numeric);
  return ok(rounded);
}

/**
 * Reads a plain X12 numeric element, e.g. a unit count, an adjustment quantity
 * or a benefit percentage.
 *
 * Accepts the leading-decimal form, `.2`, which `parseAmount` deliberately does
 * not. Payers really do quote a twenty percent coinsurance that way in an EB08,
 * and rejecting it would fail an eligibility check over punctuation. Money is
 * held to the stricter rule, because a monetary element that lost its leading
 * digit is far more likely to be truncation than a house style.
 */
export function parseNumber(
  value: string,
  at: X12Location,
  expected = 'a number'
): Result<number, X12Error> {
  if (value === '' || !/^-?(\d+(\.\d+)?|\.\d+)$/.test(value)) {
    return err({ kind: 'invalid_element', message: `expected ${expected}`, at, value, expected });
  }
  return ok(Number(value));
}

/** CCYYMMDD, the D8 date format used everywhere except ISA09. */
export function formatDate8(value: Date): string {
  return (
    String(value.getUTCFullYear()).padStart(4, '0') +
    String(value.getUTCMonth() + 1).padStart(2, '0') +
    String(value.getUTCDate()).padStart(2, '0')
  );
}

/** YYMMDD, which only ISA09 still uses. */
export function formatDate6(value: Date): string {
  return formatDate8(value).slice(2);
}

/** HHMM, used by ISA10 and GS05. */
export function formatTime4(value: Date): string {
  return (
    String(value.getUTCHours()).padStart(2, '0') + String(value.getUTCMinutes()).padStart(2, '0')
  );
}

/**
 * Reads a CCYYMMDD element into an ISO calendar date string.
 *
 * Returns `YYYY-MM-DD` rather than a `Date` deliberately: the consumers are
 * Postgres `date` columns, and handing them a `Date` reintroduces the timezone
 * question this function exists to close.
 */
export function parseDate8(value: string, at: X12Location): Result<string, X12Error> {
  if (!/^\d{8}$/.test(value)) {
    return err({
      kind: 'invalid_element',
      message: 'expected a CCYYMMDD date',
      at,
      value,
      expected: 'CCYYMMDD',
    });
  }
  const year = value.slice(0, 4);
  const month = value.slice(4, 6);
  const day = value.slice(6, 8);
  const monthNumber = Number(month);
  const dayNumber = Number(day);
  if (monthNumber < 1 || monthNumber > 12 || dayNumber < 1 || dayNumber > 31) {
    return err({
      kind: 'invalid_element',
      message: 'the date is not a real calendar date',
      at,
      value,
      expected: 'CCYYMMDD',
    });
  }
  return ok(`${year}-${month}-${day}`);
}

/**
 * Pads or truncates to X12's fixed-width ISA fields.
 *
 * Truncation is silent by design here and checked by the caller instead: ISA06
 * is fifteen characters and a sender id longer than that is a configuration
 * error the encoder reports as a precondition, not something to discover from
 * a mangled envelope.
 */
export function padRight(value: string, width: number): string {
  return value.length >= width ? value.slice(0, width) : value.padEnd(width, ' ');
}
