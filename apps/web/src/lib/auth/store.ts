import type { Session } from './session';

/**
 * The one place a bearer token is held in the browser, and the reason it is
 * held nowhere else.
 *
 * A module-level variable is process-global on a server, shared by every
 * concurrent request. For a token that is not a caching detail, it is one
 * clinician's credential answering another clinician's render. So this store
 * holds nothing outside the browser and reports nothing outside the browser: on
 * the server it is permanently signed out, and a server component that wants
 * data has to be handed a token explicitly rather than picking one up from the
 * ambient module state. Every screen in this app is a client component today,
 * so nothing is lost by that; the guard is here because the first server-side
 * fetch someone adds is exactly when it stops being obvious.
 *
 * The subscriber list is what `useSession` renders from. It is deliberately not
 * a React context: `AppShell` and its top bar are mounted by tests that have no
 * provider around them, and a store that throws without one would make signing
 * in a prerequisite for rendering anything at all.
 */

let held: Session | null = null;

const listeners = new Set<() => void>();

function inBrowser(): boolean {
  return typeof window !== 'undefined';
}

/**
 * The snapshot `useSession` reads. Returns the same reference until something
 * writes, which is what `useSyncExternalStore` requires: a value that changes
 * on its own - because a clock passed a deadline, say - would make React
 * re-render forever looking for a stable read.
 */
export function heldSession(): Session | null {
  return inBrowser() ? held : null;
}

/**
 * The token to attach to an API request, or null.
 *
 * Unlike {@link heldSession} this does consult the clock, because the caller is
 * a fetch rather than a render: sending a token we know to be past its absolute
 * deadline would spend a request to be told what we already knew. The expired
 * session is left in place rather than cleared here, so that the resulting
 * unauthenticated 401 travels the same path as any other rejection and ends the
 * session in one place instead of two.
 */
export function currentAccessToken(): string | null {
  const session = heldSession();
  if (session === null || Date.now() >= session.expiresAt) return null;
  return session.token;
}

export function holdSession(session: Session | null): void {
  if (!inBrowser()) return;
  held = session;
  for (const listener of listeners) listener();
}

export function subscribeToSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
