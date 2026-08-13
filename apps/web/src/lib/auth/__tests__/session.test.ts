import { describe, expect, it } from 'vitest';

import {
  ABSOLUTE_LIFETIME_MS,
  IDLE_TIMEOUT_MS,
  decodeSessionCookie,
  encodeSessionCookie,
  readSessionPayload,
  sessionExpiresAt,
  sessionState,
  startSessionRecord,
  toSession,
  touchSessionRecord,
} from '@/lib/auth/session';
import type { Identity, SessionRecord } from '@/lib/auth/session';

const CLINICIAN: Identity = {
  subject: '01890000-0000-7000-8000-000000000101',
  displayName: 'Dr. Adaeze Okafor',
  roles: ['clinician'],
};

const NOON = Date.parse('2026-08-13T12:00:00Z');

function record(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return { ...startSessionRecord('dev-clinician-a', CLINICIAN, NOON), ...overrides };
}

describe('the session cookie', () => {
  it('carries the token and the identity back out unchanged', () => {
    const restored = decodeSessionCookie(encodeSessionCookie(record()));

    expect(restored).toEqual(record());
  });

  it('survives a name that is not plain ASCII', () => {
    const original = record({ identity: { ...CLINICIAN, displayName: 'Dr. Ingrid Sjöberg' } });

    expect(decodeSessionCookie(encodeSessionCookie(original))?.identity.displayName).toBe(
      'Dr. Ingrid Sjöberg'
    );
  });

  it('uses only characters a cookie and a URL both leave alone', () => {
    expect(encodeSessionCookie(record())).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('reads nothing from an absent or empty cookie', () => {
    expect(decodeSessionCookie(undefined)).toBeNull();
    expect(decodeSessionCookie('')).toBeNull();
  });

  it('reads nothing from a value that is not one of ours', () => {
    expect(decodeSessionCookie('not a cookie we wrote!!')).toBeNull();
    expect(decodeSessionCookie(btoa('plain text, not JSON'))).toBeNull();
    expect(decodeSessionCookie(btoa('[1,2,3]'))).toBeNull();
  });

  it('refuses a record with a field missing, rather than half-reading it', () => {
    const withoutToken = btoa(JSON.stringify({ ...record(), token: '' }));
    const withoutRoles = btoa(
      JSON.stringify({ ...record(), identity: { ...CLINICIAN, roles: undefined } })
    );

    expect(decodeSessionCookie(withoutToken)).toBeNull();
    expect(decodeSessionCookie(withoutRoles)).toBeNull();
  });

  it('refuses a timestamp that is not a number, so a hand-edited cookie cannot become immortal', () => {
    const notATime = btoa(JSON.stringify({ ...record(), lastSeenAt: 'later' }));

    expect(decodeSessionCookie(notATime)).toBeNull();
  });

  it('refuses a role list holding something that is not a role', () => {
    const oddRoles = btoa(
      JSON.stringify({ ...record(), identity: { ...CLINICIAN, roles: ['clinician', 7] } })
    );

    expect(decodeSessionCookie(oddRoles)).toBeNull();
  });

  it('accepts a rewritten identity rather than pretending to detect tampering', () => {
    // Stated as a test because it is a deliberate position, not an oversight:
    // the cookie is not signed, and it does not need to be. Editing the name
    // changes the label in your own top bar; the token beside it is the thing
    // the API checks, and it is unchanged.
    const rewritten = btoa(
      JSON.stringify({ ...record(), identity: { ...CLINICIAN, displayName: 'Somebody Else' } })
    );

    const decoded = decodeSessionCookie(rewritten);

    expect(decoded?.identity.displayName).toBe('Somebody Else');
    expect(decoded?.token).toBe('dev-clinician-a');
  });
});

describe('how long a session lasts', () => {
  it('is active while someone is still there', () => {
    expect(sessionState(record(), NOON)).toBe('active');
    expect(sessionState(record(), NOON + IDLE_TIMEOUT_MS - 1)).toBe('active');
  });

  it('goes idle the moment the idle window closes', () => {
    expect(sessionState(record(), NOON + IDLE_TIMEOUT_MS)).toBe('idle');
  });

  it('expires on the absolute deadline even if someone is sitting right there', () => {
    const busy = record({ lastSeenAt: NOON + ABSOLUTE_LIFETIME_MS });

    expect(sessionState(busy, NOON + ABSOLUTE_LIFETIME_MS)).toBe('expired');
  });

  it('reports expiry rather than idleness when both are true', () => {
    // An expired session cannot be revived by activity, and calling it idle
    // would invite an interface that offers to extend it.
    expect(sessionState(record(), NOON + ABSOLUTE_LIFETIME_MS)).toBe('expired');
  });

  it('re-stamps the idle clock without moving the absolute one', () => {
    const later = touchSessionRecord(record(), NOON + IDLE_TIMEOUT_MS - 1);

    expect(later.lastSeenAt).toBe(NOON + IDLE_TIMEOUT_MS - 1);
    expect(later.issuedAt).toBe(NOON);
    expect(sessionExpiresAt(later)).toBe(NOON + ABSOLUTE_LIFETIME_MS);
  });

  it('does not let refreshing forever outlast the shift', () => {
    let live = record();
    for (let hour = 1; hour <= 12; hour += 1) {
      live = touchSessionRecord(live, NOON + hour * 60 * 60 * 1000);
    }

    expect(sessionState(live, NOON + ABSOLUTE_LIFETIME_MS)).toBe('expired');
  });
});

describe('what the browser is handed', () => {
  it('gets the token, the identity and one deadline, and no idle clock', () => {
    expect(toSession(record())).toEqual({
      token: 'dev-clinician-a',
      identity: CLINICIAN,
      expiresAt: NOON + ABSOLUTE_LIFETIME_MS,
    });
  });

  it('reads that payload back off the wire', () => {
    expect(readSessionPayload(JSON.parse(JSON.stringify(toSession(record()))))).toEqual(
      toSession(record())
    );
  });

  it('refuses a payload that is missing any of the three', () => {
    expect(readSessionPayload(null)).toBeNull();
    expect(readSessionPayload({ token: 'dev-clinician-a', identity: CLINICIAN })).toBeNull();
    expect(readSessionPayload({ token: 'dev-clinician-a', expiresAt: NOON })).toBeNull();
    expect(readSessionPayload({ identity: CLINICIAN, expiresAt: NOON })).toBeNull();
  });
});
