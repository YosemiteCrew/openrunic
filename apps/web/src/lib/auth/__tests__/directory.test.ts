import { describe, expect, it } from 'vitest';

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

  it('leaves out the patient-portal principal, because this is the staff EMR', () => {
    const tokens = developmentCredentials('development').map((credential) => credential.token);

    expect(tokens).not.toContain('dev-portal-a');
  });
});
