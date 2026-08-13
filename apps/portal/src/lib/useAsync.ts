'use client';

/**
 * The two async primitives every screen is built from.
 *
 * `useAsync` owns reading: one state machine covering loading, error and ready, plus a
 * reload the error state can offer. `useAction` owns writing: it reports pending, failed
 * and done so a screen can keep a draft on the page when a send fails instead of losing
 * what the patient typed.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export type AsyncState<T> =
  { status: 'loading' } | { status: 'error'; error: Error } | { status: 'ready'; data: T };

export interface AsyncResult<T> {
  state: AsyncState<T>;
  /** Re-runs the loader from the loading state. Wired to the error state's try again. */
  reload: () => void;
}

/** Anything thrown can reach a catch block; only an Error carries a usable message. */
export function toError(thrown: unknown): Error {
  return thrown instanceof Error ? thrown : new Error(String(thrown));
}

export function useAsync<T>(load: () => Promise<T>): AsyncResult<T> {
  const [state, setState] = useState<AsyncState<T>>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const loadRef = useRef(load);

  /* Read the loader through a ref so an inline arrow in a screen does not re-fetch on
     every render; `attempt` is the only thing that re-runs the read. */
  useEffect(() => {
    loadRef.current = load;
  });

  /* The loading state is set by `reload` rather than here. Initial state is already
     loading, so the effect never has to announce it, and setting state synchronously in an
     effect body only buys a cascading render. */
  useEffect(() => {
    let cancelled = false;

    loadRef.current().then(
      (data) => {
        if (!cancelled) setState({ status: 'ready', data });
      },
      (thrown: unknown) => {
        if (!cancelled) setState({ status: 'error', error: toError(thrown) });
      }
    );

    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const reload = useCallback(() => {
    setState({ status: 'loading' });
    setAttempt((value) => value + 1);
  }, []);

  return { state, reload };
}

export type ActionStatus = 'idle' | 'pending' | 'done' | 'failed';

export interface ActionResult<Args extends unknown[], Value> {
  status: ActionStatus;
  error: Error | null;
  /** What the action resolved to, once it has succeeded at least once. */
  value: Value | undefined;
  /** Resolves true when the action succeeded, so a caller can clear a draft only then. */
  run: (...args: Args) => Promise<boolean>;
  reset: () => void;
}

export function useAction<Args extends unknown[], Value>(
  perform: (...args: Args) => Promise<Value>
): ActionResult<Args, Value> {
  const [status, setStatus] = useState<ActionStatus>('idle');
  const [error, setError] = useState<Error | null>(null);
  const [value, setValue] = useState<Value | undefined>(undefined);
  const performRef = useRef(perform);

  useEffect(() => {
    performRef.current = perform;
  });

  const run = useCallback(async (...args: Args): Promise<boolean> => {
    setStatus('pending');
    setError(null);
    try {
      const result = await performRef.current(...args);
      setValue(result);
      setStatus('done');
      return true;
    } catch (thrown: unknown) {
      setError(toError(thrown));
      setStatus('failed');
      return false;
    }
  }, []);

  const reset = useCallback(() => {
    setStatus('idle');
    setError(null);
  }, []);

  return { status, error, value, run, reset };
}
