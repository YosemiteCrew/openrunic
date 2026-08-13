/**
 * Display formatters.
 *
 * Every formatter pins its locale and its time zone. A patient record read in two places
 * has to say the same thing, and a test must not depend on the machine that runs it.
 */

import type { Money } from './api/types';

const LOCALE = 'en-GB';
const TIME_ZONE = 'UTC';

/** Symbols for the currencies the portal issues statements in. */
const CURRENCY_SYMBOL: Record<string, string> = {
  GBP: '£',
  EUR: '€',
  USD: '$',
};

const DATE = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TIME_ZONE,
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

const DATE_WITH_WEEKDAY = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TIME_ZONE,
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

const TIME = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** '3 September 2026'. Returns the input unchanged when it is not a date. */
export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return DATE.format(date);
}

/** 'Thursday 3 September 2026'. */
export function formatDateWithWeekday(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return DATE_WITH_WEEKDAY.format(date);
}

/** '09:30'. */
export function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return TIME.format(date);
}

/** 'Thursday 3 September 2026 at 09:30'. */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${DATE_WITH_WEEKDAY.format(date)} at ${TIME.format(date)}`;
}

/** '20 minutes' / '1 hour' / '1 hour 30 minutes'. */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} minutes`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const hourPart = hours === 1 ? '1 hour' : `${hours} hours`;
  if (rest === 0) return hourPart;
  return `${hourPart} ${rest} minutes`;
}

/**
 * '£84.50'. Always signed by meaning rather than by a minus: a negative amount is money
 * the practice owes the patient, and `formatMoney` never invents the word "credit" - the
 * `Money` component pairs the figure with that label so the sign is never the only signal.
 */
export function formatMoney(money: Money): string {
  const symbol = CURRENCY_SYMBOL[money.currency] ?? '';
  const major = Math.abs(money.amountMinor) / 100;
  return `${symbol}${major.toFixed(2)}`;
}

/** '£84.50 GBP', for a headline figure that has to name its currency outright. */
export function formatMoneyWithCode(money: Money): string {
  return `${formatMoney(money)} ${money.currency}`;
}

/** '1 unread message' / '3 unread messages' / '0 unread messages'. */
export function pluralise(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** '75 micrograms' - a measured value never renders without its unit. */
export function formatMeasurement(value: number, unit: string): string {
  return `${value} ${unit}`;
}

/** '2 of 3 answered'. */
export function formatProgress(done: number, total: number): string {
  return `${done} of ${total} answered`;
}
