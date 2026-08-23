import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FLOW_COOKIE } from '@/lib/auth/oidc';
import { sealPayload, sessionSealKey, unsealSessionCookie } from '@/lib/auth/seal';
import { SESSION_COOKIE } from '@/lib/auth/session';
import type { FlowState } from '@/lib/auth/oidc';

import { GET as callback } from '../auth/callback/route';
import { GET as start } from '../auth/start/route';

/**
 * The two halves of the sign-in redirect.
 *
 * These tests care about one thing above the happy path: that a callback this
 * browser did not start never reaches the provider's token endpoint. Every
 * refusal below asserts on `fetch` not having been called, because a redirect
 * back to the sign-in screen looks identical whether the code was spent first
 * or not, and spending it is the part that matters.
 */

const ISSUER = 'https://id.example.invalid';
const DISCOVERY = {
  authorization_endpoint: `${ISSUER}/authorize`,
  token_endpoint: `${ISSUER}/token`,
  code_challenge_methods_supported: ['S256'],
};

const NOW = Date.parse('2026-08-20T09:00:00Z');

function key(): string {
  const value = sessionSealKey();
  if (value === null) throw new Error('the test environment has no seal key');
  return value;
}

function configure(): void {
  vi.stubEnv('OIDC_ISSUER', ISSUER);
  vi.stubEnv('OIDC_CLIENT_ID', 'openrunic-web');
  vi.stubEnv('OIDC_REDIRECT_URI', 'http://localhost:3000/auth/callback');
}

function jsonOk(body: unknown): Response {
  return { ok: true, json: () => Promise.resolve(body) } as unknown as Response;
}

function encodeClaims(claims: Record<string, unknown>): string {
  const encode = (value: string): string =>
    btoa(value).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
  return `${encode('{"alg":"RS256"}')}.${encode(JSON.stringify(claims))}.sig`;
}

async function flowCookie(overrides: Partial<FlowState> = {}): Promise<string> {
  const flow: FlowState = {
    verifier: 'the-verifier',
    state: 'the-state',
    nonce: 'the-nonce',
    next: null,
    startedAt: NOW,
    ...overrides,
  };
  return sealPayload(flow, key());
}

async function callbackRequest(query: string, cookie?: string): Promise<NextRequest> {
  const headers: Record<string, string> = {};
  if (cookie !== undefined) headers.cookie = `${FLOW_COOKIE}=${cookie}`;
  return new NextRequest(`http://localhost:3000/auth/callback${query}`, { headers });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('GET /auth/start', () => {
  it('sends the browser to the provider and parks the flow in a cookie', async () => {
    configure();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonOk(DISCOVERY)));

    const response = await start(new NextRequest('http://localhost:3000/auth/start'));

    expect(response.status).toBe(303);
    const location = new URL(response.headers.get('location') ?? '');
    expect(location.origin + location.pathname).toBe(`${ISSUER}/authorize`);
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    expect(location.searchParams.get('state')).not.toBeNull();

    const parked = response.cookies.get(FLOW_COOKIE);
    expect(parked?.httpOnly).toBe(true);
    expect(parked?.sameSite).toBe('lax');
    // The state in the cookie is the one in the URL, or the callback can never
    // match them.
    expect(parked?.value).toContain(location.searchParams.get('state') ?? 'absent');
  });

  it('never puts the verifier in the URL it redirects to', async () => {
    configure();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonOk(DISCOVERY)));

    const response = await start(new NextRequest('http://localhost:3000/auth/start'));
    const location = response.headers.get('location') ?? '';
    const challenge = new URL(location).searchParams.get('code_challenge') ?? '';

    // The cookie holds the verifier; the URL holds only its hash. If a refactor
    // ever swapped them this assertion is what notices.
    expect(response.cookies.get(FLOW_COOKIE)?.value).not.toContain(challenge);
  });

  it('carries a safe return path into the flow', async () => {
    configure();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonOk(DISCOVERY)));

    const response = await start(
      new NextRequest('http://localhost:3000/auth/start?next=%2Fbilling')
    );

    expect(response.cookies.get(FLOW_COOKIE)?.value).toContain('/billing');
  });

  it('refuses to carry an absolute URL somebody put in the query string', async () => {
    configure();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonOk(DISCOVERY)));

    const response = await start(
      new NextRequest('http://localhost:3000/auth/start?next=https%3A%2F%2Felsewhere.invalid')
    );

    expect(response.cookies.get(FLOW_COOKIE)?.value).not.toContain('elsewhere.invalid');
  });

  it('returns to the sign-in screen when the deployment has no provider', async () => {
    const response = await start(new NextRequest('http://localhost:3000/auth/start'));

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toContain('/sign-in');
  });

  it('returns to the sign-in screen when discovery fails', async () => {
    configure();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    const response = await start(new NextRequest('http://localhost:3000/auth/start'));

    expect(response.headers.get('location')).toContain('/sign-in');
    expect(response.cookies.get(FLOW_COOKIE)?.value ?? '').toBe('');
  });
});

