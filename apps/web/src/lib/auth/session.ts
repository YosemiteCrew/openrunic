/**
 * The staff session: what it is made of, where it is kept, and for how long.
 *
 * ## Where the token lives
 *
 * Two homes, one per reader.
 *
 * The browser holds the bearer token in memory only (`store.ts`): never in
 * `localStorage`, never in a cookie `document.cookie` exposes.
 *
 * Say plainly what that does and does not buy, because the usual claim for it
 * is false. It does **not** put the token beyond the reach of injected script.
 * `lib/api/client.ts` asks for it synchronously on every request, so it has to
 * be reachable from script, and script running in this page can read anything
 * the page can reach, a module-scoped variable included. Anyone who has
 * achieved execution on this origin can read the token, and can call `/session`
 * to be handed a fresh one besides. Memory-only is not a defence against
 * cross-site scripting, and writing that it is would be the wrong lesson to
 * leave in the code.
 *
 * What it does buy is that the token is never at rest and never outlives the
 * tab. Nothing is written to disk, so a payload that runs tomorrow finds
 * nothing from today, a backup or a synced profile carries no credential, and
 * the next person to sit down at a shared workstation recovers nothing from
 * storage. The window an attacker has to be inside is the life of the tab
 * rather than the life of the browser profile.
 *
 * The server holds the same session in an httpOnly cookie, because two readers
 * on that side need it and neither is script. `proxy.ts` decides whether a
 * clinical route renders at all, and the `/session` route handler hands the
 * token back to a page that has just been loaded and re-stamps the idle clock
 * for a tab that somebody is working in. httpOnly keeps the value out of
 * `document.cookie`; SameSite keeps it off cross-site writes.
 *
 * Be honest about the limit. A script that has already achieved execution on
 * this origin can call `/session` itself and be handed the token, exactly as
 * the application does. httpOnly raises the cost of exfiltration; it does not
 * prevent it. What bounds the damage is how long a stolen session stays worth
 * anything, which is the next section.
 *
 * The alternative not taken was to proxy every API call through Next so the
 * token never enters the browser at all. That is genuinely stronger, and it is
 * a different application: the data layer talks to a separately deployed API
 * origin and attaches its own bearer header, so the proxy would have to be a
 * second copy of the whole API surface, maintained in step with the first. It
 * is worth revisiting when this app and the API share an origin.
 *
 * ## How long it lasts
 *
 * Fifteen minutes idle, twelve hours absolute.
 *
 * The idle timeout exists for one specific person: the clinician called away
 * mid-note who leaves a chart open on a workstation in a corridor. Fifteen
 * minutes is short enough that the screen is not still showing a chart when the
 * next shift walks past, and long enough to survive reading a result or taking
 * a phone call. It should become a per-deployment setting - a single-user
 * practice and a shared ward terminal do not want the same number - and it is a
 * constant here because a setting nobody has asked for yet is a setting with no
 * requirements.
 *
 * The absolute lifetime is one long shift. It is the ceiling that makes a
 * stolen session a bounded problem rather than a permanent one, and it cannot
 * be extended by activity, which is the whole point of having it as well as the
 * idle timeout.
 *
 * `lastSeenAt` is the idle clock, and the word to hold onto is *seen*. It is
 * the last moment a person was known to be at the workstation, not the last
 * time a page was loaded, and `lib/auth/idle.ts` is what keeps that true: the
 * tab watches for human input and asks `/session` to re-stamp the clock while
 * someone is working. That file carries the decision about what counts as a
 * person being there, and what deliberately does not.
 *
 * Both deadlines are enforced on the server, by the `/session` handler and by
 * `proxy.ts`, because a timer in a tab is advice and a check on the cookie is
 * a rule. The tab runs its own countdown as well, so the screen actually clears
 * while the clinician is away rather than only failing on their return, and it
 * counts from the same instant the server does so that the two cannot disagree
 * about whether a session is still live.
 *
 * ## Tampering
 *
 * The cookie is sealed: `<signature>.<json>`, signed by this deployment with
 * HMAC-SHA-256. Rewriting any byte of it makes it read as no session at all.
 *
 * The seal is here for the clocks above, not for the token. A cookie somebody
 * writes by hand carries a token the API refuses, so it was never going to
 * reach a record - but before the seal, the timestamps beside that token were
 * writable too, and moving `issuedAt` forward turned a session with a minute
 * left into one with twelve hours. That is a control being erased by the person
 * it constrains. `lib/auth/seal.ts` sets out what signing does and does not
 * establish; the short version is that the API remains the boundary that
 * protects a record, and the seal is what makes the timeout a rule rather than
 * a suggestion.
 */

