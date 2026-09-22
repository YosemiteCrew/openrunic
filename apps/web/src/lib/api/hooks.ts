'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { api } from './api';
import { ApiError } from './client';
import type {
  ApiClient,
  Appointment,
  AppointmentListQuery,
  ListResponse,
  Patient,
  PatientListQuery,
  PrincipalCapabilities,
} from './types';

/**
 * Per-aggregate read hooks.
 *
 * Small on purpose: no cache, no retry storm, no global store. Every hook
 * returns the same {@link AsyncState}, and `AsyncBoundary` turns that state into
 * the loading, empty and error surfaces the design system defines. When a
 * screen needs caching or mutation, that is a shared addition to this file, not
 * a bespoke `useEffect` inside the screen.
 *
 * Requests are aborted when the query changes or the component unmounts, so a
 * slow patient search can never overwrite a newer one.
 */

export type AsyncStatus = 'loading' | 'success' | 'error';

export interface AsyncState<T> {
  status: AsyncStatus;
  /** Present only while `status` is 'success'. */
  data: T | null;
  /** Present only while `status` is 'error'. */
  error: ApiError | null;
  /** Re-runs the request. Wire it to ErrorState's retry button. */
  refetch: () => void;
}

function toApiError(cause: unknown): ApiError {
  if (cause instanceof ApiError) return cause;
  return new ApiError('The request could not be completed.', { kind: 'network' });
}

/** A settled request, stamped with the request it answers. */
interface Settled<T> {
  requestKey: string;
  data: T | null;
  error: ApiError | null;
}

/**
 * The one place a request is turned into render state.
 *
 * `key` is the dependency: it must change exactly when the request should
 * re-run, which is why every hook below serialises its query into it rather
 * than passing an object literal that is a new reference on every render.
 *
 * The status is derived rather than stored. A result carries the key it answers,
 * and anything that does not match the current key is by definition still
 * loading. That is what makes a stale patient search impossible to display: the
 * old payload cannot be mistaken for the new one even for a single frame.
 */
