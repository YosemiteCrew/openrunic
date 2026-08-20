import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { applySessionCookie } from '@/lib/auth/cookie';
import {
  FLOW_COOKIE,
  discoverEndpoints,
  exchangeCode,
  flowExpired,
  identityFromClaims,
  nonceMatches,
  oidcWebConfig,
  readFlowState,
  readIdTokenClaims,
} from '@/lib/auth/oidc';
import { landingPath, signInUrl } from '@/lib/auth/routes';
import { sealSessionCookie, sessionSealKey, unsealPayload } from '@/lib/auth/seal';
import { startSessionRecord } from '@/lib/auth/session';

/**
 * Completes the authorization code flow.
 *
 * The order of the checks is the point. State is compared before the code is
 * redeemed, so a callback this browser did not start never reaches the
 * provider's token endpoint. The nonce is compared after the exchange, because
 * it lives inside the ID token and there is no ID token until the code has been
 * spent.
 *
 * Every failure lands on the sign-in screen with the flow cookie cleared. There
 * is deliberately no retry: each of these failures means the attempt cannot be
 * trusted, and a retry loop against a provider is how a misconfiguration turns
 * into a rate limit.
 */
const SEE_OTHER = 303;

function abandon(request: NextRequest): NextResponse {
  const response = NextResponse.redirect(new URL(signInUrl(), request.url), SEE_OTHER);
  response.cookies.delete(FLOW_COOKIE);
  return response;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const config = oidcWebConfig();
  const key = sessionSealKey();
  if (config === null || key === null) return abandon(request);

  const flow = await unsealPayload(request.cookies.get(FLOW_COOKIE)?.value, key, (parsed) =>
    readFlowState(parsed)
  );
  if (flow === null || flowExpired(flow, Date.now())) return abandon(request);

  // A provider that refused says so in the query string. There is nothing to
  // exchange, and the reason belongs in the deployment's logs rather than in a
  // redirect the user can read.
  if (request.nextUrl.searchParams.get('error') !== null) return abandon(request);

  const code = request.nextUrl.searchParams.get('code');
  const state = request.nextUrl.searchParams.get('state');
  if (code === null || state === null || state !== flow.state) return abandon(request);

  const endpoints = await discoverEndpoints(config.issuer);
  if (endpoints === null) return abandon(request);

  const tokens = await exchangeCode(config, endpoints, code, flow.verifier);
  if (tokens === null) return abandon(request);

  // The ID token is required, not optional. Without it there is no nonce to
  // check and no claims to build an identity from, and a session whose subject
  // was guessed is worse than no session.
  if (tokens.idToken === null) return abandon(request);
  const claims = readIdTokenClaims(tokens.idToken);
  if (claims === null || !nonceMatches(claims, flow.nonce)) return abandon(request);

  const identity = identityFromClaims(claims);
  if (identity === null) return abandon(request);

  // The ACCESS token is what the session carries, because that is the one the
  // API verifies against the provider's key set. The ID token's job ended with
  // the nonce and the display name.
  const record = startSessionRecord(tokens.accessToken, identity, Date.now());
  const response = NextResponse.redirect(new URL(landingPath(flow.next), request.url), SEE_OTHER);
  response.cookies.delete(FLOW_COOKIE);
  return applySessionCookie(response, await sealSessionCookie(record, key));
}
