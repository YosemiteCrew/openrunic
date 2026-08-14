import { constants, createHmac, generateKeyPairSync, sign as signBytes } from 'node:crypto';
import type { KeyObject } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createJwksCache } from '../auth/jwks.js';
import {
  __internals,
  createOidcPrincipalResolver,
  type OidcResolverOptions,
} from '../auth/oidc-resolver.js';
import type { Principal, PrincipalResolver } from '../auth/principal.js';

/**
 * The token verifier is the one module an unauthenticated stranger can reach,
 * so the suite spends most of its effort on tokens that must be refused.
 *
 * All key material is generated here, at run time, and every identifier is
 * synthetic: nothing in this file is a credential anywhere, and no fixture is
 * copied from a real deployment.
 */

const ISSUER = 'https://identity.openrunic.invalid/';
const AUDIENCE = 'https://api.openrunic.invalid/fhir';
const JWKS_URI = 'https://identity.openrunic.invalid/jwks';

const TENANT = '01890000-0000-7000-8000-00000000000a';
const SUBJECT = '01890000-0000-7000-8000-000000000101';
const FACILITY = '01890000-0000-7000-8000-0000000000fa';
const PATIENT = '01890000-0000-7000-8000-000000000001';

const NOW = new Date('2026-08-13T09:00:00.000Z');
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000);

const RSA_KID = 'rsa-2026-08';
const EC_KID = 'ec-2026-08';
const ROTATED_KID = 'rsa-2026-09';

const rsaKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const rotatedKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const ecKeys = generateKeyPairSync('ec', { namedCurve: 'P-256' });

function publicJwk(key: KeyObject, kid: string): Record<string, unknown> {
  return { ...key.export({ format: 'jwk' }), kid, use: 'sig' };
}

const RSA_JWK = publicJwk(rsaKeys.publicKey, RSA_KID);
const EC_JWK = publicJwk(ecKeys.publicKey, EC_KID);
const ROTATED_JWK = publicJwk(rotatedKeys.publicKey, ROTATED_KID);

type Signer = (input: Buffer) => Buffer;

const rsaSigner: Signer = (input) => signBytes('sha256', input, rsaKeys.privateKey);
const rotatedSigner: Signer = (input) => signBytes('sha256', input, rotatedKeys.privateKey);
const ecSigner: Signer = (input) =>
  signBytes('sha256', input, { key: ecKeys.privateKey, dsaEncoding: 'ieee-p1363' });
const pssSigner: Signer = (input) =>
  signBytes('sha256', input, {
    key: rsaKeys.privateKey,
    padding: constants.RSA_PKCS1_PSS_PADDING,
    saltLength: constants.RSA_PSS_SALTLEN_DIGEST,
  });

function encodeSegment(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

/** Signs `header.payload` as a JWS, from segments rather than from objects. */
function jws(headerSegment: string, payloadSegment: string, signer: Signer): string {
  const signingInput = `${headerSegment}.${payloadSegment}`;
  return `${signingInput}.${signer(Buffer.from(signingInput, 'ascii')).toString('base64url')}`;
}

function claims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: ISSUER,
    aud: AUDIENCE,
    sub: SUBJECT,
    exp: NOW_SECONDS + 300,
    iat: NOW_SECONDS - 5,
    tenant: TENANT,
    ...overrides,
  };
}

/** The everyday token: RS256, signed by the key the provider publishes. */
function rs256(
  overrides: Record<string, unknown> = {},
  header: Record<string, unknown> = {}
): string {
  return jws(
    encodeSegment({ alg: 'RS256', kid: RSA_KID, typ: 'JWT', ...header }),
    encodeSegment(claims(overrides)),
    rsaSigner
  );
}

type Responder = () => Promise<Response>;

function jsonResponder(body: unknown): Responder {
  return () =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
}

interface FakeProvider {
  readonly fetch: typeof globalThis.fetch;
  readonly calls: number;
  serve(responder: Responder): void;
  serveKeys(keys: readonly unknown[]): void;
}

