import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { clearSessionCookie } from '@/lib/auth/cookie';
import { SIGNED_IN_HOME, SIGN_IN_PATH, isPublicPath, signInUrl } from '@/lib/auth/routes';
import { SESSION_COOKIE, decodeSessionCookie, sessionState } from '@/lib/auth/session';

/**
 * The door. Nothing under a clinical route is served without a live session
 * cookie, and a stale cookie is taken away on the way past.
 *
 * This is not where a record is protected - the API verifies the bearer token
 * on every request and answers 401 without one, which is the boundary that
 * actually holds. What this stops is the shape of failure that comes before
 * that: an anonymous browser rendering the chart frame, the rail, the patient
 * banner and a row of error panels, which looks like a broken product and leaks
 * the map of the application to anyone who types a URL.
 *
 * The cookie is only read here, never trusted for anything but "should this
 * page render". Its contents are client-editable (see `lib/auth/session.ts`),
 * and editing them can shorten a session but cannot lengthen one, because a
 * token the API rejects is a 401 whatever the cookie claims.
 *
 * Two redirects rather than one, because there are two wrong places to be.
 * Someone without a session on a clinical route is sent to sign in, carrying
 * where they were headed. Someone with a session asking for the marketing home
 * is sent to the schedule: `/` is the project's public front door and stays
 * that way, but a browser holding a live staff session did not come for the
 * brochure.
 *
 * ## Where this file has to live, which is not obvious
 *
 * `src/proxy.ts`, and both halves of that were found by testing rather than by
 * reading. Next 16 renamed the `middleware` convention to `proxy` and warns at
 * build time about the old spelling. And because this application keeps its
 * routes under `src/app`, the file has to sit beside them in `src/`: at the
 * package root, `next dev` never loads it at all. It does not warn, it does not
 * error, it simply serves every clinical route to anyone who asks, which is the
 * worst way for a guard to fail. There is a request-level test for exactly that
 * in `src/__tests__/proxy.test.ts`, so a future move breaks a test rather than
 * quietly reopening the door.
 */

export function proxy(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;
  const cookie = request.cookies.get(SESSION_COOKIE)?.value;
  const record = decodeSessionCookie(cookie);
  const live = record !== null && sessionState(record, Date.now()) === 'active';

  if (live) {
    if (pathname === '/' || pathname === SIGN_IN_PATH) {
      return NextResponse.redirect(new URL(SIGNED_IN_HOME, request.url));
    }
    return NextResponse.next();
  }

  if (isPublicPath(pathname)) return NextResponse.next();

  const response = NextResponse.redirect(
    new URL(signInUrl(`${pathname}${search}`, 'expired'), request.url)
  );

  // A cookie that decoded but had run out is worth removing now, so the next
  // request is honestly anonymous rather than presenting a credential the whole
  // system has already agreed is finished.
  return record === null ? response : clearSessionCookie(response);
}

export const config = {
  /**
   * Everything except Next's own build output, the public asset folder and the
   * metadata files a crawler fetches from the root. Written as one exclusion
   * rather than a list of protected prefixes on purpose: a matcher that names
   * the areas to guard protects exactly the areas somebody remembered, and the
   * route this misses is the route nobody thought about.
   */
  matcher: ['/((?!_next/static|_next/image|assets|fonts|favicon.ico|robots.txt|sitemap.xml).*)'],
};
