import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  sealPayload,
  sealSessionCookie,
  sessionSealKey,
  unsealPayload,
  unsealSessionCookie,
} from '@/lib/auth/seal';
import { startSessionRecord } from '@/lib/auth/session';
import type { Identity, SessionRecord } from '@/lib/auth/session';

/**
 * The seal exists for the clocks. A cookie carries the idle window and the
 * absolute lifetime, and before this the person the timeout is written for -
 * whoever finds a workstation still signed in - could open the browser's cookie
 * editor and move them.
 *
 * So these tests are mostly about refusal: every way of arriving with a record
 * this deployment did not write has to read as no session at all.
 */

const CLINICIAN: Identity = {
  subject: '01890000-0000-7000-8000-000000000101',
  displayName: 'Dr. Adaeze Okafor',
  roles: ['clinician'],
};

const NOON = Date.parse('2026-08-13T12:00:00Z');

const KEY = 'a-test-key-for-sealing-cookies';

function record(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return { ...startSessionRecord('dev-clinician-a', CLINICIAN, NOON), ...overrides };
}

/**
 * A value signed with the real key but carrying something else entirely, which
 * is the one shape that gets past the signature and still has to be refused.
 */
async function signedOver(payload: string, key = KEY): Promise<string> {
  const material = new TextEncoder().encode(key);
  const algorithm = { name: 'HMAC', hash: 'SHA-256' } as const;
  const signingKey = await crypto.subtle.importKey('raw', material, algorithm, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', signingKey, new TextEncoder().encode(payload));

  const bytes = new Uint8Array(signature);
  let binary = '';
  for (const byte of bytes) binary += String.fromCodePoint(byte);
  const encoded = btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');

  return `${encoded}.${payload}`;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('a cookie this deployment sealed', () => {
  it('comes back out unchanged', async () => {
    expect(await unsealSessionCookie(await sealSessionCookie(record(), KEY), KEY)).toEqual(
      record()
    );
  });

  it('survives a name that is not plain ASCII', async () => {
    const original = record({ identity: { ...CLINICIAN, displayName: 'Dr. Ingrid Sjöberg' } });
    const sealed = await sealSessionCookie(original, KEY);

    expect((await unsealSessionCookie(sealed, KEY))?.identity.displayName).toBe(
      'Dr. Ingrid Sjöberg'
    );
  });

  it('carries a signature that survives a cookie header, so no character needs escaping', async () => {
    const sealed = await sealSessionCookie(record(), KEY);
    const signature = sealed.slice(0, sealed.indexOf('.'));

    expect(signature).toMatch(/^[\w-]+$/);
  });
});

describe('a cookie somebody rewrote', () => {
  it('is refused when a timestamp is moved, which is the whole point of signing it', async () => {
    // The rewrite that used to work: a session about to go idle, re-stamped as
    // though somebody had just used it.
    const sealed = await sealSessionCookie(record(), KEY);
    const extended = sealed.replace(String(NOON), String(NOON + 60 * 60 * 1000));

    expect(await unsealSessionCookie(extended, KEY)).toBeNull();
  });

  it('is refused when the name is changed', async () => {
    const sealed = await sealSessionCookie(record(), KEY);

    expect(await unsealSessionCookie(sealed.replace('Adaeze', 'Somebody'), KEY)).toBeNull();
  });

  it('is refused when the signature is swapped for one over other content', async () => {
    const other = await sealSessionCookie(record({ token: 'dev-biller-a' }), KEY);
    const mine = await sealSessionCookie(record(), KEY);
    const spliced = `${other.slice(0, other.indexOf('.'))}.${mine.slice(mine.indexOf('.') + 1)}`;

    expect(await unsealSessionCookie(spliced, KEY)).toBeNull();
  });

  it('is refused when it was signed by some other deployment', async () => {
    const elsewhere = await sealSessionCookie(record(), 'a-different-deployments-key');

    expect(await unsealSessionCookie(elsewhere, KEY)).toBeNull();
  });
});

describe('a cookie that was never one of ours', () => {
  it('reads nothing from an absent or empty value', async () => {
    expect(await unsealSessionCookie(undefined, KEY)).toBeNull();
    expect(await unsealSessionCookie('', KEY)).toBeNull();
  });

  it('reads nothing from a value with no signature in front of it', async () => {
    expect(await unsealSessionCookie('not-a-cookie-we-wrote', KEY)).toBeNull();
    expect(await unsealSessionCookie(`.${JSON.stringify(record())}`, KEY)).toBeNull();
  });

  it('reads nothing from a signature that is not base64 at all', async () => {
    expect(await unsealSessionCookie(`***.${JSON.stringify(record())}`, KEY)).toBeNull();
  });

  it('reads nothing from a signature of the wrong length', async () => {
    expect(await unsealSessionCookie(`AAAA.${JSON.stringify(record())}`, KEY)).toBeNull();
  });
});

describe('content that is signed and still not a session', () => {
  it('is refused rather than thrown on, so a bad cookie is not a 500', async () => {
    expect(await unsealSessionCookie(await signedOver('not json at all'), KEY)).toBeNull();
  });

  it('is refused when a field is missing, rather than half-read', async () => {
    const withoutToken = JSON.stringify({ ...record(), token: '' });
    const withoutRoles = JSON.stringify({
      ...record(),
      identity: { ...CLINICIAN, roles: undefined },
    });

    expect(await unsealSessionCookie(await signedOver(withoutToken), KEY)).toBeNull();
    expect(await unsealSessionCookie(await signedOver(withoutRoles), KEY)).toBeNull();
  });

  it('is refused when a timestamp is not a number, so it cannot become immortal', async () => {
    // A `NaN` deadline compares false against every clock, so a record carrying
    // one would never expire. The seal makes this unreachable from outside;
    // it is checked anyway, because this is the last point before a record
    // becomes a live session.
    const notATime = JSON.stringify({ ...record(), lastSeenAt: 'later' });

    expect(await unsealSessionCookie(await signedOver(notATime), KEY)).toBeNull();
  });

  it('is refused when the role list holds something that is not a role', async () => {
    const oddRoles = JSON.stringify({
      ...record(),
      identity: { ...CLINICIAN, roles: ['clinician', 7] },
    });

    expect(await unsealSessionCookie(await signedOver(oddRoles), KEY)).toBeNull();
  });

  it('is refused when it is not an object at all', async () => {
    expect(await unsealSessionCookie(await signedOver('[1,2,3]'), KEY)).toBeNull();
  });
});

describe('where the key comes from', () => {
  it('is whatever the deployment configured', () => {
    vi.stubEnv('SESSION_COOKIE_SECRET', 'the-configured-one');

    expect(sessionSealKey()).toBe('the-configured-one');
  });

  it('falls back to a development value so a fresh clone runs', () => {
    vi.stubEnv('SESSION_COOKIE_SECRET', '');
    vi.stubEnv('NODE_ENV', 'development');

    expect(sessionSealKey()).not.toBeNull();
  });

  it('is nothing at all in production, because the fallback is in the source', () => {
    // A deployment that fell back to a key everyone can read would be sealing
    // cookies anybody could seal. No key means no session, which is the safe
    // direction for a missing setting.
    vi.stubEnv('SESSION_COOKIE_SECRET', '');
    vi.stubEnv('NODE_ENV', 'production');

    expect(sessionSealKey()).toBeNull();
  });

  it('uses a configured key in production, which is the supported way to run one', () => {
    vi.stubEnv('SESSION_COOKIE_SECRET', 'the-configured-one');
    vi.stubEnv('NODE_ENV', 'production');

    expect(sessionSealKey()).toBe('the-configured-one');
  });
});

describe('sealPayload and unsealPayload', () => {
  const KEY = 'a-key';
  const reader = (parsed: unknown): { a: number } | null =>
    typeof parsed === 'object' &&
    parsed !== null &&
    typeof (parsed as { a?: unknown }).a === 'number'
      ? { a: (parsed as { a: number }).a }
      : null;

  it('round-trips a payload the reader accepts', async () => {
    const sealed = await sealPayload({ a: 1 }, KEY);
    await expect(unsealPayload(sealed, KEY, reader)).resolves.toEqual({ a: 1 });
  });

  it('refuses a payload signed with a different key', async () => {
    const sealed = await sealPayload({ a: 1 }, 'another-key');
    await expect(unsealPayload(sealed, KEY, reader)).resolves.toBeNull();
  });

  it('refuses a payload edited after signing', async () => {
    const sealed = await sealPayload({ a: 1 }, KEY);
    const tampered = `${sealed.slice(0, sealed.indexOf('.') + 1)}{"a":2}`;
    await expect(unsealPayload(tampered, KEY, reader)).resolves.toBeNull();
  });

  it('refuses a shape the reader does not accept, even when the signature is sound', async () => {
    const sealed = await sealPayload({ a: 'not a number' }, KEY);
    await expect(unsealPayload(sealed, KEY, reader)).resolves.toBeNull();
  });

  it.each([
    ['nothing at all', undefined],
    ['an empty string', ''],
    ['no separator', 'abcdef'],
    ['a leading separator', '.{"a":1}'],
    ['a signature that is not base64url', '!!!.{"a":1}'],
    ['a signature of the wrong length', `${'A'.repeat(8)}.{"a":1}`],
  ])('refuses %s', async (_label, value) => {
    await expect(unsealPayload(value, KEY, reader)).resolves.toBeNull();
  });

  it('refuses a signed payload that is not JSON', async () => {
    // Signed correctly, so it reaches the JSON parse, which is the branch under
    // test rather than the signature check above it.
    const sealed = await sealPayload('not json', KEY);
    const broken = `${sealed.slice(0, sealed.indexOf('.') + 1)}not json`;
    await expect(unsealPayload(broken, KEY, reader)).resolves.toBeNull();
  });
});
