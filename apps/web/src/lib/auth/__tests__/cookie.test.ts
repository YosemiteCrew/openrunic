import { NextResponse } from 'next/server';
import { describe, expect, it } from 'vitest';

import { applySessionCookie, clearSessionCookie } from '@/lib/auth/cookie';
import {
  ABSOLUTE_LIFETIME_MS,
  SESSION_COOKIE,
  decodeSessionCookie,
  startSessionRecord,
} from '@/lib/auth/session';
import type { Identity } from '@/lib/auth/session';

const CLINICIAN: Identity = {
  subject: '01890000-0000-7000-8000-000000000101',
  displayName: 'Dr. Adaeze Okafor',
  roles: ['clinician'],
};

const RECORD = startSessionRecord('dev-clinician-a', CLINICIAN, Date.parse('2026-08-13T12:00:00Z'));

function setCookieHeader(response: NextResponse): string {
  return response.headers.get('set-cookie') ?? '';
}

describe('writing the session cookie', () => {
  it('keeps the token out of reach of page script', () => {
    const header = setCookieHeader(applySessionCookie(NextResponse.json({}), RECORD));

    expect(header).toContain('HttpOnly');
  });

  it('withholds itself from cross-site writes without breaking a link into a chart', () => {
    // Strict would refuse the cookie on any cross-site navigation, so a chart
    // link a colleague sent would arrive signed out. Lax still withholds it
    // from cross-site POST, PUT and DELETE, which is the case that matters.
    const header = setCookieHeader(applySessionCookie(NextResponse.json({}), RECORD));

    expect(header).toContain('SameSite=lax');
  });

  it('applies to the whole application, so signing out on one screen signs out on all', () => {
    const header = setCookieHeader(applySessionCookie(NextResponse.json({}), RECORD));

    expect(header).toContain('Path=/');
  });

  it('expires in the browser on the absolute deadline, not on the idle one', () => {
    // A cookie that expired at the idle deadline would sign people out
    // mid-note; the idle rule is enforced by reading `lastSeenAt` instead.
    const header = setCookieHeader(applySessionCookie(NextResponse.json({}), RECORD));

    expect(header).toContain(`Max-Age=${ABSOLUTE_LIFETIME_MS / 1000}`);
  });

  it('carries a session the next request can read back', () => {
    const response = applySessionCookie(NextResponse.json({}), RECORD);

    expect(decodeSessionCookie(response.cookies.get(SESSION_COOKIE)?.value)).toEqual(RECORD);
  });

  it('is not marked Secure in development, where the app is served over http', () => {
    // A Secure cookie on http://localhost is simply never sent, and the whole
    // session silently fails to exist.
    const header = setCookieHeader(applySessionCookie(NextResponse.json({}), RECORD));

    expect(header).not.toContain('Secure');
  });
});

describe('clearing the session cookie', () => {
  it('empties it immediately, on the same path it was written to', () => {
    const header = setCookieHeader(clearSessionCookie(NextResponse.json({})));

    expect(header).toContain(`${SESSION_COOKIE}=`);
    expect(header).toContain('Max-Age=0');
    expect(header).toContain('Path=/');
  });

  it('leaves nothing a later request could decode', () => {
    const response = clearSessionCookie(NextResponse.json({}));

    expect(decodeSessionCookie(response.cookies.get(SESSION_COOKIE)?.value)).toBeNull();
  });
});
