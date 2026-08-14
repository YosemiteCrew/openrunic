'use client';

import { useCallback } from 'react';

import { mockCoveragesForPatient, queryKey, useApiQuery } from '@/lib/api';
import type { AsyncState, MockCoverage } from '@/lib/api';

/**
 * Coverage for one patient.
 *
 * There is no coverage endpoint in `apps/api` yet, so this reads the fixture
 * module through the same {@link useApiQuery} primitive every other screen
 * uses. That is deliberate: the screen already gets its loading, empty and
 * error states from `AsyncBoundary`, so when the endpoint lands only the body
 * of this hook changes.
 */

export interface UseCoveragesOptions {
  /** Injectable for tests: returns the coverage rows for a patient. */
  read?: (patientId: string) => Promise<MockCoverage[]>;
}

function readFixtures(patientId: string): Promise<MockCoverage[]> {
  return Promise.resolve(mockCoveragesForPatient(patientId));
}

export function useCoverages(
  patientId: string,
  options: UseCoveragesOptions = {}
): AsyncState<MockCoverage[]> {
  const read = options.read ?? readFixtures;
  const run = useCallback(() => read(patientId), [patientId, read]);
  return useApiQuery(queryKey('coverages.list', { patientId }), run);
}
