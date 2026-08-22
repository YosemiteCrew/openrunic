import { describe, expect, it, vi } from 'vitest';

import {
  FLOW_TTL_MS,
  authorizationUrl,
  codeChallenge,
  discoverEndpoints,
  exchangeCode,
  flowExpired,
  identityFromClaims,
  nonceMatches,
  oidcWebConfig,
  randomToken,
  readFlowState,
  readIdTokenClaims,
} from '../oidc';
import type { FlowState, OidcEndpoints, OidcWebConfig } from '../oidc';

const CONFIG: OidcWebConfig = {
  issuer: 'https://id.example.invalid',
  clientId: 'openrunic-web',
  redirectUri: 'https://clinic.example.invalid/auth/callback',
  scopes: 'openid profile email',
};

const ENDPOINTS: OidcEndpoints = {
  authorizationEndpoint: 'https://id.example.invalid/authorize',
  tokenEndpoint: 'https://id.example.invalid/token',
};

const FLOW: FlowState = {
  verifier: 'verifier-value',
  state: 'state-value',
  nonce: 'nonce-value',
  next: '/schedule',
  startedAt: 1_000_000,
};

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

/** An unsigned token with a real base64url payload. Only the claims are read. */
function idToken(claims: Record<string, unknown>): string {
  const encode = (value: string): string =>
    btoa(value).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
  return `${encode('{"alg":"none"}')}.${encode(JSON.stringify(claims))}.signature`;
}

describe('oidcWebConfig', () => {
  it('reads a complete configuration', () => {
    const config = oidcWebConfig({
      OIDC_ISSUER: 'https://id.example.invalid',
      OIDC_CLIENT_ID: 'openrunic-web',
      OIDC_REDIRECT_URI: 'https://clinic.example.invalid/auth/callback',
    } as unknown as NodeJS.ProcessEnv);

    expect(config?.issuer).toBe('https://id.example.invalid');
    expect(config?.scopes).toBe('openid profile email');
    expect(config?.clientSecret).toBeUndefined();
  });

  it('carries a client secret when the provider insists on one', () => {
    const config = oidcWebConfig({
      OIDC_ISSUER: 'https://id.example.invalid',
      OIDC_CLIENT_ID: 'openrunic-web',
      OIDC_REDIRECT_URI: 'https://clinic.example.invalid/auth/callback',
      OIDC_CLIENT_SECRET: 'shh',
    } as unknown as NodeJS.ProcessEnv);

    expect(config?.clientSecret).toBe('shh');
  });

  it('takes the deployment scopes over the default when given', () => {
    const config = oidcWebConfig({
      OIDC_ISSUER: 'https://id.example.invalid',
      OIDC_CLIENT_ID: 'openrunic-web',
      OIDC_REDIRECT_URI: 'https://clinic.example.invalid/auth/callback',
      OIDC_SCOPES: 'openid clinician',
    } as unknown as NodeJS.ProcessEnv);

    expect(config?.scopes).toBe('openid clinician');
  });

  it.each([
    ['no issuer', { OIDC_CLIENT_ID: 'a', OIDC_REDIRECT_URI: 'b' }],
    ['no client id', { OIDC_ISSUER: 'a', OIDC_REDIRECT_URI: 'b' }],
    ['no redirect uri', { OIDC_ISSUER: 'a', OIDC_CLIENT_ID: 'b' }],
    ['a blank issuer', { OIDC_ISSUER: '   ', OIDC_CLIENT_ID: 'a', OIDC_REDIRECT_URI: 'b' }],
  ])('refuses a half-configured deployment: %s', (_label, env) => {
    expect(oidcWebConfig(env as unknown as NodeJS.ProcessEnv)).toBeNull();
  });
});

