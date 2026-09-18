import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DELETE, GET, POST } from '@/app/api/session/route';
import { SESSION_FETCH_HEADER, SESSION_FETCH_MARKER } from '@/lib/auth/routes';
import { sealSessionCookie, sessionSealKey, unsealSessionCookie } from '@/lib/auth/seal';
import {
  ABSOLUTE_LIFETIME_MS,
  IDLE_TIMEOUT_MS,
  SESSION_COOKIE,
  startSessionRecord,
} from '@/lib/auth/session';

const NOON = Date.parse('2026-09-18T12:00:00Z');
const ENDPOINT = 'http://localhost:3300/api/session';
const FROM_APP = { [SESSION_FETCH_HEADER]: SESSION_FETCH_MARKER };

function request(
  init: { method?: string; body?: BodyInit; headers?: HeadersInit } = {}
): NextRequest {
  return new NextRequest(ENDPOINT, {
    method: init.method,
    body: init.body,
    headers: { ...FROM_APP, ...init.headers },
  });
}

async function sessionRequest(
  record = startSessionRecord('patient-token', NOON)
): Promise<NextRequest> {
  const sealed = await sealSessionCookie(record, sessionSealKey() ?? '');
  return request({ headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(sealed)}` } });
}

async function responseRecord(response: Response) {
  const header = response.headers.get('set-cookie') ?? '';
  const value = new RegExp(`${SESSION_COOKIE}=([^;]*)`).exec(header)?.[1];
  return value === undefined || value === ''
    ? null
    : unsealSessionCookie(decodeURIComponent(value), sessionSealKey() ?? '');
}

function acceptedPatient(): Response {
  return Response.json({
    id: '01890000-0000-7000-8000-000000000301',
    name: 'Testina Patientsson',
    mrn: 'OR-100482',
    dateOfBirth: '1984-03-11',
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOON);
  vi.stubEnv('OPENRUNIC_API_URL', 'https://api.example.invalid');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('POST /api/session', () => {
  it('accepts a token only after the patient endpoint names a patient', async () => {
    const platform = vi.fn(() => Promise.resolve(acceptedPatient()));
    vi.stubGlobal('fetch', platform);

    const response = await POST(
      request({ method: 'POST', body: JSON.stringify({ token: 'patient-token' }) })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      expiresAt: NOON + ABSOLUTE_LIFETIME_MS,
      idleExpiresAt: NOON + IDLE_TIMEOUT_MS,
    });
    expect(await responseRecord(response)).toEqual(startSessionRecord('patient-token', NOON));
    expect(platform).toHaveBeenCalledWith(
      new URL('https://api.example.invalid/bff/v0/portal/patient'),
      expect.objectContaining({
        headers: { accept: 'application/json', authorization: 'Bearer patient-token' },
        redirect: 'manual',
      })
    );
  });

  it.each([401, 403])('rejects a token the API answers with %s', async (status) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(null, { status })))
    );

    const response = await POST(
      request({ method: 'POST', body: JSON.stringify({ token: 'wrong' }) })
    );

    expect(response.status).toBe(401);
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('rejects malformed, empty, and non-JSON request bodies', async () => {
    for (const body of [
      JSON.stringify({}),
      JSON.stringify({ token: '' }),
      JSON.stringify({ token: 'x'.repeat(3073) }),
      '<not-json>',
    ]) {
      expect((await POST(request({ method: 'POST', body }))).status).toBe(401);
    }
  });

  it('reports unavailable when the API fails or returns an invalid patient', async () => {
    for (const outcome of [
      () => Promise.reject(new Error('offline')),
      () => Promise.resolve(new Response(null, { status: 500 })),
      () => Promise.resolve(Response.json({ id: 'patient-only' })),
      () => Promise.resolve(new Response('<html>')),
    ]) {
      vi.stubGlobal('fetch', vi.fn(outcome));
      const response = await POST(
        request({ method: 'POST', body: JSON.stringify({ token: 'patient-token' }) })
      );
      expect(response.status).toBe(503);
    }
  });

  it('refuses missing and incorrect application markers', async () => {
    const body = JSON.stringify({ token: 'patient-token' });
    expect((await POST(new NextRequest(ENDPOINT, { method: 'POST', body }))).status).toBe(403);
    expect(
      (
        await POST(
          new NextRequest(ENDPOINT, {
            method: 'POST',
            body,
            headers: { [SESSION_FETCH_HEADER]: 'wrong' },
          })
        )
      ).status
    ).toBe(403);
  });

  it('fails closed when production has no session key', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SESSION_COOKIE_SECRET', '');

    expect(
      (await POST(request({ method: 'POST', body: JSON.stringify({ token: 'patient-token' }) })))
        .status
    ).toBe(503);
  });
});

describe('GET /api/session', () => {
  it('refreshes the idle clock without moving the absolute deadline', async () => {
    const started = startSessionRecord('patient-token', NOON);
    vi.setSystemTime(NOON + 5 * 60 * 1000);

    const response = await GET(await sessionRequest(started));
    const refreshed = await responseRecord(response);

    expect(response.status).toBe(200);
    expect(refreshed).toEqual({ ...started, lastSeenAt: NOON + 5 * 60 * 1000 });
  });

  it('refuses absent, malformed, idle, and absolutely expired sessions', async () => {
    expect((await GET(request())).status).toBe(401);
    expect(
      (
        await GET(
          request({ headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent('nonsense')}` } })
        )
      ).status
    ).toBe(401);

    vi.setSystemTime(NOON + IDLE_TIMEOUT_MS);
    expect((await GET(await sessionRequest())).status).toBe(401);

    vi.setSystemTime(NOON + ABSOLUTE_LIFETIME_MS);
    expect(
      (
        await GET(
          await sessionRequest({
            ...startSessionRecord('patient-token', NOON),
            lastSeenAt: NOON + ABSOLUTE_LIFETIME_MS,
          })
        )
      ).status
    ).toBe(401);
  });

  it('does not refresh without the exact application marker', async () => {
    const sealed = await sealSessionCookie(
      startSessionRecord('patient-token', NOON),
      sessionSealKey() ?? ''
    );
    const response = await GET(
      new NextRequest(ENDPOINT, {
        headers: {
          [SESSION_FETCH_HEADER]: 'wrong',
          cookie: `${SESSION_COOKIE}=${encodeURIComponent(sealed)}`,
        },
      })
    );

    expect(response.status).toBe(403);
    expect(response.headers.get('set-cookie')).toBeNull();
  });
});

describe('DELETE /api/session', () => {
  it('clears the cookie for an application request', () => {
    const response = DELETE(request({ method: 'DELETE' }));

    expect(response.status).toBe(204);
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('refuses a cross-site sign-out request', () => {
    expect(DELETE(new NextRequest(ENDPOINT, { method: 'DELETE' })).status).toBe(403);
  });
});
