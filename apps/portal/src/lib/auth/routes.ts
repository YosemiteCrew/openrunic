export const SIGN_IN_PATH = '/sign-in';
export const SESSION_PATH = '/api/session';
export const SESSION_FETCH_HEADER = 'x-openrunic-portal';
export const SESSION_FETCH_MARKER = 'same-origin';

export function safeReturnPath(value: string | null | undefined): string | null {
  if (!value?.startsWith('/')) return null;
  if (value.startsWith('//') || value.startsWith('/\\')) return null;
  for (const character of value) {
    if (character < ' ' || character === '\u007f') return null;
  }
  return value.startsWith(SIGN_IN_PATH) ? null : value;
}

export function signInUrl(next?: string | null, reason?: 'idle' | 'expired'): string {
  const params = new URLSearchParams();
  const target = safeReturnPath(next);
  if (target !== null) params.set('next', target);
  if (reason !== undefined) params.set('reason', reason);
  const query = params.toString();
  return query === '' ? SIGN_IN_PATH : `${SIGN_IN_PATH}?${query}`;
}
