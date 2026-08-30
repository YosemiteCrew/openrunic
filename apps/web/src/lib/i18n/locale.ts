import { localeFrom } from '@openrunic/i18n';
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
 * `headers()` opts a route tree into dynamic rendering, which is why this is
 * read by the `(app)` root layout and not by the public one. The four public
 * pages take their locale from the URL instead - `(public)/[locale]` with
 * `generateStaticParams` - so they prerender once per language while every
 * route that could not use a prerender anyway keeps resolving from the request.
 *
 * For the routes that still read this, the cost is close to nothing: they sit
 * behind `SessionGate` and their prerendered output was an empty shell that
 * immediately fetched.
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

/**
 * The reader's language, for a server component.
 *
 * The rule itself is `localeFrom` in `@openrunic/i18n`, which takes two strings
 * and touches no framework. This is the half that cannot be shared: reading the
 * request. The proxy asks the same question from middleware, which cannot call
 * `headers()`, and `apps/portal` asks it for the same reader - a patient who
 * chose Spanish on the public pages has chosen once, not once per application.
 *
 * Two implementations of "what language is this person reading in" would drift,
 * and the first symptom would be a reader redirected to `/es` and then served
 * English.
 */
export async function resolveLocale(): Promise<string> {
  const requestHeaders = await headers();
  return localeFrom(requestHeaders.get('cookie'), requestHeaders.get('accept-language'));
}

export { LOCALE_COOKIE, localeFrom, readLocaleCookie } from '@openrunic/i18n';