/** An in-memory identity provider. Counts calls so refetch policy is provable. */
function fakeProvider(keys: readonly unknown[] = [RSA_JWK, EC_JWK]): FakeProvider {
  let responder = jsonResponder({ keys });
  let calls = 0;

  return {
    fetch: () => {
      calls += 1;
      return responder();
    },
    get calls(): number {
      return calls;
    },
    serve(next: Responder): void {
      responder = next;
    },
    serveKeys(next: readonly unknown[]): void {
      responder = jsonResponder({ keys: next });
    },
  };
}

function resolverFor(
  provider: FakeProvider,
  extra: Partial<OidcResolverOptions> = {}
): PrincipalResolver {
  return createOidcPrincipalResolver({
    issuer: ISSUER,
    audience: AUDIENCE,
    jwksUri: JWKS_URI,
    fetch: provider.fetch,
    now: () => NOW,
    ...extra,
  });
}

/** Normalises the resolver's sync-or-async return into a promise. */
function resolveToken(resolver: PrincipalResolver, token: string): Promise<Principal | null> {
  return Promise.resolve(resolver.resolve(token));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a token the verifier accepts', () => {
  it('maps an RS256 token onto a principal', async () => {
    const resolver = resolverFor(fakeProvider());

    const principal = await resolveToken(
      resolver,
      rs256({
        name: 'Dr. Adaeze Okafor',
        roles: ['clinician'],
        facilities: [FACILITY],
        scope: 'openid fhirUser user/Patient.read',
        purpose_of_use: 'TREAT',
      })
    );

    expect(principal).toEqual({
      subject: SUBJECT,
      tenantId: TENANT,
      actorType: 'user',
      displayName: 'Dr. Adaeze Okafor',
      roles: ['clinician'],
      facilityIds: [FACILITY],
      scopes: ['openid', 'fhirUser', 'user/Patient.read'],
      purposeOfUse: 'TREAT',
    });
  });

  it('verifies an ES256 token, whose signature is a raw r||s pair', async () => {
    const resolver = resolverFor(fakeProvider());
    const token = jws(
      encodeSegment({ alg: 'ES256', kid: EC_KID }),
      encodeSegment(claims()),
      ecSigner
    );

    expect(await resolveToken(resolver, token)).not.toBeNull();
  });

  it('verifies a PS256 token when the deployment asks for that algorithm', async () => {
    const resolver = resolverFor(fakeProvider(), { algorithms: ['PS256'] });
    const token = jws(
      encodeSegment({ alg: 'PS256', kid: RSA_KID }),
      encodeSegment(claims()),
      pssSigner
    );

    expect(await resolveToken(resolver, token)).not.toBeNull();
  });

  it('records the raw scope strings, including the ones it does not parse', async () => {
    const resolver = resolverFor(fakeProvider());

    const principal = await resolveToken(
      resolver,
      rs256({ scope: 'launch/patient offline_access' })
    );

    expect(principal?.scopes).toEqual(['launch/patient', 'offline_access']);
  });

  it('fetches the key set once and serves later tokens from cache', async () => {
    const provider = fakeProvider();
    const resolver = resolverFor(provider);

    await resolveToken(resolver, rs256());
    await resolveToken(resolver, rs256({ sub: 'another-subject' }));

    expect(provider.calls).toBe(1);
  });

  it('accepts a token whose expiry has just passed but is inside the skew window', async () => {
    const resolver = resolverFor(fakeProvider(), { clockSkewSeconds: 60 });

    expect(await resolveToken(resolver, rs256({ exp: NOW_SECONDS - 30 }))).not.toBeNull();
  });

  it('accepts a not-before that is barely in the future', async () => {
    const resolver = resolverFor(fakeProvider());

    expect(await resolveToken(resolver, rs256({ nbf: NOW_SECONDS + 30 }))).not.toBeNull();
  });

  it('accepts one of several configured audiences', async () => {
    const resolver = resolverFor(fakeProvider(), {
      audience: ['https://other.invalid/', AUDIENCE],
    });

    expect(await resolveToken(resolver, rs256())).not.toBeNull();
  });

  it('accepts an aud array holding one of the configured audiences', async () => {
    const resolver = resolverFor(fakeProvider());

    expect(
      await resolveToken(resolver, rs256({ aud: ['https://other.invalid/', AUDIENCE] }))
    ).not.toBeNull();
  });

  it('uses the single published key when the header names no kid', async () => {
    const resolver = resolverFor(fakeProvider([RSA_JWK]));
    const token = jws(encodeSegment({ alg: 'RS256' }), encodeSegment(claims()), rsaSigner);

    expect(await resolveToken(resolver, token)).not.toBeNull();
  });

  it('works on its defaults, with no clock, transport or claim names injected', async () => {
    const provider = fakeProvider();
    vi.stubGlobal('fetch', provider.fetch);
    const resolver = createOidcPrincipalResolver({
      issuer: ISSUER,
      audience: AUDIENCE,
      jwksUri: JWKS_URI,
    });
    const realNowSeconds = Math.floor(Date.now() / 1000);

    const principal = await resolveToken(
      resolver,
      jws(
        encodeSegment({ alg: 'RS256', kid: RSA_KID }),
        encodeSegment({
          iss: ISSUER,
          aud: AUDIENCE,
          sub: SUBJECT,
          tenant: TENANT,
          exp: realNowSeconds + 300,
        }),
        rsaSigner
      )
    );

    expect(principal?.subject).toBe(SUBJECT);
    expect(provider.calls).toBe(1);
  });
});

