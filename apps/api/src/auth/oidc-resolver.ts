import { constants, createPublicKey, verify as verifySignature } from 'node:crypto';

import { createJwksCache, type Jwk } from './jwks.js';
import {
  ACTOR_TYPES,
  type ActorType,
  type Principal,
  type PrincipalResolver,
} from './principal.js';
import { parseScopes } from './scopes.js';

/**
 * The production {@link PrincipalResolver}: a bearer token verified against the
 * identity provider's published keys.
 *
 * Everything here runs before the request has an identity, so it is the one
 * module in the API that an unauthenticated stranger can reach at will. Two
 * consequences shape the code.
 *
 * The first is ordering. The header is inspected, and its algorithm accepted or
 * refused, before any key is looked up, because algorithm confusion is won in
 * the header: a token that asks to be verified with a symmetric algorithm is
 * asking us to treat a public key as a shared secret, and the only safe answer
 * is to refuse before that key is in hand.
 *
 * The second is the failure policy. Any defect in the token resolves to `null`,
 * with no indication of which check failed, so the authn middleware renders one
 * indistinguishable 401 and a probe learns nothing from the difference between
 * a bad signature and an expired token. A failure to *reach* the key set is not
 * a defect in the token and is deliberately allowed to reject: an identity
 * provider outage should surface as a 500 carrying a request id, not as "your
 * credentials are wrong" delivered simultaneously to every user of the system.
 */

export interface OidcClaimNames {
  readonly tenantId?: string;
  readonly roles?: string;
  readonly facilityIds?: string;
  readonly purposeOfUse?: string;
  readonly patient?: string;
  readonly actorType?: string;
  readonly displayName?: string;
}

export interface OidcResolverOptions {
  readonly issuer: string;
  readonly audience: string | readonly string[];
  readonly jwksUri: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => Date;
  /** Tolerance on `exp`, `nbf` and `iat`, in seconds. Default 60. */
  readonly clockSkewSeconds?: number;
  readonly cacheTtlMs?: number;
  readonly minRefetchIntervalMs?: number;
  readonly claims?: OidcClaimNames;
  /** Algorithms accepted. Default ['RS256','RS384','RS512','ES256','ES384','ES512']. */
  readonly algorithms?: readonly string[];
}

const DEFAULT_ALGORITHMS: readonly string[] = [
  'RS256',
  'RS384',
  'RS512',
  'ES256',
  'ES384',
  'ES512',
];

const DEFAULT_CLOCK_SKEW_SECONDS = 60;

const DEFAULT_CLAIM_NAMES: Required<OidcClaimNames> = {
  tenantId: 'tenant',
  roles: 'roles',
  facilityIds: 'facilities',
  purposeOfUse: 'purpose_of_use',
  patient: 'patient',
  actorType: 'actor_type',
  displayName: 'name',
};

/**
 * Recorded when the token asserts no purpose. Most identity providers do not
 * send one, and refusing those tokens would refuse nearly all of them; `TREAT`
 * is what an unqualified clinical access is filed under, and an auditor reading
 * it should understand it as "no purpose asserted" rather than as a claim the
 * token actually made.
 */
const DEFAULT_PURPOSE_OF_USE = 'TREAT';

const DEFAULT_ACTOR_TYPE: ActorType = 'user';

/** Base64url alphabet, unpadded. Anything else is not a JWS segment. */
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

interface SignatureAlgorithm {
  /** Digest name for `crypto.verify`. */
  readonly hash: string;
  /** Key family the algorithm is defined over, checked against the fetched key. */
  readonly keyType: string;
  readonly verifyOptions?: {
    readonly padding?: number;
    readonly saltLength?: number;
    readonly dsaEncoding?: 'der' | 'ieee-p1363';
  };
}

/**
 * The algorithms this verifier knows how to check. `none` and the HMAC family
 * are absent by construction rather than by a guard: there is no entry to look
 * up, so no configuration mistake in `algorithms` can bring them back.
 *
 * ECDSA signatures in a JWS are the raw r||s pair rather than the DER sequence
 * OpenSSL produces by default, hence `ieee-p1363`.
 */
