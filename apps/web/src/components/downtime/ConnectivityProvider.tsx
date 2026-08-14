'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

import { resolveStatus, type ConnectivityStatus, type ProbeResult } from '@/lib/downtime/status';

/**
 * Watches whether the API is reachable and publishes it to the whole app.
 *
 * Two independent signals feed the answer:
 *
 *   1. A periodic probe of the API's health endpoint. Proves the API process is
 *      alive and answering.
 *   2. Reports from the data layer. `reportDataFailure()` is called when a
 *      request fails for a reason that is not the caller's fault.
 *
 * The second one is what catches a database outage. An API whose health
 * endpoint answers while every query behind it fails is precisely the state a
 * probe alone reports as healthy, and it is the state where staff most need to
 * be told to stop typing notes that are not being saved.
 */

export interface Connectivity {
  readonly status: ConnectivityStatus;
  /** Call when a data request fails for an infrastructure reason. */
  readonly reportDataFailure: () => void;
  /** Call when a data request succeeds, which clears a previous failure. */
  readonly reportDataSuccess: () => void;
  /** Probe now rather than waiting for the next interval. */
  readonly recheck: () => void;
}

const ConnectivityContext = createContext<Connectivity>({
  status: 'online',
  reportDataFailure: () => undefined,
  reportDataSuccess: () => undefined,
  recheck: () => undefined,
});

export function useConnectivity(): Connectivity {
  return useContext(ConnectivityContext);
}

export interface ConnectivityProviderProps {
  readonly children: ReactNode;
  /** Defaults to the same-origin health route. Overridden in tests. */
  readonly healthUrl?: string;
  readonly intervalMs?: number;
  /** Injected in tests. Defaults to the global fetch. */
  readonly fetchImpl?: typeof fetch;
}

/**
 * Same-origin, always.
 *
 * Probing the API directly looks simpler and is wrong: it is a different
 * origin, it sends no CORS headers, and the browser blocking the request is
 * indistinguishable from the server being down - so the banner was permanently
 * on against a perfectly healthy stack. `/api/health` is a Next route handler
 * that makes the same check server-side. See app/api/health/route.ts.
 */
const HEALTH_PATH = '/api/health';

/**
 * The browser's own view of whether it has a network.
 *
 * Read through `useSyncExternalStore` rather than mirrored into state by an
 * effect. `navigator.onLine` is an external store that changes without React's
 * knowledge, which is exactly what this hook is for - and the effect-and-
 * setState version has a real bug in it, not just a lint complaint: between the
 * server render and the effect running, the component claims to be online
 * whatever the truth is.
 */
function subscribeToNetwork(onChange: () => void): () => void {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

/** There is no network state during a server render, so assume the good one. */
function networkOnServer(): boolean {
  return true;
}

function networkInBrowser(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine;
}

export function ConnectivityProvider({
  children,
  healthUrl,
  intervalMs = 10_000,
  fetchImpl,
}: ConnectivityProviderProps) {
  const [probeResult, setProbeResult] = useState<ProbeResult>(null);
  const [dataFailing, setDataFailing] = useState(false);
  const browserOnline = useSyncExternalStore(subscribeToNetwork, networkInBrowser, networkOnServer);

  const probe = useCallback(async (): Promise<void> => {
    const doFetch = fetchImpl ?? globalThis.fetch;
    if (typeof doFetch !== 'function') return;

    try {
      // A short timeout on purpose: a request left hanging by a half-open
      // connection would keep the banner saying "connected" for as long as the
      // socket takes to give up, which on some networks is minutes.
      const response = await doFetch(healthUrl ?? HEALTH_PATH, {
        method: 'GET',
        cache: 'no-store',
        signal: AbortSignal.timeout(5_000),
      });

      if (response.ok) {
        setProbeResult('ok');
        setDataFailing(false);
        return;
      }

      // 503 from the health route means the web server reached the API and the
      // API said it cannot serve data: a database outage. Anything else -
      // notably 502, which the route uses for "the API did not answer at all" -
      // is a total outage, where "read-only" would be the wrong thing to say.
      setProbeResult(response.status === 503 ? 'degraded' : 'down');
    } catch {
      // The request never completed: nothing is answering on this origin.
      setProbeResult('down');
    }
  }, [fetchImpl, healthUrl]);

  useEffect(() => {
    // Nothing here sets state synchronously: the probe is async, so React is
    // only ever updated from its resolution, and the network signal is read
    // from the store above rather than mirrored into state here.
    const reprobe = (): void => {
      void probe();
    };

    window.addEventListener('online', reprobe);
    reprobe();
    const timer = setInterval(reprobe, intervalMs);

    return () => {
      clearInterval(timer);
      window.removeEventListener('online', reprobe);
    };
  }, [intervalMs, probe]);

  const value = useMemo<Connectivity>(
    () => ({
      status: resolveStatus({ browserOnline, probe: probeResult, dataFailing }),
      reportDataFailure: () => {
        setDataFailing(true);
      },
      reportDataSuccess: () => {
        setDataFailing(false);
      },
      recheck: () => {
        void probe();
      },
    }),
    [browserOnline, probeResult, dataFailing, probe]
  );

  return <ConnectivityContext.Provider value={value}>{children}</ConnectivityContext.Provider>;
}
