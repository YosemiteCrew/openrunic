import type { Locale, MessageKey } from './catalogue.js';

/**
 * INTERPOLATION AND PLURALS: THE TWO PLACES A TRANSLATED STRING GOES WRONG
 * WITHOUT ANYTHING THROWING.
 *
 * ## A missing placeholder is refused, not left blank
 *
 * "Give {dose} mg" rendered without `dose` becomes "Give  mg" in every
 * implementation that treats a missing value as an empty string. Nothing
 * throws, the sentence is still grammatical, and the number that made it an
 * instruction is gone. That is the failure this file exists to prevent, and it
 * is the same shape as an empty array meaning "none" elsewhere in this
 * codebase: an absence rendered as a value.
 *
 * So a placeholder with no value is an error naming the placeholder and the
 * message, which is something a screen can report and a test can catch.
 *
 * ## Plurals are the locale's rule, never `n === 1`
 *
 * English has two plural forms and is the reason everybody writes `n === 1`.
 * Polish has four. Japanese has one. Arabic has six. A catalogue keyed on a
 * boolean cannot express any of them, and the failure is not a crash - it is a
 * sentence that reads as broken to a native speaker and fine to the person who
 * shipped it.
 *
 * `Intl.PluralRules` knows the categories per locale, so the catalogue supplies
 * a form per category and this picks. A locale whose rules the runtime does not
 * know is refused rather than guessed at, for the same reason a bad timezone is
 * refused elsewhere: substituting a default silently produces a screen nobody
 * checked in a language nobody here reads.
 */

/** Values a placeholder may take. Deliberately narrow; see `format`. */
export type Interpolations = Readonly<Record<string, string | number>>;

/** `{name}` - a single brace pair around a name, and nothing cleverer. */
const PLACEHOLDER = /\{(?<name>[a-zA-Z][a-zA-Z0-9_]*)\}/gu;

/**
 * What is wrong with a message and its values, or nothing.
 *
 * Returned rather than thrown, so a coverage report can check a whole catalogue
 * in one pass without stopping at the first bad message. `format` throws on the
 * same conditions, because a screen rendering one message has nowhere useful to
 * put a list.
 */
export function formatProblems(
  template: string,
  values: Interpolations,
  key: MessageKey
): readonly string[] {
  const problems: string[] = [];
  const named = new Set<string>();

  for (const match of template.matchAll(PLACEHOLDER)) {
    const name = match.groups?.['name'] ?? '';
    named.add(name);
    const value = values[name];
    if (value === undefined) {
      problems.push(
        `${key} has a placeholder {${name}} and no value for it, so the message would render with a gap where the value belongs.`
      );
    } else if (typeof value === 'number' && !Number.isFinite(value)) {
      // `String(NaN)` is "NaN", which renders as a word in the middle of a
      // sentence and reads to a user as a value rather than as an error.
      problems.push(`${key} was given ${String(value)} for {${name}}, which is not a number.`);
    }
  }

  // A value nobody asked for is usually a renamed placeholder, so the message
  // is missing one and silently dropping the other. Reported rather than
  // ignored, because the pair is the signal.
  for (const name of Object.keys(values)) {
    if (!named.has(name)) {
      problems.push(`${key} was given a value for {${name}}, which the message does not use.`);
    }
  }

  return problems;
}

/**
 * Fills the placeholders in a message.
 *
 * Throws on anything `formatProblems` reports. A message that cannot be
 * rendered correctly must not be rendered incorrectly: a gap where a dose
 * belongs is worse than an error, because the error is visible to whoever
 * deployed it and the gap is visible only to whoever reads the chart.
 */
export function format(template: string, values: Interpolations, key: MessageKey): string {
  const problems = formatProblems(template, values, key);
  if (problems.length > 0) {
    throw new RangeError(problems.join(' '));
  }
  return template.replaceAll(PLACEHOLDER, (_whole, ...args) => {
    const groups = args.at(-1) as { name: string };
    return String(values[groups.name]);
  });
}

/**
 * The plural forms a message needs, keyed by CLDR category.
 *
 * `other` is required and the rest are optional, because every locale has
 * `other` and no locale has all six. A catalogue supplying only `other` is
 * legitimate - it is what Japanese needs - rather than an incomplete entry.
 */
export interface PluralForms {
  readonly zero?: string;
  readonly one?: string;
  readonly two?: string;
  readonly few?: string;
  readonly many?: string;
  readonly other: string;
}

/**
 * The form a locale's rules select for a count.
 *
 * Refuses a locale the runtime does not know rather than falling back to
 * English rules, which would produce a sentence that reads as broken to a
 * native speaker and fine to whoever shipped it - the failure being invisible
 * on exactly the side that could fix it.
 *
 * Falls back to `other` when the rules pick a category the catalogue does not
 * supply, because `other` is the form every locale has and a missing `few` is a
 * translation gap rather than a reason to show nothing.
 */
export function plural(forms: PluralForms, count: number, locale: Locale): string {
  if (!Number.isFinite(count)) {
    throw new RangeError(`A plural needs a count, not ${String(count)}.`);
  }

  // Asked twice, because the constructor answers a different question from the
  // one that matters. `new Intl.PluralRules('zz')` does not throw - it accepts
  // any well-formed tag and quietly uses root rules, which have only `other`.
  // So a locale nobody has rules for produces a sentence with no plural
  // agreement at all, and nothing anywhere reports it. Only a malformed tag
  // throws, and a malformed tag is the case that was never the hazard.
  //
  // `supportedLocalesOf` is what distinguishes them: it returns an empty list
  // for a tag the runtime will fall back on.
  if (Intl.PluralRules.supportedLocalesOf([locale]).length === 0) {
    throw new RangeError(
      `${locale} is not a locale this runtime has plural rules for. Guessing at them produces a sentence that reads as broken only to somebody who speaks it, which is the side that cannot fix it.`
    );
  }

  const category = new Intl.PluralRules(locale).select(count);
  return forms[category] ?? forms.other;
}

/**
 * A count as the locale writes it.
 *
 * Separate from `plural` and always used with it. The form and the digits are
 * two different locale decisions - Arabic can select `few` and write the number
 * in Eastern Arabic numerals - and a catalogue that interpolated a raw
 * `String(count)` would get the grammar right and the numerals wrong.
 */
export function formatCount(count: number, locale: Locale): string {
  if (!Number.isFinite(count)) {
    throw new RangeError(`A count must be a number, not ${String(count)}.`);
  }
  return new Intl.NumberFormat(locale).format(count);
}
