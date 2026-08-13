'use client';

import { queryKey, useApiQuery } from '../hooks';
import type { AsyncState } from '../hooks';

import { chartApi } from './client';
import type { ChartClient } from './client';
import type { ChartSummary, EncounterNote } from './types';

/**
 * Chart read hooks. Same shape as `usePatient` and `useAppointments`, so
 * `AsyncBoundary` renders the loading, empty and error states unchanged.
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
  return useApiQuery(
    queryKey('chart.summary', { patientId }),
    (signal) => client.summary.get(patientId ?? '', signal),
    { enabled: (options.enabled ?? true) && patientId !== null }
  );
}

export function useEncounterNote(
  noteId: string | null,
  options: ChartHookOptions = {}
): AsyncState<EncounterNote> {
  const client = options.client ?? chartApi;
  return useApiQuery(
    queryKey('chart.note', { noteId }),
    (signal) => client.notes.get(noteId ?? '', signal),
    { enabled: (options.enabled ?? true) && noteId !== null }
  );
}
