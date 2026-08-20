import type { Identity } from './session';

/**
 * THE BROWSER HALF OF SIGNING IN.
 *
 * The API has been able to verify real tokens for a while: point
 * `OIDC_ISSUER`, `OIDC_AUDIENCE` and `OIDC_JWKS_URI` at a provider and
 * `createOidcPrincipalResolver` checks the signature against the published key
 * set. What was missing was any way for a person at a browser to obtain such a
 * token, so in production `developmentCredentials` returned an empty list and
 * the deployment had no front door at all rather than a weak one.
 *
 * This module is that door. It is the authorization code flow with PKCE, and
 * the token it ends up with is the same bearer token `lib/api/client.ts`
 * already attaches to every API call, so the two halves meet without either
 * side learning about the other.
 *
 * ## Why PKCE, and why S256 only
 *
 * A browser cannot keep a client secret: anything shipped to it is public. PKCE
 * replaces the secret with a value the client invents per attempt, sends only a
 * hash of, and reveals only when redeeming the code. An attacker who steals the
 * authorization code out of a redirect still cannot exchange it.
 *
 * `plain` is in the specification and is not offered here. It sends the
 * verifier itself as the challenge, so anyone who can see the authorization
 * request can redeem the code, which is the attack PKCE exists to stop. A
 * provider that cannot do S256 is a provider this should refuse rather than
 * quietly downgrade to.
 *
 * ## What is checked on the way back
 *
 * `state` proves the callback belongs to a flow this browser started, which is
 * what makes login CSRF fail. `nonce` is echoed inside the ID token and proves
 * the token was minted for this attempt rather than replayed from another one.
 * Both are generated here, sealed into a short-lived cookie, and compared on
 * return. A mismatch is not a recoverable condition and is not retried.
 */

/** How long a half-finished sign-in stays valid. Long enough to type a password. */
export const FLOW_TTL_MS = 10 * 60 * 1000;

/** The cookie carrying the in-flight verifier, state and nonce. */
export const FLOW_COOKIE = 'or_oidc_flow';

/** Scopes asked for when the deployment does not name its own. */
const DEFAULT_SCOPES = 'openid profile email';

export interface OidcWebConfig {
  readonly issuer: string;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly scopes: string;
  /**
   * Present only for a confidential client. A browser flow does not need one,
   * and PKCE is what secures the exchange either way, but some providers still
   * insist on a secret even for the authorization code grant.
   */
  readonly clientSecret?: string;
}

/**
 * Reads the deployment's OIDC settings, or null when it has none.
 *
 * Null is the signal that the demo path stays in charge. It is deliberately not
 * a partially-populated object: a deployment that set an issuer and forgot the
 * client id has misconfigured its front door, and starting a flow that can only
 * fail at the provider tells them far less than refusing to start one.
 */
export function oidcWebConfig(env: NodeJS.ProcessEnv = process.env): OidcWebConfig | null {
  const issuer = env.OIDC_ISSUER?.trim();
  const clientId = env.OIDC_CLIENT_ID?.trim();
  const redirectUri = env.OIDC_REDIRECT_URI?.trim();
  if (!issuer || !clientId || !redirectUri) return null;

  const secret = env.OIDC_CLIENT_SECRET?.trim();
  return {
    issuer,
    clientId,
    redirectUri,
    scopes: env.OIDC_SCOPES?.trim() || DEFAULT_SCOPES,
    ...(secret ? { clientSecret: secret } : {}),
  };
}