describe('a token the verifier refuses', () => {
  it('refuses an unsigned token before it looks at any key', async () => {
    const provider = fakeProvider();
    const resolver = resolverFor(provider);
    const token = `${encodeSegment({ alg: 'none' })}.${encodeSegment(claims())}.`;

    expect(await resolveToken(resolver, token)).toBeNull();
    expect(provider.calls).toBe(0);
  });

  it('refuses an algorithm the deployment did not accept, even a sound one', async () => {
    const provider = fakeProvider();
    const resolver = resolverFor(provider);
    const token = jws(
      encodeSegment({ alg: 'PS256', kid: RSA_KID }),
      encodeSegment(claims()),
      pssSigner
    );

    expect(await resolveToken(resolver, token)).toBeNull();
    expect(provider.calls).toBe(0);
  });

  it('refuses a symmetric algorithm signed with the public key as the secret', async () => {
    const resolver = resolverFor(fakeProvider(), { algorithms: ['RS256', 'HS256'] });
    const headerSegment = encodeSegment({ alg: 'HS256', kid: RSA_KID });
    const payloadSegment = encodeSegment(claims());
    const signingInput = `${headerSegment}.${payloadSegment}`;
    const mac = createHmac('sha256', rsaKeys.publicKey.export({ type: 'spki', format: 'pem' }))
      .update(signingInput)
      .digest('base64url');

    expect(await resolveToken(resolver, `${signingInput}.${mac}`)).toBeNull();
  });

  it('refuses a header whose alg is not a string', async () => {
    const resolver = resolverFor(fakeProvider());
    const token = jws(encodeSegment({ alg: 256 }), encodeSegment(claims()), rsaSigner);

    expect(await resolveToken(resolver, token)).toBeNull();
  });

  it('refuses a payload that was edited after signing', async () => {
    const resolver = resolverFor(fakeProvider());
    const token = rs256();
    const [headerSegment, , signatureSegment] = token.split('.');
    const tampered = `${String(headerSegment)}.${encodeSegment(claims({ tenant: 'another-tenant' }))}.${String(signatureSegment)}`;

    expect(await resolveToken(resolver, tampered)).toBeNull();
  });

  it('refuses a token signed by a key the provider does not publish', async () => {
    const resolver = resolverFor(fakeProvider([RSA_JWK]));
    const token = jws(
      encodeSegment({ alg: 'RS256', kid: RSA_KID }),
      encodeSegment(claims()),
      rotatedSigner
    );

    expect(await resolveToken(resolver, token)).toBeNull();
  });

  it('refuses a kid the provider has never published', async () => {
    const resolver = resolverFor(fakeProvider());

    expect(await resolveToken(resolver, rs256({}, { kid: 'invented-kid' }))).toBeNull();
  });

  it('refuses a key of the wrong family for the algorithm', async () => {
    const resolver = resolverFor(fakeProvider());
    const token = jws(
      encodeSegment({ alg: 'RS256', kid: EC_KID }),
      encodeSegment(claims()),
      ecSigner
    );

    expect(await resolveToken(resolver, token)).toBeNull();
  });

  it('refuses a truncated ECDSA signature rather than throwing', async () => {
    const resolver = resolverFor(fakeProvider());
    const token = jws(
      encodeSegment({ alg: 'ES256', kid: EC_KID }),
      encodeSegment(claims()),
      ecSigner
    );

    expect(await resolveToken(resolver, token.slice(0, -8))).toBeNull();
  });

  it('refuses a published key that cannot be imported', async () => {
    const resolver = resolverFor(fakeProvider([{ kty: 'RSA', kid: RSA_KID }]));

    expect(await resolveToken(resolver, rs256())).toBeNull();
  });

  it('refuses a token that is not three segments', async () => {
    const resolver = resolverFor(fakeProvider());
    const token = rs256();

    expect(await resolveToken(resolver, token.split('.').slice(0, 2).join('.'))).toBeNull();
    expect(await resolveToken(resolver, `${token}.extra`)).toBeNull();
    expect(await resolveToken(resolver, '')).toBeNull();
  });

  it('refuses a header segment outside the base64url alphabet', async () => {
    const resolver = resolverFor(fakeProvider());

    expect(await resolveToken(resolver, `he+der.${encodeSegment(claims())}.signature`)).toBeNull();
  });

  it('refuses a signature segment outside the base64url alphabet', async () => {
    const provider = fakeProvider();
    const resolver = resolverFor(provider);
    const [headerSegment, payloadSegment] = rs256().split('.');

    expect(
      await resolveToken(resolver, `${String(headerSegment)}.${String(payloadSegment)}.**`)
    ).toBeNull();
    expect(provider.calls).toBe(0);
  });

  it('refuses a payload that is not JSON, however well it is signed', async () => {
    const resolver = resolverFor(fakeProvider());
    const token = jws(
      encodeSegment({ alg: 'RS256', kid: RSA_KID }),
      Buffer.from('not json at all', 'utf8').toString('base64url'),
      rsaSigner
    );

    expect(await resolveToken(resolver, token)).toBeNull();
  });

  it('refuses a payload that is JSON but not an object', async () => {
    const resolver = resolverFor(fakeProvider());
    const token = jws(
      encodeSegment({ alg: 'RS256', kid: RSA_KID }),
      encodeSegment(['patient/Patient.read']),
      rsaSigner
    );

    expect(await resolveToken(resolver, token)).toBeNull();
  });

  it('refuses another issuer', async () => {
    const resolver = resolverFor(fakeProvider());

    expect(await resolveToken(resolver, rs256({ iss: 'https://elsewhere.invalid/' }))).toBeNull();
    expect(await resolveToken(resolver, rs256({ iss: undefined }))).toBeNull();
  });

  it('refuses an audience this deployment does not answer to', async () => {
    const resolver = resolverFor(fakeProvider());

    expect(await resolveToken(resolver, rs256({ aud: 'https://other.invalid/' }))).toBeNull();
    expect(await resolveToken(resolver, rs256({ aud: [] }))).toBeNull();
    expect(await resolveToken(resolver, rs256({ aud: [17] }))).toBeNull();
    expect(await resolveToken(resolver, rs256({ aud: undefined }))).toBeNull();
  });

  it('refuses an expired token', async () => {
    const resolver = resolverFor(fakeProvider());

    expect(await resolveToken(resolver, rs256({ exp: NOW_SECONDS - 3600 }))).toBeNull();
  });

  it('refuses a token with no expiry at all', async () => {
    const resolver = resolverFor(fakeProvider());

    expect(await resolveToken(resolver, rs256({ exp: undefined }))).toBeNull();
  });

  it('refuses an expiry that is not a finite number', async () => {
    const resolver = resolverFor(fakeProvider());

    expect(await resolveToken(resolver, rs256({ exp: '2026-08-13T09:05:00Z' }))).toBeNull();
  });

  it('refuses a not-before that has not arrived', async () => {
    const resolver = resolverFor(fakeProvider());

    expect(await resolveToken(resolver, rs256({ nbf: NOW_SECONDS + 3600 }))).toBeNull();
  });

  it('refuses a not-before that is present but garbled', async () => {
    const resolver = resolverFor(fakeProvider());

    expect(await resolveToken(resolver, rs256({ nbf: 'soon' }))).toBeNull();
  });

  it('refuses a token issued in the future', async () => {
    const resolver = resolverFor(fakeProvider());

    expect(await resolveToken(resolver, rs256({ iat: NOW_SECONDS + 3600 }))).toBeNull();
  });

  it('refuses an issued-at that is present but garbled', async () => {
    const resolver = resolverFor(fakeProvider());

    expect(await resolveToken(resolver, rs256({ iat: null }))).toBeNull();
  });

  it('refuses a token with no subject', async () => {
    const resolver = resolverFor(fakeProvider());

    expect(await resolveToken(resolver, rs256({ sub: undefined }))).toBeNull();
    expect(await resolveToken(resolver, rs256({ sub: '' }))).toBeNull();
  });

  it('refuses a token with no tenant, which nothing downstream could scope', async () => {
    const resolver = resolverFor(fakeProvider());

    expect(await resolveToken(resolver, rs256({ tenant: undefined }))).toBeNull();
  });

  it('refuses an actor type outside the audit vocabulary', async () => {
    const resolver = resolverFor(fakeProvider());

    expect(await resolveToken(resolver, rs256({ actor_type: 'robot' }))).toBeNull();
    expect(await resolveToken(resolver, rs256({ actor_type: 42 }))).toBeNull();
  });

  it('reports nothing about which check failed', async () => {
    const resolver = resolverFor(fakeProvider());

    const expired = await resolveToken(resolver, rs256({ exp: NOW_SECONDS - 3600 }));
    const forged = await resolveToken(resolver, rs256({}, { kid: 'invented-kid' }));

    expect(expired).toBe(forged);
  });
});

