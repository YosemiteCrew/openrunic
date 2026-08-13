import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { currentAccessToken, heldSession, holdSession, subscribeToSession } from '@/lib/auth/store';
import type { Session } from '@/lib/auth/session';

const NOON = Date.parse('2026-08-13T12:00:00Z');

const SESSION: Session = {
  token: 'dev-clinician-a',
  identity: {
    subject: '01890000-0000-7000-8000-000000000101',
    displayName: 'Dr. Adaeze Okafor',
    roles: ['clinician'],
  },
  expiresAt: NOON + 60_000,
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOON);
  holdSession(null);
});

afterEach(() => {
  holdSession(null);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the token the data layer attaches', () => {
  it('is nothing at all until someone signs in', () => {
    expect(currentAccessToken()).toBeNull();
    expect(heldSession()).toBeNull();
  });

  it('is the signed-in token, read fresh rather than captured', () => {
    holdSession(SESSION);

    expect(currentAccessToken()).toBe('dev-clinician-a');
  });

  it('stops being sent the moment the absolute deadline passes', () => {
    holdSession(SESSION);
    vi.setSystemTime(SESSION.expiresAt);

    expect(currentAccessToken()).toBeNull();
  });

  it('is gone after signing out', () => {
    holdSession(SESSION);
    holdSession(null);

    expect(currentAccessToken()).toBeNull();
  });
});

describe('what renders from the store', () => {
  it('reads the same value until something writes, which is what React requires', () => {
    holdSession(SESSION);
    vi.setSystemTime(SESSION.expiresAt + 60_000);

    // Deliberately not clock-aware: a snapshot that changed on its own would
    // make React re-render forever looking for a stable read. The expired token
    // is withheld by `currentAccessToken`, and the resulting 401 ends the
    // session in one place.
    expect(heldSession()).toBe(heldSession());
    expect(heldSession()).toBe(SESSION);
  });

  it('tells every subscriber when the session changes', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToSession(listener);

    holdSession(SESSION);
    expect(listener).toHaveBeenCalledTimes(1);

    holdSession(null);
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    holdSession(SESSION);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe('on the server', () => {
  it('holds nothing, because module state there is shared by every request', () => {
    // One clinician's credential answering another clinician's render is the
    // failure this guard exists to make impossible.
    holdSession(SESSION);
    vi.stubGlobal('window', undefined);

    expect(heldSession()).toBeNull();
    expect(currentAccessToken()).toBeNull();
  });

  it('refuses to take one either', () => {
    vi.stubGlobal('window', undefined);
    holdSession(SESSION);
    vi.unstubAllGlobals();

    expect(heldSession()).toBeNull();
  });
});
