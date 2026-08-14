import { readSessionRecord } from './session';
import type { SessionRecord } from './session';

/**
 * The session cookie's seal: a keyed signature over the JSON, so that the two
 * clocks inside it mean something.
 *
 * ## Why this exists now, when it did not before
 *
 * The cookie used to be plain JSON, and the argument for leaving it that way
 * was that nothing in it is a permission: the token is a credential the API
 * verifies on every request, so a rewritten cookie buys an application shell
 * and a screenful of 401s. That argument was true about the token and wrong
 * about the clocks.
 *
 * `issuedAt` and `lastSeenAt` are the idle timeout and the absolute lifetime.
 * They are the whole of what stops a session that is still valid to the API
 * from lasting forever, and they were writable by anyone holding the cookie.
 * The timeout exists for a workstation left signed in and walked away from;
 * somebody who finds that workstation while the session is still live can open
 * the browser's cookie editor - `httpOnly` withholds the value from
 * `document.cookie`, not from devtools - move `issuedAt` to now, and turn a
 * session with one minute left into one with twelve hours. A control the person
 * it is meant to constrain can rewrite is not a control.
 *
 * So the value is `<signature>.<json>`, signed with HMAC-SHA-256. Rewriting any
 * byte of the JSON invalidates the signature, and the cookie reads as no
 * session at all.
 *
 * ## What the seal establishes, and what it does not
 *
 * It establishes that this deployment wrote this record and that nothing has
 * changed since. That is all. In particular it does **not** make the cookie a
 * proof of identity to anything downstream: the API is a separate origin that
 * has never seen this key and authenticates the bearer token on its own. Nor
 * does it protect a cookie that is copied whole - a sealed cookie lifted off a
 * workstation is a valid sealed cookie until its clocks run out, which is
 * precisely why the clocks are worth protecting.
 *
 * ## Where the key comes from
 *
 * `SESSION_COOKIE_SECRET`, and outside production a fixed development value so
 * that `next dev` works on a clean checkout. The development value is in the
 * source, which makes it not a secret and is why production refuses to fall
 * back to it: a deployment with no key configured mints no sessions and
 * recognises none, and `POST /session` says so with a 503 rather than pretending
 * the credential was wrong. Failing closed and loud is the only safe direction
 * for a missing key.
 *
 * The reader and the writer live in different runtimes - `proxy.ts` runs at the
 * edge, the route handler runs in Node - so this uses Web Crypto, which both
 * have, rather than `node:crypto`, which only one of them does. That is also
 * why the two functions are async: `crypto.subtle` has no synchronous form, and
 * an interface that pretended otherwise would have to block or lie.
 */

const ALGORITHM = { name: 'HMAC', hash: 'SHA-256' } as const;

/** HMAC-SHA-256 output. A signature of any other length was not written here. */
const SIGNATURE_BYTES = 32;

/**
 * Not a secret, and named so that nobody has to guess. It exists so that a
 * fresh clone runs, and it is refused in production for exactly the reason it
 * is convenient in development: everyone can read it.
 */
const DEVELOPMENT_KEY = 'openrunic-development-cookie-seal-not-a-secret';

/**
 * The key this deployment seals with, or null when it has none.
 *
 * Read at call time rather than captured, because the answer differs between
 * the edge runtime and the Node runtime the route handler uses, and a value
 * frozen at module load in one of them would be the wrong answer in the other.
 */
export function sessionSealKey(): string | null {
  const configured = process.env.SESSION_COOKIE_SECRET;
  if (configured !== undefined && configured !== '') return configured;

  return process.env.NODE_ENV === 'production' ? null : DEVELOPMENT_KEY;
}

/**
 * UTF-8 bytes in a buffer Web Crypto will accept.
 *
 * `TextEncoder.encode` is typed as returning a view over `ArrayBufferLike`,
 * which includes `SharedArrayBuffer`, and `crypto.subtle` takes only the plain
 * kind. Copying into one allocated here is what makes that true rather than
 * asserted, and the strings involved are a cookie and a key.
 */
