import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NAV_AREAS } from '@/components/shell/navigation';
import { sealSessionCookie, sessionSealKey } from '@/lib/auth/seal';
import {
  ABSOLUTE_LIFETIME_MS,
  IDLE_TIMEOUT_MS,
  SESSION_COOKIE,
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

/**
 * A request carrying the cookie the way a browser sends it back: sealed, then
 * percent-encoded, because that is the form the platform wrote into
 * `Set-Cookie` and the form it decodes on the way out of `NextRequest.cookies`.
 *
 * A string is passed through unsealed, which is how a hand-written cookie is
 * spelled in these tests.
 */
async function request(path: string, cookie?: SessionRecord | string): Promise<NextRequest> {
  const value =
    typeof cookie === 'string' || cookie === undefined
      ? cookie
      : await sealSessionCookie(cookie, sessionSealKey() ?? '');

  return new NextRequest(`http://localhost:3000${path}`, {
    headers:
      value === undefined ? {} : { cookie: `${SESSION_COOKIE}=${encodeURIComponent(value)}` },
  });
}

/** An anonymous request carrying whatever headers the case is about. */
function anonymous(path: string, headers: Record<string, string>): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, { headers });
}

function live(): SessionRecord {
  return startSessionRecord('dev-clinician-a', CLINICIAN, NOON);
}

