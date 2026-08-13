import { requestJson } from '../client';
import { API_BASE_URL, API_MODE } from '../config';
import { mockChartFor, mockEncounterNote } from '../mock/chart';
import { MOCK_PATIENTS } from '../mock/fixtures';
import { notFound, settle } from '../mock/protocol';

import type { ChartSummary, EncounterNote } from './types';

/**
 * The chart read surface.
 *
 * It is a second client rather than two more methods on {@link ApiClient} for
 * one reason: `apps/api` implements patients and appointments and answers
 * `NotImplemented` for everything else, so the chart routes are a contract this
 * app has written down and the API has not yet met. Keeping them here makes
 * that boundary visible, and makes the day they land a deletion rather than a
 * refactor - the interface, the mock and the hooks all move across unchanged.
 *
 * Both implementations satisfy the same interface, so a chart screen never
 * branches on the mode.
 */

export interface ChartClient {
  readonly mode: 'live' | 'mock';
  summary: {
    get: (patientId: string, signal?: AbortSignal) => Promise<ChartSummary>;
  };
  notes: {
    get: (noteId: string, signal?: AbortSignal) => Promise<EncounterNote>;
  };
}

export interface MockChartClientOptions {
  /** Overrides the fixture chart, for a screen state a fixture does not carry. */
  charts?: readonly ChartSummary[];
  notes?: readonly EncounterNote[];
  /** Patient ids that exist. Defaults to the patient fixtures. */
  patientIds?: readonly string[];
}

export function createMockChartClient(options: MockChartClientOptions = {}): ChartClient {
  const knownPatients = options.patientIds ?? MOCK_PATIENTS.map((patient) => patient.id);

  return {
    mode: 'mock',
    summary: {
      get: (patientId) => {
        const override = options.charts?.find((chart) => chart.patientId === patientId);
        if (override) return settle(override);
        // A chart for a patient who does not exist is a 404, not an empty
        // chart: a mistyped id must never render as a patient with nothing
        // wrong with them.
        if (!knownPatients.includes(patientId)) {
          return Promise.reject(notFound('No such patient.'));
        }
        return settle(mockChartFor(patientId));
      },
    },
    notes: {
      get: (noteId) => {
        const found = options.notes
          ? options.notes.find((note) => note.id === noteId)
          : mockEncounterNote(noteId);
        if (!found) return Promise.reject(notFound('No such visit note.'));
        return settle(found);
      },
    },
  };
}

export function createHttpChartClient(baseUrl: string): ChartClient {
  const config = { baseUrl, getToken: () => null };
  return {
    mode: 'live',
    summary: {
      get: (patientId, signal) =>
        requestJson<ChartSummary>(config, `/patients/${encodeURIComponent(patientId)}/chart`, {
          signal,
        }),
    },
    notes: {
      get: (noteId, signal) =>
        requestJson<EncounterNote>(config, `/encounters/${encodeURIComponent(noteId)}/note`, {
          signal,
        }),
    },
  };
}

/** The client the chart screens read through, resolved once at module load. */
export const chartApi: ChartClient =
  API_MODE === 'mock' ? createMockChartClient() : createHttpChartClient(API_BASE_URL);
