import { NextResponse } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { endSession, landingPath, restoreSession, signIn } from '../client';
import { applySessionCookie, clearSessionCookie } from '../cookie';
import { SESSION_FETCH_HEADER, SESSION_FETCH_MARKER, safeReturnPath, signInUrl } from '../routes';
import { sealSessionCookie, sessionSealKey, unsealSessionCookie } from '../seal';
import {
  ABSOLUTE_LIFETIME_MS,
  IDLE_TIMEOUT_MS,
  SESSION_COOKIE,
  readSessionRecord,
  readSessionState,
  sessionIsActive,
  startSessionRecord,
  toSessionState,
  touchSessionRecord,
} from '../session';
import { upstreamUrl } from '../upstream';

const NOON = Date.parse('2026-09-18T12:00:00Z');
const RECORD = startSessionRecord('patient-token', NOON);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('portal session values', () => {
  it('reads only a complete finite record', () => {
    expect(readSessionRecord(RECORD)).toEqual(RECORD);
    for (const value of [
      null,
      [],
      {},
      { ...RECORD, token: '' },
      { ...RECORD, token: 'x'.repeat(3073) },
      { ...RECORD, issuedAt: Infinity },
    ]) {
      expect(readSessionRecord(value)).toBeNull();
    }
  });

  it('touches only the idle clock and derives both deadlines', () => {
    const touched = touchSessionRecord(RECORD, NOON + 1000);

    expect(touched).toEqual({ ...RECORD, lastSeenAt: NOON + 1000 });
    expect(toSessionState(touched)).toEqual({
      expiresAt: NOON + ABSOLUTE_LIFETIME_MS,
      idleExpiresAt: NOON + 1000 + IDLE_TIMEOUT_MS,
    });
  });

  it('ends at either deadline, including the exact boundary', () => {
    expect(sessionIsActive(RECORD, NOON + IDLE_TIMEOUT_MS - 1)).toBe(true);
    expect(sessionIsActive(RECORD, NOON + IDLE_TIMEOUT_MS)).toBe(false);
    expect(
      sessionIsActive(
        { ...RECORD, lastSeenAt: NOON + ABSOLUTE_LIFETIME_MS },
        NOON + ABSOLUTE_LIFETIME_MS
      )
    ).toBe(false);
  });

  it('rejects malformed public session state', () => {
    expect(readSessionState(toSessionState(RECORD))).toEqual(toSessionState(RECORD));
    expect(readSessionState({ expiresAt: NOON, idleExpiresAt: Number.NaN })).toBeNull();
    expect(readSessionState({ expiresAt: `${NOON}`, idleExpiresAt: NOON })).toBeNull();
  });
});

describe('safe sign-in destinations', () => {
  it('keeps local paths and rejects redirects outside the portal', () => {
    expect(safeReturnPath('/messages?thread=one')).toBe('/messages?thread=one');
    for (const value of [
      undefined,
      null,
      '',
      'https://elsewhere.invalid',
      '//elsewhere.invalid',
      '/\\evil',
      '/sign-in',
      '/a\n',
    ]) {
      expect(safeReturnPath(value)).toBeNull();
    }
  });

  it('encodes the return path and reason', () => {
    expect(signInUrl('/appointments?view=past', 'idle')).toBe(
      '/sign-in?next=%2Fappointments%3Fview%3Dpast&reason=idle'
    );
    expect(signInUrl('https://elsewhere.invalid')).toBe('/sign-in');
    expect(landingPath('//elsewhere.invalid')).toBe('/');
  });
});

