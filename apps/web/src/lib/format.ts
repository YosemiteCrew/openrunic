import type { PatientName } from '@/lib/api/types';

/**
 * Clinical formatting. One implementation, used everywhere.
 *
 * Two screens that render a date differently are a defect, not a style choice:
 * a clinician reading "08/12" cannot tell a US date from a European one, and
 * on a chart that ambiguity is dangerous. So every date on a staff surface is
 * "12 Aug 2026" (prose) or "12 Aug" (dense), and nothing else.
 *
 * Everything here is pure and deterministic. Times are rendered in the clinic's
 * timezone, passed explicitly and defaulting to {@link CLINIC_TIME_ZONE}, never
 * in the machine's local zone: an appointment must not move by an hour because
 * the front desk's laptop travelled.
 */

/**
 * The clinic's display zone. UTC until facilities carry one, which keeps
 * fixtures, tests and screenshots identical on every machine.
 */
export const CLINIC_TIME_ZONE = 'UTC';

/** The locale every formatter uses. en-US primary; DE ships at v1. */
const LOCALE = 'en-US';

/**
 * Built formatters, kept for the life of the page.
 *
 * Constructing an `Intl.NumberFormat` is one of the more expensive things in
 * the standard library, and a ledger screen formats one per cell per render.
 * The options cannot be hoisted to a constant because the currency comes from
 * the row, so they are memoised on the option set instead. The key space is the
 * currencies a practice actually bills in, which is a handful, so this cannot
 * grow without bound.
 */
const NUMBER_FORMATTERS = new Map<string, Intl.NumberFormat>();

function numberFormatter(options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = JSON.stringify(options);
  const cached = NUMBER_FORMATTERS.get(key);
  if (cached) return cached;
  const built = new Intl.NumberFormat(LOCALE, options);
  NUMBER_FORMATTERS.set(key, built);
  return built;
}

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** What a formatter renders when a value is genuinely absent. Never an empty cell. */
export const NOT_RECORDED = 'Not recorded';

/**
 * Anything a date formatter accepts. Named because five signatures take it, and
 * an alias is the only way to keep them from drifting apart one argument at a
 * time.
 */
export type DateInput = string | Date | null | undefined;

/* -------------------------------------------------------------------------- */
/* Counts                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The noun for a count: "note" or "notes".
 *
 * The plural is a parameter rather than a suffix rule because clinical English
 * does not derive: "coverage"/"coverages" is regular, but the summary line
 * "1 error blocks billing" has to become "2 errors block billing", where the
 * verb moves too. Passing both words keeps that decision at the call site,
 * where the sentence is.
 */
export function pluralise(count: number, singular: string, plural = `${singular}s`): string {
  return count === 1 ? singular : plural;
}

/** The count and its noun together: "1 claim", "4 claims". */
export function formatCount(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${pluralise(count, singular, plural)}`;
}

/* -------------------------------------------------------------------------- */
/* Names and identifiers                                                       */
/* -------------------------------------------------------------------------- */

export type NameStyle =
  /** "Testina Patientsson". Headings, chart rails, prose. */
  | 'full'
  /** "Patientsson, Testina". Sorted tables and pickers. */
  | 'listing'
  /** "T. Patientsson". Dense rows where the column is narrow. */
  | 'short';

/**
 * A preferred name is what the patient is called, so it replaces the given name
 * in every surface a human reads, and never silently disappears.
 */
export function formatName(name: PatientName, style: NameStyle = 'full'): string {
  const given = name.preferred ?? name.given;
  const family = name.family;
  if (style === 'listing') return `${family}, ${given}`;
  if (style === 'short') return `${given.charAt(0)}. ${family}`;
  return [name.prefix, given, family, name.suffix].filter(Boolean).join(' ');
}

/**
 * A staff member as "Ada Okafor, MD", or just "Ada Okafor" when the directory
 * carries no credential for them.
 *
 * The separator is conditional because the credential is: `userDtoSchema` makes
 * it nullable, and plenty of people who write in a chart hold none. Joining
 * unconditionally would print a trailing comma after the name of everyone who
 * does not, which reads as a field the screen failed to load.
 */
export function formatCredentialed(name: string, credential: string): string {
  return credential ? `${name}, ${credential}` : name;
}

/** Two letters for an avatar. Decorative: never the only identification on screen. */
export function formatInitials(name: PatientName): string {
  const given = name.preferred ?? name.given;
  return `${given.charAt(0)}${name.family.charAt(0)}`.toUpperCase();
}

/**
 * The MRN, uppercased and trimmed. Render it in `.or-mono`: an identifier that
 * is read character by character needs tabular, unambiguous glyphs.
 */
export function formatMrn(mrn: string): string {
  return mrn.trim().toUpperCase();
}

/* -------------------------------------------------------------------------- */
/* Dates and times                                                             */
/* -------------------------------------------------------------------------- */

export type DateStyle =
  /** "12 Aug 2026". The default on any surface with room. */
  | 'prose'
  /** "12 Aug". Dense tables, where the year is implied by the filter. */
  | 'dense'
  /** "2026-08-12". Machine-facing surfaces and export filenames only. */
  | 'iso';

interface CalendarParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function toDate(value: string | Date): Date | null {
  const date = value instanceof Date ? value : parseValue(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** A bare `YYYY-MM-DD` is a calendar date, so it is read as UTC midnight, never local. */
function parseValue(value: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00.000Z`) : new Date(value);
}

