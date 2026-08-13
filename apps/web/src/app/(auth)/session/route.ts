import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { applySessionCookie, clearSessionCookie } from '@/lib/auth/cookie';
import { identityForAccessToken } from '@/lib/auth/credentials';
import {
  SESSION_COOKIE,
  decodeSessionCookie,
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
 * becomes a cookie. GET is a page load asking for its token back, and it is
 * where the idle and absolute deadlines are actually enforced, because a check
 * on the server is a rule and a timer in a tab is advice. DELETE is signing
 * out.
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

/** Deliberately incurious about which part was wrong. */
const REFUSAL = { error: 'The credential was not accepted.' } as const;

function refuse(): NextResponse {
  return clearSessionCookie(NextResponse.json(REFUSAL, { status: UNAUTHENTICATED }));
}

function readSubmittedToken(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const token = (body as { token?: unknown }).token;
  return typeof token === 'string' && token !== '' ? token : null;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
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
  return applySessionCookie(NextResponse.json(toSession(record)), record);
}

export function GET(request: NextRequest): NextResponse {
  const record = decodeSessionCookie(request.cookies.get(SESSION_COOKIE)?.value);
  if (record === null) return refuse();

  const now = Date.now();
  if (sessionState(record, now) !== 'active') return refuse();

  // Re-stamped on every page load, which is what makes the idle window a window
  // of inactivity rather than a countdown from signing in.
  const refreshed = touchSessionRecord(record, now);
  return applySessionCookie(NextResponse.json(toSession(refreshed)), refreshed);
}

export function DELETE(): NextResponse {
  return clearSessionCookie(new NextResponse(null, { status: 204 }));
}
