import type { NextResponse } from 'next/server';

import { ABSOLUTE_LIFETIME_MS, SESSION_COOKIE } from './session';

/**
 * Writing and clearing the session cookie, in one place so the attributes
 * cannot differ between the handler that sets it and the request proxy that
 * revokes it. A cookie cleared with a different `path` than it was set with is
 * not cleared at all, and the failure is invisible until someone stays signed
 * in after pressing sign out.
 *
 * This module owns the attributes and nothing else. What goes in the value is
 * `lib/auth/seal.ts`'s business, and it takes a key and an await to produce, so
 * a caller hands the sealed string in already made. That keeps the one function
 * that decides `httpOnly` and `SameSite` synchronous and readable at a glance.
 *
 * ## SameSite is Lax, not Strict
 *
 * Strict is the reflex, and it is wrong here. Under Strict the cookie is
 * withheld from every cross-site navigation, so a clinician who opens a chart
 * link a colleague sent them in a message arrives signed out, gets bounced to
 * the sign-in screen, and finds they were signed in all along. Sending links to
 * a chart is a real clinical workflow, and breaking it teaches people to
 * work around the product.
 *
 * Lax still withholds the cookie from cross-site POST, PUT and DELETE, which is
 * the request-forgery case that matters. And the cookie is not a credential for
 * anything that holds records: the API is a separate origin authenticated by a
 * bearer header, so a forged cross-site request that did carry this cookie
 * would reach a Next route handler and no patient data. What it protects is
 * which pages this application agrees to render, and `/session` is the only
 * write it gates.
 */

const SECONDS_PER_MILLISECOND = 1000;

function secure(): boolean {
  // Development runs on http://localhost, where a Secure cookie is simply never
  // sent and the whole session silently fails to exist.
  return process.env.NODE_ENV === 'production';
}

export function applySessionCookie<T>(response: NextResponse<T>, sealed: string): NextResponse<T> {
  response.cookies.set({
    name: SESSION_COOKIE,
    value: sealed,
    httpOnly: true,
    sameSite: 'lax',
    secure: secure(),
    path: '/',
    /* The browser's own expiry matches the absolute lifetime rather than the
       idle timeout, because the idle clock is re-stamped on every refresh and a
       cookie that expired at the idle deadline would sign people out mid-note.
       The idle rule is enforced by reading `lastSeenAt`, not by this. */
    maxAge: Math.floor(ABSOLUTE_LIFETIME_MS / SECONDS_PER_MILLISECOND),
  });
  return response;
}

export function clearSessionCookie<T>(response: NextResponse<T>): NextResponse<T> {
  response.cookies.set({
    name: SESSION_COOKIE,
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    secure: secure(),
    path: '/',
    maxAge: 0,
  });
  return response;
}