/** Who is signed in, as far as this application is concerned. */
export interface Identity {
  /** Stable subject identifier. Matches the API principal's `subject`. */
  readonly subject: string;
  /** What the top bar shows. Cached here so a later rename does not blank it. */
  readonly displayName: string;
  /** Role keys the token carries. Rendered, never used to decide access. */
  readonly roles: readonly string[];
}

/** A live session, as the browser holds it. */
export interface Session {
  /** Bearer token. `lib/api/client.ts` attaches it to every request. */
  readonly token: string;
  readonly identity: Identity;
  /** Epoch milliseconds. Past this the session is over, whatever else happens. */
  readonly expiresAt: number;
}

/** A session as the cookie carries it, with the two clocks kept separate. */
export interface SessionRecord {
  readonly token: string;
  readonly identity: Identity;
  /** When the session began. Fixed: the absolute lifetime runs from here. */
  readonly issuedAt: number;
  /** Last request that proved someone was still there. Re-stamped on refresh. */
  readonly lastSeenAt: number;
}

export const SESSION_COOKIE = 'or_session';

export const IDLE_TIMEOUT_MS = 15 * 60 * 1000;

export const ABSOLUTE_LIFETIME_MS = 12 * 60 * 60 * 1000;

/** Why a session is no longer usable, or that it still is. */
export type SessionState = 'active' | 'idle' | 'expired';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readText(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function readRoles(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null;
  return value.every((entry) => typeof entry === 'string') ? (value as string[]) : null;
}

function readTimestamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Parses an identity out of untrusted JSON, or null when it is not one. */
export function readIdentity(value: unknown): Identity | null {
  if (!isRecord(value)) return null;

  const subject = readText(value.subject);
  const displayName = readText(value.displayName);
  const roles = readRoles(value.roles);
  if (subject === null || displayName === null || roles === null) return null;

  return { subject, displayName, roles };
}

/**
 * Parses a cookie record, checking every field.
 *
 * The seal already refuses anything this deployment did not write, so in
 * practice these checks run on our own JSON. They stay because the shape of the
 * failure they prevent is severe out of proportion to their cost: a record with
 * `NaN` timestamps compares false against every deadline and so never expires,
 * and this is the last point before that record becomes a live session.
 */
export function readSessionRecord(value: unknown): SessionRecord | null {
  if (!isRecord(value)) return null;

  const token = readText(value.token);
  const identity = readIdentity(value.identity);
  const issuedAt = readTimestamp(value.issuedAt);
  const lastSeenAt = readTimestamp(value.lastSeenAt);
  if (token === null || identity === null || issuedAt === null || lastSeenAt === null) return null;

  return { token, identity, issuedAt, lastSeenAt };
}

/** Parses the `/session` response body, which is the same shape the store holds. */
export function readSessionPayload(value: unknown): Session | null {
  if (!isRecord(value)) return null;

  const token = readText(value.token);
  const identity = readIdentity(value.identity);
  const expiresAt = readTimestamp(value.expiresAt);
  if (token === null || identity === null || expiresAt === null) return null;

  return { token, identity, expiresAt };
}

/** When the absolute lifetime runs out, irrespective of activity. */
export function sessionExpiresAt(record: SessionRecord): number {
  return record.issuedAt + ABSOLUTE_LIFETIME_MS;
}

/**
 * The two deadlines, checked in the order that reports the more serious one:
 * an expired session cannot be revived by activity, so saying "idle" about it
 * would invite an interface that offers to extend it.
 */
export function sessionState(record: SessionRecord, now: number): SessionState {
  if (now >= sessionExpiresAt(record)) return 'expired';
  if (now >= record.lastSeenAt + IDLE_TIMEOUT_MS) return 'idle';
  return 'active';
}

export function startSessionRecord(token: string, identity: Identity, now: number): SessionRecord {
  return { token, identity, issuedAt: now, lastSeenAt: now };
}

/** Re-stamps the idle clock. The absolute clock is deliberately untouched. */
export function touchSessionRecord(record: SessionRecord, now: number): SessionRecord {
  return { ...record, lastSeenAt: now };
}

/** The half of a record the browser is given: no idle clock, one deadline. */
export function toSession(record: SessionRecord): Session {
  return { token: record.token, identity: record.identity, expiresAt: sessionExpiresAt(record) };
}
