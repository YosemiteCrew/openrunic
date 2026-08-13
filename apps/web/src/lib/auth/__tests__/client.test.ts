import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSessionAwareFetch, endSession, restoreSession, signIn } from '@/lib/auth/client';
import { ABSOLUTE_LIFETIME_MS } from '@/lib/auth/session';
import type { Session } from '@/lib/auth/session';
import { heldSession, holdSession } from '@/lib/auth/store';

const NOON = Date.parse('2026-08-13T12:00:00Z');

const SESSION: Session = {
  token: 'dev-clinician-a',
  identity: {
    subject: '01890000-0000-7000-8000-000000000101',
    displayName: 'Dr. Adaeze Okafor',
    roles: ['clinician'],
  },
  expiresAt: NOON + ABSOLUTE_LIFETIME_MS,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const fetchImpl = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchImpl.mockReset();
  vi.stubGlobal('fetch', fetchImpl);
  holdSession(null);
});

afterEach(() => {
  holdSession(null);
  vi.unstubAllGlobals();
});

describe('signing in', () => {
  it('holds the session it is handed, so the next request carries a token', async () => {
    fetchImpl.mockResolvedValue(jsonResponse(SESSION));

    const outcome = await signIn('dev-clinician-a');

    expect(outcome).toEqual({ ok: true, session: SESSION });
    expect(heldSession()).toEqual(SESSION);
  });

  it('asks this application rather than the API', async () => {
    // The token exchange has to happen where a client secret can exist, which
    // is the route handler. Nothing here talks to the API directly.
    fetchImpl.mockResolvedValue(jsonResponse(SESSION));

    await signIn('dev-clinician-a');

    expect(fetchImpl).toHaveBeenCalledWith('/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'dev-clinician-a' }),
    });
  });

  it('says the credential was refused when it was', async () => {
    fetchImpl.mockResolvedValue(jsonResponse({ error: 'no' }, 401));

    expect(await signIn('not-a-token')).toEqual({ ok: false, reason: 'rejected' });
    expect(heldSession()).toBeNull();
  });

  it('does not blame the clinician when the server is the problem', async () => {
    // Telling somebody holding the right token that their credential is wrong
    // sends them looking for a new one.
    fetchImpl.mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await signIn('dev-clinician-a')).toEqual({ ok: false, reason: 'unavailable' });

    fetchImpl.mockResolvedValue(jsonResponse({ error: 'no' }, 500));
    expect(await signIn('dev-clinician-a')).toEqual({ ok: false, reason: 'unavailable' });
  });

  it('refuses a success that is not a session, rather than holding half of one', async () => {
    fetchImpl.mockResolvedValue(jsonResponse({ token: 'dev-clinician-a' }));

    expect(await signIn('dev-clinician-a')).toEqual({ ok: false, reason: 'unavailable' });
    expect(heldSession()).toBeNull();
  });

  it('survives a success that is not JSON', async () => {
    fetchImpl.mockResolvedValue(new Response('<html>proxy error</html>', { status: 200 }));

    expect(await signIn('dev-clinician-a')).toEqual({ ok: false, reason: 'unavailable' });
  });
});

describe('restoring a session after a page load', () => {
  it('puts the token back in memory', async () => {
    fetchImpl.mockResolvedValue(jsonResponse(SESSION));

    expect(await restoreSession()).toEqual(SESSION);
    expect(heldSession()).toEqual(SESSION);
  });

  it('ends up signed out when the cookie has run out', async () => {
    holdSession(SESSION);
    fetchImpl.mockResolvedValue(jsonResponse({ error: 'no' }, 401));

    expect(await restoreSession()).toBeNull();
    expect(heldSession()).toBeNull();
  });

  it('ends up signed out when the request never completes', async () => {
    holdSession(SESSION);
    fetchImpl.mockRejectedValue(new TypeError('Failed to fetch'));

    expect(await restoreSession()).toBeNull();
    expect(heldSession()).toBeNull();
  });
});

describe('signing out', () => {
  it('clears the token from this tab and revokes the cookie', async () => {
    holdSession(SESSION);
    fetchImpl.mockResolvedValue(new Response(null, { status: 204 }));

    await endSession();

    expect(heldSession()).toBeNull();
    expect(fetchImpl).toHaveBeenCalledWith('/session', { method: 'DELETE' });
  });

  it('cannot be undone by a restore that started at the same moment', async () => {
    // Signing out drops the token, which wakes the gate into restoring a
    // session it thinks it has lost. Unordered, that restore reaches the server
    // first, is handed a token because the cookie is still there, and puts the
    // session back: sign out leaves you signed in. A browser found this.
    holdSession(SESSION);
    const order: string[] = [];
    fetchImpl.mockImplementation(async (_input, init) => {
      const method = (init as RequestInit | undefined)?.method ?? 'GET';
      order.push(method);
      return method === 'DELETE' ? new Response(null, { status: 204 }) : jsonResponse(SESSION);
    });

    const revoked = endSession();
    const restored = restoreSession();
    await Promise.all([revoked, restored]);

    expect(order).toEqual(['DELETE', 'GET']);
  });

  it('still clears the token when the revoke call fails', async () => {
    // Keeping the credential because we could not tell the server we were done
    // with it is how pressing sign out leaves somebody signed in.
    holdSession(SESSION);
    fetchImpl.mockRejectedValue(new TypeError('Failed to fetch'));

    await endSession();

    expect(heldSession()).toBeNull();
  });
});

describe('the fetch the data layer runs on', () => {
  it('passes an ordinary response straight through', async () => {
    holdSession(SESSION);
    const ok = jsonResponse({ items: [] });
    fetchImpl.mockResolvedValue(ok);

    const response = await createSessionAwareFetch()('http://api.test/bff/v0/patients');

    expect(response).toBe(ok);
    expect(heldSession()).toEqual(SESSION);
  });

  it('ends the session when the API stops accepting the token', async () => {
    // Otherwise a token that expires mid-shift turns every chart into an error
    // panel that the retry button cannot fix.
    holdSession(SESSION);
    fetchImpl.mockResolvedValue(jsonResponse({ title: 'Unauthenticated' }, 401));

    await createSessionAwareFetch()('http://api.test/bff/v0/patients');

    expect(heldSession()).toBeNull();
  });

  it('does nothing about a 401 when nobody was signed in', async () => {
    fetchImpl.mockResolvedValue(jsonResponse({ title: 'Unauthenticated' }, 401));

    await createSessionAwareFetch()('http://api.test/bff/v0/patients');

    // One call, not two: an anonymous request that was always going to 401 must
    // not stampede the sign-out path.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('forwards the request it was given, untouched', async () => {
    fetchImpl.mockResolvedValue(jsonResponse({ items: [] }));
    const init = { method: 'POST', body: '{}' };

    await createSessionAwareFetch()('http://api.test/bff/v0/patients', init);

    expect(fetchImpl).toHaveBeenCalledWith('http://api.test/bff/v0/patients', init);
  });
});
