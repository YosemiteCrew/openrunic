import {
  SESSION_FETCH_HEADER,
  SESSION_FETCH_MARKER,
  SESSION_PATH,
  safeReturnPath,
  signInUrl,
} from './routes';
import { readSessionState, type PortalSessionState } from './session';

export type SignInOutcome =
  | { readonly ok: true; readonly session: PortalSessionState }
  | { readonly ok: false; readonly reason: 'rejected' | 'unavailable' };

const headers = { [SESSION_FETCH_HEADER]: SESSION_FETCH_MARKER };

async function bodyOf(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function signIn(token: string): Promise<SignInOutcome> {
  let response: Response;
  try {
    response = await fetch(SESSION_PATH, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    });
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
  if (response.status === 401) return { ok: false, reason: 'rejected' };
  if (!response.ok) return { ok: false, reason: 'unavailable' };
  const session = readSessionState(await bodyOf(response));
  return session === null ? { ok: false, reason: 'unavailable' } : { ok: true, session };
}

export async function restoreSession(signal?: AbortSignal): Promise<PortalSessionState | null> {
  try {
    const response = await fetch(SESSION_PATH, {
      headers,
      ...(signal === undefined ? {} : { signal }),
    });
    return response.ok ? readSessionState(await bodyOf(response)) : null;
  } catch {
    return null;
  }
}

export async function endSession(): Promise<void> {
  try {
    await fetch(SESSION_PATH, { method: 'DELETE', headers });
  } catch {
    return;
  }
}

export function landingPath(next: string | null | undefined): string {
  return safeReturnPath(next) ?? '/';
}

export function returnToSignIn(reason?: 'idle' | 'expired', next?: string | null): void {
  window.location.assign(signInUrl(next, reason));
}
