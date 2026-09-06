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
 * consulted. `identityForAccessToken` in `credentials.ts` is that seam: it is
 * the one function that turns a credential into a name, and the OIDC path
 * replaces its body rather than the shape of anything that calls it. It lives
 * in its own module because checking a credential needs `node:crypto` and this
 * one is read by the sign-in screen in the browser.
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
  /*
   * The three oversight principals. They are staff, so the rule this table
   * already states - a patient's credential is not a staff credential - admits
   * them, and leaving them out would mean the API grew a token for reading the
   * audit trail that nobody could sign in with.
   *
   * They will meet more refusals than a clinician does, and that is the point
   * rather than a defect: `read-only` may open a chart and not write to it, and
   * `auditor` may open the log and almost nothing else. The screens say which
   * permission is missing; a role that cannot do a thing being told so is the
   * behaviour, not a gap in this table.
   */
  {
    token: 'dev-auditor-a',
    identity: {
      subject: '01890000-0000-7000-8000-000000000104',
      displayName: 'Audita Trailmore, CHC',
      roles: ['auditor'],
    },
  },
  {
    token: 'dev-stockkeeper-a',
    identity: {
      subject: '01890000-0000-7000-8000-000000000105',
      displayName: 'Stocka Shelfward, CPhT',
      roles: ['stock-keeper'],
    },
  },
  {
    token: 'dev-readonly-a',
    identity: {
      subject: '01890000-0000-7000-8000-000000000106',
      displayName: 'Reada Overlook',
      roles: ['read-only'],
    },
  },
];

/**
 * The credentials this build accepts, which outside development is almost never
 * any of them.
 *
 * This is the same stance `assertProductionWiring` takes in the API: a
 * convenience default that survives into production is how a demo token becomes
 * a credential. The API refuses to start with the static resolver under
 * `NODE_ENV=production`, and a production web build that still opened the door
 * for `dev-clinician-a` would mint a session cookie for a token that server has
 * already decided to reject - past the route guard, into the shell, and straight
 * into a screenful of 401s. Better to have no door than a false one.
 *
 * That objection is to a **default**, and it stands. What it also produced was a
 * product nobody outside a checkout could look at: a production build had no way
 * to sign in at all, so a hosted demonstration (#154) could show four marketing
 * pages and a sign-in form that refuses everything.
 *
 * `demoBuild` is the door, and it defaults to closed. `lib/auth/build.ts` is the
 * only thing that answers true for it, and it takes two conditions to do so: the
 * build was told to be a demonstration, and its data layer is reading fixtures.
 * A build pointed at a real API is exactly the case this comment started by
 * refusing, and it can never reach the second condition.
 *
 * Neither is read from `process.env` inside these functions. The branches that
 * matter are production and demonstration, and those are the two a test process
 * can never be in.
 */
export function developmentCredentials(
  nodeEnv: string | undefined,
  demoBuild = false
): readonly StaffCredential[] {
  if (nodeEnv !== 'production') return DEVELOPMENT_STAFF;
  return demoBuild ? DEVELOPMENT_STAFF : [];
}
