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
    /**
     * Canonical base for the FHIR resources this deployment publishes.
     *
     * Only `Questionnaire.url` needs it today, and it needs it badly: a form
     * published without this claims a canonical URL on the openrunic project's
     * own domain, which the practice does not run and nobody can resolve to
     * its forms. Left unset the compiler's default applies and that is what
     * happens, so a self-hosted deployment serving Questionnaires should set
     * it to its own public API base.
     */
    OPENRUNIC_FHIR_BASE_URL: z.url().optional(),
    /** OIDC issuer, matched exactly against the token's `iss`. */
    OIDC_ISSUER: z.url().optional(),
    /** Audience this API answers to. Several may be listed, comma separated. */
    OIDC_AUDIENCE: z.string().min(1).optional(),
    /** Where the issuer publishes its signing keys. */
    OIDC_JWKS_URI: z.url().optional(),
    /** Tolerance on `exp`, `nbf` and `iat`, in seconds. */
    OIDC_CLOCK_SKEW_SECONDS: z.coerce.number().int().min(0).max(600).default(60),
    /**
     * Where the provider authorises, and where it redeems a code.
     *
     * Named explicitly rather than discovered from the issuer, for the same
     * reason `OIDC_JWKS_URI` is. The one document that needs them,
     * `.well-known/smart-configuration`, is served unauthenticated, and an
     * unauthenticated endpoint that makes an outbound request on demand lets
     * anybody drive traffic out of this API at a URL this API chose. Two lines
     * of configuration are cheaper than owning that.
     *
     * Optional even when the rest of OIDC is set: a deployment can verify
     * tokens perfectly well without publishing a SMART launch, and it says so
     * by leaving these unset rather than by naming an endpoint that is not
     * there.
     */
    OIDC_AUTHORIZATION_ENDPOINT: z.url().optional(),
    OIDC_TOKEN_ENDPOINT: z.url().optional(),
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
  )
  // Two refinements rather than one comparing the pair, so the path names the
  // variable that is MISSING. `parseEnv` reports paths, not messages, and an
  // error naming the variable the operator just set tells them nothing they did
  // not already know.
  .refine(
    (value) =>
      value.OIDC_TOKEN_ENDPOINT === undefined || value.OIDC_AUTHORIZATION_ENDPOINT !== undefined,
    {
      message: 'OIDC_AUTHORIZATION_ENDPOINT and OIDC_TOKEN_ENDPOINT must be set together',
      path: ['OIDC_AUTHORIZATION_ENDPOINT'],
    }
  )
  .refine(
    (value) =>
      value.OIDC_AUTHORIZATION_ENDPOINT === undefined || value.OIDC_TOKEN_ENDPOINT !== undefined,
    {
      message: 'OIDC_AUTHORIZATION_ENDPOINT and OIDC_TOKEN_ENDPOINT must be set together',
      path: ['OIDC_TOKEN_ENDPOINT'],
    }
  )
  .refine(
    (value) => value.OIDC_AUTHORIZATION_ENDPOINT === undefined || value.OIDC_ISSUER !== undefined,
    {
      // A launch cannot be advertised by a deployment that cannot verify what
      // comes back from it. Allowing this pair alone would publish a working
      // authorisation flow whose tokens this API then rejects, and the app
      // developer would debug it at the far end of a redirect.
      message: 'OIDC_AUTHORIZATION_ENDPOINT requires the OIDC verification settings to be set too',
      path: ['OIDC_AUTHORIZATION_ENDPOINT'],
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

/**
 * The authorisation server a SMART app should be sent to, when this deployment
 * has one.
 *
 * Separate from {@link OidcSettings} because the two answer different questions.
 * `OidcSettings` is what this API needs to VERIFY a token that has arrived.
 * This is what a third-party app needs to OBTAIN one, and a deployment can
 * reasonably have the first without publishing the second.
 */
export interface SmartLaunchSettings {
  authorizationEndpoint: string;
  tokenEndpoint: string;
}

export function smartLaunchSettings(env: Env): SmartLaunchSettings | undefined {
  // The schema already refuses one without the other, and refuses either
  // without the verification settings, so a single check is the whole test.
  if (env.OIDC_AUTHORIZATION_ENDPOINT === undefined) return undefined;
  if (env.OIDC_TOKEN_ENDPOINT === undefined) return undefined;
  return {
    authorizationEndpoint: env.OIDC_AUTHORIZATION_ENDPOINT,
    tokenEndpoint: env.OIDC_TOKEN_ENDPOINT,
  };
}

/**
 * The canonical base for published FHIR resources, or undefined.
 *
 * Read from the process rather than threaded through, because the one caller
 * is a projection: `toResource` receives a row and the page's prepared data,
 * and widening that signature across every resource to carry one optional
 * string would be a worse trade than this. Parsed through the same schema as
 * everything else, so a malformed value fails here rather than surfacing as an
 * unresolvable canonical URL in a published Questionnaire.
 */
export function fhirBaseUrl(
  source: Record<string, string | undefined> = process.env
): string | undefined {
  const raw = source.OPENRUNIC_FHIR_BASE_URL;
  if (raw === undefined || raw.trim() === '') return undefined;
  const parsed = z.url().safeParse(raw.trim());
  if (!parsed.success) return undefined;
  /* Trailing slashes trimmed without a regex. `/\/+$/` backtracks
     super-linearly on a long run of them, which is a denial of service reachable
     from a configuration value, and the loop says the same thing in one pass. */
  let base = parsed.data;
  while (base.endsWith('/')) base = base.slice(0, -1);
  return base;
}
