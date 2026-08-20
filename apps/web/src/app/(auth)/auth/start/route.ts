import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import {
  FLOW_COOKIE,
  FLOW_TTL_MS,
  authorizationUrl,
  codeChallenge,
  discoverEndpoints,
  oidcWebConfig,
  randomToken,
} from '@/lib/auth/oidc';
import { SIGN_IN_PATH, safeReturnPath } from '@/lib/auth/routes';
import { sealPayload, sessionSealKey } from '@/lib/auth/seal';
import type { FlowState } from '@/lib/auth/oidc';

/**
 * Starts the authorization code flow.
 *
 * Everything secret to the attempt is minted here and parked in a signed,
 * http-only cookie: the verifier the provider never sees, plus the state and
 * nonce that prove the callback belongs to this browser and this attempt. Only
 * the challenge and the two opaque values travel in the URL.
 *
 * Failures redirect back to the sign-in screen rather than rendering an error
 * page. A person who cannot start a sign-in wants the sign-in screen, and the
 * detail that would help them is a deployment problem visible in the logs, not
 * something to print at an unauthenticated browser.
 */
const SEE_OTHER = 303;

/** See the note on `sameOrigin` in the callback route: origin from the request
 *  object, path from a constant, never a string that arrived from outside. */
function backToSignIn(request: NextRequest): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = SIGN_IN_PATH;
  url.search = '';
  return NextResponse.redirect(url, SEE_OTHER);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const config = oidcWebConfig();
  if (config === null) return backToSignIn(request);

  const key = sessionSealKey();
  if (key === null) return backToSignIn(request);

  const endpoints = await discoverEndpoints(config.issuer);
  if (endpoints === null) return backToSignIn(request);

  const flow: FlowState = {
    verifier: randomToken(),
    state: randomToken(),
    nonce: randomToken(),
    next: safeReturnPath(request.nextUrl.searchParams.get('next')),
    startedAt: Date.now(),
  };

  const response = NextResponse.redirect(
    authorizationUrl(config, endpoints, flow, await codeChallenge(flow.verifier)),
    SEE_OTHER
  );

  // Lax rather than Strict: the browser arrives back at the callback from the
  // provider's origin, and Strict would withhold the cookie on exactly that
  // navigation, which is the one request that needs it.
  response.cookies.set(FLOW_COOKIE, await sealPayload(flow, key), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: Math.floor(FLOW_TTL_MS / 1000),
  });

  return response;
}