describe('discoverEndpoints', () => {
  it('reads the two endpoints it needs', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        authorization_endpoint: ENDPOINTS.authorizationEndpoint,
        token_endpoint: ENDPOINTS.tokenEndpoint,
        code_challenge_methods_supported: ['S256'],
      })
    );

    await expect(discoverEndpoints(CONFIG.issuer, fetchImpl)).resolves.toEqual(ENDPOINTS);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      'https://id.example.invalid/.well-known/openid-configuration'
    );
  });

  it('does not double the slash when the issuer carries a trailing one', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        authorization_endpoint: ENDPOINTS.authorizationEndpoint,
        token_endpoint: ENDPOINTS.tokenEndpoint,
      })
    );

    await discoverEndpoints('https://id.example.invalid///', fetchImpl);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      'https://id.example.invalid/.well-known/openid-configuration'
    );
  });

  it('refuses a provider that cannot do S256 rather than downgrading', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        authorization_endpoint: ENDPOINTS.authorizationEndpoint,
        token_endpoint: ENDPOINTS.tokenEndpoint,
        code_challenge_methods_supported: ['plain'],
      })
    );

    await expect(discoverEndpoints(CONFIG.issuer, fetchImpl)).resolves.toBeNull();
  });

  it.each([
    ['a non-ok response', jsonResponse({}, false)],
    ['a document that is not an object', jsonResponse('nope')],
    ['a document with no authorization endpoint', jsonResponse({ token_endpoint: 'x' })],
    ['a document with no token endpoint', jsonResponse({ authorization_endpoint: 'x' })],
  ])('returns null on %s', async (_label, response) => {
    await expect(
      discoverEndpoints(CONFIG.issuer, vi.fn().mockResolvedValue(response))
    ).resolves.toBeNull();
  });

  it('returns null when the provider cannot be reached', async () => {
    await expect(
      discoverEndpoints(CONFIG.issuer, vi.fn().mockRejectedValue(new Error('offline')))
    ).resolves.toBeNull();
  });
});

describe('PKCE', () => {
  it('produces the S256 challenge from RFC 7636 appendix B', async () => {
    // The specification's own worked example, so a refactor that quietly changes
    // the encoding fails here rather than at a provider.
    await expect(codeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).resolves.toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
    );
  });

  it('mints a different value every time', () => {
    expect(randomToken()).not.toBe(randomToken());
  });

  it('emits base64url only, so nothing needs escaping in a query string', () => {
    expect(randomToken()).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('authorizationUrl', () => {
  it('carries the challenge and never the verifier', () => {
    const url = new URL(authorizationUrl(CONFIG, ENDPOINTS, FLOW, 'challenge-value'));

    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe(CONFIG.clientId);
    expect(url.searchParams.get('redirect_uri')).toBe(CONFIG.redirectUri);
    expect(url.searchParams.get('state')).toBe(FLOW.state);
    expect(url.searchParams.get('nonce')).toBe(FLOW.nonce);
    expect(url.searchParams.get('code_challenge')).toBe('challenge-value');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    // The whole point of PKCE: the secret never travels in the front channel.
    expect(url.toString()).not.toContain(FLOW.verifier);
  });
});

describe('exchangeCode', () => {
  it('sends the verifier and returns both tokens', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ access_token: 'access', id_token: 'id' }));

    await expect(
      exchangeCode(CONFIG, ENDPOINTS, 'the-code', FLOW.verifier, fetchImpl)
    ).resolves.toEqual({ accessToken: 'access', idToken: 'id' });

    const body = new URLSearchParams(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code_verifier')).toBe(FLOW.verifier);
    expect(body.get('client_secret')).toBeNull();
  });

  it('includes the client secret only when the deployment configured one', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ access_token: 'access' }));
    await exchangeCode(
      { ...CONFIG, clientSecret: 'shh' },
      ENDPOINTS,
      'the-code',
      FLOW.verifier,
      fetchImpl
    );

    expect(
      new URLSearchParams(String(fetchImpl.mock.calls[0]?.[1]?.body)).get('client_secret')
    ).toBe('shh');
  });

  it('reports no id token rather than inventing one', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ access_token: 'access' }));
    await expect(exchangeCode(CONFIG, ENDPOINTS, 'c', FLOW.verifier, fetchImpl)).resolves.toEqual({
      accessToken: 'access',
      idToken: null,
    });
  });

  it.each([
    ['the provider refuses', jsonResponse({ error: 'invalid_grant' }, false)],
    ['the response is not an object', jsonResponse('nope')],
    ['there is no access token', jsonResponse({ id_token: 'id' })],
  ])('returns null when %s', async (_label, response) => {
    await expect(
      exchangeCode(CONFIG, ENDPOINTS, 'c', FLOW.verifier, vi.fn().mockResolvedValue(response))
    ).resolves.toBeNull();
  });

  it('returns null when the token endpoint cannot be reached', async () => {
    await expect(
      exchangeCode(CONFIG, ENDPOINTS, 'c', FLOW.verifier, vi.fn().mockRejectedValue(new Error('x')))
    ).resolves.toBeNull();
  });
});

