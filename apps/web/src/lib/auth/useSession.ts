'use client';

import { useSyncExternalStore } from 'react';

import type { Session } from './session';
import { heldSession, subscribeToSession } from './store';

/**
 * The signed-in session, or null.
 *
 * `useSyncExternalStore` rather than a context because the store is not React's
 * to own: `lib/api/config.ts` reads the same token from outside any component
 * tree, on every request, and a context would give it no way to.
 *
 * The same reader serves as the server snapshot, because it already answers
 * null there by construction - see `store.ts` for why a token must never be
 * held in module state on a server. A separate server snapshot would be a
 * second statement of the same rule, free to disagree with the first.
 */
export function useSession(): Session | null {
  return useSyncExternalStore(subscribeToSession, heldSession, heldSession);
}
