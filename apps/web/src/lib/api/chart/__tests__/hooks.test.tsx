import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useChartSummary, useEncounterNote } from '@/lib/api/chart/hooks';
import type { ChartClient } from '@/lib/api/chart/client';
import { MOCK_ENCOUNTER_IDS } from '@/lib/api/mock/chart';
import { mockPatientIdByMrn } from '@/lib/api/mock/fixtures';

/**
 * The two chart read hooks, at the inputs a screen hands them before it knows
 * which patient it is showing.
 *
 * A route parameter arrives as a string, but both hooks accept null because a
 * rail can render beside a patient that has not resolved yet, and both are
 * asked for an id that turns out to be empty by anything reading a URL. The
 * question in every case is the same: does a request go out.
 */

function stubClient(): { client: ChartClient; summary: () => number; note: () => number } {
  const summary = vi.fn(() => Promise.reject(new Error('the query should not have run')));
  const note = vi.fn(() => Promise.reject(new Error('the query should not have run')));
  return {
    client: {
      mode: 'mock',
      summary: { get: summary },
      notes: { get: note },
    } as unknown as ChartClient,
    summary: () => summary.mock.calls.length,
    note: () => note.mock.calls.length,
  };
}

describe.each([
  ['useChartSummary', useChartSummary, (s: ReturnType<typeof stubClient>) => s.summary],
  ['useEncounterNote', useEncounterNote, (s: ReturnType<typeof stubClient>) => s.note],
] as const)('%s', (_name, useHook, calls) => {
  it('asks for nothing when it has no identifier', () => {
    const stub = stubClient();

    renderHook(() => useHook(null, { client: stub.client }));

    expect(calls(stub)()).toBe(0);
  });

  it('asks for nothing when the identifier is empty, not just when it is null', () => {
    /*
     * An empty string is what a screen reading a route parameter hands over
     * when the segment is missing. It is not null, so a null check alone lets
     * the request through, and the request it builds asks the API for the
     * resource with no id at all.
     */
    const stub = stubClient();

    renderHook(() => useHook('', { client: stub.client }));

    expect(calls(stub)()).toBe(0);
  });

  it('asks once when it has one', async () => {
    /* The control. Without it the two assertions above are satisfied by a hook
       that never requests anything. */
    const stub = stubClient();

    renderHook(() => useHook('some-id', { client: stub.client }));

    await waitFor(() => expect(calls(stub)()).toBe(1));
  });
});

describe('the default options', () => {
  /*
   * Every caller in the app passes a client or an empty object, so the
   * documented default - call it with an identifier and nothing else - was
   * never exercised on either hook. It is the shape a story or a new screen
   * writes first, and the one that would fail on a bad default.
   */
  it('reach the app chart client from useChartSummary', async () => {
    const { result } = renderHook(() => useChartSummary(mockPatientIdByMrn('OR-100482')));

    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(result.current.data?.problems.length).toBeGreaterThan(0);
  });

  it('reach the app chart client from useEncounterNote', async () => {
    const { result } = renderHook(() => useEncounterNote(MOCK_ENCOUNTER_IDS.testinaUnsigned));

    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(result.current.data?.sections.length).toBeGreaterThan(0);
  });
});