function bytes(value: string): Uint8Array<ArrayBuffer> {
  const encoded = new TextEncoder().encode(value);
  const buffer = new Uint8Array(encoded.length);
  buffer.set(encoded);
  return buffer;
}

async function signingKey(secret: string): Promise<CryptoKey> {
  return globalThis.crypto.subtle.importKey('raw', bytes(secret), ALGORITHM, false, [
    'sign',
    'verify',
  ]);
}

/**
 * Base64url rather than base64, because the padding and the `+` and `/` of
 * plain base64 are exactly the characters that would then be percent-encoded
 * into the cookie header and have to survive a round trip to come back.
 */
function toBase64Url(signature: ArrayBuffer): string {
  let binary = '';
  for (const byte of new Uint8Array(signature)) binary += String.fromCodePoint(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> | null {
  try {
    const binary = atob(value.replaceAll('-', '+').replaceAll('_', '/'));
    const decoded = new Uint8Array(binary.length);
    /* `charCodeAt` rather than `codePointAt`, deliberately. `atob` returns a
       binary string, in which every character is one UTF-16 code unit in the
       range 0-255, and what this loop wants at each index is that unit as a
       byte. The two calls agree on all 256 values `atob` can produce and differ
       only above 0xFFFF, which is precisely where reading a byte per index is
       already wrong: such a code point spans two indices, and storing it in a
       `Uint8Array` slot truncates it to zero rather than to its low byte. These
       bytes are the signature `crypto.subtle.verify` checks, so the accessor
       here stays the one that reads code units. */
    for (let index = 0; index < binary.length; index += 1) {
      decoded[index] = binary.charCodeAt(index);
    }
    return decoded;
  } catch {
    // `atob` throws on anything that is not base64. A cookie somebody typed is
    // not a cookie we wrote, which is the same answer as a bad signature.
    return null;
  }
}

/**
 * JSON, signed, with the signature first.
 *
 * The JSON itself is not encoded further. A cookie value cannot carry a
 * semicolon, a space, a quote or a character outside ASCII, all of which JSON
 * produces, and the platform already percent-encodes on the way into
 * `Set-Cookie` and decodes on the way out of `Cookie`. Encoding here as well
 * produced a value escaped twice on the way out and once on the way back, so
 * every session ended at the first reload.
 */
export async function sealSessionCookie(record: SessionRecord, key: string): Promise<string> {
  const payload = JSON.stringify(record);
  const signature = await globalThis.crypto.subtle.sign(
    ALGORITHM.name,
    await signingKey(key),
    bytes(payload)
  );

  return `${toBase64Url(signature)}.${payload}`;
}

/**
 * Reads a sealed cookie, or null for anything this deployment did not write.
 *
 * `crypto.subtle.verify` rather than a comparison written here, because the
 * platform's is constant-time and one written by hand is one review away from
 * not being. A parse failure, a bad signature and a well-formed record of the
 * wrong shape all return the same null: none of them is a session.
 */
export async function unsealSessionCookie(
  value: string | undefined,
  key: string
): Promise<SessionRecord | null> {
  if (value === undefined || value === '') return null;

  const separator = value.indexOf('.');
  if (separator <= 0) return null;

  /* A prefix that would not decode reads as `undefined` here rather than as a
     length, and `undefined` is not `SIGNATURE_BYTES` either. Not base64 at all
     and the wrong number of bytes are the same answer: not a cookie we wrote. */
  const signature = fromBase64Url(value.slice(0, separator));
  if (signature?.length !== SIGNATURE_BYTES) return null;

  const payload = value.slice(separator + 1);
  const authentic = await globalThis.crypto.subtle.verify(
    ALGORITHM.name,
    await signingKey(key),
    signature,
    bytes(payload)
  );
  if (!authentic) return null;

  try {
    return readSessionRecord(JSON.parse(payload));
  } catch {
    // Signed by us and still not JSON is not reachable today. It is handled
    // rather than thrown so that a future change to what gets sealed cannot
    // turn a malformed cookie into a 500 on every request through the proxy.
    return null;
  }
}
