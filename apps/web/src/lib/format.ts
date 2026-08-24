import { formatCount as countInLocale } from '@openrunic/i18n';
import type { Translator } from '@openrunic/i18n';

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
 *
 * ## Why some of these take a translator and others do not
 *
 * A formatter that produces a word has to produce it in the reader's language,
 * and a shared helper is the one place a `useTranslator` call cannot reach. So
 * `formatAge`, `formatElapsed` and `formatVital` take the translator as their
 * first argument, the way `counted` in `lib/i18n/counted.ts` already does. That
 * is a deliberately dull mechanism: no hook, no context, nothing that stops
 * these being called from a plain module like `components/inbox/sla.ts`.
 *
 * `formatName`, `formatInitials`, `formatMrn` and `formatCredentialed` do not,
 * because they produce no words. They rearrange a name the server supplied and
 * uppercase an identifier, and neither is a language decision.
 *
 * The numbers inside a translated string go through `formatCount` from
 * `@openrunic/i18n` rather than being interpolated raw. The form and the digits
 * are two separate locale decisions - Arabic writes its numerals differently -
 * and a message that got the wording right and the numerals wrong would still
 * be wrong.
 */

/**
 * The clinic's display zone. UTC until facilities carry one, which keeps
 * fixtures, tests and screenshots identical on every machine.
 */
export const CLINIC_TIME_ZONE = 'UTC';

/**
 * Built formatters, kept for the life of the page.
 *
 * Constructing an `Intl.NumberFormat` is one of the more expensive things in
 * the standard library, and a ledger screen formats one per cell per render.
 * The options cannot be hoisted to a constant because the currency comes from
 * the row and the locale comes from the reader, so they are memoised on both
 * instead. The key space is the currencies a practice bills in times the
 * languages this build ships, both of which are a handful, so this cannot grow
 * without bound.
 *
 * The locale is part of the key rather than fixed, and that is the whole reason
 * this function changed: keyed on the options alone, the first reader to open a
 * ledger would decide how every later reader saw one, whatever language they
 * had asked for.
 */
const NUMBER_FORMATTERS = new Map<string, Intl.NumberFormat>();

function numberFormatter(locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  const cached = NUMBER_FORMATTERS.get(key);
  if (cached) return cached;
  const built = new Intl.NumberFormat(locale, options);
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

/**
 * What a formatter renders when a value is genuinely absent. Never an empty cell.
 *
 * Still a constant because the date formatters below still return it, and they
 * have not been given a translator yet. The catalogue holds the same words under
 * `common.notRecorded`, and `format.test.ts` asserts the two are equal, so the
 * two spellings cannot drift while both exist.
 */
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
export function formatAge(
  t: Translator,
  birthDate: DateInput,
  asOf: string | Date = new Date()
): string {
  if (!birthDate) return t('common.notRecorded');
  const born = toDate(birthDate);
  const now = toDate(asOf);
  if (!born || !now || born > now) return t('common.notRecorded');

  const days = Math.floor((now.getTime() - born.getTime()) / 86_400_000);
  if (days < 31) return t('common.age.days', { count: countInLocale(days, t.locale) });

  const months =
    (now.getUTCFullYear() - born.getUTCFullYear()) * 12 +
    (now.getUTCMonth() - born.getUTCMonth()) -
    (now.getUTCDate() < born.getUTCDate() ? 1 : 0);
  if (months < 24) return t('common.age.months', { count: countInLocale(months, t.locale) });
  return t('common.age.years', { count: countInLocale(Math.floor(months / 12), t.locale) });
}

/**
 * Elapsed time for wait timers and status ages: "4 min", "1 h 12 min", "3 d".
 * Under a minute reads "just now" rather than counting seconds, because a
 * second-by-second number on a clinical board invites watching it.
 */
export function formatElapsed(
  t: Translator,
  from: DateInput,
  to: string | Date = new Date()
): string {
  if (!from) return t('common.notRecorded');
  const start = toDate(from);
  const end = toDate(to);
  if (!start || !end) return t('common.notRecorded');

  const minutes = Math.floor((end.getTime() - start.getTime()) / 60_000);
  if (minutes < 0) return t('common.notRecorded');
  if (minutes < 1) return t('common.elapsed.justNow');
  if (minutes < 60) return t('common.elapsed.minutes', { count: countInLocale(minutes, t.locale) });

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    // The minutes are zero-padded and the hours are not, because these render
    // in an `or-mono` column on the flow board where "1 h 05 min" lines up under
    // "1 h 40 min" and "1 h 5 min" does not. A padded field is a column width
    // rather than a count, which is why it does not go through `countInLocale`.
    return rest === 0
      ? t('common.elapsed.hours', { count: countInLocale(hours, t.locale) })
      : t('common.elapsed.hoursMinutes', {
          count: countInLocale(hours, t.locale),
          minutes: pad(rest),
        });
  }
  return t('common.elapsed.days', { count: countInLocale(Math.floor(hours / 24), t.locale) });
}