async function redirectedTo(path: string, cookie?: SessionRecord | string): Promise<string> {
  const response = await proxy(await request(path, cookie));
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
  it('is sent to sign in from every clinical area', async () => {
    for (const area of NAV_AREAS) {
      expect(await redirectedTo(area.href)).toBe(
        `/sign-in?next=${encodeURIComponent(area.href)}&reason=expired`
      );
    }
  });

  it('does not get the chart, and is told where to sign in instead', async () => {
    const response = await proxy(await request('/patients/0192f1a0-0000-7000-8000-00000000p001'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('/sign-in');
  });

  it('keeps the query it asked for, so signing in returns to the same view', async () => {
    expect(await redirectedTo('/schedule?day=2026-08-13')).toBe(
      '/sign-in?next=%2Fschedule%3Fday%3D2026-08-13&reason=expired'
    );
  });

  it('still reads the marketing pages and the sign-in screen', async () => {
    for (const path of ['/en', '/en/for/developers', '/es/for/hospitals', '/sign-in']) {
      expect((await proxy(await request(path))).headers.get('location')).toBeNull();
    }
  });

  /**
   * The addresses the public pages used to have. They still arrive - from
   * bookmarks, from links, from anything written down before the pages started
   * carrying a language - and they have to land on the same page in the reader's
   * own language rather than 404.
   */
  it('sends an unprefixed public address on to the reader own language', async () => {
    for (const [path, expected] of [
      ['/', '/en'],
      ['/for/developers', '/en/for/developers'],
      ['/for/hospitals', '/en/for/hospitals'],
      ['/for/patients', '/en/for/patients'],
    ] as const) {
      const response = await proxy(await request(path));

      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toContain(expected);
    }
  });

  it("honours the reader's own choice over the browser's when it redirects", async () => {
    const spanish = anonymous('/', { 'accept-language': 'en', cookie: 'or_locale=es' });

    expect((await proxy(spanish)).headers.get('location')).toContain('/es');
  });

  it('redirects rather than caching, because the answer can change', async () => {
    // 307 and not 308: the destination depends on a cookie the reader can
    // change, and a permanent redirect is cached against a URL with no fixed
    // answer. Somebody switching to Spanish would keep landing on English.
    expect((await proxy(await request('/'))).status).toBe(307);
  });

  it('can still reach the endpoint that would sign it in', async () => {
    expect((await proxy(await request('/session'))).headers.get('location')).toBeNull();
  });

  it('reaches the health probe instead of the sign-in form', async () => {
    expect((await proxy(await request('/api/health'))).headers.get('location')).toBeNull();
  });
});

describe('a cookie that has run out', () => {
  it('does not open a chart after the idle window', async () => {
    vi.setSystemTime(NOON + IDLE_TIMEOUT_MS);

    expect(await redirectedTo('/patients', live())).toContain('/sign-in');
  });

  it('does not open a chart after the shift', async () => {
    vi.setSystemTime(NOON + ABSOLUTE_LIFETIME_MS);

    expect(await redirectedTo('/patients', live())).toContain('/sign-in');
  });

  it('is removed on the way past, so the next request is honestly anonymous', async () => {
    vi.setSystemTime(NOON + ABSOLUTE_LIFETIME_MS);

    const response = await proxy(await request('/patients', live()));

    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('leaves nothing to clear when the cookie was never ours', async () => {
    const response = await proxy(await request('/patients', 'somebody-elses-cookie'));

    expect(response.headers.get('location')).toContain('/sign-in');
    expect(response.headers.get('set-cookie')).toBeNull();
  });
});

describe('a cookie somebody wrote themselves', () => {
  /**
   * The shape this guard used to be fooled by. The cookie was plain JSON, so a
   * browser could be handed one carrying any string as its token and any clocks
   * it liked, and the door opened. No record was exposed - the API refuses the
   * token - but a guard that renders the whole application to a made-up cookie
   * is not the guard the code said it was.
   */
  function forged(token: string, clock = NOON): string {
    return JSON.stringify({
      token,
      identity: CLINICIAN,
      issuedAt: clock,
      lastSeenAt: clock,
    });
  }

  it('does not open the chart with a token nobody issued', async () => {
    expect(await redirectedTo('/patients', forged('anything-at-all'))).toContain('/sign-in');
  });

  it('cannot move the clocks forward to outlive the idle window', async () => {
    vi.setSystemTime(NOON + IDLE_TIMEOUT_MS + 1);

    // The rewrite that used to work: re-stamp the session as though it had just
    // been used, on a workstation whose owner left twenty minutes ago.
    const rewritten = forged('dev-clinician-a', NOON + IDLE_TIMEOUT_MS + 1);

    expect(await redirectedTo('/patients', rewritten)).toContain('/sign-in');
  });

  it('cannot survive one byte being changed inside a cookie we did sign', async () => {
    const sealed = await sealSessionCookie(live(), sessionSealKey() ?? '');
    const tampered = sealed.replace('"lastSeenAt":', '"lastSeenAt" :');

    expect(await redirectedTo('/patients', tampered)).toContain('/sign-in');
  });

  it('cannot be signed with a key this deployment does not use', async () => {
    const elsewhere = await sealSessionCookie(live(), 'a-key-from-some-other-deployment');

    expect(await redirectedTo('/patients', elsewhere)).toContain('/sign-in');
  });
});

describe('a deployment with no session key configured', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SESSION_COOKIE_SECRET', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('keeps the door shut rather than falling back to an open one', async () => {
    // The cookie is sealed with the key the rest of this file uses, so the
    // refusal is about the deployment having no key at all rather than about
    // this particular cookie.
    const sealed = await sealSessionCookie(live(), 'the-key-it-was-sealed-with');

    expect(await redirectedTo('/patients', sealed)).toContain('/sign-in');
  });

  it('still serves the pages that never needed a session', async () => {
    expect((await proxy(await request('/en'))).headers.get('location')).toBeNull();
    expect((await proxy(await request('/sign-in'))).headers.get('location')).toBeNull();
  });
});

describe('a signed-in clinician', () => {
  it('gets every clinical area', async () => {
    for (const area of NAV_AREAS) {
      expect((await proxy(await request(area.href, live()))).headers.get('location')).toBeNull();
    }
  });

  it('gets the chart they asked for', async () => {
    const response = await proxy(
      await request('/patients/0192f1a0-0000-7000-8000-00000000p001', live())
    );

    expect(response.headers.get('location')).toBeNull();
  });

  it('lands on the schedule instead of the marketing home', async () => {
    // `/` stays the project's public front door. A browser holding a live staff
    // session did not come for the brochure.
    expect(await redirectedTo('/', live())).toBe('/schedule');
  });

  it('is not shown a sign-in form they do not need', async () => {
    expect(await redirectedTo('/sign-in', live())).toBe('/schedule');
  });

  it('still reads the marketing pages that are not the home page', async () => {
    expect(
      (await proxy(await request('/for/hospitals', live()))).headers.get('location')
    ).toBeNull();
  });
});

describe('what the route guard runs on', () => {
  it('guards everything it is not told to skip', async () => {
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