export function useApiQuery<T>(
  key: string,
  run: (signal: AbortSignal) => Promise<T>,
  options: { enabled?: boolean } = {}
): AsyncState<T> {
  const enabled = options.enabled ?? true;
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<Settled<T> | null>(null);
  const runRef = useRef(run);

  // The request identity: the query, plus the retry counter, so pressing "Try
  // again" re-runs an identical query rather than reading the failed result.
  const requestKey = `${key}#${attempt}`;

  // Read the runner through a ref so an inline arrow function in a screen
  // cannot re-trigger the request on every render. `requestKey` is the trigger.
  useEffect(() => {
    runRef.current = run;
  });

  useEffect(() => {
    if (!enabled) return;

    const controller = new AbortController();
    let active = true;

    runRef
      .current(controller.signal)
      .then((data) => {
        if (!active) return;
        setSettled({ requestKey, data, error: null });
      })
      .catch((cause: unknown) => {
        // An abort is a cancelled render, never an error the user should read.
        if (!active || controller.signal.aborted) return;
        setSettled({ requestKey, data: null, error: toApiError(cause) });
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [requestKey, enabled]);

  const refetch = useCallback(() => setAttempt((value) => value + 1), []);
  const fresh = settled?.requestKey === requestKey ? settled : null;

  return useMemo(() => {
    // A disabled query is not pending: there is nothing to wait for, so it
    // reports success with no data and the screen renders its empty state.
    if (!enabled) return { status: 'success' as AsyncStatus, data: null, error: null, refetch };
    if (fresh === null)
      return { status: 'loading' as AsyncStatus, data: null, error: null, refetch };
    if (fresh.error) {
      return { status: 'error' as AsyncStatus, data: null, error: fresh.error, refetch };
    }
    return { status: 'success' as AsyncStatus, data: fresh.data, error: null, refetch };
  }, [enabled, fresh, refetch]);
}

/** Stable cache key for a query object; undefined and key order cannot change it. */
export function queryKey(name: string, query: Record<string, unknown> = {}): string {
  const entries = Object.entries(query)
    .filter(([, value]) => value !== undefined && value !== null)
    .sort(([a], [b]) => a.localeCompare(b));
  return `${name}:${JSON.stringify(entries)}`;
}

/**
 * What a write did, as one value the caller can branch on.
 *
 * A discriminated result rather than a value-or-null, because the failure has
 * to be readable at the moment it happens. A screen that answered "did it
 * work?" with null and then read the hook's `error` would read the render
 * before last: React has not re-rendered yet at the point a click handler
 * resumes, so the error it finds is the previous one, or none at all. That is
 * how a refused write ends up reporting the wrong reason, or no reason.
 */
export type MutationOutcome<T> = { ok: true; value: T } | { ok: false; error: ApiError };

/**
 * A write in flight, and what it left behind.
 *
 * `run` resolves rather than rejects: a click handler is not a promise chain,
 * and a rejected one from an `onClick` is an unhandled rejection in the console
 * of a clinician's browser. `error` holds the same failure for a surface that
 * renders it in place, such as a dialog that stays open on a refusal.
 */
export interface MutationState<TArgs extends readonly unknown[], TResult> {
  run: (...args: TArgs) => Promise<MutationOutcome<TResult>>;
  /** True while the request is outstanding. Wire it to the button's disabled state. */
  pending: boolean;
  error: ApiError | null;
  /** Clears the error, for a dialog that is being reopened. */
  reset: () => void;
}

/**
 * The one place a write is turned into render state.
 *
 * There is no optimistic layer here on purpose. Every write this app makes is
 * a clinical or financial state change, and the screens that make them already
 * confirm first; showing a result before the server has agreed to it is how a
 * refused transition ends up looking like a completed one. What the hook does
 * give a screen is the thing it needs to stay honest: a `pending` flag while
 * the answer is outstanding, and the server's own problem document when the
 * answer is no.
 */
export function useMutation<TArgs extends readonly unknown[], TResult>(
  perform: (...args: TArgs) => Promise<TResult>
): MutationState<TArgs, TResult> {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const performRef = useRef(perform);
  const mounted = useRef(true);

  useEffect(() => {
    performRef.current = perform;
  });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(async (...args: TArgs): Promise<MutationOutcome<TResult>> => {
    setPending(true);
    setError(null);
    try {
      return { ok: true, value: await performRef.current(...args) };
    } catch (cause) {
      const failure = toApiError(cause);
      if (mounted.current) setError(failure);
      return { ok: false, error: failure };
    } finally {
      // Cleared on both paths, and cleared here so a `return` added to either
      // branch later cannot leave a button disabled forever. A screen the
      // clinician has already left is not re-rendered; the write still
      // happened, which is what matters.
      if (mounted.current) setPending(false);
    }
  }, []);

  const reset = useCallback(() => setError(null), []);

  return useMemo(() => ({ run, pending, error, reset }), [error, pending, reset, run]);
}

/*
 * The single-record hooks resolve their id before describing the request rather
 * than inside it. Written the other way - `client.patients.get(id ?? '')` - the
 * fallback sits in a closure that only runs when the query is enabled, and the
 * query is only enabled when the id is present, so it was a default nothing
 * could take. Resolving first also lets one value answer both questions, which
 * is why an empty id is now treated the same as a missing one: a request for
 * `/patients/` cannot succeed, and the honest answer to being handed no patient
 * is to make no request however the caller spells it.
 */

export interface HookOptions {
  /** Injectable for tests and stories. Defaults to the app's `api`. */
  client?: ApiClient;
  enabled?: boolean;
}

export function usePatients(
  query: PatientListQuery = {},
  options: HookOptions = {}
): AsyncState<ListResponse<Patient>> {
  const client = options.client ?? api;
  return useApiQuery(
    queryKey('patients.list', { ...query }),
    (signal) => client.patients.list(query, signal),
    { enabled: options.enabled }
  );
}

export function usePatient(id: string | null, options: HookOptions = {}): AsyncState<Patient> {
  const client = options.client ?? api;
  const resolved = id ?? '';
  return useApiQuery(
    queryKey('patients.get', { id }),
    (signal) => client.patients.get(resolved, signal),
    { enabled: (options.enabled ?? true) && resolved !== '' }
  );
}

export function useAppointments(
  query: AppointmentListQuery = {},
  options: HookOptions = {}
): AsyncState<ListResponse<Appointment>> {
  const client = options.client ?? api;
  return useApiQuery(
    queryKey('appointments.list', { ...query }),
    (signal) => client.appointments.list(query, signal),
    { enabled: options.enabled }
  );
}

export function useAppointment(
  id: string | null,
  options: HookOptions = {}
): AsyncState<Appointment> {
  const client = options.client ?? api;
  const resolved = id ?? '';
  return useApiQuery(
    queryKey('appointments.get', { id }),
    (signal) => client.appointments.get(resolved, signal),
    { enabled: (options.enabled ?? true) && resolved !== '' }
  );
}

/**
 * What the signed-in principal may do, as this deployment resolved it.
 *
 * One request per screen that asks, cached by `useApiQuery` like every other
 * read. It answers from `/bff/v0/me` in a live build and from the mirrored role
 * table in the demonstration build, and a screen never learns which - the whole
 * point of #313 is that both behave the same way.
 *
 * `permissions` is empty while it loads and empty on failure. Screens must read
 * that as "do not offer the action yet" rather than as "may not": an interface
 * that offers a signature because a request has not come back is the failure
 * this exists to prevent, in the direction that matters.
 */
export function useOwnCapabilities(
  options: { client?: ApiClient } = {}
): AsyncState<PrincipalCapabilities> {
  const client = options.client ?? api;
  return useApiQuery(queryKey('session.me'), (signal) => client.session.me(signal));
}
