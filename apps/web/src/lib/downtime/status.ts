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
  /** Catalogue key for the short banner label. */
  readonly titleKey: string;
  /** Catalogue key for what has happened, in one sentence, with no jargon. */
  readonly detailKey: string;
  /** Catalogue key for what the person reading this should do next. */
  readonly actionKey: string | null;
  /** Banners for a working system are polite; a broken one interrupts. */
  readonly tone: 'info' | 'warning' | 'critical';
}

/**
 * What staff actually see, as keys.
 *
 * Kept as data rather than inline JSX so the wording is reviewable in one place
 * and testable, and as keys rather than sentences so a clinic that does not
 * work in English is told its notes are not being saved in a language it reads.
 * That is the single most important sentence this application ever shows, and
 * it is the one a reader is least able to puzzle out from context.
 *
 * `actionKey` is null where there is nothing to do, rather than an empty
 * string: an empty message would render as a blank paragraph, and the banner
 * would carry an empty line where an instruction usually is.
 */
export const STATUS_COPY: Readonly<Record<ConnectivityStatus, StatusCopy>> = {
  online: {
    titleKey: 'downtime.online.title',
    detailKey: 'downtime.online.detail',
    actionKey: null,
    tone: 'info',
  },
  degraded: {
    titleKey: 'downtime.degraded.title',
    detailKey: 'downtime.degraded.detail',
    actionKey: 'downtime.degraded.action',
    tone: 'critical',
  },
  offline: {
    titleKey: 'downtime.offline.title',
    detailKey: 'downtime.offline.detail',
    actionKey: 'downtime.offline.action',
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
