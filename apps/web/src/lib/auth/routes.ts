/**
 * Which URLs a stranger may reach, and where a signed-in clinician belongs.
 *
 * The list is exact matches only, and it is a list rather than a pattern. A
 * prefix rule here would be one typo away from publishing a whole area of the
 * chart, and the same reasoning is written into the API's own public-path set
 * in `apps/api/src/middleware/authn.ts`. The cost is that adding a public page
 * means adding a line here; the benefit is that forgetting to leaves the new
 * route protected, which is the way round to be wrong.
 *
 * `proxy.ts` and `SessionGate` both read this, so the server's answer and
 * the browser's answer to "is this page public" come from one place rather than
 * from two lists that drift.
 */

export const SIGN_IN_PATH = '/sign-in';

/** The route handler that mints, refreshes and clears the session cookie. */
export const SESSION_PATH = '/session';

/**
 * Where signing in lands when nothing else is asked for.
 *
 * The rail is ordered by workflow rather than alphabetically, and Schedule is
 * its first row because that is where a clinical day starts: the front desk
 * opens the day list and works rightwards. `/` stays what it is - the public
 * marketing home - because the project's front door has to work for someone who
 * has never heard of it. A browser holding a live session and asking for `/` is
 * redirected here instead, since a person with a session is at work and did not
 * come for the brochure.
 */
export const SIGNED_IN_HOME = '/schedule';

/** The `(marketing)` route group, which is public by design. */
const MARKETING_PATHS: readonly string[] = [
  '/',
  '/for/developers',
  '/for/hospitals',
  '/for/patients',
];

const PUBLIC_PATHS: ReadonlySet<string> = new Set([...MARKETING_PATHS, SIGN_IN_PATH, SESSION_PATH]);

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname);
}

/** Why the sign-in screen is being shown, so it can say so rather than sit blank. */
export type SignInReason = 'idle' | 'expired';

/** The space, which is the first printable character: everything below it is a C0 control. */
const FIRST_PRINTABLE = ' ';
const DELETE_CHARACTER = '\u007f';

/**
 * Validates a `?next=` value before anything navigates to it.
 *
 * The parameter is attacker-controlled by construction, because it arrives in a
 * URL somebody can be sent, so it is accepted only as a path on this origin.
 * `//host` and `/\host` are the two spellings a browser reads as protocol
 * relative, which is how a "sign in and continue" link becomes an open redirect
 * to a page that asks for the same credentials again. Control characters are
 * refused as well: this value reaches a `Location` header, and a newline in a
 * header is a second header.
 */
export function safeReturnPath(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  if (!value.startsWith('/')) return null;
  if (value.startsWith('//') || value.startsWith('/\\')) return null;

  // Compared as characters rather than as code points, because `codePointAt`
  // is typed as possibly undefined and the `?? 0` that satisfies it is a branch
  // no input can take: iterating a string yields non-empty characters. Every C0
  // control sorts below the space, so this says the same thing with nothing
  // unreachable in it.
  for (const character of value) {
    if (character < FIRST_PRINTABLE || character === DELETE_CHARACTER) return null;
  }

  return value;
}

/**
 * The query the sign-in screen needs: where to return to, and why we are here.
 *
 * Separate from {@link signInUrl} because the two callers want different
 * halves. The browser wants a whole path to navigate to; `proxy.ts` wants only
 * the query, because it builds its redirect by editing the request's own parsed
 * URL rather than by concatenating one, which is what keeps the destination on
 * this origin by construction instead of by inspection.
 *
 * A return path pointing back at the sign-in screen is dropped: it would send a
 * clinician who has just signed in straight back to the form.
 */
export function signInQuery(next?: string | null, reason?: SignInReason): string {
  const params = new URLSearchParams();
  const target = safeReturnPath(next);
  if (target !== null && !target.startsWith(SIGN_IN_PATH)) params.set('next', target);
  if (reason !== undefined) params.set('reason', reason);
  return params.toString();
}

/** The sign-in path with that query attached, for a browser to navigate to. */
export function signInUrl(next?: string | null, reason?: SignInReason): string {
  const query = signInQuery(next, reason);
  return query === '' ? SIGN_IN_PATH : `${SIGN_IN_PATH}?${query}`;
}

/** Where to send someone who has just signed in. */
export function landingPath(next?: string | null): string {
  const target = safeReturnPath(next);
  return target === null || target.startsWith(SIGN_IN_PATH) ? SIGNED_IN_HOME : target;
}
