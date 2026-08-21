import { appCatalogue, negotiateLocale, SUPPORTED_LOCALES } from '@openrunic/i18n';
import { headers } from 'next/headers';

/**
 * WHAT LANGUAGE TO RENDER IN.
 *
 * Server-side, because the answer has to be known before the first byte: a page
 * that renders in English and then swaps to Spanish once JavaScript arrives has
 * shown the wrong language to the person least able to read it, and has moved
 * the layout under their cursor while doing it.
 *
 * ## Where the answer comes from, in order
 *
 * 1. The reader's own choice, if they have made one. A cookie, set by the
 *    language control and readable without a session, so it works on the public
 *    pages and on the sign-in screen.
 * 2. `Accept-Language`. What the browser was configured with, which for most
 *    people is the language their computer is in.
 *
 * ## What this costs
 *
 * `headers()` opts the whole route tree into dynamic rendering, so every page
 * is server-rendered on demand where 27 of them were prerendered before. For
 * the 23 authenticated shells that is close to free: they sit behind
 * `SessionGate` and their prerendered output was an empty shell that
 * immediately fetched. For the four public pages it is a real cost, and the fix
 * is locale-segmented routes (`/es/...`) with `generateStaticParams`, which
 * prerenders each locale instead. That is a routing change rather than a
 * rendering one, and it is tracked separately.
 *
 * Rendering in the right language in one pass was worth more than the
 * prerender: the alternative shows the wrong language to the person least able
 * to read it, then moves the layout under their cursor when JavaScript arrives.
 *
 * The user record's `locale` is deliberately NOT consulted here. It is behind
 * the session, which is behind an httpOnly cookie this layout does not read, and
 * a language that only appears after sign-in would mean the sign-in screen
 * itself is in the wrong one. The provider carries the resolved locale down, and
 * a signed-in user changing their preference writes the cookie.
 */

/** The reader's explicit choice, when they have made one. */
export const LOCALE_COOKIE = 'or_locale';

export async function resolveLocale(): Promise<string> {
  const requestHeaders = await headers();

  const chosen = readLocaleCookie(requestHeaders.get('cookie'));
  if (chosen !== null) return chosen;

  return negotiateLocale(
    requestHeaders.get('accept-language'),
    SUPPORTED_LOCALES,
    appCatalogue.sourceLocale
  );
}

/**
 * Reads the choice cookie, and refuses anything that is not a locale this build
 * carries.
 *
 * The value reaches `<html lang>` and the catalogue lookup, so it is checked
 * against the supported list rather than trusted: a cookie is attacker-writable,
 * and an unchecked one would put arbitrary text into an attribute.
 */
function readLocaleCookie(header: string | null): string | null {
  if (header === null) return null;
  for (const pair of header.split(';')) {
    const [name, ...rest] = pair.trim().split('=');
    if (name !== LOCALE_COOKIE) continue;
    const value = decodeURIComponent(rest.join('='));
    return SUPPORTED_LOCALES.includes(value) ? value : null;
  }
  return null;
}
