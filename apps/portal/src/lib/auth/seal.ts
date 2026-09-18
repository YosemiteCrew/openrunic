import { readSessionRecord, type PortalSessionRecord } from './session';

const ALGORITHM = { name: 'HMAC', hash: 'SHA-256' } as const;
const SIGNATURE_BYTES = 32;
const DEVELOPMENT_KEY = 'openrunic-portal-development-cookie-seal-not-a-secret';

export function sessionSealKey(): string | null {
  const configured = process.env.SESSION_COOKIE_SECRET;
  if (configured !== undefined && configured !== '') return configured;
  return process.env.NODE_ENV === 'production' ? null : DEVELOPMENT_KEY;
}

function bytes(value: string): Uint8Array<ArrayBuffer> {
  const encoded = new TextEncoder().encode(value);
  const result = new Uint8Array(encoded.length);
  result.set(encoded);
  return result;
}

async function signingKey(secret: string): Promise<CryptoKey> {
  return globalThis.crypto.subtle.importKey('raw', bytes(secret), ALGORITHM, false, [
    'sign',
    'verify',
  ]);
}

function toBase64Url(signature: ArrayBuffer): string {
  let binary = '';
  for (const byte of new Uint8Array(signature)) binary += String.fromCodePoint(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> | null {
  try {
    const binary = atob(value.replaceAll('-', '+').replaceAll('_', '/'));
    const result = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      result[index] = binary.charCodeAt(index);
    }
    return result;
  } catch {
    return null;
  }
}

export async function sealSessionCookie(
  record: PortalSessionRecord,
  secret: string
): Promise<string> {
  const body = JSON.stringify(record);
  const signature = await globalThis.crypto.subtle.sign(
    ALGORITHM.name,
    await signingKey(secret),
    bytes(body)
  );
  return `${toBase64Url(signature)}.${body}`;
}

export async function unsealSessionCookie(
  value: string | undefined,
  secret: string
): Promise<PortalSessionRecord | null> {
  if (value === undefined || value === '') return null;
  const separator = value.indexOf('.');
  if (separator <= 0) return null;
  const signature = fromBase64Url(value.slice(0, separator));
  if (signature?.length !== SIGNATURE_BYTES) return null;
  const body = value.slice(separator + 1);
  const authentic = await globalThis.crypto.subtle.verify(
    ALGORITHM.name,
    await signingKey(secret),
    signature,
    bytes(body)
  );
  if (!authentic) return null;
  try {
    return readSessionRecord(JSON.parse(body));
  } catch {
    return null;
  }
}
