import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GET, POST } from '@/app/api/[...path]/route';
import { SESSION_FETCH_HEADER, SESSION_FETCH_MARKER } from '@/lib/auth/routes';
import { sealSessionCookie, sessionSealKey, unsealSessionCookie } from '@/lib/auth/seal';
import { IDLE_TIMEOUT_MS, SESSION_COOKIE, startSessionRecord } from '@/lib/auth/session';

const NOON = Date.parse('2026-09-18T12:00:00Z');
const THREAD_ID = '01890000-0000-7000-8000-000000000401';
const FROM_APP = { [SESSION_FETCH_HEADER]: SESSION_FETCH_MARKER };

type RouteContext = { params: Promise<{ path: string[] }> };

function context(...path: string[]): RouteContext {
  return { params: Promise.resolve({ path }) };
}

async function request(path: string, method = 'GET', body?: string): Promise<NextRequest> {
  const record = startSessionRecord('patient-token', NOON);
  const sealed = await sealSessionCookie(record, sessionSealKey() ?? '');
  return new NextRequest(`http://localhost:3300/api/${path}`, {
    method,
    headers: { ...FROM_APP, cookie: `${SESSION_COOKIE}=${encodeURIComponent(sealed)}` },
    ...(body === undefined ? {} : { body }),
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

describe('the authenticated portal proxy', () => {
  it('forwards an allowlisted read with the sealed bearer token', async () => {
    const platform = vi.fn(() =>
      Promise.resolve(Response.json({ id: 'patient-a' }, { headers: { 'x-upstream': 'hidden' } }))
    );
    vi.stubGlobal('fetch', platform);

    const response = await GET(await request('portal/patient'), context('portal', 'patient'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: 'patient-a' });
    expect(response.headers.get('x-upstream')).toBeNull();
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(platform).toHaveBeenCalledWith(
      new URL('https://api.example.invalid/bff/v0/portal/patient'),
      expect.objectContaining({
        method: 'GET',
        headers: { accept: 'application/json', authorization: 'Bearer patient-token' },
        redirect: 'manual',
      })
    );
  });

  it('touches the idle clock after a successful request', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(Response.json({})))
    );
    vi.setSystemTime(NOON + 5 * 60 * 1000);

    const response = await GET(await request('portal/home'), context('portal', 'home'));
    const sealed = response.cookies.get(SESSION_COOKIE)?.value;

    expect((await unsealSessionCookie(sealed, sessionSealKey() ?? ''))?.lastSeenAt).toBe(
      NOON + 5 * 60 * 1000
    );
  });

  it('forwards only the two allowlisted writes and preserves their bodies', async () => {
    const platform = vi.fn(() => Promise.resolve(Response.json({ ok: true })));
    vi.stubGlobal('fetch', platform);

    const replyBody = JSON.stringify({ body: 'Please call me.' });
    await POST(
      await request(`portal/messages/${THREAD_ID}/replies`, 'POST', replyBody),
      context('portal', 'messages', THREAD_ID, 'replies')
    );
    expect(platform).toHaveBeenLastCalledWith(
      new URL(`https://api.example.invalid/bff/v0/portal/messages/${THREAD_ID}/replies`),
      expect.objectContaining({ method: 'POST', body: replyBody })
    );

    const turnBody = JSON.stringify({ prompt: 'Show my appointments' });
    await POST(
      await request('bff/v0/agent/turns', 'POST', turnBody),
      context('bff', 'v0', 'agent', 'turns')
    );
    expect(platform).toHaveBeenLastCalledWith(
      new URL('https://api.example.invalid/bff/v0/agent/turns'),
      expect.objectContaining({ method: 'POST', body: turnBody })
    );
  });

  it('maps the allowlisted assistant read without a second prefix', async () => {
    const platform = vi.fn(() => Promise.resolve(Response.json([])));
    vi.stubGlobal('fetch', platform);

    await GET(await request('bff/v0/agent/tools'), context('bff', 'v0', 'agent', 'tools'));

    expect(platform).toHaveBeenCalledWith(
      new URL('https://api.example.invalid/bff/v0/agent/tools'),
      expect.anything()
    );
  });

  it('refuses routes and identifiers outside the fixed allowlist', async () => {
    const platform = vi.fn();
    vi.stubGlobal('fetch', platform);

    for (const [method, path] of [
      ['GET', ['admin', 'patients']],
      ['POST', ['portal', 'messages', 'not-a-uuid', 'replies']],
      ['DELETE', ['portal', 'messages', THREAD_ID, 'replies']],
    ] as const) {
      const response =
        method === 'POST'
          ? await POST(await request(path.join('/'), method, '{}'), context(...path))
          : await GET(await request(path.join('/'), method), context(...path));
      expect(response.status).toBe(404);
    }
    expect(platform).not.toHaveBeenCalled();
  });

  it('requires the exact same-origin marker', async () => {
    const sealed = await sealSessionCookie(
      startSessionRecord('patient-token', NOON),
      sessionSealKey() ?? ''
    );
    const noMarker = new NextRequest('http://localhost:3300/api/portal/patient', {
      headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(sealed)}` },
    });
    const wrongMarker = new NextRequest('http://localhost:3300/api/portal/patient', {
      headers: {
        [SESSION_FETCH_HEADER]: 'wrong',
        cookie: `${SESSION_COOKIE}=${encodeURIComponent(sealed)}`,
      },
    });

    expect((await GET(noMarker, context('portal', 'patient'))).status).toBe(403);
    expect((await GET(wrongMarker, context('portal', 'patient'))).status).toBe(403);
  });

  it('clears absent, malformed, and expired sessions', async () => {
    const absent = new NextRequest('http://localhost:3300/api/portal/patient', {
      headers: FROM_APP,
    });
    expect((await GET(absent, context('portal', 'patient'))).status).toBe(401);

    const malformed = new NextRequest('http://localhost:3300/api/portal/patient', {
      headers: { ...FROM_APP, cookie: `${SESSION_COOKIE}=nonsense` },
    });
    expect(
      (await GET(malformed, context('portal', 'patient'))).headers.get('set-cookie')
    ).toContain('Max-Age=0');

    vi.setSystemTime(NOON + IDLE_TIMEOUT_MS);
    expect((await GET(await request('portal/patient'), context('portal', 'patient'))).status).toBe(
      401
    );
  });

  it('reports missing configuration and transport failures without forwarding details', async () => {
    vi.stubEnv('OPENRUNIC_API_URL', '');
    expect((await GET(await request('portal/patient'), context('portal', 'patient'))).status).toBe(
      503
    );

    vi.stubEnv('OPENRUNIC_API_URL', 'https://api.example.invalid');
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('private upstream detail')))
    );
    const response = await GET(await request('portal/patient'), context('portal', 'patient'));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'Portal API is unavailable.' });
  });

  it('clears the session when the upstream rejects its bearer token', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(null, { status: 401 })))
    );

    const response = await GET(await request('portal/patient'), context('portal', 'patient'));

    expect(response.status).toBe(401);
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('fails closed when production has no session key', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SESSION_COOKIE_SECRET', '');
    const response = await GET(
      new NextRequest('http://localhost:3300/api/portal/patient', { headers: FROM_APP }),
      context('portal', 'patient')
    );

    expect(response.status).toBe(503);
  });
});
