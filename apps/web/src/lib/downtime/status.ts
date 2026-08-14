/**
 * What the application knows about its own reachability.
 *
 * A clinic does not stop at 2pm because a database did. Staff keep seeing
 * patients, and the software's job in that hour is to say clearly what has
 * happened, what still works, and what to do - not to show a spinner that never
 * resolves, a blank page, or a stack trace with a connection string in it.
 *
 * Three states, because they call for three different actions:
 *
 *   online     everything works.
 *   degraded   the server is up but cannot serve data. Almost always the
 *              database. Reading may work from what is already loaded; writing
 *              will not. Staff should keep paper notes for the gap.
 *   offline    the server cannot be reached at all - it is down, or this
 *              machine has no network. Nothing loads.
 */

export type ConnectivityStatus = 'online' | 'degraded' | 'offline';

/**
 * What the health probe last reported.
 *
 * `null` means no probe has completed yet - distinct from a failure, and the
 * distinction matters: treating "not yet known" as "broken" would flash an
 * outage banner on every page load and teach staff to ignore it.
 */
export type ProbeResult = 'ok' | 'degraded' | 'down' | null;

export interface StatusCopy {
  /** Short label, for the banner. */
  readonly title: string;
  /** What has happened, in one sentence, with no jargon. */
  readonly detail: string;
  /** What the person reading this should do next. */
  readonly action: string;
  /** Banners for a working system are polite; a broken one interrupts. */
  readonly tone: 'info' | 'warning' | 'critical';
}

/**
 * The words staff actually see.
 *
 * Kept as data rather than inline JSX so the wording is reviewable in one
 * place, and testable. Every string is written for a front-desk user in the
 * middle of a clinic day: no "5xx", no "upstream", no "connection pool".
 */
export const STATUS_COPY: Readonly<Record<ConnectivityStatus, StatusCopy>> = {
  online: {
    title: 'Connected',
    detail: 'openrunic is working normally.',
    action: '',
    tone: 'info',
  },
  degraded: {
    title: 'Read-only: records cannot be saved',
    detail:
      'The application is running but cannot reach the patient records database. Anything already on screen is still readable. New notes, orders and changes will not be saved.',
    action:
      'Keep working on paper for now and enter it once this message clears. Tell whoever looks after your server that the database is unreachable. This page checks again every few seconds on its own.',
    tone: 'critical',
  },
  offline: {
    title: 'Cannot reach openrunic',
    detail:
      'This computer cannot reach the openrunic server. That usually means the server is restarting, or this machine has lost its network connection.',
    action:
      'Check that this computer is on the practice network. If other computers have the same message, the server itself is down - tell whoever looks after it. This page keeps trying on its own; do not close it.',
    tone: 'critical',
  },
};

/**
 * Decides the status from the signals available in a browser.
 *
 * Three inputs, and all three are needed.
 *
 * `browserOnline` is the machine's own view of its network. `probe` is the
 * same-origin readiness check, which distinguishes "the server is gone" from
 * "the server is up and its database is gone" - a distinction a liveness check
 * cannot make, and the one that decides whether staff are told their notes are
 * not being saved. `dataFailing` is the data layer reporting that a request
 * which should have worked did not, and it catches the case where readiness
 * passes but real queries are failing anyway.
 */
export function resolveStatus(input: {
  readonly browserOnline: boolean;
  readonly probe: ProbeResult;
  readonly dataFailing: boolean;
}): ConnectivityStatus {
  if (!input.browserOnline) return 'offline';
  if (input.probe === 'down') return 'offline';
  if (input.probe === 'degraded') return 'degraded';
  // A probe that has not answered yet is not evidence of health, but it is not
  // evidence of failure either. Only a real failed request overrides it.
  if (input.dataFailing) return 'degraded';
  return 'online';
}