export interface OidcEndpoints {
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readText(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * Fetches the provider's discovery document and pulls out the two endpoints
 * this flow uses.
 *
 * Discovery is not cached. It is fetched once per sign-in, which is rare, and a
 * cache here would be one more thing that can hold a stale endpoint after a
 * provider migration. The tradeoff is one extra request on a page nobody loads
 * in a loop.
 */
export async function discoverEndpoints(
  issuer: string,
  fetchImpl: typeof fetch = fetch
): Promise<OidcEndpoints | null> {
  // Trimmed with a loop rather than /\/+$/, which backtracks super-linearly on a
  // long run of trailing slashes. The issuer is deployment configuration and not
  // attacker input, so this is a cheap fix to a theoretical problem rather than
  // a live one, but a linear trim costs nothing and the regex bought nothing.
  let base = issuer;
  while (base.endsWith('/')) base = base.slice(0, -1);
  let document: unknown;
  try {
    const response = await fetchImpl(`${base}/.well-known/openid-configuration`, {
      headers: { accept: 'application/json' },
    });
    if (!response.ok) return null;
    document = await response.json();
  } catch {
    return null;
  }

  if (!isRecord(document)) return null;
  const authorizationEndpoint = readText(document.authorization_endpoint);
  const tokenEndpoint = readText(document.token_endpoint);
  if (authorizationEndpoint === null || tokenEndpoint === null) return null;

  // A provider that will not do S256 is refused rather than downgraded to
  // `plain`, for the reason in this file's header.
  const methods = document.code_challenge_methods_supported;
  if (Array.isArray(methods) && !methods.includes('S256')) return null;

  return { authorizationEndpoint, tokenEndpoint };
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCodePoint(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

/** 32 bytes of CSPRNG output, base64url encoded. Used for verifier, state and nonce. */
export function randomToken(size = 32): string {
  const bytes = new Uint8Array(size);
  globalThis.crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

/** The S256 challenge for a verifier: base64url(SHA-256(ascii(verifier))). */
export async function codeChallenge(verifier: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier)
  );
  return toBase64Url(new Uint8Array(digest));
}

export interface FlowState {
  readonly verifier: string;
  readonly state: string;
  readonly nonce: string;
  /** Where to land after a successful exchange. Already validated by the caller. */
  readonly next: string | null;
  readonly startedAt: number;
}

export function readFlowState(value: unknown): FlowState | null {
  if (!isRecord(value)) return null;
  const verifier = readText(value.verifier);
  const state = readText(value.state);
  const nonce = readText(value.nonce);
  const startedAt = typeof value.startedAt === 'number' ? value.startedAt : null;
  if (verifier === null || state === null || nonce === null || startedAt === null) return null;

  const next = typeof value.next === 'string' && value.next !== '' ? value.next : null;
  return { verifier, state, nonce, next, startedAt };
}

export function flowExpired(flow: FlowState, now: number): boolean {
  return now - flow.startedAt > FLOW_TTL_MS;
}

/** Builds the URL the browser is sent to, given a started flow. */
export function authorizationUrl(
  config: OidcWebConfig,
  endpoints: OidcEndpoints,
  flow: FlowState,
  challenge: string
): string {
  const url = new URL(endpoints.authorizationEndpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('scope', config.scopes);
  url.searchParams.set('state', flow.state);
  url.searchParams.set('nonce', flow.nonce);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

export interface TokenSet {
  readonly accessToken: string;
  readonly idToken: string | null;
}

/**
 * Redeems the authorization code.
 *
 * The verifier travels here and nowhere else. Everything before this point
 * carried only its hash, which is what makes a stolen code useless.
 */
export async function exchangeCode(
  config: OidcWebConfig,
  endpoints: OidcEndpoints,
  code: string,
  verifier: string,
  fetchImpl: typeof fetch = fetch
): Promise<TokenSet | null> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUri,
    client_id: config.clientId,
    code_verifier: verifier,
  });
  if (config.clientSecret !== undefined) body.set('client_secret', config.clientSecret);

  let payload: unknown;
  try {
    const response = await fetchImpl(endpoints.tokenEndpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
      body: body.toString(),
    });
    if (!response.ok) return null;
    payload = await response.json();
  } catch {
    return null;
  }

  if (!isRecord(payload)) return null;
  const accessToken = readText(payload.access_token);
  if (accessToken === null) return null;

  return { accessToken, idToken: readText(payload.id_token) };
}

/**
 * Reads the ID token's claims without verifying its signature.
 *
 * That is deliberate and it is safe only because of where the token came from.
 * This value arrived over TLS, from the provider's own token endpoint, in a
 * direct response to a request carrying the code verifier. It was never in the
 * browser's URL bar and never passed through the user. What comes out of here
 * is used for two things: checking the nonce, and putting a name in the top
 * bar.
 *
 * The token that actually grants access is the ACCESS token, and that one is
 * verified properly, by the API, against the provider's published key set. No
 * access decision anywhere is made from these claims.
 */
export function readIdTokenClaims(idToken: string): Record<string, unknown> | null {
  const segments = idToken.split('.');
  const encoded = segments.length === 3 ? segments[1] : undefined;
  if (encoded === undefined) return null;
  try {
    const payload = encoded.replaceAll('-', '+').replaceAll('_', '/');
    const parsed: unknown = JSON.parse(
      new TextDecoder().decode(Uint8Array.from(atob(payload), (c) => c.codePointAt(0) ?? 0))
    );
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readRoles(claims: Record<string, unknown>): readonly string[] {
  // Providers disagree about where roles live. `roles` is the plain reading,
  // `groups` is what several directory-backed providers emit. Anything that is
  // not a list of non-empty strings is treated as absent rather than coerced,
  // because a half-read role list rendered in a top bar is worse than none.
  for (const key of ['roles', 'groups']) {
    const value = claims[key];
    if (!Array.isArray(value)) continue;
    const roles = value.filter(
      (entry): entry is string => typeof entry === 'string' && entry !== ''
    );
    if (roles.length > 0) return roles;
  }
  return [];
}

/**
 * Turns ID token claims into the identity the session cookie carries.
 *
 * `sub` is required. A provider that does not send one has not identified
 * anybody, and inventing a subject here would let two different people share a
 * session record.
 */
export function identityFromClaims(claims: Record<string, unknown>): Identity | null {
  const subject = readText(claims.sub);
  if (subject === null) return null;

  const displayName =
    readText(claims.name) ??
    readText(claims.preferred_username) ??
    readText(claims.email) ??
    subject;

  return { subject, displayName, roles: readRoles(claims) };
}

/** True when the ID token was minted for this attempt. */
export function nonceMatches(claims: Record<string, unknown>, expected: string): boolean {
  const actual = readText(claims.nonce);
  return actual !== null && actual === expected;
}
