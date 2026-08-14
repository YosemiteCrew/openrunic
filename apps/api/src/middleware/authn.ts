import { createMiddleware } from 'hono/factory';

import { parseBearerToken, type PrincipalResolver } from '../auth/principal.js';
import type { AppEnv } from '../context.js';
import { ApiError } from '../errors.js';

export interface AuthnOptions {
  resolver: PrincipalResolver;
  /**
   * Paths served without a principal. Exact matches only: a prefix rule here
   * would be one typo away from exposing a whole router.
   */
  publicPaths?: Iterable<string>;
}

/**
 * Routes that must answer before anyone has a token.
 *
 * `/readyz` is here for the same reason as `/healthz`: it is read by the
 * container runtime's healthcheck, which has no credentials and never will. An
 * authenticated readiness probe answers 401 forever, the container never turns
 * healthy, and nothing that depends on it ever starts.
 *
 * Neither endpoint reveals anything: both return a fixed shape saying whether
 * this process can serve, with no counts, no versions and no error detail.
 */
export const DEFAULT_PUBLIC_PATHS: readonly string[] = [
  '/healthz',
  '/readyz',
  '/fhir/metadata',
  '/openapi.json',
];

/**
 * Stage 2 of the chain. Turns a bearer token into a {@link Principal}.
 *
 * This is the seam the real OIDC/SMART verifier drops into: it consumes a
 * `PrincipalResolver` and knows nothing about how a token is validated. What it
 * does own is the failure policy - a missing token and an unrecognised token
 * produce the same 401 with the same body, so the endpoint cannot be used to
 * distinguish a valid-but-expired token from a fabricated one.
 */
export function authn(options: AuthnOptions) {
  const publicPaths = new Set(options.publicPaths ?? DEFAULT_PUBLIC_PATHS);

  return createMiddleware<AppEnv>(async (c, next) => {
    if (publicPaths.has(c.req.path)) {
      await next();
      return;
    }

    const token = parseBearerToken(c.req.header('authorization'));
    if (token === null) {
      throw ApiError.unauthenticated('A bearer token is required.');
    }

    const principal = await options.resolver.resolve(token);
    if (principal === null) {
      throw ApiError.unauthenticated('The bearer token is not valid.');
    }

    c.set('principal', principal);
    await next();
  });
}
