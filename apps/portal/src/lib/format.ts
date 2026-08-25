import { formatCount, plural } from '@openrunic/i18n';
import type { Translator } from '@openrunic/i18n';

import type { Money } from './api/types';

/**
 * Display formatters.
 *
 * Every formatter pins its time zone, so a patient record read in two places
 * says the same thing and a test does not depend on the machine that runs it.
 *
 * It used to pin the locale too, at `en-GB`, and write its own English around
 * the numbers. So a reader who had chosen Spanish got Spanish navigation and an
 * English date on their own appointment, on the one surface where a reader
 * cannot be assumed to work through another language.
 *
 * The locale comes from the reader now, through the translator. The translator
 * is the first argument, matching `counted` and every formatter in the staff
 * application, which keeps these callable from a plain module rather than only
 * from inside a hook.
 *
 * ## Why the order is `Intl`'s here and not in `apps/web`
 *
 * `apps/web` composes day, named month and year itself and says why: a dense
 * date on a chart has to be unreadable-wrong rather than plausibly-wrong, so the
 * order is fixed and only the month name follows the reader.
 *
 * This application writes the long form for a patient, and `Intl` produces it
 * idiomatically in a way composition cannot: Spanish wants `3 de septiembre de
 * 2026`, and a `{day} {month} {year}` frame would render `3 septiembre 2026`.
 * The particles are the reason. English moves from `3 September 2026` to
 * `September 3, 2026` as a consequence, which is what the source locale means
 * and is unambiguous either way because the month is named.
 *
 * The two applications therefore write a date differently, and did before this:
 * `12 Aug 2026` on a chart column and `3 September 2026` on a patient's page is
 * a difference of register, chosen once for a clinician scanning and once for
 * somebody reading about themselves.
 */

/**
 * The clinic's display zone.
 *
 * Still pinned, and for the reason the old comment gave: an appointment must not
 * move by an hour because the reader opened it on holiday. This is the one thing
 * here that is deliberately not the reader's.
 */
const TIME_ZONE = 'UTC';

/**
 * Built formatters, kept for the life of the page.
 *
 * Constructing an `Intl` formatter is one of the more expensive things in the
 * standard library and a bill formats one per row. Keyed on the locale, and on
 * the currency where there is one, which is the whole of what varies now that
 * the options are fixed per shape.
 *
 * The `new Intl.*` calls live here rather than inside the formatters below, and
 * that is not only tidiness: a construction inside an exported formatter reads
 * as one-per-call to anything looking at the source, including
 * `react-doctor/js-hoist-intl`, which flagged exactly that before this was
 * pulled out. The memoisation was already there; it was not visible.
 */
type DateShape = 'date' | 'dateWithWeekday' | 'time';

const DATE_OPTIONS: Record<DateShape, Intl.DateTimeFormatOptions> = {
  date: { day: 'numeric', month: 'long', year: 'numeric' },
  dateWithWeekday: { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' },
  // 24-hour whatever the locale would choose, for the reason the staff
  // application gives: a clinic day crosses noon and am/pm doubles the reading.
  // The digits are still the reader's.
  time: { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' },
};

const DATE_FORMATTERS = new Map<string, Intl.DateTimeFormat>();
const MONEY_FORMATTERS = new Map<string, Intl.NumberFormat>();

function dateFormatter(shape: DateShape, locale: string): Intl.DateTimeFormat {
  const key = `${shape}|${locale}`;
  const found = DATE_FORMATTERS.get(key);
  if (found !== undefined) return found;

  const built = new Intl.DateTimeFormat(locale, { timeZone: TIME_ZONE, ...DATE_OPTIONS[shape] });
  DATE_FORMATTERS.set(key, built);
  return built;
}

function moneyFormatter(locale: string, currency: string): Intl.NumberFormat {
  const key = `${locale}|${currency}`;
  const found = MONEY_FORMATTERS.get(key);
  if (found !== undefined) return found;

  const built = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
  });
  MONEY_FORMATTERS.set(key, built);
  return built;
}