describe('the patient compartment', () => {
  it('confines a patient-scoped token to the chart its launch context names', async () => {
    const resolver = resolverFor(fakeProvider());

    const principal = await resolveToken(
      resolver,
      rs256({
        actor_type: 'patient',
        patient: PATIENT,
        scope: 'launch/patient patient/Observation.rs',
      })
    );

    expect(principal?.actorType).toBe('patient');
    expect(principal?.compartmentPatientId).toBe(PATIENT);
  });

  it('refuses a patient scope with no launch context to confine it to', async () => {
    const resolver = resolverFor(fakeProvider());

    expect(await resolveToken(resolver, rs256({ scope: 'patient/Observation.rs' }))).toBeNull();
  });

  it('leaves a launch context without a patient scope as no restriction at all', async () => {
    const resolver = resolverFor(fakeProvider());

    const principal = await resolveToken(
      resolver,
      rs256({ patient: PATIENT, scope: 'user/Observation.rs' })
    );

    expect(principal).not.toBeNull();
    expect(principal === null || 'compartmentPatientId' in principal).toBe(false);
  });

  it('confines a token that also carries a user scope', async () => {
    const resolver = resolverFor(fakeProvider());

    const principal = await resolveToken(
      resolver,
      rs256({ patient: PATIENT, scope: 'patient/Observation.rs user/Observation.rs' })
    );

    expect(principal?.compartmentPatientId).toBe(PATIENT);
  });
});

