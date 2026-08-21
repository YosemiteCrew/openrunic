import type { Catalogue } from '../catalogue.js';

import { en } from './en.js';
import { es } from './es.js';

/**
 * The catalogue the applications render from.
 *
 * `sourceLocale` is named rather than assumed to be `en`: a fork whose source
 * strings are Spanish is a fork where falling back to English would be falling
 * back to a language nobody involved wrote.
 *
 * Adding a locale is adding a file and one line here. No code changes, which is
 * the property that makes translation something a contributor can do.
 */
export const appCatalogue: Catalogue = {
  sourceLocale: 'en',
  messages: { en, es },
};

/** The locales this build actually carries, for content negotiation. */
export const SUPPORTED_LOCALES = Object.keys(appCatalogue.messages);

export { en, es };
