/**
 * MESSAGE CATALOGUES: WHAT A SCREEN SAYS, IN THE LANGUAGE OF THE PERSON READING
 * IT.
 *
 * The hard part of translating an EMR is not the translating. It is that a
 * half-translated screen has to fail in a direction somebody can act on, and
 * the obvious implementations all fail in the other one.
 *
 * ## A missing translation renders in the source language, never as nothing
 *
 * Three things a lookup can do when a key is absent, and only one of them is
 * safe in a clinical screen:
 *
 * - Render the key. `patient.allergy.severity` appears where a label should be.
 *   Obvious in a demo, and in production it appears next to a real allergy.
 * - Render an empty string. Worse, and this is the one that gets shipped,
 *   because it looks tidy. A field label that is blank does not read as broken;
 *   it reads as a field with no label, and the value beside it becomes
 *   unattributed. On a medication list that is a dose with nothing saying what
 *   it is a dose of.
 * - Render the source language. The reader sees English where they expected
 *   Spanish, which is obviously incomplete and obviously still information.
 *
 * The third is the only one that degrades rather than breaks, so it is what
 * this does - and it records that it happened, because a fallback nobody counts
 * is a translation gap nobody closes.
 *
 * ## Coverage is measured, not claimed
 *
 * A catalogue cannot say it covers a locale. {@link coverageOf} counts what is
 * actually there against the source, so "we support Spanish" is a number rather
 * than an assertion in a README.
 */

/** A BCP 47 tag, as `User.locale` stores it - `en-US`, `es-MX`, `fr`. */
export type Locale = string;

/** A dotted key. Dotted by convention only; nothing here parses the parts. */
export type MessageKey = string;

/**
 * One locale's messages.
 *
 * Flat rather than nested. A nested catalogue reads better in a file and turns
 * every lookup into a walk that can end on an object rather than a string -
 * which then renders as `[object Object]` in the one place nobody tested. Flat
 * keys make a missing message a missing key, which is the thing this file is
 * about handling well.
 */
export type Messages = Readonly<Record<MessageKey, string>>;

export interface Catalogue {
  /**
   * The language the software is written in, and the fallback for every other.
   *
   * Named rather than assumed to be `en`. A deployment whose source strings are
   * Spanish is a deployment where falling back to English would be falling back
   * to a language nobody involved wrote.
   */
  readonly sourceLocale: Locale;
  readonly messages: Readonly<Record<Locale, Messages>>;
}

/** What a lookup did, so a caller can tell a translation from a fallback. */
export interface Rendered {
  readonly text: string;
  /**
   * The locale the text actually came from, which is not always the one asked
   * for. A screen can use this to mark a fallback; a report uses it to find
   * what still needs translating.
   */
  readonly locale: Locale;
  /** True when the requested locale had no message and the source was used. */
  readonly fellBack: boolean;
}

/**
 * The locales to try, most specific first.
 *
 * `es-MX` falls to `es` before it falls to the source language, because a
 * Mexican Spanish speaker reading Castilian Spanish is reading their own
 * language with unfamiliar word choices, and reading English is not. The chain
 * is the reason the region is worth storing at all.
 */
export function localeChain(locale: Locale, sourceLocale: Locale): readonly Locale[] {
  const seen = new Set<Locale>();
  const chain: Locale[] = [];
  for (const candidate of [locale, locale.split('-')[0] ?? locale, sourceLocale]) {
    if (candidate !== '' && !seen.has(candidate)) {
      seen.add(candidate);
      chain.push(candidate);
    }
  }
  return chain;
}

/**
 * A key this catalogue does not have, in any locale.
 *
 * Distinguished from a key that is merely untranslated, and the distinction is
 * the whole point of returning a result rather than a string: an untranslated
 * key is a translation job, and an unknown key is a bug in the code that asked
 * for it. Rendering both as the same thing is how a typo in a key survives to
 * production looking like a translation backlog.
 */
export interface UnknownMessage {
  readonly unknown: true;
  readonly key: MessageKey;
}

export function isUnknown(value: Rendered | UnknownMessage): value is UnknownMessage {
  return 'unknown' in value;
}

/**
 * Looks a message up, following the locale chain.
 *
 * Returns what it found and where from. A caller that only wants the string
 * takes `.text`; a caller building a coverage report reads `.fellBack`. The
 * shape is deliberately awkward to ignore, because ignoring it is how a screen
 * ends up silently English.
 */
export function lookup(
  catalogue: Catalogue,
  locale: Locale,
  key: MessageKey
): Rendered | UnknownMessage {
  for (const candidate of localeChain(locale, catalogue.sourceLocale)) {
    const text = catalogue.messages[candidate]?.[key];
    if (text !== undefined) {
      return { text, locale: candidate, fellBack: candidate !== locale };
    }
  }
  return { unknown: true, key };
}

/** How much of the source catalogue a locale actually covers. */
export interface Coverage {
  readonly locale: Locale;
  readonly translated: number;
  readonly total: number;
  /** Source keys with no message in this locale, sorted, so a report is stable. */
  readonly missing: readonly MessageKey[];
}

/**
 * Counts what a locale actually has against the source.
 *
 * Measured rather than declared, because a catalogue that could declare its own
 * coverage would declare it once and then drift every time a source string was
 * added. Every new key is missing in every locale by definition, and the number
 * that says so should move on its own.
 *
 * Keys present in the locale but absent from the source are counted separately
 * by {@link staleKeys}: they are usually a source string that was renamed, and
 * a translator's work that is now unreachable.
 */
export function coverageOf(catalogue: Catalogue, locale: Locale): Coverage {
  const source = catalogue.messages[catalogue.sourceLocale] ?? {};
  const target = catalogue.messages[locale] ?? {};
  const keys = Object.keys(source);
  const missing = keys.filter((key) => target[key] === undefined).toSorted();
  return {
    locale,
    translated: keys.length - missing.length,
    total: keys.length,
    missing,
  };
}

/**
 * Messages a locale has that the source no longer does.
 *
 * Almost always a renamed source key, which leaves a translation nothing can
 * reach. Worth surfacing rather than deleting: the text is somebody's work and
 * usually wants moving to the new key rather than retranslating.
 */
export function staleKeys(catalogue: Catalogue, locale: Locale): readonly MessageKey[] {
  const source = catalogue.messages[catalogue.sourceLocale] ?? {};
  const target = catalogue.messages[locale] ?? {};
  return Object.keys(target)
    .filter((key) => source[key] === undefined)
    .toSorted();
}