describe('claim shapes', () => {
  it('reads roles and facilities from arrays', async () => {
    const resolver = resolverFor(fakeProvider());

    const principal = await resolveToken(
      resolver,
      rs256({ roles: ['clinician', 'biller'], facilities: [FACILITY] })
    );

    expect(principal?.roles).toEqual(['clinician', 'biller']);
    expect(principal?.facilityIds).toEqual([FACILITY]);
  });

  it('reads roles and facilities from space-separated strings', async () => {
    const resolver = resolverFor(fakeProvider());

    const principal = await resolveToken(
      resolver,
      rs256({ roles: 'clinician biller', facilities: `${FACILITY} ` })
    );

    expect(principal?.roles).toEqual(['clinician', 'biller']);
    expect(principal?.facilityIds).toEqual([FACILITY]);
  });

  it('drops array members that are not strings rather than refusing the token', async () => {
    const resolver = resolverFor(fakeProvider());

    const principal = await resolveToken(resolver, rs256({ roles: ['clinician', 7, null, ''] }));

    expect(principal?.roles).toEqual(['clinician']);
  });

  it('treats a missing roles or facilities claim as no grant, never as a wildcard', async () => {
    const resolver = resolverFor(fakeProvider());

    const principal = await resolveToken(resolver, rs256({ roles: { admin: true } }));

    expect(principal?.roles).toEqual([]);
    expect(principal?.facilityIds).toEqual([]);
  });

  it('reads the standard scope claim and the plural spelling, without duplicates', async () => {
    const resolver = resolverFor(fakeProvider());

    const principal = await resolveToken(
      resolver,
      rs256({ scope: 'user/Patient.read openid', scopes: ['openid', 'user/Encounter.read'] })
    );

    expect(principal?.scopes).toEqual(['user/Patient.read', 'openid', 'user/Encounter.read']);
  });

  it('files a token that asserts no purpose under TREAT', async () => {
    const resolver = resolverFor(fakeProvider());

    expect((await resolveToken(resolver, rs256()))?.purposeOfUse).toBe('TREAT');
  });

  it('omits the display name when the token carries none', async () => {
    const resolver = resolverFor(fakeProvider());

    const principal = await resolveToken(resolver, rs256());

    expect(principal === null || 'displayName' in principal).toBe(false);
  });

  it('reads every claim from the names the deployment configured', async () => {
    const resolver = resolverFor(fakeProvider(), {
      claims: {
        tenantId: 'org',
        roles: 'groups',
        facilityIds: 'sites',
        purposeOfUse: 'pou',
        patient: 'launch_patient',
        actorType: 'kind',
        displayName: 'display',
      },
    });

    const principal = await resolveToken(
      resolver,
      rs256({
        tenant: undefined,
        org: TENANT,
        groups: ['front-desk'],
        sites: [FACILITY],
        pou: 'HOPERAT',
        kind: 'patient',
        display: 'Testina Patientsson',
        launch_patient: PATIENT,
        scope: 'patient/Appointment.rs',
      })
    );

    expect(principal).toEqual({
      subject: SUBJECT,
      tenantId: TENANT,
      actorType: 'patient',
      displayName: 'Testina Patientsson',
      roles: ['front-desk'],
      facilityIds: [FACILITY],
      scopes: ['patient/Appointment.rs'],
      compartmentPatientId: PATIENT,
      purposeOfUse: 'HOPERAT',
    });
  });
});

