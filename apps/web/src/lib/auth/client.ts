import { SESSION_PATH } from './routes';
import { readSessionPayload } from './session';
import type { Session } from './session';
import { heldSession, holdSession } from './store';

/**
 * The browser's half of the session: three calls to `/session`, and the wrapper
 * that notices when the API has stopped believing us.
 *
 * Every one of them goes to this application's own origin rather than to the
 * API. That is the seam the OIDC path arrives through: signing in becomes a
 * redirect to the provider and a callback, refreshing becomes a token exchange
 * against the provider's token endpoint, and both of those happen inside the
 * route handler where a client secret can exist. Nothing in this file changes,
 * because none of it knows where a token comes from.
 */

export type SignInFailure =
  /** The credential was not accepted. Nothing about retrying will help. */
  | 'rejected'
  /** We never got an answer. Worth trying again. */
  | 'unavailable';

export type SignInOutcome =
  | { readonly ok: true; readonly session: Session }
  | { readonly ok: false; readonly reason: SignInFailure };

const UNAUTHENTICATED = 401;

/**
 * The sign-out currently in flight, if any.
 *
 * Signing out clears the token from memory before the network call returns,
 * which is right, and which immediately makes `SessionGate` think the page it
 * is showing has lost its session and should be restored. Left unordered, that
 * restore reaches `/session` before the sign-out does, is handed a token
 * because the cookie is still there, re-stamps the cookie's idle clock, and
 * puts the session back. Pressing sign out then leaves you signed in - which is
 * exactly what a browser showed before this existed.
 *
 * A restore therefore waits for any revoke already under way. It never waits
 * long: this is a same-origin request that has already been dispatched.
 */
let revoking: Promise<unknown> = Promise.resolve();

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Exchanges an access token for a session.
 *
 * A rejected credential and an unreachable server are told apart because the
 * screen says different things about them, and a clinician who has typed the
 * right token into a server that is down should not be told their credential is
 * wrong. This is the opposite of the API's failure policy, which renders one
 * indistinguishable 401 for every bad token; the difference is deliberate,
 * because that policy is about not helping someone guess a credential, and this
 * one is about not lying to someone who already has one.
 */
export async function signIn(accessToken: string): Promise<SignInOutcome> {
  let response: Response;
  try {
    response = await globalThis.fetch(SESSION_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: accessToken }),
    });
  } catch {
    return { ok: false, reason: 'unavailable' };
  }

  if (response.status === UNAUTHENTICATED) return { ok: false, reason: 'rejected' };
  if (!response.ok) return { ok: false, reason: 'unavailable' };

  const session = readSessionPayload(await readJson(response));
  if (session === null) return { ok: false, reason: 'unavailable' };

  holdSession(session);
  return { ok: true, session };
}

/**
 * Puts the token back in memory after a page load, if the cookie still carries
 * a live session.
 *
 * This is also where the idle and absolute deadlines are actually enforced: the
 * handler re-stamps the idle clock when it answers, and refuses when either
 * deadline has passed. A page load is therefore the moment a session that
 * outlived its welcome stops existing, which is why the gate waits for this
 * answer before it renders a chart.
 */
export async function restoreSession(): Promise<Session | null> {
  await revoking;

  let response: Response;
  try {
    response = await globalThis.fetch(SESSION_PATH, { method: 'GET' });
  } catch {
    holdSession(null);
    return null;
  }

  const session = response.ok ? readSessionPayload(await readJson(response)) : null;
  holdSession(session);
  return session;
}

/**
 * Ends the session everywhere.
 *
 * Memory is cleared without waiting for the network, and unconditionally. If
 * the call to revoke the cookie fails, the right outcome is still a browser
 * holding no token; the alternative - keeping the credential because we could
 * not tell the server we were done with it - is how pressing sign out leaves
 * someone signed in.
 *
 * The revoke is dispatched before the token is dropped, so that a restore
 * woken by the drop is already ordered behind it. See `revoking` above.
 */
export async function endSession(): Promise<void> {
  revoking = globalThis.fetch(SESSION_PATH, { method: 'DELETE' }).catch(() => {
    // Nothing to report and nothing to retry: the credential is already gone
    // from this tab, and the cookie carries its own deadlines.
  });
  holdSession(null);
  await revoking;
}

/**
 * The fetch the data layer runs on.
 *
 * A 401 from the API is not an error a screen should render. It is the API's
 * verdict on the token we are holding, and the only honest response is to stop
 * holding it: `SessionGate` sees the session go and sends the clinician to sign
 * in again. Without this, a token that expires mid-shift turns every chart into
 * an error panel that a retry button cannot fix, which is the exact shape of
 * "the screen is broken" that gets reported as a bug against the chart.
 *
 * Guarded on there being a session to end, so an anonymous request that was
 * always going to 401 does not stampede the sign-out path.
 */
export function createSessionAwareFetch(): typeof fetch {
  return async (input, init) => {
    const response = await globalThis.fetch(input, init);
    if (response.status === UNAUTHENTICATED && heldSession() !== null) {
      await endSession();
    }
    return response;
  };
}
