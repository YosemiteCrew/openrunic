declare const brand: unique symbol;

/**
 * Nominal typing helper. `Brand<string, 'UUID'>` is assignable to `string`,
 * but a plain `string` is not assignable to it without passing a guard.
 * The brand exists only at the type level — there is no runtime cost.
 */
export type Brand<T, TBrand extends string> = T & { readonly [brand]: TBrand };

/** An RFC 4122 UUID (versions 1–8), e.g. a Prisma `@default(uuid())` id. */
export type UUID = Brand<string, 'UUID'>;

/** An ISO 8601 date-time string with an explicit UTC offset, e.g. `2026-01-01T12:00:00Z`. */
export type ISODateTime = Brand<string, 'ISODateTime'>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Guard for {@link UUID}. Accepts RFC 4122 UUIDs of versions 1–8 in any case.
 * The all-zero nil UUID is deliberately rejected — it is never a real record id.
 */
export function isUuid(value: string): value is UUID {
  return UUID_PATTERN.test(value);
}

// Time of day and offset are bounds-checked by the pattern itself; the
// calendar date needs real logic (leap years), handled below.
const ISO_DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

// Proleptic Gregorian, matching ISO 8601. Pure arithmetic instead of Date.UTC:
// Date maps two-digit years 0-99 to 1900-1999, so year 0000 (a leap year)
// would be validated against non-leap 1900.
function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) {
    return false;
  }
  const max = month === 2 && isLeapYear(year) ? 29 : (DAYS_IN_MONTH[month - 1] ?? 0);
  return day <= max;
}

/**
 * Guard for {@link ISODateTime}. Requires date, time, and an explicit offset
 * (`Z` or `±HH:MM`), and rejects strings that match the shape but are not real
 * instants (e.g. month 13 or February 30th). Note: `Date.parse` is deliberately
 * not used — V8 silently rolls invalid days over into the next month.
 */
export function isIsoDateTime(value: string): value is ISODateTime {
  const match = ISO_DATE_TIME_PATTERN.exec(value);
  if (!match) {
    return false;
  }
  return isValidCalendarDate(Number(match[1]), Number(match[2]), Number(match[3]));
}