describe('key rotation and refetch policy', () => {
  it('refetches once when a kid is unknown and the floor has elapsed', async () => {
    const provider = fakeProvider([RSA_JWK]);
    let clock = NOW.getTime();
    const resolver = resolverFor(provider, { now: () => new Date(clock) });
    const rotated = jws(
      encodeSegment({ alg: 'RS256', kid: ROTATED_KID }),
      encodeSegment(claims()),
      rotatedSigner
    );

    expect(await resolveToken(resolver, rs256())).not.toBeNull();
    provider.serveKeys([RSA_JWK, ROTATED_JWK]);

    // Straight away the refetch floor still applies, so the new key is unseen.
    expect(await resolveToken(resolver, rotated)).toBeNull();
    expect(provider.calls).toBe(1);

    clock += 10_000;
    expect(await resolveToken(resolver, rotated)).not.toBeNull();
    expect(provider.calls).toBe(2);
  });

  it('passes its cache options down to the key set', async () => {
    const provider = fakeProvider([RSA_JWK]);
    let clock = NOW.getTime();
    const resolver = resolverFor(provider, {
      now: () => new Date(clock),
      cacheTtlMs: 1000,
      minRefetchIntervalMs: 0,
    });
    const rotated = jws(
      encodeSegment({ alg: 'RS256', kid: ROTATED_KID }),
      encodeSegment(claims()),
      rotatedSigner
    );

    await resolveToken(resolver, rs256());
    provider.serveKeys([RSA_JWK, ROTATED_JWK]);

    // With the floor set to zero, the rotated key is picked up immediately.
    expect(await resolveToken(resolver, rotated)).not.toBeNull();
    expect(provider.calls).toBe(2);

    // And the ttl ages the set out even while every kid in it is still known.
    clock += 1000;
    await resolveToken(resolver, rs256());
    expect(provider.calls).toBe(3);
  });

  it('rate-limits a stream of fabricated kids to one fetch', async () => {
    const provider = fakeProvider([RSA_JWK]);
    const resolver = resolverFor(provider);

    for (let attempt = 0; attempt < 25; attempt += 1) {
      expect(await resolveToken(resolver, rs256({}, { kid: `forged-${attempt}` }))).toBeNull();
    }

    expect(provider.calls).toBe(1);
  });
});