/** Splits an instant into the clinic's wall-clock fields, via Intl rather than getters. */
function calendarParts(date: Date, timeZone: string): CalendarParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');

  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
  };
}

function pad(value: number): string {
  return value.toString().padStart(2, '0');
}

export function formatDate(
  value: DateInput,
  style: DateStyle = 'prose',
  timeZone: string = CLINIC_TIME_ZONE
): string {
  if (!value) return NOT_RECORDED;
  const date = toDate(value);
  if (!date) return NOT_RECORDED;

  const { year, month, day } = calendarParts(date, timeZone);
  if (style === 'iso') return `${year}-${pad(month)}-${pad(day)}`;
  const monthName = MONTHS[month - 1] ?? '';
  return style === 'dense' ? `${day} ${monthName}` : `${day} ${monthName} ${year}`;
}

/** "09:20". 24-hour, because a clinic day crosses noon and am/pm doubles the reading. */
export function formatTime(value: DateInput, timeZone: string = CLINIC_TIME_ZONE): string {
  if (!value) return NOT_RECORDED;
  const date = toDate(value);
  if (!date) return NOT_RECORDED;
  const { hour, minute } = calendarParts(date, timeZone);
  return `${pad(hour)}:${pad(minute)}`;
}

/** "12 Aug 2026, 09:20". */
export function formatDateTime(
  value: DateInput,
  style: DateStyle = 'prose',
  timeZone: string = CLINIC_TIME_ZONE
): string {
  if (!value) return NOT_RECORDED;
  const date = toDate(value);
  if (!date) return NOT_RECORDED;
  return `${formatDate(date, style, timeZone)}, ${formatTime(date, timeZone)}`;
}

/**
 * Age in the unit a clinician would say it in: years from two, months from one
 * month, days before that. Pass `asOf` on any surface that must not move with
 * the clock (fixtures, tests, printed records).
 */
export function formatAge(birthDate: DateInput, asOf: string | Date = new Date()): string {
  if (!birthDate) return NOT_RECORDED;
  const born = toDate(birthDate);
  const now = toDate(asOf);
  if (!born || !now || born > now) return NOT_RECORDED;

  const days = Math.floor((now.getTime() - born.getTime()) / 86_400_000);
  if (days < 31) return `${days} d`;

  const months =
    (now.getUTCFullYear() - born.getUTCFullYear()) * 12 +
    (now.getUTCMonth() - born.getUTCMonth()) -
    (now.getUTCDate() < born.getUTCDate() ? 1 : 0);
  if (months < 24) return `${months} mo`;
  return `${Math.floor(months / 12)} y`;
}

/**
 * Elapsed time for wait timers and status ages: "4 min", "1 h 12 min", "3 d".
 * Under a minute reads "just now" rather than counting seconds, because a
 * second-by-second number on a clinical board invites watching it.
 */
export function formatElapsed(from: DateInput, to: string | Date = new Date()): string {
  if (!from) return NOT_RECORDED;
  const start = toDate(from);
  const end = toDate(to);
  if (!start || !end) return NOT_RECORDED;

  const minutes = Math.floor((end.getTime() - start.getTime()) / 60_000);
  if (minutes < 0) return NOT_RECORDED;
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest === 0 ? `${hours} h` : `${hours} h ${pad(rest)} min`;
  }
  return `${Math.floor(hours / 24)} d`;
}

/* -------------------------------------------------------------------------- */
/* Money                                                                       */
/* -------------------------------------------------------------------------- */

export type NegativeLabel = 'Credit' | 'Refund';

