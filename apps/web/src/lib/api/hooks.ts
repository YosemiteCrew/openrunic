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
  return useApiQuery(
    queryKey('patients.get', { id }),
    (signal) => client.patients.get(id ?? '', signal),
    { enabled: (options.enabled ?? true) && id !== null }
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
  return useApiQuery(
    queryKey('appointments.get', { id }),
    (signal) => client.appointments.get(id ?? '', signal),
    { enabled: (options.enabled ?? true) && id !== null }
  );
}
