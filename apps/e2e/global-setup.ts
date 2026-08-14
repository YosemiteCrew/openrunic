import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * SIGNS THE DRILL IN, BEFORE ANY SCENARIO RUNS.
 *
 * `proxy.ts` redirects every non-public path to the sign-in screen when the
 * request carries no live session cookie. It is the security boundary, it runs
 * server-side on the way in, and it does not care that the browser is a test.
 * So a drill that simply navigates to `/schedule` never reaches the schedule: it
 * lands on a sign-in form and waits for a clinical element that will never
 * appear, once per scenario, until the job's timeout kills it. That is exactly
 * what happened when the drill first met the auth work - a suite that used to
 * finish in under three minutes spent thirty and was cancelled.
 *
 * ## Why the session is minted here instead of signed in through the form
 *
 * `POST /session` checks the submitted token against `developmentCredentials`,
 * and that function returns an empty list when `NODE_ENV` is `production`. The
 * drill runs `next start`, which is production by definition. So there is no
 * credential the sign-in form would accept, and there should not be: demo tokens
 * working against a production build is the thing that rule exists to prevent.
 *
 * ## Why not simply let mock mode skip the proxy
 *
 * Because `resolveApiMode` treats anything that is not the exact string 'live'
 * as mock - it fails open. A proxy that waived authentication whenever it
 * believed it was in mock mode would waive it for any deployment where that
 * variable was unset or misspelled, and in the shipped image the variable is a
 * BUILD argument rather than a runtime one. The failure mode is an EMR serving
 * charts to anyone who asks. A test is never worth that, so the proxy is left
 * exactly as it is and the drill brings a real credential instead.
 *
 * ## What this actually does
 *
 * Seals the same record `POST /session` would have sealed, with the same
 * algorithm and the same key, and hands it to the browser as the same cookie.
 * The drill then goes through the real proxy and the real session gate.
 *
 * The seal is reproduced here rather than imported, because `apps/e2e` does not
 * depend on `apps/web` and adding that dependency to reach one function would
 * pull a Next application into a Playwright package. The duplication is safe in
 * the only direction that matters: if the format ever changes, this cookie stops
 * verifying, the proxy redirects, and the drill fails loudly on its first
 * assertion. It cannot drift into passing.
 */

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Must match the value handed to the web server in `playwright.config.ts`.
 * Not a secret: it seals a fixture session for a browser that Playwright throws
 * away, against a server holding nothing but mock data.
 */
export const DRILL_COOKIE_SECRET = 'openrunic-drill-cookie-seal-not-a-secret';

/** The cookie name `proxy.ts` reads. */
const SESSION_COOKIE = 'or_session';

/**
 * The clinician from the API's own development fixtures, copied from
 * `apps/web/src/lib/auth/directory.ts`. The subject is the load-bearing half:
 * it is what an audit record attributes an action to, so it has to be the real
 * one rather than something that merely looks like it.
 */
const DRILL_IDENTITY = {
  subject: '01890000-0000-7000-8000-000000000101',
  displayName: 'Dr. Adaeze Okafor',
  roles: ['clinician'],
} as const;

const DRILL_TOKEN = 'dev-clinician-a';

function base64Url(signature: ArrayBuffer): string {
  let binary = '';
  for (const byte of new Uint8Array(signature)) binary += String.fromCodePoint(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function utf8(value: string): Uint8Array<ArrayBuffer> {
  const encoded = new TextEncoder().encode(value);
  const buffer = new Uint8Array(encoded.length);
  buffer.set(encoded);
  return buffer;
}

/** `${base64url(HMAC-SHA256(payload))}.${payload}`, as `sealSessionCookie` writes it. */
export async function sealDrillSession(now: number): Promise<string> {
  const record = {
    token: DRILL_TOKEN,
    identity: DRILL_IDENTITY,
    issuedAt: now,
    lastSeenAt: now,
  };
  const payload = JSON.stringify(record);
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    utf8(DRILL_COOKIE_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
  const signature = await globalThis.crypto.subtle.sign('HMAC', key, utf8(payload));
  return `${base64Url(signature)}.${payload}`;
}

/** Where the storage state lands. `playwright.config.ts` reads the same path. */
export const STORAGE_STATE = path.join(here, '.auth', 'drill.json');

export default async function globalSetup(): Promise<void> {
  // Stamped at setup rather than frozen, because both of the session's clocks
  // run from it: a hard-coded timestamp would be expired the day after it was
  // written, and would fail as a redirect to sign-in rather than as anything
  // that pointed at the cause.
  const sealed = await sealDrillSession(Date.now());

  // Created here rather than committed as an empty directory: the file written
  // into it is a credential, so the directory is git-ignored, and a git-ignored
  // directory does not exist on a fresh clone or a CI runner.
  await mkdir(path.dirname(STORAGE_STATE), { recursive: true });

  await writeFile(
    STORAGE_STATE,
    JSON.stringify({
      cookies: [
        {
          name: SESSION_COOKIE,
          value: sealed,
          domain: '127.0.0.1',
          path: '/',
          // The session's own clocks are inside the sealed record and are what
          // the proxy enforces. This one only has to outlive the run.
          expires: Math.floor(Date.now() / 1000) + 60 * 60,
          httpOnly: true,
          secure: false,
          sameSite: 'Lax',
        },
      ],
      origins: [],
    }),
    'utf8'
  );
}
