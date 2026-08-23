import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { applySessionCookie, clearSessionCookie } from '@/lib/auth/cookie';
import { identityForAccessToken } from '@/lib/auth/credentials';
import { SESSION_FETCH_HEADER } from '@/lib/auth/routes';
import { sealSessionCookie, sessionSealKey, unsealSessionCookie } from '@/lib/auth/seal';
import {
  SESSION_COOKIE,
  sessionState,
  startSessionRecord,
  toSession,
  touchSessionRecord,
} from '@/lib/auth/session';

/**
 * The session endpoint: the only thing in this application that touches the
 * session cookie, and the seam the real identity provider arrives through.
 *
 * Three verbs, three moments. POST is signing in, and it is where a credential
 * becomes a cookie. GET is a tab asking for its token back and for its idle
 * clock to be re-stamped, and it is where both deadlines are actually enforced,
 * because a check on the server is a rule and a timer in a tab is advice.
 * DELETE is signing out.
 *
 * GET and POST additionally require the header `lib/auth/routes.ts` names,
 * which is how the route knows a request came from this application's own code
 * rather than from a page a clinician was sent to. GET is the one that needs
 * it: it re-stamps the idle clock, and the cookie is `SameSite=Lax`, so a
 * cross-site top-level navigation carries it.
 *
 * When OIDC lands, POST becomes a redirect to the provider plus a callback that
 * exchanges an authorization code, and GET becomes a refresh-token exchange
 * against the provider's token endpoint. Both of those need a client secret,
 * which is precisely why this is a route handler and not a function in the
 * browser bundle. Nothing that calls these three verbs has to change.
 *
 * Every successful answer hands the token to the browser in the response body.
 * That is the deliberate handoff described in `lib/auth/session.ts`: the data
 * layer attaches a bearer header synchronously on every request, so the token
 * has to reach memory, and this is the one place it crosses over.
 *
 * There is no rate limit on POST. The credentials it checks are the API's
 * public development fixtures, so there is nothing here to guess; a limiter
 * becomes a requirement in the same change that makes this verify a real
 * secret.
 */

const UNAUTHENTICATED = 401;

const FORBIDDEN = 403;

/** A request that did not come from this application's own code. */
const NOT_OUR_REQUEST = {
  error: 'This endpoint is called by the application, not navigated to.',
} as const;

/**
 * Whether this request was made by script on this origin.
 *
 * `GET /session` re-stamps the idle clock, which is a state change behind a safe
 * method, and the session cookie is `SameSite=Lax` - which browsers send on a
 * cross-site top-level NAVIGATION. A page a signed-in clinician visits could
 * therefore open a window, point it here every few minutes, and hold the session
 * open to its twelve-hour ceiling, defeating the fifteen-minute
 * unattended-workstation control entirely. Same-origin policy stops the attacker
 * READING the token out of that window; it never stopped the server acting on
 * the cookie.
 *
 * The check is the presence of a header, because a navigation cannot set one and
 * a cross-origin `fetch` that tries is stopped by a preflight this route does not
 * answer. `Origin` would not do: browsers omit it on a same-origin GET, so there
 * would be nothing to compare against.
 */
function fromApplication(request: NextRequest): boolean {
  return request.headers.get(SESSION_FETCH_HEADER) !== null;
}

function notOurRequest(): NextResponse {
  // Deliberately not `clearSessionCookie`: this request proves nothing about the
  // session, and clearing on it would let any page a clinician visits sign them
  // out - trading one cross-site effect for another.
  return NextResponse.json(NOT_OUR_REQUEST, { status: FORBIDDEN });
}

const MISCONFIGURED = 503;

/** Deliberately incurious about which part was wrong. */
const REFUSAL = { error: 'The credential was not accepted.' } as const;

/**
 * The one refusal that is not about the caller.
 *
 * A deployment with no `SESSION_COOKIE_SECRET` cannot seal a cookie, so it
 * cannot hold a session at all. Answering 401 would blame the credential for a
 * server's missing configuration and send whoever is debugging it to look at
 * the wrong end; 503 says the truth, which is that this server is not in a
 * state to sign anybody in.
 */
const UNSEALABLE = { error: 'This deployment has no session key configured.' } as const;

function refuse(): NextResponse {
  return clearSessionCookie(NextResponse.json(REFUSAL, { status: UNAUTHENTICATED }));
}

function unsealable(): NextResponse {
  return clearSessionCookie(NextResponse.json(UNSEALABLE, { status: MISCONFIGURED }));
}

function readSubmittedToken(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const token = (body as { token?: unknown }).token;
  return typeof token === 'string' && token !== '' ? token : null;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  // POST is not reachable by navigation, but it mints the cookie, so the same
  // proof is asked of it: a marker that some calls carry and others do not is
  // one somebody eventually drops from the call that needed it.
  if (!fromApplication(request)) return notOurRequest();

  const key = sessionSealKey();
  if (key === null) return unsealable();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return refuse();
  }

  const token = readSubmittedToken(body);
  if (token === null) return refuse();

  const identity = identityForAccessToken(token, process.env.NODE_ENV);
  if (identity === null) return refuse();

  const record = startSessionRecord(token, identity, Date.now());
  return applySessionCookie(
    NextResponse.json(toSession(record)),
    await sealSessionCookie(record, key)
  );
}

/**
 * A page load asking for its token back, and a working tab asking for its idle
 * clock to be re-stamped. They are the same request, deliberately.
 *
 * The tab calls this while somebody is at the keyboard (`lib/auth/idle.ts`),
 * which is what makes `lastSeenAt` mean "last seen" rather than "last loaded".
 * Both deadlines are checked before the stamp is moved, so a keep-alive can
 * only refresh a session that is still live: it can never revive one the idle
 * window or the shift has already ended.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  // Before the cookie is read at all, because the cookie is the thing a
  // cross-site navigation brings with it.
  if (!fromApplication(request)) return notOurRequest();

  const key = sessionSealKey();
  if (key === null) return unsealable();

  const record = await unsealSessionCookie(request.cookies.get(SESSION_COOKIE)?.value, key);
  if (record === null) return refuse();

  const now = Date.now();
  if (sessionState(record, now) !== 'active') return refuse();

  const refreshed = touchSessionRecord(record, now);
  return applySessionCookie(
    NextResponse.json(toSession(refreshed)),
    await sealSessionCookie(refreshed, key)
  );
}

/**
 * Signing out. Deliberately still answered for a request with no marker.
 *
 * The failure mode here is the opposite of GET's: a sign-out that is refused
 * leaves somebody signed in, and a cross-site request that signs a clinician out
 * is a nuisance rather than a breach. A browser cannot navigate with DELETE
 * anyway, and a cross-origin `fetch` that tries is stopped by a preflight this
 * route does not answer.
 */
export function DELETE(): NextResponse {
  return clearSessionCookie(new NextResponse(null, { status: 204 }));
}