export interface MoneyOptions {
  /** ISO 4217. Always explicit: a bare number on a billing screen is a defect. */
  currency?: string;
  /**
   * What a negative amount means on this screen. Billing surfaces read "Credit"
   * (money the practice owes the patient); payment surfaces read "Refund".
   */
  negativeLabel?: NegativeLabel;
}

export interface Money {
  /** "$38.00", or "($38.00)" when negative. Right-align it, tabular figures. */
  text: string;
  /** "Credit" or "Refund" for a negative amount, otherwise null. Render it. */
  label: NegativeLabel | null;
  /** "38.00 US dollars credit". For `aria-label` where the parentheses do not read. */
  srText: string;
  negative: boolean;
}

/**
 * A money amount, in major units.
 *
 * Negatives are rendered in parentheses AND carry an explicit word, because
 * a minus sign is easy to miss at the end of a long ledger column and colour is
 * never the only signal.
 */
export function formatMoney(amount: number, options: MoneyOptions = {}): Money {
  const currency = options.currency ?? 'USD';
  const negative = amount < 0;
  const label = negative ? (options.negativeLabel ?? 'Credit') : null;

  const magnitude = numberFormatter({
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
  }).format(Math.abs(amount));

  const spoken = numberFormatter({
    style: 'currency',
    currency,
    currencyDisplay: 'name',
  }).format(Math.abs(amount));

  return {
    text: negative ? `(${magnitude})` : magnitude,
    label,
    srText: label ? `${spoken} ${label.toLowerCase()}` : spoken,
    negative,
  };
}

/* -------------------------------------------------------------------------- */
/* Vitals and ranges                                                           */
/* -------------------------------------------------------------------------- */

/** Matches `StatusTone` in @openrunic/ui: olive, hazelnut, danger red. */
export type RangeState = 'success' | 'neutral' | 'danger';

export interface ReferenceRange {
  low?: number;
  high?: number;
}

export interface VitalInput {
  label: string;
  value: number | null | undefined;
  unit: string;
  range?: ReferenceRange;
  /** Precision for display. Defaults to whatever the value already carries. */
  decimals?: number;
}

export interface FormattedVital {
  label: string;
  /** "7.4". Pair it with `unit`; never render a bare number. */
  value: string;
  unit: string;
  state: RangeState;
  /** "In range", "Above range", "Below range", "No range recorded". Always render it. */
  stateLabel: string;
  /** "7.4 mmol/L, above range". The whole reading in one string, for aria and exports. */
  text: string;
  /** "3.9 to 7.8 mmol/L", or null when no range is recorded. */
  rangeText: string | null;
}

function rangeState(value: number, range: ReferenceRange | undefined): [RangeState, string] {
  if (!range || (range.low === undefined && range.high === undefined)) {
    return ['neutral', 'No range recorded'];
  }
  if (range.high !== undefined && value > range.high) return ['danger', 'Above range'];
  if (range.low !== undefined && value < range.low) return ['danger', 'Below range'];
  return ['success', 'In range'];
}

/**
 * A vital or lab reading with its unit and an explicitly worded range state.
 *
 * The rule this enforces: a number on a clinical surface always carries a unit
 * and a labelled range state. The colour that goes with the state is decoration
 * on top of `stateLabel`, never a substitute for it.
 */
export function formatVital(input: VitalInput): FormattedVital {
  const { label, unit, range, decimals } = input;

  if (input.value === null || input.value === undefined || Number.isNaN(input.value)) {
    return {
      label,
      value: NOT_RECORDED,
      unit,
      state: 'neutral',
      stateLabel: 'Not recorded',
      text: `${label}: ${NOT_RECORDED}`,
      rangeText: null,
    };
  }

  const [state, stateLabel] = rangeState(input.value, range);
  const value =
    decimals === undefined ? String(input.value) : input.value.toFixed(Math.max(decimals, 0));

  const bounds: string | null =
    range && (range.low !== undefined || range.high !== undefined)
      ? `${range.low ?? '-'} to ${range.high ?? '-'} ${unit}`
      : null;

  return {
    label,
    value,
    unit,
    state,
    stateLabel,
    text: `${value} ${unit}, ${stateLabel.toLowerCase()}`,
    rangeText: bounds,
  };
}

/* -------------------------------------------------------------------------- */
/* Enum labels                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Turns a schema enum into sentence case: `CHECKED_IN` becomes "Checked in".
 * Sentence case is the system's only casing; overline is the sole exception.
 */
export function formatEnumLabel(value: string): string {
  const words = value.toLowerCase().split('_').filter(Boolean);
  const [first, ...rest] = words;
  if (!first) return '';
  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(' ');
}
