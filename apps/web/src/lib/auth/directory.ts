import type { Identity } from './session';

/**
 * The development sign-in: which access tokens this application accepts, and
 * whose name it puts in the top bar when it does.
 *
 * ## Why the web app holds a table at all
 *
 * `GET /bff/v0/me` (#346) answers what a token may DO - its roles and its
 * permissions - and deliberately not whose it is. That DTO says it is not a
 * security boundary, and `subject` is what an audit record attributes an access
 * to, so an identity fact inside an advisory object would invite a client to
 * trust it for attribution. Nothing serves the caller their own subject or
 * display name, which is the half this table carries. So a sign-in surface that
 * has just accepted a token still has no way to ask whose it is, and something
 * has to know the name to render. Under OIDC that something is the token itself
 * - the
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
 * it. `scripts/ci/demo-principal-parity.mjs` asserts that on every `verify`; it
 * was checked by hand once, and a hand check works exactly once.
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

/**
 * The table, written as rows rather than as seven copies of one object.
 *
 * Each row is `[token, subject, display name, ...roles]`. The subjects are
 * spelled out in full on purpose: they are the load-bearing half, because an
 * audit record attributes an access to the subject, so these have to be
 * diffable by eye against `apps/api/src/auth/static-resolver.ts` rather than
 * merely look like it. Deriving them from a shared prefix would save a few
 * characters and cost exactly that.
 *
 * This was seven eight-line object literals until 2026-09-06, which Sonar reads
 * as one sixty-line self-duplication, and it is right: the shape carried no
 * information, and the four values on each row were the only thing that ever
 * differed. Every principal happens to hold one role today; the rest spread so
 * a two-role one needs no change here.
 */
const DEVELOPMENT_STAFF: readonly StaffCredential[] = (
  [
    ['dev-clinician-a', '01890000-0000-7000-8000-000000000101', 'Dr. Adaeze Okafor', 'clinician'],
    ['dev-frontdesk-a', '01890000-0000-7000-8000-000000000102', 'Front Desk', 'front-desk'],
    ['dev-biller-a', '01890000-0000-7000-8000-000000000103', 'Billing', 'biller'],
    ['dev-clinician-b', '01890000-0000-7000-8000-000000000201', 'Dr. Rowan Vale', 'clinician'],
    // The three oversight principals. They are staff, so the rule this table
    // already states - a patient's credential is not a staff credential -
    // admits them, and leaving them out would mean the API grew a token for
    // reading the audit trail that nobody could sign in with. They meet more
    // refusals than a clinician does, and that is the behaviour rather than a
    // gap here: the screens say which permission is missing.
    ['dev-auditor-a', '01890000-0000-7000-8000-000000000104', 'Audita Trailmore, CHC', 'auditor'],
    [
      'dev-stockkeeper-a',
      '01890000-0000-7000-8000-000000000105',
      'Stocka Shelfward, CPhT',
      'stock-keeper',
    ],
    ['dev-readonly-a', '01890000-0000-7000-8000-000000000106', 'Reada Overlook', 'read-only'],
  ] as const satisfies readonly (readonly [string, string, string, ...string[]])[]
).map(([token, subject, displayName, ...roles]) => ({
  token,
  identity: { subject, displayName, roles },
}));

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
  /* The empty list IS the refusal: no throw, no guard, the door closed by there
     being nothing to iterate. Anything that replaces this lookup with a call to
     the API has to re-express it explicitly, because an absence cannot fail a
     test - the API accepts a demo token whatever `NODE_ENV` says, so asking it
     instead would mint a session here and redden nothing. */
  return demoBuild ? DEVELOPMENT_STAFF : [];
}