const SIGNATURE_ALGORITHMS: Readonly<Record<string, SignatureAlgorithm>> = {
  RS256: { hash: 'sha256', keyType: 'rsa' },
  RS384: { hash: 'sha384', keyType: 'rsa' },
  RS512: { hash: 'sha512', keyType: 'rsa' },
  PS256: {
    hash: 'sha256',
    keyType: 'rsa',
    verifyOptions: {
      padding: constants.RSA_PKCS1_PSS_PADDING,
      saltLength: constants.RSA_PSS_SALTLEN_DIGEST,
    },
  },
  PS384: {
    hash: 'sha384',
    keyType: 'rsa',
    verifyOptions: {
      padding: constants.RSA_PKCS1_PSS_PADDING,
      saltLength: constants.RSA_PSS_SALTLEN_DIGEST,
    },
  },
  PS512: {
    hash: 'sha512',
    keyType: 'rsa',
    verifyOptions: {
      padding: constants.RSA_PKCS1_PSS_PADDING,
      saltLength: constants.RSA_PSS_SALTLEN_DIGEST,
    },
  },
  ES256: { hash: 'sha256', keyType: 'ec', verifyOptions: { dsaEncoding: 'ieee-p1363' } },
  ES384: { hash: 'sha384', keyType: 'ec', verifyOptions: { dsaEncoding: 'ieee-p1363' } },
  ES512: { hash: 'sha512', keyType: 'ec', verifyOptions: { dsaEncoding: 'ieee-p1363' } },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function isTriple(segments: readonly string[]): segments is readonly [string, string, string] {
  return segments.length === 3;
}

/**
 * Decodes one base64url JWS segment into a JSON object, or null when it is not
 * one. The charset is checked first because `Buffer.from` silently discards
 * characters outside the alphabet, which would let two different token strings
 * decode to the same claims.
 */
function decodeSegment(segment: string): Record<string, unknown> | null {
  if (!BASE64URL_PATTERN.test(segment)) return null;

  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  return isRecord(decoded) ? decoded : null;
}

function stringClaim(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/** The string members of a claim that should have been an array of strings. */
function fromArrayClaim(value: unknown): string[] {
  if (!isUnknownArray(value)) return [];

  const entries: string[] = [];
  for (const entry of value) {
    const text = stringClaim(entry);
    if (text !== null) entries.push(text);
  }
  return entries;
}

/**
 * Normalises a claim that may be a JSON array or a space-separated string.
 * `scope` is the OAuth spelling and arrives as one string; `roles` and the rest
 * arrive either way depending on the provider's mapper.
 */
function toStringArray(value: unknown): string[] {
  if (typeof value === 'string') return value.split(/\s+/).filter((entry) => entry !== '');
  return fromArrayClaim(value);
}

/**
 * A numeric date claim. `undefined` means the claim is absent, `null` means it
 * is present but not a finite number, and the two lead to different answers:
 * an absent `nbf` is normal, a garbled one is a token to refuse.
 */
function numericDate(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * `aud` is a string or an array of strings, and unlike `scope` a single string
 * is one audience rather than a list: splitting it on whitespace would let an
 * audience nobody configured slip in beside one that was.
 */
function audienceAccepted(value: unknown, accepted: readonly string[]): boolean {
  const presented = typeof value === 'string' ? [value] : fromArrayClaim(value);
  return presented.some((entry) => accepted.includes(entry));
}

function resolveClaimNames(overrides: OidcClaimNames = {}): Required<OidcClaimNames> {
  return {
    tenantId: overrides.tenantId ?? DEFAULT_CLAIM_NAMES.tenantId,
    roles: overrides.roles ?? DEFAULT_CLAIM_NAMES.roles,
    facilityIds: overrides.facilityIds ?? DEFAULT_CLAIM_NAMES.facilityIds,
    purposeOfUse: overrides.purposeOfUse ?? DEFAULT_CLAIM_NAMES.purposeOfUse,
    patient: overrides.patient ?? DEFAULT_CLAIM_NAMES.patient,
    actorType: overrides.actorType ?? DEFAULT_CLAIM_NAMES.actorType,
    displayName: overrides.displayName ?? DEFAULT_CLAIM_NAMES.displayName,
  };
}

/**
 * An unrecognised actor type is refused rather than defaulted, because the
 * audit vocabulary distinguishes a patient from a member of staff and quietly
 * filing an unknown value as staff would misattribute every record it touches.
 */
function readActorType(value: unknown): ActorType | null {
  if (value === undefined) return DEFAULT_ACTOR_TYPE;

  const candidate = stringClaim(value);
  if (candidate === null) return null;
  return ACTOR_TYPES.find((actorType) => actorType === candidate) ?? null;
}

type CompartmentDecision =
  | { readonly kind: 'none' }
  | { readonly kind: 'confined'; readonly patientId: string }
  | { readonly kind: 'unusable' };

/**
 * Decides whether the token is confined to one chart.
 *
 * A launch context without a patient scope is not a restriction: the token was
 * simply launched somewhere, and honouring it as a compartment would silently
 * hide records the user is entitled to see. A patient scope without a launch
 * context is the dangerous half of the same pair: the token claims to be
 * confined and does not say to what, so there is no chart to confine it to and
 * no safe way to guess one. That token is refused.
 */
function decideCompartment(launchPatient: unknown, scopes: readonly string[]): CompartmentDecision {
  const patientScoped = parseScopes(scopes).some((scope) => scope.compartment === 'patient');
  if (!patientScoped) return { kind: 'none' };

  const patientId = stringClaim(launchPatient);
  return patientId === null ? { kind: 'unusable' } : { kind: 'confined', patientId };
}

/** Maps verified claims onto a {@link Principal}, or null when they cannot be. */
function toPrincipal(
  claims: Record<string, unknown>,
  names: OidcClaimNames = {}
): Principal | null {
  const resolved = resolveClaimNames(names);

  const subject = stringClaim(claims.sub);
  if (subject === null) return null;

  // Without a tenant there is nothing to scope the request to, and the
  // tenant-scope middleware reads this field and no other.
  const tenantId = stringClaim(claims[resolved.tenantId]);
  if (tenantId === null) return null;

  const actorType = readActorType(claims[resolved.actorType]);
  if (actorType === null) return null;

  const scopes = [...new Set([...toStringArray(claims.scope), ...toStringArray(claims.scopes)])];

  const compartment = decideCompartment(claims[resolved.patient], scopes);
  if (compartment.kind === 'unusable') return null;

  const displayName = stringClaim(claims[resolved.displayName]);

  return {
    subject,
    tenantId,
    actorType,
    ...(displayName === null ? {} : { displayName }),
    roles: toStringArray(claims[resolved.roles]),
    facilityIds: toStringArray(claims[resolved.facilityIds]),
    scopes,
    ...(compartment.kind === 'confined' ? { compartmentPatientId: compartment.patientId } : {}),
    purposeOfUse: stringClaim(claims[resolved.purposeOfUse]) ?? DEFAULT_PURPOSE_OF_USE,
  };
}

/**
 * Verifies the signature over `header.payload`. A key that cannot be imported,
 * or one from the wrong family for the algorithm, counts as a token this
 * process cannot verify rather than as a provider outage: there is nothing a
 * client could resend that would help, and the answer is the same 401.
 */
function signatureIsValid(
  jwk: Jwk,
  algorithm: SignatureAlgorithm,
  signingInput: string,
  signature: string
): boolean {
  try {
    const key = createPublicKey({ key: { ...jwk }, format: 'jwk' });
    if (key.asymmetricKeyType !== algorithm.keyType) return false;

    return verifySignature(
      algorithm.hash,
      Buffer.from(signingInput, 'ascii'),
      { key, ...algorithm.verifyOptions },
      Buffer.from(signature, 'base64url')
    );
  } catch {
    return false;
  }
}

export function createOidcPrincipalResolver(options: OidcResolverOptions): PrincipalResolver {
  const nowDate = options.now ?? ((): Date => new Date());
  const skewSeconds = options.clockSkewSeconds ?? DEFAULT_CLOCK_SKEW_SECONDS;
  const accepted = new Set(options.algorithms ?? DEFAULT_ALGORITHMS);
  const audiences = typeof options.audience === 'string' ? [options.audience] : options.audience;
  const claimNames = resolveClaimNames(options.claims);

  const jwks = createJwksCache({
    jwksUri: options.jwksUri,
    now: () => nowDate().getTime(),
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    ...(options.cacheTtlMs === undefined ? {} : { cacheTtlMs: options.cacheTtlMs }),
    ...(options.minRefetchIntervalMs === undefined
      ? {}
      : { minRefetchIntervalMs: options.minRefetchIntervalMs }),
  });

  function claimsAreValid(claims: Record<string, unknown>): boolean {
    if (claims.iss !== options.issuer) return false;
    if (!audienceAccepted(claims.aud, audiences)) return false;

    const nowSeconds = nowDate().getTime() / 1000;

    const expiry = numericDate(claims.exp);
    if (expiry === undefined || expiry === null) return false;
    if (nowSeconds > expiry + skewSeconds) return false;

    const notBefore = numericDate(claims.nbf);
    if (notBefore === null) return false;
    if (notBefore !== undefined && nowSeconds < notBefore - skewSeconds) return false;

    const issuedAt = numericDate(claims.iat);
    if (issuedAt === null) return false;
    if (issuedAt !== undefined && nowSeconds < issuedAt - skewSeconds) return false;

    return true;
  }

  return {
    async resolve(token: string): Promise<Principal | null> {
      const segments = token.split('.');
      if (!isTriple(segments)) return null;
      const [headerSegment, payloadSegment, signatureSegment] = segments;

      const header = decodeSegment(headerSegment);
      if (header === null) return null;

      const algorithmName = header.alg;
      if (typeof algorithmName !== 'string' || !accepted.has(algorithmName)) return null;
      const algorithm = SIGNATURE_ALGORITHMS[algorithmName];
      if (algorithm === undefined) return null;

      if (!BASE64URL_PATTERN.test(signatureSegment)) return null;

      const kid = typeof header.kid === 'string' ? header.kid : undefined;
      // Deliberately unguarded: a JWKS transport failure rejects, and the
      // request becomes a 500 rather than a fleet-wide 401.
      const jwk = await jwks.keyFor(kid);
      if (jwk === null) return null;

      const signingInput = `${headerSegment}.${payloadSegment}`;
      if (!signatureIsValid(jwk, algorithm, signingInput, signatureSegment)) return null;

      const claims = decodeSegment(payloadSegment);
      if (claims === null) return null;
      if (!claimsAreValid(claims)) return null;

      return toPrincipal(claims, claimNames);
    },
  };
}

/**
 * Exposed for the suite only, and not part of the resolver contract. These two
 * functions are where a hostile string becomes ordinary data, so they are worth
 * exercising directly rather than only through signed fixtures.
 */
export const __internals = { decodeSegment, toPrincipal };
