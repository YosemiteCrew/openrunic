'use client';

import { queryKey, useApiQuery } from '../hooks';
import type { AsyncState } from '../hooks';

import { chartApi } from './client';
import type { ChartClient } from './client';
import type { ChartSummary, EncounterNote } from './types';

/**
 * Chart read hooks. Same shape as `usePatient` and `useAppointments`, so
 * `AsyncBoundary` renders the loading, empty and error states unchanged.
 *
 * The identifier is resolved before the request is described rather than inside
 * it. Written the other way - `client.summary.get(patientId ?? '', signal)` -
 * the fallback sits inside a closure that only runs when the query is enabled,
 * and the query is only enabled when the identifier is present, so the fallback
 * was unreachable by construction: a default nothing could ever take.
 *
 * Resolving first also lets one value answer both questions, which is why an
 * empty string is treated the same as a missing one. A chart request for an
 * empty id asks for `/patients//chart` and cannot succeed; the honest response
 * to being handed no patient is to make no request, whichever way the caller
 * spells "no patient".
 */

export interface ChartHookOptions {
  /** Injectable for tests and stories. Defaults to the app's chart client. */
  client?: ChartClient;
  enabled?: boolean;
}

export function useChartSummary(
  patientId: string | null,
  options: ChartHookOptions = {}
): AsyncState<ChartSummary> {
  const client = options.client ?? chartApi;
  const id = patientId ?? '';
  return useApiQuery(
    queryKey('chart.summary', { patientId }),
    (signal) => client.summary.get(id, signal),
    { enabled: (options.enabled ?? true) && id !== '' }
  );
}

export function useEncounterNote(
  noteId: string | null,
  options: ChartHookOptions = {}
): AsyncState<EncounterNote> {
  const client = options.client ?? chartApi;
  const id = noteId ?? '';
  return useApiQuery(queryKey('chart.note', { noteId }), (signal) => client.notes.get(id, signal), {
    enabled: (options.enabled ?? true) && id !== '',
  });
}
