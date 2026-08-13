import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NAV_AREAS } from '@/components/shell/navigation';
import {
  ABSOLUTE_LIFETIME_MS,
  IDLE_TIMEOUT_MS,
  SESSION_COOKIE,
  encodeSessionCookie,
  startSessionRecord,
} from '@/lib/auth/session';
import type { Identity, SessionRecord } from '@/lib/auth/session';

import { config, proxy } from '../proxy';

/**
 * The door.
 *
 * What a user notices: typing a chart URL while signed out gets a sign-in form
 * rather than an empty chart frame, and signing in afterwards puts them back on
 * the URL they typed. What an auditor notices: no clinical route answers
 * without a live session cookie, and a stale one is taken away on the way past.
 */

const CLINICIAN: Identity = {
  subject: '01890000-0000-7000-8000-000000000101',
  displayName: 'Dr. Adaeze Okafor',
  roles: ['clinician'],
};

const NOON = Date.parse('2026-08-13T12:00:00Z');

function request(path: string, cookie?: SessionRecord | string): NextRequest {
  const value = typeof cookie === 'string' ? cookie : cookie && encodeSessionCookie(cookie);
  return new NextRequest(`http://localhost:3000${path}`, {
    headers: value === undefined ? {} : { cookie: `${SESSION_COOKIE}=${value}` },
  });
}

function live(): SessionRecord {
  return startSessionRecord('dev-clinician-a', CLINICIAN, NOON);
}

function redirectedTo(path: string, cookie?: SessionRecord | string): string {
  const response = proxy(request(path, cookie));
  return (
    new URL(response.headers.get('location') ?? '').pathname +
    new URL(response.headers.get('location') ?? '').search
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOON);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('an anonymous browser', () => {
  it('is sent to sign in from every clinical area', () => {
    for (const area of NAV_AREAS) {
      expect(redirectedTo(area.href)).toBe(
        `/sign-in?next=${encodeURIComponent(area.href)}&reason=expired`
      );
    }
  });

  it('does not get the chart, and is told where to sign in instead', () => {
    const response = proxy(request('/patients/0192f1a0-0000-7000-8000-00000000p001'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('/sign-in');
  });

  it('keeps the query it asked for, so signing in returns to the same view', () => {
    expect(redirectedTo('/schedule?day=2026-08-13')).toBe(
      '/sign-in?next=%2Fschedule%3Fday%3D2026-08-13&reason=expired'
    );
  });

  it('still reads the marketing pages and the sign-in screen', () => {
    for (const path of ['/', '/for/developers', '/for/hospitals', '/for/patients', '/sign-in']) {
      expect(proxy(request(path)).headers.get('location')).toBeNull();
    }
  });

  it('can still reach the endpoint that would sign it in', () => {
    expect(proxy(request('/session')).headers.get('location')).toBeNull();
  });
});

describe('a cookie that has run out', () => {
  it('does not open a chart after the idle window', () => {
    vi.setSystemTime(NOON + IDLE_TIMEOUT_MS);

    expect(redirectedTo('/patients', live())).toContain('/sign-in');
  });

  it('does not open a chart after the shift', () => {
    vi.setSystemTime(NOON + ABSOLUTE_LIFETIME_MS);

    expect(redirectedTo('/patients', live())).toContain('/sign-in');
  });

  it('is removed on the way past, so the next request is honestly anonymous', () => {
    vi.setSystemTime(NOON + ABSOLUTE_LIFETIME_MS);

    const response = proxy(request('/patients', live()));

    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('leaves nothing to clear when the cookie was never ours', () => {
    const response = proxy(request('/patients', 'somebody-elses-cookie'));

    expect(response.headers.get('location')).toContain('/sign-in');
    expect(response.headers.get('set-cookie')).toBeNull();
  });
});

describe('a signed-in clinician', () => {
  it('gets every clinical area', () => {
    for (const area of NAV_AREAS) {
      expect(proxy(request(area.href, live())).headers.get('location')).toBeNull();
    }
  });

  it('gets the chart they asked for', () => {
    const response = proxy(request('/patients/0192f1a0-0000-7000-8000-00000000p001', live()));

    expect(response.headers.get('location')).toBeNull();
  });

  it('lands on the schedule instead of the marketing home', () => {
    // `/` stays the project's public front door. A browser holding a live staff
    // session did not come for the brochure.
    expect(redirectedTo('/', live())).toBe('/schedule');
  });

  it('is not shown a sign-in form they do not need', () => {
    expect(redirectedTo('/sign-in', live())).toBe('/schedule');
  });

  it('still reads the marketing pages that are not the home page', () => {
    expect(proxy(request('/for/hospitals', live())).headers.get('location')).toBeNull();
  });
});

describe('what the middleware runs on', () => {
  it('guards everything it is not told to skip', () => {
    // One exclusion rather than a list of protected prefixes: a matcher that
    // names the areas to guard protects exactly the areas somebody remembered.
    expect(config.matcher).toHaveLength(1);
    // Next anchors a matcher against the whole path; anchored here so this test
    // asks the same question the framework does.
    const matcher = new RegExp(`^${config.matcher[0] ?? ''}$`);

    expect(matcher.test('/patients')).toBe(true);
    expect(matcher.test('/some/route/added/next/week')).toBe(true);
    expect(matcher.test('/_next/static/chunk.js')).toBe(false);
    expect(matcher.test('/assets/logo/mark.svg')).toBe(false);
    expect(matcher.test('/fonts/BricolageGrotesque-variable.woff2')).toBe(false);
    expect(matcher.test('/favicon.ico')).toBe(false);
  });
});
