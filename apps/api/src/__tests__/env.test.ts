import { describe, expect, it } from 'vitest';

import { oidcSettings, parseEnv, smartLaunchSettings, type Env } from '../env.js';

describe('parseEnv', () => {
  it('applies defaults when variables are absent', () => {
    const env: Env = parseEnv({});

    expect(env.PORT).toBe(4000);
    expect(env.NODE_ENV).toBe('development');
  });

  it('parses and coerces provided values', () => {
    const env = parseEnv({ PORT: '8080', NODE_ENV: 'production' });

    expect(env).toEqual({
      PORT: 8080,
      NODE_ENV: 'production',
      OIDC_CLOCK_SKEW_SECONDS: 60,
    });
  });

  it('rejects out-of-range ports', () => {
    expect(() => parseEnv({ PORT: '70000' })).toThrowError(/PORT/);
  });

  it('names every invalid variable without echoing values', () => {
    let caught: unknown;
    try {
      parseEnv({ PORT: 'not-a-port', NODE_ENV: 'staging' });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    expect(message).toContain('PORT');
    expect(message).toContain('NODE_ENV');
    // values must never leak into the error message
    expect(message).not.toContain('not-a-port');
    expect(message).not.toContain('staging');
  });
});

describe('the identity-provider settings', () => {
  const configured = {
    OIDC_ISSUER: 'https://idp.example.invalid',
    OIDC_AUDIENCE: 'openrunic-api, openrunic-portal',
    OIDC_JWKS_URI: 'https://idp.example.invalid/jwks',
  };

  it('are absent when the deployment configured none', () => {
    expect(oidcSettings(parseEnv({}))).toBeUndefined();
  });

  it('read a comma-separated audience list', () => {
    expect(oidcSettings(parseEnv(configured))).toEqual({
      issuer: 'https://idp.example.invalid',
      audience: ['openrunic-api', 'openrunic-portal'],
      jwksUri: 'https://idp.example.invalid/jwks',
      clockSkewSeconds: 60,
    });
  });

  it('accept an explicit clock skew', () => {
    const env = parseEnv({ ...configured, OIDC_CLOCK_SKEW_SECONDS: '15' });

    expect(oidcSettings(env)?.clockSkewSeconds).toBe(15);
  });

  it('are refused when only half of them are set', () => {
    // A partial configuration would fall back to the development principal
    // table, which is the failure this refusal exists to prevent.
    expect(() => parseEnv({ OIDC_ISSUER: 'https://idp.example.invalid' })).toThrow(/OIDC_ISSUER/);
    expect(() =>
      parseEnv({ OIDC_ISSUER: 'https://idp.example.invalid', OIDC_AUDIENCE: 'a' })
    ).toThrow(/OIDC_ISSUER/);
  });

  it('refuse an issuer that is not a URL', () => {
    expect(() => parseEnv({ ...configured, OIDC_ISSUER: 'not-a-url' })).toThrow(/OIDC_ISSUER/);
  });
});

describe('a half-configured provider is refused at parse time', () => {
  const COMPLETE = {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/openrunic',
    OIDC_ISSUER: 'https://id.example.invalid',
    OIDC_AUDIENCE: 'openrunic-api',
    OIDC_JWKS_URI: 'https://id.example.invalid/jwks.json',
  };

  it.each([['OIDC_ISSUER'], ['OIDC_AUDIENCE'], ['OIDC_JWKS_URI']])(
    'refuses the environment when %s is the one that is missing',
    (missing) => {
      const partial: Record<string, string> = { ...COMPLETE };
      delete partial[missing];

      // This is the case that matters most in this file. An operator who
      // intended authentication and misspelled one variable must not get a
      // deployment that quietly accepts the demo tokens instead.
      expect(() => parseEnv(partial)).toThrow(/Invalid environment configuration/);
    }
  );

  it('accepts all three together', () => {
    expect(oidcSettings(parseEnv(COMPLETE as NodeJS.ProcessEnv))?.issuer).toBe(
      'https://id.example.invalid'
    );
  });

  it('accepts none of them, which is the demo-token path', () => {
    expect(oidcSettings(parseEnv({ DATABASE_URL: COMPLETE.DATABASE_URL }))).toBeUndefined();
  });
});

describe('the SMART launch settings', () => {
  const verification = {
    OIDC_ISSUER: 'https://idp.example.invalid',
    OIDC_AUDIENCE: 'openrunic-api',
    OIDC_JWKS_URI: 'https://idp.example.invalid/jwks',
  };
  const endpoints = {
    OIDC_AUTHORIZATION_ENDPOINT: 'https://idp.example.invalid/authorize',
    OIDC_TOKEN_ENDPOINT: 'https://idp.example.invalid/oauth/token',
  };

  it('are absent when the deployment publishes no launch', () => {
    // Verifying tokens and publishing a launch are separate decisions. A
    // deployment whose apps are configured by hand wants the first and not the
    // second, and it says so by leaving these unset.
    expect(smartLaunchSettings(parseEnv(verification))).toBeUndefined();
  });

  it('read both endpoints when the deployment set them', () => {
    expect(smartLaunchSettings(parseEnv({ ...verification, ...endpoints }))).toEqual({
      authorizationEndpoint: 'https://idp.example.invalid/authorize',
      tokenEndpoint: 'https://idp.example.invalid/oauth/token',
    });
  });

  it.each(['OIDC_AUTHORIZATION_ENDPOINT', 'OIDC_TOKEN_ENDPOINT'])(
    'refuses %s on its own',
    (missing) => {
      const partial: Record<string, string> = { ...verification, ...endpoints };
      delete partial[missing];

      // Half a pair would publish a document naming one endpoint and not the
      // other, which no client can complete a flow against.
      expect(() => parseEnv(partial)).toThrow(/Invalid environment configuration/);
    }
  );

  it('refuses a launch the deployment could not verify the result of', () => {
    // Authorising against a provider whose tokens this API cannot check would
    // give an app a working redirect and a 401 at the end of it.
    expect(() => parseEnv(endpoints)).toThrow(/Invalid environment configuration/);
  });

  it.each([
    ['OIDC_AUTHORIZATION_ENDPOINT', 'OIDC_TOKEN_ENDPOINT'],
    ['OIDC_TOKEN_ENDPOINT', 'OIDC_AUTHORIZATION_ENDPOINT'],
  ])('names what is missing when only %s is set, not what was set', (present, absent) => {
    let message = '';
    try {
      parseEnv({ ...verification, [present]: 'https://a.invalid/somewhere' });
    } catch (error) {
      message = error instanceof Error ? error.message : '';
    }

    // The variable the operator has to add, not the one they just typed.
    expect(message).toContain(absent);
    // And never the value: this file's errors are read out of boot logs.
    expect(message).not.toContain('a.invalid');
  });
});

/**
 * A blank `.env` line, which is what an operator writes to decline a setting.
 *
 * `.env.example` ships `OPENRUNIC_FHIR_BASE_URL=` with nothing after it, the
 * installer copies that line into `.env` verbatim, and Compose hands a blank
 * key to the container as an empty string rather than leaving it out. Without
 * the blank-is-unset rule the documented way to decline a setting is a startup
 * failure naming the variable the operator deliberately left alone - so these
 * assertions are the ones standing between the Compose change that passes
 * `OPENRUNIC_FHIR_BASE_URL` through and a self-hosted stack that will not boot.
 */
describe('a variable that is present and blank', () => {
  const verification = {
    OIDC_ISSUER: 'https://idp.example.invalid',
    OIDC_AUDIENCE: 'openrunic-api',
    OIDC_JWKS_URI: 'https://idp.example.invalid/jwks',
  };

  it('reads as unset on the canonical FHIR base', () => {
    expect(parseEnv({ OPENRUNIC_FHIR_BASE_URL: '' }).OPENRUNIC_FHIR_BASE_URL).toBeUndefined();
  });

  it('reads as unset when it is only whitespace', () => {
    expect(parseEnv({ OPENRUNIC_FHIR_BASE_URL: '   ' }).OPENRUNIC_FHIR_BASE_URL).toBeUndefined();
  });

  it('still refuses a value that is present and malformed', () => {
    // The point of parsing the environment at startup. Blank means "not this
    // one"; anything else means the operator meant it and got it wrong.
    expect(() => parseEnv({ OPENRUNIC_FHIR_BASE_URL: 'not-a-url' })).toThrow(
      /OPENRUNIC_FHIR_BASE_URL/
    );
  });

  it('leaves a defaulted number at its default rather than coercing to zero', () => {
    /*
     * The quiet one. `Number('')` is 0, so a blank clock skew would have become
     * no tolerance at all - every token from a provider a second out of step
     * rejected, with nothing in a log to say why, and the operator having set
     * the variable to exactly the value the file told them meant "leave it".
     */
    expect(parseEnv({ ...verification, OIDC_CLOCK_SKEW_SECONDS: '' }).OIDC_CLOCK_SKEW_SECONDS).toBe(
      60
    );
    expect(parseEnv({ PORT: '' }).PORT).toBe(4000);
    expect(parseEnv({ NODE_ENV: '' }).NODE_ENV).toBe('development');
  });

  it('does not turn a half-configured provider into a whole one', () => {
    /*
     * The refusal this file cares about most must survive the new rule. A blank
     * audience is an unset audience, so an issuer and a JWKS URI with a blank
     * audience is still the partial configuration that would otherwise fall
     * back to the demo tokens.
     */
    expect(() =>
      parseEnv({
        OIDC_ISSUER: verification.OIDC_ISSUER,
        OIDC_JWKS_URI: verification.OIDC_JWKS_URI,
        OIDC_AUDIENCE: '',
      })
    ).toThrow(/OIDC_ISSUER/);
  });
});