describe('an identity provider that cannot be reached', () => {
  it('rejects rather than reporting the token as bad', async () => {
    const provider = fakeProvider();
    provider.serve(() => Promise.reject(new Error('socket hang up')));
    const resolver = resolverFor(provider);

    await expect(resolveToken(resolver, rs256())).rejects.toThrow('socket hang up');
  });

  it('rejects when the key set comes back as an error page', async () => {
    const provider = fakeProvider();
    provider.serve(() => Promise.resolve(new Response('down for maintenance', { status: 503 })));
    const resolver = resolverFor(provider);

    await expect(resolveToken(resolver, rs256())).rejects.toThrow(JWKS_URI);
  });
});

describe('the JWKS cache', () => {
  function cacheFor(
    provider: FakeProvider,
    options: { now?: () => number; cacheTtlMs?: number; minRefetchIntervalMs?: number } = {}
  ) {
    return createJwksCache({ jwksUri: JWKS_URI, fetch: provider.fetch, ...options });
  }

  it('fetches once and then serves from cache', async () => {
    const provider = fakeProvider();
    const cache = cacheFor(provider, { now: () => 0 });

    expect((await cache.keyFor(RSA_KID))?.kid).toBe(RSA_KID);
    expect((await cache.keyFor(EC_KID))?.kid).toBe(EC_KID);
    expect(cache.fetchCount).toBe(1);
  });

  it('refetches once the cached set has aged past its ttl', async () => {
    const provider = fakeProvider();
    let clock = 0;
    const cache = cacheFor(provider, { now: () => clock, cacheTtlMs: 1000 });

    await cache.keyFor(RSA_KID);
    clock = 999;
    await cache.keyFor(RSA_KID);
    expect(cache.fetchCount).toBe(1);

    clock = 1000;
    await cache.keyFor(RSA_KID);
    expect(cache.fetchCount).toBe(2);
  });

  it('joins a fetch already in flight instead of opening a second one', async () => {
    const provider = fakeProvider();
    const cache = cacheFor(provider, { now: () => 0 });

    const [first, second] = await Promise.all([cache.keyFor(RSA_KID), cache.keyFor(EC_KID)]);

    expect(first?.kid).toBe(RSA_KID);
    expect(second?.kid).toBe(EC_KID);
    expect(cache.fetchCount).toBe(1);
  });

  it('uses the only key when no kid is given', async () => {
    const cache = cacheFor(fakeProvider([RSA_JWK]), { now: () => 0 });

    expect((await cache.keyFor(undefined))?.kid).toBe(RSA_KID);
  });

  it('refuses to guess when no kid is given and several keys are published', async () => {
    const provider = fakeProvider();
    const cache = cacheFor(provider, { now: () => 0 });

    expect(await cache.keyFor(undefined)).toBeNull();
    expect(cache.fetchCount).toBe(1);
  });

  it('returns null for an empty key set without refetching for it', async () => {
    const provider = fakeProvider([]);
    const cache = cacheFor(provider, { now: () => 0 });

    expect(await cache.keyFor(undefined)).toBeNull();
    expect(await cache.keyFor(RSA_KID)).toBeNull();
    expect(cache.fetchCount).toBe(1);
  });

  it('drops key set entries that are not usable keys', async () => {
    const provider = fakeProvider(['not-an-object', null, {}, { kty: '' }, RSA_JWK]);
    const cache = cacheFor(provider, { now: () => 0 });

    expect((await cache.keyFor(RSA_KID))?.kty).toBe('RSA');
  });

  it('copies only the members a public key is made of', async () => {
    const provider = fakeProvider([{ ...RSA_JWK, d: 'private-material', ext: true, kid: 7 }]);
    const cache = cacheFor(provider, { now: () => 0 });

    const key = await cache.keyFor(undefined);

    expect(key).not.toBeNull();
    expect(key).not.toHaveProperty('d');
    expect(key).not.toHaveProperty('ext');
    expect(key).not.toHaveProperty('kid');
  });

  it('never caches a failed fetch as an empty key set', async () => {
    const provider = fakeProvider();
    const cache = cacheFor(provider, { now: () => 0 });
    provider.serve(() => Promise.reject(new Error('connection reset')));

    await expect(cache.keyFor(RSA_KID)).rejects.toThrow('connection reset');

    provider.serveKeys([RSA_JWK]);
    expect((await cache.keyFor(RSA_KID))?.kid).toBe(RSA_KID);
  });

  it('names the endpoint, and nothing about the caller, when the fetch fails', async () => {
    const provider = fakeProvider();
    const cache = cacheFor(provider, { now: () => 0 });
    provider.serve(() => Promise.resolve(new Response('nope', { status: 404 })));

    await expect(cache.keyFor(RSA_KID)).rejects.toThrow(`${JWKS_URI} returned HTTP 404`);
  });

  it('throws when the body is not JSON', async () => {
    const provider = fakeProvider();
    const cache = cacheFor(provider, { now: () => 0 });
    provider.serve(() => Promise.resolve(new Response('<html>captive portal</html>')));

    await expect(cache.keyFor(RSA_KID)).rejects.toThrow('not JSON');
  });

  it('throws when the document has no keys array', async () => {
    const provider = fakeProvider();
    const cache = cacheFor(provider, { now: () => 0 });
    provider.serve(jsonResponder({ jwks: [RSA_JWK] }));

    await expect(cache.keyFor(RSA_KID)).rejects.toThrow('no "keys" array');

    provider.serve(jsonResponder([RSA_JWK]));
    await expect(cache.keyFor(RSA_KID)).rejects.toThrow('no "keys" array');
  });

  it('falls back to the global transport and clock when neither is injected', async () => {
    const provider = fakeProvider([RSA_JWK]);
    vi.stubGlobal('fetch', provider.fetch);
    const cache = createJwksCache({ jwksUri: JWKS_URI });

    expect((await cache.keyFor(RSA_KID))?.kid).toBe(RSA_KID);
    expect(await cache.keyFor('unknown-kid')).toBeNull();
    expect(cache.fetchCount).toBe(1);
  });
});

