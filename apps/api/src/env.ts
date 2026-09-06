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
/**
 * An optional or defaulted setting, where blank means "not set".
 *
 * A `.env` carries every key the template has, and a key with nothing after the
 * `=` is how an operator says "not this one" - it is what `.env.example` ships
 * for the settings a practice may not need. Compose hands such a key to the
 * container as an empty string rather than leaving it out, so without this the
 * documented way to decline a setting is a startup failure naming the variable
 * the operator deliberately left alone.
 *
 * Applied to every field an operator can decline rather than to the one that
 * reached a container first, because the difference is not a property of those
 * fields: it is what an empty `.env` line means, and it means the same thing on
 * all of them. On a coerced number it matters more quietly - `Number('')` is 0,
 * so a blank `OIDC_CLOCK_SKEW_SECONDS` would have become no tolerance at all
 * rather than the documented sixty seconds, with nothing to read in a log.
 *
 * `NODE_ENV` is the exception and says why at its own declaration: it is not a
 * setting a practice declines, and blank there would mean the demo-token mode
 * rather than a refusal.
 *
 * Only whitespace is read as absence. A value that is present and malformed
 * still fails, which is the whole point of parsing the environment at startup.
 */
function blankAsUnset<T extends z.ZodType>(schema: T): z.ZodPreprocess<T> {
  return z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    schema
  );
}

const envObject = z.object({
  PORT: blankAsUnset(z.coerce.number().int().min(1).max(65535).default(4000)),
  /**
   * Deliberately NOT wrapped in {@link blankAsUnset}, and it is the one field
   * in this object where that matters.
   *
   * Everywhere else, blank and absent have the same consequence: a setting
   * the operator declined. Here they do not. Blank would default to
   * `development`, which is the mode that accepts the table of public demo
   * tokens printed in this repository's own source - so the rule that makes
   * every other field forgiving would turn one empty line into a deployment
   * serving charts to anyone holding a token anybody can read.
   *
   * It is also not a setting a practice declines. `.env.example` ships no
   * `NODE_ENV` line at all and Compose sets it on both services, so the only
   * way to reach a blank one is to have written it, and a refusal to start is
   * the right answer to that. Fail closed on the one field where "not set"
   * and "set wrong" differ in what they cost.
   */
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
  OPENRUNIC_FHIR_BASE_URL: blankAsUnset(z.url().optional()),
  /** OIDC issuer, matched exactly against the token's `iss`. */
  OIDC_ISSUER: blankAsUnset(z.url().optional()),
  /** Audience this API answers to. Several may be listed, comma separated. */
  OIDC_AUDIENCE: blankAsUnset(z.string().min(1).optional()),
  /** Where the issuer publishes its signing keys. */
  OIDC_JWKS_URI: blankAsUnset(z.url().optional()),
  /** Tolerance on `exp`, `nbf` and `iat`, in seconds. */
  OIDC_CLOCK_SKEW_SECONDS: blankAsUnset(z.coerce.number().int().min(0).max(600).default(60)),
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
  OIDC_AUTHORIZATION_ENDPOINT: blankAsUnset(z.url().optional()),
  OIDC_TOKEN_ENDPOINT: blankAsUnset(z.url().optional()),
});

/**
 * Every variable this process reads from its environment.
 *
 * Derived from the schema rather than listed beside it, so it cannot drift from
 * what is actually parsed. It exists because a setting the code reads and the
 * deployment never passes is a defect this repository has now shipped twice -
 * `OPENRUNIC_FHIR_BASE_URL` and then the whole identity-provider group - and
 * both times it looked like a working deployment ignoring its own
 * configuration. `env.test.ts` reads this and asserts `docker-compose.yml`
 * names each one, so the third instance fails a test instead of a clinic.
 */
export const ENV_VARIABLES: readonly string[] = Object.keys(envObject.shape);

/**
 * The three settings that verify a token, which are set together or not at all.
 *
 * One refinement per variable rather than one over the group, so the path names
 * the variable that is MISSING. `parseEnv` reports paths and never messages, on
 * purpose - a value must not reach a log somebody pastes into a support thread
 * - so the path is the whole of what the operator is told.
 *
 * Written as a group over one refinement, this named `OIDC_ISSUER` whichever of
 * the three was absent: an operator who set the issuer and the audience and
 * forgot the JWKS URI was told to fix the issuer, which is the line they got
 * right. The rule was already written down two lines below and applied to the
 * endpoint pair; this is it applied to the group it was written above.
 */
const OIDC_VERIFICATION = ['OIDC_ISSUER', 'OIDC_AUDIENCE', 'OIDC_JWKS_URI'] as const;

const withVerificationGroup = OIDC_VERIFICATION.reduce(
  (schema, name) =>
    schema.refine(
      (value) =>
        OIDC_VERIFICATION.every((other) => value[other] === undefined) || value[name] !== undefined,
      {
        message: `${OIDC_VERIFICATION.join(', ')} must be set together or not at all`,
        path: [name],
      }
    ),
  // A single assertion rather than one through `unknown`. Asserting through
  // `unknown` succeeds whatever the two types are, so it would keep compiling
  // if the accumulator stopped producing this object's own inferred type -
  // which is the one thing this cast exists to promise. Raised in review.
  envObject as z.ZodType<z.infer<typeof envObject>>
);

const envSchema = withVerificationGroup
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
