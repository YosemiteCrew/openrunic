import type { Catalogue } from '../catalogue.js';

import { en } from './en/index.js';
import { es } from './es/index.js';

/**
 * The catalogue the applications render from.
 *
 * `sourceLocale` is named rather than assumed to be `en`: a fork whose source
 * strings are Spanish is a fork where falling back to English would be falling
 * back to a language nobody involved wrote.
 *
 * Adding a locale is adding a directory and one line here. No code changes,
 * which is the property that makes translation something a contributor can do.
 */
export const appCatalogue: Catalogue = {
  sourceLocale: 'en',
  messages: { en, es },
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

export { en, es };
export { enAreas } from './en/index.js';
