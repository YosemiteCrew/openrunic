import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ABSOLUTE_LIFETIME_MS,
  IDLE_TIMEOUT_MS,
  SESSION_COOKIE,
  decodeSessionCookie,
  encodeSessionCookie,
  readSessionPayload,
  startSessionRecord,
} from '@/lib/auth/session';
import type { Identity, SessionRecord } from '@/lib/auth/session';

import { DELETE, GET, POST } from '../session/route';

/**
 * The session endpoint, exercised the way a browser reaches it.
 *
 * These are the moments a clinician notices: a credential accepted or refused,
 * a reload that keeps them signed in, a shift that ends, and a sign out that
 * actually takes the cookie away.
 */

const CLINICIAN: Identity = {
  subject: '01890000-0000-7000-8000-000000000101',
  displayName: 'Dr. Adaeze Okafor',
  roles: ['clinician'],
};

const NOON = Date.parse('2026-08-13T12:00:00Z');

const ENDPOINT = 'http://localhost:3000/session';

function post(body: string): NextRequest {
  return new NextRequest(ENDPOINT, { method: 'POST', body });
}

function get(cookie?: SessionRecord): NextRequest {
  const headers: Record<string, string> =
    cookie === undefined ? {} : { cookie: `${SESSION_COOKIE}=${encodeSessionCookie(cookie)}` };
  return new NextRequest(ENDPOINT, { headers });
}

function cookieFrom(response: Response): SessionRecord | null {
  const header = response.headers.get('set-cookie') ?? '';
  const value = /or_session=([^;]*)/.exec(header)?.[1];
  return decodeSessionCookie(value === '' ? undefined : value);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOON);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('signing in', () => {
  it('accepts a development principal and hands back a session', async () => {
    const response = await POST(post(JSON.stringify({ token: 'dev-clinician-a' })));

    expect(response.status).toBe(200);
    expect(readSessionPayload(await response.json())).toEqual({
      token: 'dev-clinician-a',
      identity: CLINICIAN,
      expiresAt: NOON + ABSOLUTE_LIFETIME_MS,
    });
  });

  it('sets a cookie the next request can be recognised by', async () => {
    const response = await POST(post(JSON.stringify({ token: 'dev-clinician-a' })));

    expect(cookieFrom(response)).toEqual(startSessionRecord('dev-clinician-a', CLINICIAN, NOON));
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
  });

  it('refuses the patient-portal token, because this is the staff EMR', async () => {
    const response = await POST(post(JSON.stringify({ token: 'dev-portal-a' })));

    expect(response.status).toBe(401);
    expect(cookieFrom(response)).toBeNull();
  });

  it('refuses a token nobody issued, without saying which part was wrong', async () => {
    const response = await POST(post(JSON.stringify({ token: 'guessing' })));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'The credential was not accepted.' });
  });

  it('refuses a request that carries no token', async () => {
    expect((await POST(post(JSON.stringify({})))).status).toBe(401);
    expect((await POST(post(JSON.stringify({ token: '' })))).status).toBe(401);
    expect((await POST(post(JSON.stringify({ token: 7 })))).status).toBe(401);
    expect((await POST(post(JSON.stringify('dev-clinician-a')))).status).toBe(401);
  });

  it('refuses a body that is not JSON at all', async () => {
    expect((await POST(post('<html>not json</html>'))).status).toBe(401);
  });
});

describe('reloading a page', () => {
  it('hands the token back so the chart can fetch', () => {
    const response = GET(get(startSessionRecord('dev-clinician-a', CLINICIAN, NOON)));

    expect(response.status).toBe(200);
    expect(cookieFrom(response)?.token).toBe('dev-clinician-a');
  });

  it('re-stamps the idle clock, so the window measures inactivity rather than age', () => {
    const started = startSessionRecord('dev-clinician-a', CLINICIAN, NOON);
    vi.setSystemTime(NOON + 5 * 60 * 1000);

    const refreshed = cookieFrom(GET(get(started)));

    expect(refreshed?.lastSeenAt).toBe(NOON + 5 * 60 * 1000);
    expect(refreshed?.issuedAt).toBe(NOON);
  });

  it('refuses once the workstation has been quiet for the idle window', () => {
    const started = startSessionRecord('dev-clinician-a', CLINICIAN, NOON);
    vi.setSystemTime(NOON + IDLE_TIMEOUT_MS);

    const response = GET(get(started));

    expect(response.status).toBe(401);
    expect(cookieFrom(response)).toBeNull();
  });

  it('refuses at the end of the shift however busy the workstation was', () => {
    const busy = { ...startSessionRecord('dev-clinician-a', CLINICIAN, NOON) };
    vi.setSystemTime(NOON + ABSOLUTE_LIFETIME_MS);

    expect(GET(get({ ...busy, lastSeenAt: NOON + ABSOLUTE_LIFETIME_MS })).status).toBe(401);
  });

  it('refuses when there is no cookie at all', () => {
    expect(GET(get()).status).toBe(401);
  });

  it('refuses a cookie somebody hand-wrote', () => {
    const request = new NextRequest(ENDPOINT, {
      headers: { cookie: `${SESSION_COOKIE}=nonsense` },
    });

    expect(GET(request).status).toBe(401);
  });
});

describe('signing out', () => {
  it('takes the cookie away', () => {
    const response = DELETE();

    expect(response.status).toBe(204);
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(cookieFrom(response)).toBeNull();
  });
});