function parsed(iso: string): Date | null {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Any of the three date shapes, or the input unchanged when it is not a date. */
function formatted(shape: DateShape, t: Translator, iso: string): string {
  const date = parsed(iso);
  return date === null ? iso : dateFormatter(shape, t.locale).format(date);
}

/** 'September 3, 2026' in English, '3 de septiembre de 2026' in Spanish. Returns the input unchanged when it is not a date. */
export function formatDate(t: Translator, iso: string): string {
  return formatted('date', t, iso);
}

/** 'Thursday, September 3, 2026'. */
export function formatDateWithWeekday(t: Translator, iso: string): string {
  return formatted('dateWithWeekday', t, iso);
}

/**
 * '09:30'.
 *
 * 24-hour whatever the locale would choose, for the same reason the staff
 * application gives: a clinic day crosses noon and am/pm doubles the reading.
 * The digits are still the reader's.
 */
export function formatTime(t: Translator, iso: string): string {
  return formatted('time', t, iso);
}

/** 'Thursday, September 3, 2026 at 09:30'. */
export function formatDateTime(t: Translator, iso: string): string {
  const date = parsed(iso);
  if (date === null) return iso;
  // One message rather than a date, the word "at" and a time joined here. Where
  // the time sits relative to the date is a language decision, and "at" is not
  // the same word - or the same position - in every one.
  return t('portal.dateTime', {
    date: formatDateWithWeekday(t, iso),
    time: formatTime(t, iso),
  });
}

/** '20 minutes' / '1 hour' / '1 hour 30 minutes'. */
export function formatDuration(t: Translator, minutes: number): string {
  const unit = (count: number, one: string, other: string): string =>
    plural(
      {
        one: t(one, { count: formatCount(count, t.locale) }),
        other: t(other, { count: formatCount(count, t.locale) }),
      },
      count,
      t.locale
    );

  if (minutes < 60) {
    return unit(minutes, 'portal.duration.minute', 'portal.duration.minutes');
  }

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const hourPart = unit(hours, 'portal.duration.hour', 'portal.duration.hours');
  if (rest === 0) return hourPart;

  return t('portal.duration.hoursAndMinutes', {
    hours: hourPart,
    minutes: unit(rest, 'portal.duration.minute', 'portal.duration.minutes'),
  });
}

/**
 * '£84.50'. Always signed by meaning rather than by a minus: a negative amount is
 * money the practice owes the patient, and `formatMoney` never invents the word
 * "credit" - the `Money` component pairs the figure with that label so the sign
 * is never the only signal.
 *
 * The currency comes from `Intl` rather than from a three-entry table of
 * symbols. The table returned an empty string for anything it did not hold, so a
 * fourth currency rendered as a bare number on a page asking somebody to pay,
 * and it always put the symbol first, which is wrong in most of the languages
 * this is now translated into.
 */
export function formatMoney(t: Translator, money: Money): string {
  return moneyFormatter(t.locale, money.currency).format(Math.abs(money.amountMinor) / 100);
}

/** '£84.50 GBP', for a headline figure that has to name its currency outright. */
export function formatMoneyWithCode(t: Translator, money: Money): string {
  return `${formatMoney(t, money)} ${money.currency}`;
}

/** '75 micrograms' - a measured value never renders without its unit. */
export function formatMeasurement(t: Translator, value: number, unit: string): string {
  // The unit arrives from the record already named, so only the number is the
  // reader's. `formatCount` rather than `String`, because Arabic writes its
  // numerals differently and a reading with the right unit and the wrong digits
  // is still wrong.
  return `${formatCount(value, t.locale)} ${unit}`;
}

/** '2 of 3 answered'. */
export function formatProgress(t: Translator, done: number, total: number): string {
  return t('portal.progress', {
    done: formatCount(done, t.locale),
    total: formatCount(total, t.locale),
  });
}
