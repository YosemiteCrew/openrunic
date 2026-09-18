import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sealSessionCookie, sessionSealKey } from '@/lib/auth/seal';
import { IDLE_TIMEOUT_MS, SESSION_COOKIE, startSessionRecord } from '@/lib/auth/session';

const mode = vi.hoisted(() => ({ live: true }));

vi.mock('@/lib/api/config', () => ({ isLiveMode: () => mode.live }));

import { config, proxy } from '../proxy';

const NOON = Date.parse('2026-09-18T12:00:00Z');

async function request(path: string, cookie?: string): Promise<NextRequest> {
  return new NextRequest(`http://localhost:3300${path}`, {
    headers:
      cookie === undefined ? {} : { cookie: `${SESSION_COOKIE}=${encodeURIComponent(cookie)}` },
  });
}

async function activeRequest(path: string): Promise<NextRequest> {
  const sealed = await sealSessionCookie(
    startSessionRecord('patient-token', NOON),
    sessionSealKey() ?? ''
  );
  return request(path, sealed);
}

function destination(response: Response): string | null {
  const location = response.headers.get('location');
  if (location === null) return null;
  const url = new URL(location);
  expect(url.origin).toBe('http://localhost:3300');
  return `${url.pathname}${url.search}`;
}

beforeEach(() => {
  mode.live = true;
  vi.useFakeTimers();
  vi.setSystemTime(NOON);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('portal route guard', () => {
  it('does nothing in mock mode', async () => {
    mode.live = false;
    expect(destination(await proxy(await request('/health-record')))).toBeNull();
  });

  it('sends an anonymous reader to sign in and preserves their exact local page', async () => {
    const response = await proxy(await request('/messages?thread=one'));

    expect(response.status).toBe(307);
    expect(destination(response)).toBe('/sign-in?next=%2Fmessages%3Fthread%3Done&reason=expired');
  });

  it('keeps the sign-in page public', async () => {
    expect(destination(await proxy(await request('/sign-in?reason=idle')))).toBeNull();
  });

  it('admits an active session and keeps it away from sign in', async () => {
    expect(destination(await proxy(await activeRequest('/health-record')))).toBeNull();
    expect(destination(await proxy(await activeRequest('/sign-in')))).toBe('/');
  });

  it('clears both expired and malformed cookies before redirecting', async () => {
    vi.setSystemTime(NOON + IDLE_TIMEOUT_MS);
    const expired = await proxy(await activeRequest('/health-record'));
    const malformed = await proxy(await request('/health-record', 'hand-written-cookie'));

    expect(expired.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(malformed.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('leaves an anonymous browser with no cookie to clear', async () => {
    expect((await proxy(await request('/health-record'))).headers.get('set-cookie')).toBeNull();
  });

  it('excludes API and asset paths from the framework matcher', () => {
    expect(config.matcher[0]).toContain('api|_next/static|_next/image|assets|fonts');
  });
});
