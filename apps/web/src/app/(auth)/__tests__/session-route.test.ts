import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sealSessionCookie, sessionSealKey, unsealSessionCookie } from '@/lib/auth/seal';
import {
  ABSOLUTE_LIFETIME_MS,
  IDLE_TIMEOUT_MS,
  SESSION_COOKIE,
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

/**
 * A request carrying the cookie the way a browser sends it: percent-encoded,
 * because that is what the platform put in `Set-Cookie` and what it decodes
 * again on the way out of `NextRequest.cookies`.
 */
async function get(cookie?: SessionRecord): Promise<NextRequest> {
  const sealed = cookie === undefined ? undefined : await sealSessionCookie(cookie, key());
  const headers: Record<string, string> =
    sealed === undefined ? {} : { cookie: `${SESSION_COOKIE}=${encodeURIComponent(sealed)}` };
  return new NextRequest(ENDPOINT, { headers });
}

function key(): string {
  return sessionSealKey() ?? '';
}

/** The session a response asks the browser to keep, read off the wire. */
async function cookieFrom(response: Response): Promise<SessionRecord | null> {
  const header = response.headers.get('set-cookie') ?? '';
  const value = /or_session=([^;]*)/.exec(header)?.[1];
  if (value === undefined || value === '') return null;
  return unsealSessionCookie(decodeURIComponent(value), key());
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

    expect(await cookieFrom(response)).toEqual(
      startSessionRecord('dev-clinician-a', CLINICIAN, NOON)
    );
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
  });

  it('refuses the patient-portal token, because this is the staff EMR', async () => {
    const response = await POST(post(JSON.stringify({ token: 'dev-portal-a' })));

    expect(response.status).toBe(401);
    expect(await cookieFrom(response)).toBeNull();
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
  it('hands the token back so the chart can fetch', async () => {
    const response = await GET(await get(startSessionRecord('dev-clinician-a', CLINICIAN, NOON)));

    expect(response.status).toBe(200);
    expect((await cookieFrom(response))?.token).toBe('dev-clinician-a');
  });

  it('re-stamps the idle clock, so the window measures inactivity rather than age', async () => {
    const started = startSessionRecord('dev-clinician-a', CLINICIAN, NOON);
    vi.setSystemTime(NOON + 5 * 60 * 1000);

    const refreshed = await cookieFrom(await GET(await get(started)));

    expect(refreshed?.lastSeenAt).toBe(NOON + 5 * 60 * 1000);
    expect(refreshed?.issuedAt).toBe(NOON);
  });

  it('refuses once the workstation has been quiet for the idle window', async () => {
    const started = startSessionRecord('dev-clinician-a', CLINICIAN, NOON);
    vi.setSystemTime(NOON + IDLE_TIMEOUT_MS);

    const response = await GET(await get(started));

    expect(response.status).toBe(401);
    expect(await cookieFrom(response)).toBeNull();
  });

  it('refuses at the end of the shift however busy the workstation was', async () => {
    const busy = { ...startSessionRecord('dev-clinician-a', CLINICIAN, NOON) };
    vi.setSystemTime(NOON + ABSOLUTE_LIFETIME_MS);

    expect(
      (await GET(await get({ ...busy, lastSeenAt: NOON + ABSOLUTE_LIFETIME_MS }))).status
    ).toBe(401);
  });

  it('refuses when there is no cookie at all', async () => {
    expect((await GET(await get())).status).toBe(401);
  });

  it('refuses a cookie somebody hand-wrote', async () => {
    const request = new NextRequest(ENDPOINT, {
      headers: { cookie: `${SESSION_COOKIE}=nonsense` },
    });

    expect((await GET(request)).status).toBe(401);
  });
});

describe('keeping a session alive while somebody works', () => {
  it('moves the idle clock forward without moving the shift deadline', async () => {
    const started = startSessionRecord('dev-clinician-a', CLINICIAN, NOON);

    // Four keep-alives across an hour, each one arriving before the previous
    // window closed, which is what a clinician at a keyboard produces.
    let cookie = started;
    for (let quarter = 1; quarter <= 4; quarter += 1) {
      vi.setSystemTime(NOON + quarter * 14 * 60 * 1000);
      cookie = (await cookieFrom(await GET(await get(cookie)))) ?? started;
    }

    expect(cookie.lastSeenAt).toBe(NOON + 4 * 14 * 60 * 1000);
    expect(cookie.issuedAt).toBe(NOON);
  });

  it('cannot revive a session the idle window has already ended', async () => {
    // The keep-alive checks the deadlines before it stamps, so arriving late
    // with a valid cookie ends the session rather than extending it.
    const started = startSessionRecord('dev-clinician-a', CLINICIAN, NOON);
    vi.setSystemTime(NOON + IDLE_TIMEOUT_MS + 1);

    expect((await GET(await get(started))).status).toBe(401);
  });
});

describe('a deployment with no session key configured', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SESSION_COOKIE_SECRET', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('says the server is not ready rather than blaming the credential', async () => {
    // 401 would send whoever is debugging this to look at the token. The
    // credential is not the problem; the deployment is.
    const response = await POST(post(JSON.stringify({ token: 'dev-clinician-a' })));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: 'This deployment has no session key configured.',
    });
  });

  it('says the same to a page asking for its token back', async () => {
    expect((await GET(new NextRequest(ENDPOINT))).status).toBe(503);
  });
});

describe('signing out', () => {
  it('takes the cookie away', async () => {
    const response = DELETE();

    expect(response.status).toBe(204);
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(await cookieFrom(response)).toBeNull();
  });
});
