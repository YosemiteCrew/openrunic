import type { Catalogue, Locale, Messages } from '../catalogue.js';

import { compose } from './compose.js';
import { enAreas } from './en/index.js';
import { esAreas } from './es/index.js';

/**
 * Every locale this build carries, and the areas each is composed from.
 *
 * The one place a language is registered. Everything below is derived from it,
 * so a locale cannot be present in the catalogue and absent from the tests that
 * guard it, or the other way round - which is what a hand-written `messages`
 * object beside a hand-written test map allowed.
 *
 * Adding a locale is a directory of area files with its own barrel, and two
 * lines here: the import of that barrel's `<locale>Areas`, and its entry below.
 * Nothing discovers the directory - said plainly because the same sentence has
 * been undercounted twice already in this file's history, and an instruction
 * that cannot be followed as written is how a language ends up half-registered
 * and silently falling back.
 */
export const catalogueAreas: Readonly<Record<Locale, Readonly<Record<string, Messages>>>> = {
  en: enAreas,
  es: esAreas,
};

/**
 * The catalogue the applications render from.
 *
 * `sourceLocale` is named rather than assumed to be `en`: a fork whose source
 * strings are Spanish is a fork where falling back to English would be falling
 * back to a language nobody involved wrote.
 */
export const appCatalogue: Catalogue = {
  sourceLocale: 'en',
  messages: Object.fromEntries(
    Object.entries(catalogueAreas).map(([locale, areas]) => [locale, compose(areas)])
  ),
};

/** The locales this build actually carries, for content negotiation. */
export const SUPPORTED_LOCALES = Object.keys(appCatalogue.messages);

const SUPPORTED: ReadonlySet<string> = new Set(SUPPORTED_LOCALES);

/**
 * Whether this build has a catalogue for a locale.
 *
 * For anywhere a locale arrives from outside: a URL segment, a cookie, a stored
 * user preference. `Locale` is a string, so the type system cannot tell a
 * supported one from a typo, and rendering a page in a language with no
 * catalogue shows the reader every message key instead of every message.
 */
export function isSupportedLocale(locale: string): boolean {
  return SUPPORTED.has(locale);
}

export { en } from './en/index.js';
export { es } from './es/index.js';
