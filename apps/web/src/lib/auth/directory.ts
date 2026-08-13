import type { Identity } from './session';

/**
 * The development sign-in: which access tokens this application accepts, and
 * whose name it puts in the top bar when it does.
 *
 * ## Why the web app holds a table at all
 *
 * The API has no endpoint that answers "who is this token". Its authn
 * middleware resolves a token to a principal and hands that principal to the
 * handler; nothing serves it back to the caller. So a sign-in surface that has
 * just accepted a token has no way to ask what it means, and something has to
 * know the name to render. Under OIDC that something is the token itself - the
 * identity comes out of the verified claims, and this table stops being
 * consulted. {@link identityForAccessToken} is that seam: it is the one
 * function that turns a credential into a name, and the OIDC path replaces its
 * body rather than the shape of anything that calls it.
 *
 * ## Why these values are safe to commit
 *
 * They are the API's own development fixtures, copied from
 * `apps/api/src/auth/static-resolver.ts`, and that file says what they are: not
 * secrets, granting nothing anywhere, refused outright by `createApp` under
 * `NODE_ENV=production`. Duplicating them is a real cost - two files to edit
 * when a demo principal changes - and the alternative was importing from the
 * API package, which would put a server's auth module into a browser bundle.
 * The subjects are the load-bearing half: they are what an audit record
 * attributes an access to, so they must match the API's, not merely look like
 * it.
 *
 * ## Who is deliberately missing
 *
 * `dev-portal-a`, the patient-portal principal. The API accepts it; this
 * application refuses it, because this is the staff EMR and a patient's
 * credential is not a staff credential. A portal token that signed in here
 * would reach a top bar, a rail and a patient list it has no scopes for, and
 * would spend the rest of the session collecting 403s. Refusing at the door
 * says the true thing once instead of six times.
 */

export interface StaffCredential {
  /** The bearer token the API's development resolver recognises. */
  readonly token: string;
  readonly identity: Identity;
}

const DEVELOPMENT_STAFF: readonly StaffCredential[] = [
  {
    token: 'dev-clinician-a',
    identity: {
      subject: '01890000-0000-7000-8000-000000000101',
      displayName: 'Dr. Adaeze Okafor',
      roles: ['clinician'],
    },
  },
  {
    token: 'dev-frontdesk-a',
    identity: {
      subject: '01890000-0000-7000-8000-000000000102',
      displayName: 'Front Desk',
      roles: ['front-desk'],
    },
  },
  {
    token: 'dev-biller-a',
    identity: {
      subject: '01890000-0000-7000-8000-000000000103',
      displayName: 'Billing',
      roles: ['biller'],
    },
  },
  {
    token: 'dev-clinician-b',
    identity: {
      subject: '01890000-0000-7000-8000-000000000201',
      displayName: 'Dr. Rowan Vale',
      roles: ['clinician'],
    },
  },
];

/**
 * The credentials this build accepts, which outside development is none of
 * them.
 *
 * This is the same stance `assertProductionWiring` takes in the API: a
 * convenience default that survives into production is how a demo token becomes
 * a credential. The API refuses to start with the static resolver under
 * `NODE_ENV=production`, and a production web build that still opened the door
 * for `dev-clinician-a` would mint a session cookie for a token that server has
 * already decided to reject - past the route guard, into the shell, and straight
 * into a screenful of 401s. Better to have no door than a false one.
 *
 * The consequence, stated plainly: there is no way to sign in to a production
 * build yet. That is the true state of the project, and it stops being true
 * when the OIDC path lands.
 *
 * `nodeEnv` is a parameter rather than a read of `process.env` inside these
 * functions because the production branch is the one that matters and the one a
 * test process can never be in.
 */
export function developmentCredentials(nodeEnv: string | undefined): readonly StaffCredential[] {
  return nodeEnv === 'production' ? [] : DEVELOPMENT_STAFF;
}

/**
 * Turns an access token into the identity to render, or null when this build
 * does not recognise it.
 *
 * The lookup is a plain scan with no constant-time comparison and no rate
 * limiting, for the reason the API's resolver gives for the same choice: these
 * tokens are public fixtures, so there is nothing here worth guessing. Both of
 * those become requirements the moment this function verifies a real
 * credential, and the OIDC implementation that replaces it verifies a signature
 * instead of comparing a string.
 */
export function identityForAccessToken(
  token: string,
  nodeEnv: string | undefined
): Identity | null {
  return developmentCredentials(nodeEnv).find((entry) => entry.token === token)?.identity ?? null;
}
