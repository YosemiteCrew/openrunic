import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { applySessionCookie, clearSessionCookie } from '@/lib/auth/cookie';
import { identityForAccessToken } from '@/lib/auth/credentials';
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

export function DELETE(): NextResponse {
  return clearSessionCookie(new NextResponse(null, { status: 204 }));
}