/* -------------------------------------------------------------------------- */
/* Money                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * What a negative amount means on this screen, as a discriminator rather than as
 * the word.
 *
 * It used to be `'Credit' | 'Refund'`, which made a display string double as a
 * type: the value a screen passed in was also the text a reader saw, so there
 * was no seam to translate at without changing what every call site typed. The
 * words now live in the catalogue and this names which pair to look up.
 */
export type NegativeLabel = 'credit' | 'refund';

interface NegativeWords {
  /** The standalone word beside the amount. */
  readonly labelKey: string;
  /** The whole spoken sentence, amount included. Never the label glued on. */
  readonly spokenKey: string;
}

const NEGATIVE_WORDS = {
  credit: { labelKey: 'billing.money.credit', spokenKey: 'billing.money.spokenCredit' },
  refund: { labelKey: 'billing.money.refund', spokenKey: 'billing.money.spokenRefund' },
} as const satisfies Readonly<Record<NegativeLabel, NegativeWords>>;

export interface MoneyOptions {
  /** ISO 4217. Always explicit: a bare number on a billing screen is a defect. */
  currency?: string;
  /**
   * What a negative amount means on this screen. Billing surfaces read a credit
   * (money the practice owes the patient); payment surfaces read a refund.
   */
  negativeLabel?: NegativeLabel;
}