describe('readIdTokenClaims', () => {
  it('reads the payload segment', () => {
    expect(readIdTokenClaims(idToken({ sub: 'abc', nonce: 'n' }))).toEqual({
      sub: 'abc',
      nonce: 'n',
    });
  });

  it.each([
    ['a token that is not three segments', 'a.b'],
    ['a payload that is not base64url', 'aaa.!!!.ccc'],
    ['a payload that is not JSON', `aaa.${btoa('not json')}.ccc`],
    ['a payload that is JSON but not an object', `aaa.${btoa('42')}.ccc`],
  ])('returns null for %s', (_label, token) => {
    expect(readIdTokenClaims(token)).toBeNull();
  });
});

describe('identityFromClaims', () => {
  it('prefers name, then preferred_username, then email, then the subject', () => {
    expect(
      identityFromClaims({ sub: 's', name: 'A', preferred_username: 'B', email: 'c@d' })
        ?.displayName
    ).toBe('A');
    expect(
      identityFromClaims({ sub: 's', preferred_username: 'B', email: 'c@d' })?.displayName
    ).toBe('B');
    expect(identityFromClaims({ sub: 's', email: 'c@d' })?.displayName).toBe('c@d');
    expect(identityFromClaims({ sub: 's' })?.displayName).toBe('s');
  });

  it('refuses claims with no subject, because that identifies nobody', () => {
    expect(identityFromClaims({ name: 'A' })).toBeNull();
  });

  it('reads roles, and falls back to groups', () => {
    expect(identityFromClaims({ sub: 's', roles: ['clinician'] })?.roles).toEqual(['clinician']);
    expect(identityFromClaims({ sub: 's', groups: ['front-desk'] })?.roles).toEqual(['front-desk']);
  });

  it('treats a malformed role list as absent rather than coercing it', () => {
    expect(identityFromClaims({ sub: 's', roles: 'clinician' })?.roles).toEqual([]);
    expect(identityFromClaims({ sub: 's', roles: [1, 2] })?.roles).toEqual([]);
    expect(identityFromClaims({ sub: 's', roles: [''] })?.roles).toEqual([]);
  });
});

describe('nonceMatches', () => {
  it('accepts only the exact nonce from this attempt', () => {
    expect(nonceMatches({ nonce: 'n' }, 'n')).toBe(true);
    expect(nonceMatches({ nonce: 'other' }, 'n')).toBe(false);
    expect(nonceMatches({}, 'n')).toBe(false);
    expect(nonceMatches({ nonce: 42 }, 'n')).toBe(false);
  });
});

describe('flow state', () => {
  it('round-trips a well-formed flow', () => {
    expect(readFlowState({ ...FLOW })).toEqual(FLOW);
  });

  it('treats a missing next as null rather than failing the whole flow', () => {
    expect(readFlowState({ ...FLOW, next: '' })?.next).toBeNull();
  });

  it.each([
    ['not an object', 'nope'],
    ['no verifier', { ...FLOW, verifier: '' }],
    ['no state', { ...FLOW, state: '' }],
    ['no nonce', { ...FLOW, nonce: '' }],
    ['no start time', { ...FLOW, startedAt: 'soon' }],
  ])('refuses a flow with %s', (_label, value) => {
    expect(readFlowState(value)).toBeNull();
  });

  it('expires a flow the person abandoned', () => {
    expect(flowExpired(FLOW, FLOW.startedAt + FLOW_TTL_MS - 1)).toBe(false);
    expect(flowExpired(FLOW, FLOW.startedAt + FLOW_TTL_MS + 1)).toBe(true);
  });
});
