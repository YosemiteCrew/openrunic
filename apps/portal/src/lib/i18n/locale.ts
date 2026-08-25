import { localeFrom } from '@openrunic/i18n';
import { headers } from 'next/headers';

/**
 * The reader's language, for a server component.
 *
 * The rule is `localeFrom` in `@openrunic/i18n`, shared with `apps/web` and its
 * proxy. This is the half that cannot be shared, because it reads the request.
 *
 * Sharing it is not tidiness. A patient who chose Spanish on the public pages
 * and then signed in to look at their own record has chosen once, and the cookie
 * that carries the choice is the same cookie. A second implementation here would
 * be a second place for the validation on that cookie to be dropped, and its
 * value reaches `<html lang>`.
 */
export async function resolveLocale(): Promise<string> {
  const requestHeaders = await headers();
  return localeFrom(requestHeaders.get('cookie'), requestHeaders.get('accept-language'));
}