export interface Money {
  /** "$38.00", or "($38.00)" when negative. Right-align it, tabular figures. */
  text: string;
  /** The word for a negative amount, in the reader's language, otherwise null. Render it. */
  label: string | null;
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
 *
 * The digits, the separators and the symbol's position come from the reader's
 * locale, so a Spanish reader sees "38,00 $" where an English one sees "$38.00".
 * The parentheses do not. `Intl` can produce them itself with
 * `currencySign: 'accounting'`, and for Spanish and German it produces a leading
 * minus instead - which is exactly the signal this wraps them for. The
 * parentheses are this product's rule about not losing a negative in a column,
 * the way day-month-year above is its rule about not losing a date, and neither
 * is the reader's language to decide.
 */
export function formatMoney(t: Translator, amount: number, options: MoneyOptions = {}): Money {
  const currency = options.currency ?? 'USD';
  const negative = amount < 0;
  const words = negative ? NEGATIVE_WORDS[options.negativeLabel ?? 'credit'] : null;

  const magnitude = numberFormatter(t.locale, {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
  }).format(Math.abs(amount));

  const spoken = numberFormatter(t.locale, {
    style: 'currency',
    currency,
    currencyDisplay: 'name',
  }).format(Math.abs(amount));

  return {
    text: negative ? `(${magnitude})` : magnitude,
    label: words ? t(words.labelKey) : null,
    // One message rather than the amount with the label lowercased onto the end.
    // "credit" is lower case mid-sentence in English and the label beside the
    // number is not, which is a fact about English rather than a rule to apply
    // to every language.
    srText: words ? t(words.spokenKey, { amount: spoken }) : spoken,
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

/**
 * The tone, the standalone label and the whole sentence for one range state.
 *
 * Three things rather than two because the label and the sentence are separate
 * messages, not one lowercased into the other. "Above range" beside a number and
 * "7.4 mmol/L, above range" read to a screen reader are different strings in
 * English and stay different strings in every other language, so a translator
 * gets both rather than a rule for deriving one from the other.
 *
 * The keys are written out as `labelKey` and `readingKey` properties so
 * `catalogue-drift.test.ts` can see them. A key built from the state name would
 * be invisible to it, and therefore invisible to whoever has to find it later.
 */
interface RangeWords {
  readonly state: RangeState;
  readonly labelKey: string;
  readonly readingKey: string;
}

const RANGE_WORDS = {
  in: {
    state: 'success',
    labelKey: 'clinical.range.in',
    readingKey: 'clinical.vital.reading.in',
  },
  above: {
    state: 'danger',
    labelKey: 'clinical.range.above',
    readingKey: 'clinical.vital.reading.above',
  },
  below: {
    state: 'danger',
    labelKey: 'clinical.range.below',
    readingKey: 'clinical.vital.reading.below',
  },
  none: {
    state: 'neutral',
    labelKey: 'clinical.range.none',
    readingKey: 'clinical.vital.reading.none',
  },
} as const satisfies Readonly<Record<string, RangeWords>>;

function rangeWords(value: number, range: ReferenceRange | undefined): RangeWords {
  if (!range || (range.low === undefined && range.high === undefined)) return RANGE_WORDS.none;
  if (range.high !== undefined && value > range.high) return RANGE_WORDS.above;
  if (range.low !== undefined && value < range.low) return RANGE_WORDS.below;
  return RANGE_WORDS.in;
}

/**
 * A vital or lab reading with its unit and an explicitly worded range state.
 *
 * The rule this enforces: a number on a clinical surface always carries a unit
 * and a labelled range state. The colour that goes with the state is decoration
 * on top of `stateLabel`, never a substitute for it.
 */
/**
 * The tone a reading carries, without the words.
 *
 * Separate from {@link formatVital} because a caller that only needs to know
 * whether a value is out of range is not making a language decision, and should
 * not have to hold a translator to ask. The results list sorts and flags on this
 * before it renders anything; it used to build a whole formatted vital and read
 * one field off it, which meant a screen could not decide what was abnormal
 * without first deciding what language to say so in.
 *
 * An absent value is `neutral` rather than an error: nothing recorded is not out
 * of range, it is not measured.
 */
export function vitalState(value: number | null | undefined, range?: ReferenceRange): RangeState {
  if (value === null || value === undefined || Number.isNaN(value)) return 'neutral';
  return rangeWords(value, range).state;
}

export function formatVital(t: Translator, input: VitalInput): FormattedVital {
  const { label, unit, range, decimals } = input;

  if (input.value === null || input.value === undefined || Number.isNaN(input.value)) {
    return {
      label,
      value: t('common.notRecorded'),
      unit,
      state: 'neutral',
      stateLabel: t('common.notRecorded'),
      text: t('clinical.vital.absent', { label }),
      rangeText: null,
    };
  }

  const words = rangeWords(input.value, range);

  // The number itself is not locale-formatted, so 7.4 stays 7.4 rather than
  // becoming 7,4. That is deliberate and it is tied to the `clinical.` area
  // having no Spanish file: while the sentence around it falls back to English,
  // a Spanish decimal comma inside an English sentence is a worse reading than
  // either language on its own. Whoever writes `es/clinical.ts` decides this at
  // the same time as the words, which is the only point it can be decided from.
  const value =
    decimals === undefined ? String(input.value) : input.value.toFixed(Math.max(decimals, 0));

  const bounds: string | null =
    range && (range.low !== undefined || range.high !== undefined)
      ? t('clinical.vital.range', { low: range.low ?? '-', high: range.high ?? '-', unit })
      : null;

  return {
    label,
    value,
    unit,
    state: words.state,
    stateLabel: t(words.labelKey),
    text: t(words.readingKey, { value, unit }),
    rangeText: bounds,
  };
}