describe('the internals the suite exercises directly', () => {
  const { decodeSegment, toPrincipal } = __internals;

  it('decodes a base64url JSON object', () => {
    expect(decodeSegment(encodeSegment({ alg: 'RS256' }))).toEqual({ alg: 'RS256' });
  });

  it('refuses a segment outside the base64url alphabet, padding included', () => {
    expect(decodeSegment('')).toBeNull();
    expect(decodeSegment('YWJj=')).toBeNull();
    expect(decodeSegment('ab+cd/ef')).toBeNull();
  });

  it('refuses a segment that does not decode to JSON', () => {
    expect(decodeSegment(Buffer.from('{oops').toString('base64url'))).toBeNull();
  });

  it('refuses JSON that is not an object', () => {
    expect(decodeSegment(Buffer.from('"a string"').toString('base64url'))).toBeNull();
    expect(decodeSegment(Buffer.from('null').toString('base64url'))).toBeNull();
    expect(decodeSegment(Buffer.from('[1,2]').toString('base64url'))).toBeNull();
  });

  it('maps claims onto a principal with the default claim names', () => {
    expect(toPrincipal({ sub: SUBJECT, tenant: TENANT })).toEqual({
      subject: SUBJECT,
      tenantId: TENANT,
      actorType: 'user',
      roles: [],
      facilityIds: [],
      scopes: [],
      purposeOfUse: 'TREAT',
    });
  });

  it('refuses claims that cannot name a subject or a tenant', () => {
    expect(toPrincipal({ tenant: TENANT })).toBeNull();
    expect(toPrincipal({ sub: SUBJECT })).toBeNull();
    expect(toPrincipal({ sub: 17, tenant: TENANT })).toBeNull();
  });

  it('honours a partial claim-name override, defaulting the rest', () => {
    const principal = toPrincipal(
      { sub: SUBJECT, org: TENANT, roles: ['biller'] },
      { tenantId: 'org' }
    );

    expect(principal?.tenantId).toBe(TENANT);
    expect(principal?.roles).toEqual(['biller']);
  });
});
