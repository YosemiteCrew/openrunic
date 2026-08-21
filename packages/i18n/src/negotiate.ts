import type { Catalogue, Locale, MessageKey, Rendered } from './catalogue.js';
import { isUnknown, lookup } from './catalogue.js';
import { format, type Interpolations } from './format.js';

/**
 * CHOOSING A LOCALE, AND RENDERING IN IT.
 *
 * Two small things that every application otherwise reimplements slightly
 * differently, which is how one screen ends up in Spanish and the next in
 * English for the same reader.
 */

/**
 * Picks the best supported locale from an `Accept-Language` header.
 *
 * Quality values are honoured because browsers send them and because ignoring
 * them gets the common case wrong: `es;q=0.9, en;q=0.8` means a reader who
 * prefers Spanish and will accept English, and taking the first entry in
 * document order happens to work only until a browser reorders them.
 *
 * An exact match beats a language match, so `es-MX` prefers an `es-MX`
 * catalogue over `es`. Falls back to the source locale, which is always
 * supported by definition.
 */
export function negotiateLocale(
  header: string | null | undefined,
  supported: readonly Locale[],
  sourceLocale: Locale
): Locale {
  if (!header) return sourceLocale;

  const ranked = header
    .split(',')
    .map((entry) => {
      const [tag = '', ...parameters] = entry.trim().split(';');
      const quality = parameters
        .map((parameter) => /^\s*q=(?<value>[0-9.]+)\s*$/u.exec(parameter)?.groups?.['value'])
        .find((value) => value !== undefined);
      return { tag: tag.trim(), quality: quality === undefined ? 1 : Number(quality) };
    })
    // A zero quality means "not this one", which is a refusal rather than a
    // weak preference, so it is dropped rather than sorted to the bottom.
    .filter((entry) => entry.tag !== '' && entry.quality > 0)
    .sort((left, right) => right.quality - left.quality);

  for (const { tag } of ranked) {
    if (tag === '*') return sourceLocale;
    const exact = supported.find((locale) => locale.toLowerCase() === tag.toLowerCase());
    if (exact !== undefined) return exact;

    const language = tag.split('-')[0]?.toLowerCase() ?? '';
    const byLanguage = supported.find((locale) => locale.toLowerCase() === language);
    if (byLanguage !== undefined) return byLanguage;
  }

  return sourceLocale;
}

/** What a translator did with one key, for callers that need to know. */
export interface Translation extends Rendered {
  readonly key: MessageKey;
}

export interface Translator {
  /** The rendered string. What a screen calls, and the reason this exists. */
  (key: MessageKey, values?: Interpolations): string;
  /** The locale this translator was built for, for `<html lang>`. */
  readonly locale: Locale;
  /** Every lookup that fell back to the source language, in call order. */
  readonly fallbacks: readonly Translation[];
}

/**
 * Builds a translator for one locale.
 *
 * ## An unknown key renders as the key
 *
 * Not as an empty string, and not by throwing. An empty label does not read as
 * broken, it reads as a field with no label, and the value beside it becomes
 * unattributed: on a medication list that is a dose with nothing saying what it
 * is a dose of. Throwing takes down a clinical screen over a typo. Rendering
 * `patient.allergy.severity` where a label should be is ugly, obvious, and
 * greppable, which is what a bug should be.
 *
 * ## Fallbacks are counted
 *
 * A fallback nobody counts is a translation gap nobody closes. Every lookup
 * that came back in the source language instead of the requested one is
 * recorded, so a screen can mark them and a report can list them.
 */
export function createTranslator(catalogue: Catalogue, locale: Locale): Translator {
  const fallbacks: Translation[] = [];

  const translate = (key: MessageKey, values: Interpolations = {}): string => {
    const found = lookup(catalogue, locale, key);
    if (isUnknown(found)) return key;
    if (found.fellBack) fallbacks.push({ ...found, key });
    return format(found.text, values, key);
  };

  return Object.assign(translate, { locale, fallbacks }) as Translator;
}
