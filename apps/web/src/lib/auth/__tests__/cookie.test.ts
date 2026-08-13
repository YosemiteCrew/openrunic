import { NextRequest, NextResponse } from 'next/server';
import { describe, expect, it } from 'vitest';

import { applySessionCookie, clearSessionCookie } from '@/lib/auth/cookie';
import { sealSessionCookie, sessionSealKey, unsealSessionCookie } from '@/lib/auth/seal';
import { ABSOLUTE_LIFETIME_MS, SESSION_COOKIE, startSessionRecord } from '@/lib/auth/session';
import type { Identity, SessionRecord } from '@/lib/auth/session';

const CLINICIAN: Identity = {
  subject: '01890000-0000-7000-8000-000000000101',
  displayName: 'Dr. Adaeze Okafor',
  roles: ['clinician'],
};

const RECORD = startSessionRecord('dev-clinician-a', CLINICIAN, Date.parse('2026-08-13T12:00:00Z'));

function key(): string {
  return sessionSealKey() ?? '';
}

async function written(record: SessionRecord = RECORD): Promise<NextResponse> {
  return applySessionCookie(NextResponse.json({}), await sealSessionCookie(record, key()));
}

function setCookieHeader(response: NextResponse): string {
  return response.headers.get('set-cookie') ?? '';
}

/** The cookie as a browser would send it back, header and all. */
function sentBack(header: string): NextRequest {
  return new NextRequest('http://localhost:3000/patients', {
    headers: { cookie: header.split(';')[0] ?? '' },
  });
}

describe('writing the session cookie', () => {
  it('keeps the value out of document.cookie, which is not the same as out of reach', async () => {
    // What HttpOnly buys is that page script cannot read the cookie as a
    // cookie. It does not put the session beyond script's reach: anything
    // running on this origin can call `/session` and be handed the token, the
    // same way the application does. So this asserts the flag and not the
    // stronger claim the flag is usually credited with.
    expect(setCookieHeader(await written())).toContain('HttpOnly');
  });

  it('withholds itself from cross-site writes without breaking a link into a chart', async () => {
    // Strict would refuse the cookie on any cross-site navigation, so a chart
    // link a colleague sent would arrive signed out. Lax still withholds it
    // from cross-site POST, PUT and DELETE, which is the case that matters.
    expect(setCookieHeader(await written())).toContain('SameSite=lax');
  });

  it('applies to the whole application, so signing out on one screen signs out on all', async () => {
    expect(setCookieHeader(await written())).toContain('Path=/');
  });

  it('expires in the browser on the absolute deadline, not on the idle one', async () => {
    // A cookie that expired at the idle deadline would sign people out
    // mid-note; the idle rule is enforced by reading `lastSeenAt` instead.
    expect(setCookieHeader(await written())).toContain(`Max-Age=${ABSOLUTE_LIFETIME_MS / 1000}`);
  });

  it('carries a session the next request can read back', async () => {
    const response = await written();

    expect(await unsealSessionCookie(response.cookies.get(SESSION_COOKIE)?.value, key())).toEqual(
      RECORD
    );
  });

  it('survives the header a browser actually sends it back in', async () => {
    // The whole path, because the middle of it is where this went wrong: the
    // platform percent-encodes on the way into `Set-Cookie` and decodes on the
    // way out of `Cookie`, so a value escaped here too came back escaped once
    // and every session ended at the first reload.
    const next = sentBack(setCookieHeader(await written()));

    expect(await unsealSessionCookie(next.cookies.get(SESSION_COOKIE)?.value, key())).toEqual(
      RECORD
    );
  });

  it('survives a name that is not plain ASCII travelling the same path', async () => {
    const record = { ...RECORD, identity: { ...CLINICIAN, displayName: 'Dr. Ingrid Sjöberg' } };
    const next = sentBack(setCookieHeader(await written(record)));

    expect(
      (await unsealSessionCookie(next.cookies.get(SESSION_COOKIE)?.value, key()))?.identity
        .displayName
    ).toBe('Dr. Ingrid Sjöberg');
  });

  it('is not marked Secure in development, where the app is served over http', async () => {
    // A Secure cookie on http://localhost is simply never sent, and the whole
    // session silently fails to exist.
    expect(setCookieHeader(await written())).not.toContain('Secure');
  });
});

describe('clearing the session cookie', () => {
  it('empties it immediately, on the same path it was written to', () => {
    const header = setCookieHeader(clearSessionCookie(NextResponse.json({})));

    expect(header).toContain(`${SESSION_COOKIE}=`);
    expect(header).toContain('Max-Age=0');
    expect(header).toContain('Path=/');
  });

  it('leaves nothing a later request could read', async () => {
    const response = clearSessionCookie(NextResponse.json({}));

    expect(
      await unsealSessionCookie(response.cookies.get(SESSION_COOKIE)?.value, key())
    ).toBeNull();
  });
});
