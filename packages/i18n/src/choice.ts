import { appCatalogue } from './catalogues/index.js';
import { SUPPORTED_LOCALES } from './catalogues/index.js';
import { negotiateLocale } from './negotiate.js';

/**
 * WHAT LANGUAGE THIS PERSON IS READING IN, ASKED THE SAME WAY EVERYWHERE.
 *
 * `negotiateLocale` answers it from an `Accept-Language` header. This is the
 * rest of the rule: a reader's own choice, if they have made one, and only then
 * what their browser was configured with.
 *
 * It lives in the package rather than in an application because three places
 * ask it and they must not drift. `apps/web` asks from a server component,
 * its proxy asks from middleware that cannot call `headers()`, and `apps/portal`
 * asks for the same reader - a patient who chose Spanish on the public pages and
 * then signed in to look at their own record has chosen once, not twice.
 *
 * Nothing here touches a framework. The two functions take strings, so a Next
 * route, a middleware and a test all reach the same answer through the same
 * code.
 */

/** The cookie the language control writes. One name, because one choice. */
export const LOCALE_COOKIE = 'or_locale';

/**
 * The reader's language, from the two header values that can say.
 *
 * The choice wins over the browser's configuration, because it is a person
 * saying so rather than a machine's default.
 */
export function localeFrom(cookie: string | null, acceptLanguage: string | null): string {
  const chosen = readLocaleCookie(cookie);
  if (chosen !== null) return chosen;

  return negotiateLocale(acceptLanguage, SUPPORTED_LOCALES, appCatalogue.sourceLocale);
}

/**
 * Reads the choice cookie, and refuses anything that is not a locale this build
 * carries.
 *
 * The value reaches `<html lang>` and the catalogue lookup, so it is checked
 * against the supported list rather than trusted: a cookie is attacker-writable,
 * and an unchecked one would put arbitrary text into an attribute.
 *
 * This check is the reason the whole rule is shared rather than copied. A second
 * copy of it is a second place for the validation to be dropped, and the symptom
 * of dropping it is not a wrong language - it is arbitrary text in an attribute.
 */
export function readLocaleCookie(header: string | null): string | null {
  if (header === null) return null;
  for (const pair of header.split(';')) {
    const [name, ...rest] = pair.trim().split('=');
    if (name !== LOCALE_COOKIE) continue;
    const value = decodeURIComponent(rest.join('='));
    return SUPPORTED_LOCALES.includes(value) ? value : null;
  }
  return null;
}