describe('sealed session cookies', () => {
  it('round-trips only with the signing key that created it', async () => {
    const sealed = await sealSessionCookie(RECORD, 'first-key');

    expect(await unsealSessionCookie(sealed, 'first-key')).toEqual(RECORD);
    expect(await unsealSessionCookie(sealed, 'other-key')).toBeNull();
  });

  it('rejects hand-written, truncated, tampered and malformed records', async () => {
    const sealed = await sealSessionCookie(RECORD, 'first-key');
    const signature = sealed.slice(0, sealed.indexOf('.'));
    const malformed = `${signature}.${JSON.stringify({ ...RECORD, token: '' })}`;

    expect(await unsealSessionCookie(undefined, 'first-key')).toBeNull();
    expect(await unsealSessionCookie('', 'first-key')).toBeNull();
    expect(await unsealSessionCookie('not-a-cookie', 'first-key')).toBeNull();
    expect(await unsealSessionCookie(`x.${JSON.stringify(RECORD)}`, 'first-key')).toBeNull();
    expect(await unsealSessionCookie(`${sealed}x`, 'first-key')).toBeNull();
    expect(await unsealSessionCookie(malformed, 'first-key')).toBeNull();
  });

  it('requires an explicit key in production and supplies one in development', () => {
    vi.stubEnv('SESSION_COOKIE_SECRET', 'configured-key');
    expect(sessionSealKey()).toBe('configured-key');

    vi.stubEnv('SESSION_COOKIE_SECRET', '');
    vi.stubEnv('NODE_ENV', 'production');
    expect(sessionSealKey()).toBeNull();

    vi.stubEnv('NODE_ENV', 'test');
    expect(sessionSealKey()).not.toBeNull();
  });

  it('writes an http-only lax cookie and clears it on the same path', async () => {
    const response = applySessionCookie(
      NextResponse.json({}),
      await sealSessionCookie(RECORD, sessionSealKey() ?? '')
    );
    const header = response.headers.get('set-cookie') ?? '';

    expect(header).toContain(`${SESSION_COOKIE}=`);
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=lax');
    expect(header).toContain('Path=/');
    expect(header).toContain(`Max-Age=${ABSOLUTE_LIFETIME_MS / 1000}`);
    expect(clearSessionCookie(NextResponse.json({})).headers.get('set-cookie')).toContain(
      'Max-Age=0'
    );
  });
});

describe('upstream addresses', () => {
  it('accepts only configured http and https origins', () => {
    vi.stubEnv('OPENRUNIC_API_URL', 'https://api.example.invalid/root');
    expect(upstreamUrl('/bff/v0/portal/patient')?.href).toBe(
      'https://api.example.invalid/bff/v0/portal/patient'
    );

    for (const value of ['', 'not a url', 'file:///tmp/api']) {
      vi.stubEnv('OPENRUNIC_API_URL', value);
      expect(upstreamUrl('/bff/v0/portal/patient')).toBeNull();
    }
  });
});

describe('browser session client', () => {
  it('signs in with the application marker and reads the returned deadlines', async () => {
    const state = toSessionState(RECORD);
    const platform = vi.fn(() => Promise.resolve(Response.json(state)));
    vi.stubGlobal('fetch', platform);

    await expect(signIn('patient-token')).resolves.toEqual({ ok: true, session: state });
    expect(platform).toHaveBeenCalledWith('/api/session', {
      method: 'POST',
      headers: {
        [SESSION_FETCH_HEADER]: SESSION_FETCH_MARKER,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ token: 'patient-token' }),
    });
  });

  it('distinguishes rejected credentials from an unavailable session service', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(null, { status: 401 })))
    );
    await expect(signIn('wrong')).resolves.toEqual({ ok: false, reason: 'rejected' });

    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(Response.json({ nope: true })))
    );
    await expect(signIn('patient-token')).resolves.toEqual({ ok: false, reason: 'unavailable' });

    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('offline')))
    );
    await expect(signIn('patient-token')).resolves.toEqual({ ok: false, reason: 'unavailable' });
  });

  it('restores, refuses, and ends a session without leaking transport failures', async () => {
    const state = toSessionState(RECORD);
    const platform = vi.fn(() => Promise.resolve(Response.json(state)));
    const controller = new AbortController();
    vi.stubGlobal('fetch', platform);
    await expect(restoreSession(controller.signal)).resolves.toEqual(state);
    expect(platform).toHaveBeenCalledWith('/api/session', {
      headers: { [SESSION_FETCH_HEADER]: SESSION_FETCH_MARKER },
      signal: controller.signal,
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(null, { status: 401 })))
    );
    await expect(restoreSession()).resolves.toBeNull();

    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('offline')))
    );
    await expect(endSession()).resolves.toBeUndefined();
  });
});
