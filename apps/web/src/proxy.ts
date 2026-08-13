import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { clearSessionCookie } from '@/lib/auth/cookie';
import { SIGNED_IN_HOME, SIGN_IN_PATH, isPublicPath, signInQuery } from '@/lib/auth/routes';
import { sessionSealKey, unsealSessionCookie } from '@/lib/auth/seal';
import { SESSION_COOKIE, sessionState } from '@/lib/auth/session';

/**
 * The door. Nothing under a clinical route is served without a live session
 * cookie, and a stale cookie is taken away on the way past.
 *
 * ## What passing this guard establishes, exactly
 *
 * That the browser is carrying a cookie this deployment sealed, whose absolute
 * and idle deadlines have not passed. That is the whole claim. It says nothing
 * about whether the token inside it is still one the API will accept: the API
 * is a separate origin with its own view of that token, it has never seen this
 * deployment's key, and it can revoke or expire a token without anything here
 * hearing about it. A browser can therefore be waved through this door and get
 * a 401 from the first request the screen makes, which is by design - the
 * boundary that protects a record is the API's, and this one is not standing in
 * for it.
 *
 * What this stops is the shape of failure that comes before that: an anonymous
 * browser rendering the chart frame, the rail, the patient banner and a row of
 * error panels, which looks like a broken product and hands the map of the
 * application to anyone who types a URL.
 *
 * The seal is what makes the deadlines worth checking. The cookie used to be
 * plain JSON, so anyone holding it could move its clocks and keep a session
 * alive indefinitely; the comment that used to sit here said editing it could
 * only shorten a session, and that was wrong. `lib/auth/seal.ts` has the rest.
 * A deployment with no key configured seals nothing and recognises nothing, so
 * this door stays shut - the safe way for a misconfiguration to fail.
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

/**
 * A redirect built by editing the request's own parsed URL rather than by
 * joining a string onto it.
 *
 * The difference matters. `new URL(target, request.url)` resolves `target`
 * against the request, so a target that ever began `//` would resolve to
 * another host entirely, and reading the code you would have to go and check
 * every caller to know that it cannot. Here the origin comes from the request
 * and the destination is assigned field by field, so leaving this origin is not
 * something a value can express.
 */
function redirect(request: NextRequest, pathname: string, query = ''): NextResponse {
  const destination = request.nextUrl.clone();
  destination.pathname = pathname;
  destination.search = query;
  return NextResponse.redirect(destination);
}

/**
 * Async because verifying the seal is: `crypto.subtle` has no synchronous form,
 * and it is the one Web Crypto both this file's edge runtime and the route
 * handler's Node runtime have. Next awaits a proxy that returns a promise.
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname, search } = request.nextUrl;
  const key = sessionSealKey();
  const cookie = request.cookies.get(SESSION_COOKIE)?.value;
  const record = key === null ? null : await unsealSessionCookie(cookie, key);
  const live = record !== null && sessionState(record, Date.now()) === 'active';

  if (live) {
    if (pathname === '/' || pathname === SIGN_IN_PATH) {
      return redirect(request, SIGNED_IN_HOME);
    }
    return NextResponse.next();
  }

  if (isPublicPath(pathname)) return NextResponse.next();

  const response = redirect(request, SIGN_IN_PATH, signInQuery(`${pathname}${search}`, 'expired'));

  // A cookie that we sealed ourselves but that had run out is worth removing
  // now, so the next request is honestly anonymous rather than presenting a
  // credential the whole system has already agreed is finished.
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
