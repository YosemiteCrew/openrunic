import { describe, expect, it } from 'vitest';

import { identityForAccessToken } from '@/lib/auth/credentials';
import { developmentCredentials } from '@/lib/auth/directory';

describe('checking an access token', () => {
  it('recognises the API development principals and names them', () => {
    expect(identityForAccessToken('dev-clinician-a', 'development')?.displayName).toBe(
      'Dr. Adaeze Okafor'
    );
    expect(identityForAccessToken('dev-frontdesk-a', 'development')?.displayName).toBe(
      'Front Desk'
    );
    expect(identityForAccessToken('dev-biller-a', 'development')?.displayName).toBe('Billing');
    expect(identityForAccessToken('dev-clinician-b', 'development')?.displayName).toBe(
      'Dr. Rowan Vale'
    );
  });

  it('attributes an access to the same subject the API would', () => {
    // These ids are what an audit record files a chart access under, so they
    // have to match `apps/api/src/auth/static-resolver.ts` exactly rather than
    // merely look like it.
    expect(identityForAccessToken('dev-clinician-a', 'test')?.subject).toBe(
      '01890000-0000-7000-8000-000000000101'
    );
    expect(identityForAccessToken('dev-clinician-b', 'test')?.subject).toBe(
      '01890000-0000-7000-8000-000000000201'
    );
  });

  it('refuses the patient-portal principal, because this is the staff EMR', () => {
    // The API accepts this token. Letting it in here would give a patient a
    // rail, a top bar and a patient list they have no scopes for, and a session
    // spent collecting 403s.
    expect(identityForAccessToken('dev-portal-a', 'development')).toBeNull();
  });

  it('refuses a token nobody issued', () => {
    expect(identityForAccessToken('dev-clinician-c', 'development')).toBeNull();
    expect(identityForAccessToken('', 'development')).toBeNull();
  });

  it('refuses a token that is only a prefix of a real one', () => {
    // The comparison hashes both sides to a fixed width, so a short candidate
    // is neither a match nor a thrown length error.
    expect(identityForAccessToken('dev-clinician-', 'development')).toBeNull();
    expect(identityForAccessToken('dev-clinician-a-and-more', 'development')).toBeNull();
  });

  it('recognises nothing at all in a production build', () => {
    // The API refuses to start with these tokens under NODE_ENV=production, so
    // a web build that still opened the door for them would mint a session for
    // a credential that server has already decided to reject.
    expect(identityForAccessToken('dev-clinician-a', 'production')).toBeNull();
  });

  it('recognises every credential the sign-in screen offers', () => {
    for (const credential of developmentCredentials('development')) {
      expect(identityForAccessToken(credential.token, 'development')).toEqual(credential.identity);
    }
  });

  it('recognises them in a demonstration build, which is the door #154 needed', () => {
    // The session route is where this is called from, so this is the assertion
    // that says a visitor to a hosted demonstration can actually get past the
    // sign-in form. Without it the demonstration is four marketing pages and a
    // form that refuses everything.
    expect(identityForAccessToken('dev-clinician-a', 'production', true)?.displayName).toBe(
      'Dr. Adaeze Okafor'
    );
  });

  it('recognises nothing when the demonstration flag is left off the call', () => {
    // The default carries the old behaviour, so a caller that has not been told
    // about demonstration builds keeps the answer it always had.
    expect(identityForAccessToken('dev-clinician-a', 'production', false)).toBeNull();
    expect(identityForAccessToken('dev-clinician-a', 'production', undefined)).toBeNull();
  });

  it('still refuses a token that is not one of them, demonstration or not', () => {
    // The door opens to a fixed list, not to anything typed at it. A
    // demonstration that accepted an arbitrary string would be a sign-in form
    // that is decoration.
    expect(identityForAccessToken('dev-portal-a', 'production', true)).toBeNull();
    expect(identityForAccessToken('let-me-in', 'production', true)).toBeNull();
    expect(identityForAccessToken('', 'production', true)).toBeNull();
  });
});
