import { describe, expect, it } from 'vitest';

import { isDemoBuild } from '@/lib/auth/build';
import { developmentCredentials } from '@/lib/auth/directory';

describe('the credentials the sign-in screen offers', () => {
  it('offers every development principal, each with a name and a role to show', () => {
    const offered = developmentCredentials('development');

    expect(offered).toHaveLength(4);
    for (const credential of offered) {
      expect(credential.token).not.toBe('');
      expect(credential.identity.displayName).not.toBe('');
      expect(credential.identity.roles.length).toBeGreaterThan(0);
    }
  });

  it('offers none of them in a production build, which has no door', () => {
    expect(developmentCredentials('production')).toHaveLength(0);
  });

  it('still offers none when the demonstration flag is simply absent', () => {
    // The default is the answer that matters. Every existing caller passes one
    // argument, and a door that opened because somebody forgot the second would
    // be the exact failure `directory.ts` was written to refuse.
    expect(developmentCredentials('production', undefined)).toHaveLength(0);
    expect(developmentCredentials('production', false)).toHaveLength(0);
  });

  it('opens for a demonstration build, which is the only production one that has a door', () => {
    expect(developmentCredentials('production', true)).toHaveLength(4);
  });
});

describe('what makes a build a demonstration', () => {
  /*
   * Two conditions, and the second is the one carrying the safety. A build
   * pointed at a real API can never be a demonstration however it was
   * configured, because the credentials a demonstration opens are the API's
   * public fixtures and that API refuses to start with them.
   */
  it('needs the flag to be set on purpose, with nothing defaulting to true', () => {
    expect(isDemoBuild(undefined, true)).toBe(false);
    expect(isDemoBuild('', true)).toBe(false);
    expect(isDemoBuild('false', true)).toBe(false);
    // Not truthiness: only the exact word, so a stray "0" or "no" closes it.
    expect(isDemoBuild('1', true)).toBe(false);
    expect(isDemoBuild('yes', true)).toBe(false);
    expect(isDemoBuild('true', true)).toBe(true);
  });

  it('refuses a build that is reading a real API, whatever the flag says', () => {
    expect(isDemoBuild('true', false)).toBe(false);
  });

  it('leaves out the patient-portal principal, because this is the staff EMR', () => {
    const tokens = developmentCredentials('development').map((credential) => credential.token);

    expect(tokens).not.toContain('dev-portal-a');
  });
});
