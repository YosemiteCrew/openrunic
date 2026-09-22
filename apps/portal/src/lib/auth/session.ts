export interface PortalSessionRecord {
  readonly token: string;
  readonly issuedAt: number;
  readonly lastSeenAt: number;
}

export interface PortalSessionState {
  readonly expiresAt: number;
  readonly idleExpiresAt: number;
}

export const SESSION_COOKIE = 'or_portal_session';
export const IDLE_TIMEOUT_MS = 15 * 60 * 1000;
export const ABSOLUTE_LIFETIME_MS = 12 * 60 * 60 * 1000;
export const MAX_SESSION_TOKEN_LENGTH = 3072;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readSessionToken(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_SESSION_TOKEN_LENGTH
    ? value
    : null;
}

export function readSessionRecord(value: unknown): PortalSessionRecord | null {
  if (!isRecord(value)) return null;
  const { token, issuedAt, lastSeenAt } = value;
  const parsedToken = readSessionToken(token);
  if (
    parsedToken === null ||
    typeof issuedAt !== 'number' ||
    !Number.isFinite(issuedAt) ||
    typeof lastSeenAt !== 'number' ||
    !Number.isFinite(lastSeenAt)
  ) {
    return null;
  }
  return { token: parsedToken, issuedAt, lastSeenAt };
}

export function startSessionRecord(token: string, now: number): PortalSessionRecord {
  return { token, issuedAt: now, lastSeenAt: now };
}

export function touchSessionRecord(record: PortalSessionRecord, now: number): PortalSessionRecord {
  return { ...record, lastSeenAt: now };
}

export function sessionIsActive(record: PortalSessionRecord, now: number): boolean {
  return now < record.issuedAt + ABSOLUTE_LIFETIME_MS && now < record.lastSeenAt + IDLE_TIMEOUT_MS;
}

export function toSessionState(record: PortalSessionRecord): PortalSessionState {
  return {
    expiresAt: record.issuedAt + ABSOLUTE_LIFETIME_MS,
    idleExpiresAt: record.lastSeenAt + IDLE_TIMEOUT_MS,
  };
}

export function readSessionState(value: unknown): PortalSessionState | null {
  if (!isRecord(value)) return null;
  const { expiresAt, idleExpiresAt } = value;
  if (
    typeof expiresAt !== 'number' ||
    !Number.isFinite(expiresAt) ||
    typeof idleExpiresAt !== 'number' ||
    !Number.isFinite(idleExpiresAt)
  ) {
    return null;
  }
  return { expiresAt, idleExpiresAt };
}
