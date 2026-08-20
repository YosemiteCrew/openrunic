import { z } from 'zod';

/**
 * The environment, validated once at startup.
 *
 * The identity-provider settings are optional as a group and required as a
 * group: a deployment either verifies real tokens or it does not, and a partial
 * configuration - an issuer with no key set, an audience with no issuer - would
 * silently fall back to the development principal table, which is the one
 * failure mode this file exists to prevent. `createApp` refuses the development
 * defaults under `NODE_ENV=production` for the same reason.
 */
const envSchema = z
  .object({
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    /** OIDC issuer, matched exactly against the token's `iss`. */
    OIDC_ISSUER: z.url().optional(),
    /** Audience this API answers to. Several may be listed, comma separated. */
    OIDC_AUDIENCE: z.string().min(1).optional(),
    /** Where the issuer publishes its signing keys. */
    OIDC_JWKS_URI: z.url().optional(),
    /** Tolerance on `exp`, `nbf` and `iat`, in seconds. */
    OIDC_CLOCK_SKEW_SECONDS: z.coerce.number().int().min(0).max(600).default(60),
  })
  .refine(
    (value) =>
      [value.OIDC_ISSUER, value.OIDC_AUDIENCE, value.OIDC_JWKS_URI].every(
        (entry) => entry === undefined
      ) ||
      [value.OIDC_ISSUER, value.OIDC_AUDIENCE, value.OIDC_JWKS_URI].every(
        (entry) => entry !== undefined
      ),
    {
      message: 'OIDC_ISSUER, OIDC_AUDIENCE and OIDC_JWKS_URI must be set together or not at all',
      path: ['OIDC_ISSUER'],
    }
  );

export type Env = z.infer<typeof envSchema>;

/**
 * Parse and validate process environment variables.
 *
 * Fails fast on invalid configuration. The error message names the offending
 * variables but never echoes their values.
 */
export function parseEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const names = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))];
    throw new Error(
      `Invalid environment configuration. Fix these variables and restart: ${names.join(', ')}`
    );
  }
  return result.data;
}

/** The identity-provider settings, when the deployment configured them. */
export interface OidcSettings {
  issuer: string;
  audience: string[];
  jwksUri: string;
  clockSkewSeconds: number;
}

export function oidcSettings(env: Env): OidcSettings | undefined {
  // No guard for a half-set configuration here on purpose: `envSchema` already
  // refuses one, with the message "must be set together or not at all", so the
  // process never reaches this function holding two of the three. A second
  // check here would be unreachable, and unreachable code that looks like a
  // safety net is worse than none.
  if (env.OIDC_ISSUER === undefined || env.OIDC_AUDIENCE === undefined) return undefined;
  if (env.OIDC_JWKS_URI === undefined) return undefined;
  return {
    issuer: env.OIDC_ISSUER,
    audience: env.OIDC_AUDIENCE.split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
    jwksUri: env.OIDC_JWKS_URI,
    clockSkewSeconds: env.OIDC_CLOCK_SKEW_SECONDS,
  };
}