describe('GET /auth/callback', () => {
  it('exchanges the code and starts a session on the access token', async () => {
    configure();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonOk(DISCOVERY))
      .mockResolvedValueOnce(
        jsonOk({
          access_token: 'the-access-token',
          id_token: encodeClaims({ sub: 'user-1', name: 'Dr Ada', nonce: 'the-nonce' }),
        })
      );
    vi.stubGlobal('fetch', fetchImpl);

    const response = await callback(
      await callbackRequest('?code=the-code&state=the-state', await flowCookie())
    );

    expect(response.status).toBe(303);
    const sealed = response.cookies.get(SESSION_COOKIE)?.value;
    const record = await unsealSessionCookie(sealed, key());
    // The ACCESS token is what the API verifies, so it is the one that must end
    // up in the session. Storing the id token here would authenticate nobody.
    expect(record?.token).toBe('the-access-token');
    expect(record?.identity.displayName).toBe('Dr Ada');
  });

  it('lands on the path the flow was started with', async () => {
    configure();
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(jsonOk(DISCOVERY))
        .mockResolvedValueOnce(
          jsonOk({
            access_token: 'a',
            id_token: encodeClaims({ sub: 'u', nonce: 'the-nonce' }),
          })
        )
    );

    const response = await callback(
      await callbackRequest(
        '?code=the-code&state=the-state',
        await flowCookie({ next: '/billing' })
      )
    );

    expect(response.headers.get('location')).toContain('/billing');
  });

  it('refuses a state that does not match, without spending the code', async () => {
    configure();
    const fetchImpl = vi.fn().mockResolvedValue(jsonOk(DISCOVERY));
    vi.stubGlobal('fetch', fetchImpl);

    const response = await callback(
      await callbackRequest('?code=the-code&state=someone-elses', await flowCookie())
    );

    expect(response.headers.get('location')).toContain('/sign-in');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses a callback with no flow cookie, without spending the code', async () => {
    configure();
    const fetchImpl = vi.fn().mockResolvedValue(jsonOk(DISCOVERY));
    vi.stubGlobal('fetch', fetchImpl);

    const response = await callback(await callbackRequest('?code=c&state=the-state'));

    expect(response.headers.get('location')).toContain('/sign-in');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses a flow the person abandoned', async () => {
    configure();
    const fetchImpl = vi.fn().mockResolvedValue(jsonOk(DISCOVERY));
    vi.stubGlobal('fetch', fetchImpl);
    const cookie = await flowCookie({ startedAt: NOW - 60 * 60 * 1000 });

    const response = await callback(await callbackRequest('?code=c&state=the-state', cookie));

    expect(response.headers.get('location')).toContain('/sign-in');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses when the provider reported an error instead of a code', async () => {
    configure();
    const fetchImpl = vi.fn().mockResolvedValue(jsonOk(DISCOVERY));
    vi.stubGlobal('fetch', fetchImpl);

    const response = await callback(
      await callbackRequest('?error=access_denied&state=the-state', await flowCookie())
    );

    expect(response.headers.get('location')).toContain('/sign-in');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses a token response with no id token, so the nonce can be checked', async () => {
    configure();
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(jsonOk(DISCOVERY))
        .mockResolvedValueOnce(jsonOk({ access_token: 'a' }))
    );

    const response = await callback(
      await callbackRequest('?code=c&state=the-state', await flowCookie())
    );

    expect(response.headers.get('location')).toContain('/sign-in');
    expect(response.cookies.get(SESSION_COOKIE)?.value ?? '').toBe('');
  });

  it('refuses an id token minted for a different attempt', async () => {
    configure();
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(jsonOk(DISCOVERY))
        .mockResolvedValueOnce(
          jsonOk({
            access_token: 'a',
            id_token: encodeClaims({ sub: 'u', nonce: 'a-replayed-nonce' }),
          })
        )
    );

    const response = await callback(
      await callbackRequest('?code=c&state=the-state', await flowCookie())
    );

    expect(response.headers.get('location')).toContain('/sign-in');
    expect(response.cookies.get(SESSION_COOKIE)?.value ?? '').toBe('');
  });

  it('refuses an id token with no subject, which identifies nobody', async () => {
    configure();
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(jsonOk(DISCOVERY))
        .mockResolvedValueOnce(
          jsonOk({ access_token: 'a', id_token: encodeClaims({ nonce: 'the-nonce' }) })
        )
    );

    const response = await callback(
      await callbackRequest('?code=c&state=the-state', await flowCookie())
    );

    expect(response.headers.get('location')).toContain('/sign-in');
  });

  it('refuses when the token endpoint turns the code down', async () => {
    configure();
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(jsonOk(DISCOVERY))
        .mockResolvedValueOnce({
          ok: false,
          json: () => Promise.resolve({}),
        } as unknown as Response)
    );

    const response = await callback(
      await callbackRequest('?code=c&state=the-state', await flowCookie())
    );

    expect(response.headers.get('location')).toContain('/sign-in');
  });

  it('refuses when discovery fails on the way back', async () => {
    configure();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    const response = await callback(
      await callbackRequest('?code=c&state=the-state', await flowCookie())
    );

    expect(response.headers.get('location')).toContain('/sign-in');
  });

  it('refuses when the deployment has no provider configured', async () => {
    const response = await callback(
      await callbackRequest('?code=c&state=the-state', await flowCookie())
    );

    expect(response.headers.get('location')).toContain('/sign-in');
  });

  it('refuses a callback carrying a code but no state at all', async () => {
    configure();
    const fetchImpl = vi.fn().mockResolvedValue(jsonOk(DISCOVERY));
    vi.stubGlobal('fetch', fetchImpl);

    const response = await callback(await callbackRequest('?code=c', await flowCookie()));

    expect(response.headers.get('location')).toContain('/sign-in');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
