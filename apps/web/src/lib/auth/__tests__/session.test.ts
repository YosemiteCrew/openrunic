import { describe, expect, it } from 'vitest';

import {
  ABSOLUTE_LIFETIME_MS,
  IDLE_TIMEOUT_MS,
  readSessionPayload,
  readSessionRecord,
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

describe('reading a record', () => {
  /*
   * How a record gets into and out of a cookie is `seal.ts`'s business, and
   * `seal.test.ts` covers the ways one can arrive rewritten. What is left here
   * is the shape check itself, which runs on JSON that has already been proved
   * to be ours.
   */

  it('takes a record that is one', () => {
    expect(readSessionRecord(structuredClone(record()))).toEqual(record());
  });

  it('refuses anything that is not an object', () => {
    expect(readSessionRecord(null)).toBeNull();
    expect(readSessionRecord([1, 2, 3])).toBeNull();
    expect(readSessionRecord('dev-clinician-a')).toBeNull();
  });

  it('refuses a record with a field missing, rather than half-reading it', () => {
    expect(readSessionRecord({ ...record(), token: '' })).toBeNull();
    expect(readSessionRecord({ ...record(), issuedAt: undefined })).toBeNull();
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
    expect(readSessionPayload(structuredClone(toSession(record())))).toEqual(toSession(record()));
  });

  it('refuses a payload that is missing any of the three', () => {
    expect(readSessionPayload(null)).toBeNull();
    expect(readSessionPayload({ token: 'dev-clinician-a', identity: CLINICIAN })).toBeNull();
    expect(readSessionPayload({ token: 'dev-clinician-a', expiresAt: NOON })).toBeNull();
    expect(readSessionPayload({ identity: CLINICIAN, expiresAt: NOON })).toBeNull();
  });
});
