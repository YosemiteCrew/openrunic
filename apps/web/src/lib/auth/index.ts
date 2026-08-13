/**
 * The session's public surface. Screens, the shell and the data layer import
 * from `@/lib/auth` and nothing deeper, so where a token is kept can change
 * without touching anything that uses one.
 */
export { endSession, createSessionAwareFetch, restoreSession, signIn } from './client';
export type { SignInFailure, SignInOutcome } from './client';
export { applySessionCookie, clearSessionCookie } from './cookie';
export { developmentCredentials, identityForAccessToken } from './directory';
export type { StaffCredential } from './directory';
export {
  isPublicPath,
  landingPath,
  safeReturnPath,
  signInUrl,
  SESSION_PATH,
  SIGNED_IN_HOME,
  SIGN_IN_PATH,
} from './routes';
export type { SignInReason } from './routes';
export { SessionGate } from './SessionGate';
export type { SessionGateProps } from './SessionGate';
export {
  ABSOLUTE_LIFETIME_MS,
  IDLE_TIMEOUT_MS,
  SESSION_COOKIE,
  decodeSessionCookie,
  encodeSessionCookie,
  readIdentity,
  readSessionPayload,
  readSessionRecord,
  sessionExpiresAt,
  sessionState,
  startSessionRecord,
  toSession,
  touchSessionRecord,
} from './session';
export type { Identity, Session, SessionRecord, SessionState } from './session';
export { currentAccessToken, heldSession, holdSession, subscribeToSession } from './store';
export { useSession } from './useSession';
