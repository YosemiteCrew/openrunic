'use client';

import { useMemo } from 'react';

import { api } from './api';
import { queryKey, useApiQuery, type HookOptions } from './hooks';
import type { ApiClient, Patient } from './types';

import { formatCredentialed } from '@/lib/format';

/**
 * Names for a page of rows a worklist already has the ids of.
 *
 * Orders, results and the inbox all answer with ids and no names: a
 * `ServiceRequestDto`, a `DiagnosticReportDto` and a `TaskDto` each carry
 * `patientId`, none carries a patient, and the one column a reader scans to
 * know WHOSE work a row is had nowhere to come from. Before this seam the three
 * screens read the demonstration fixtures for it, which answer nothing for a
 * real id - so in a live build every row rendered correct in every column
 * except the one naming the person (#559).
 *
 * Two rules shape what is here.
 *
 * **A name is decoration, and must never fail a screen.** These hooks return a
 * lookup and nothing else - no status, no error, no retry. While the read is in
 * flight, and if it fails outright, every id resolves to the same absence the
 * row renders today. A queue of clinical work must not disappear behind "This
 * did not load" because a display name did.
 *
 * **An id that cannot be named is named as absent, never as anything else.** The
 * lookups answer `undefined` and `null` rather than falling back to the id, to
 * an empty string, or to a word like "Unassigned" that would read as a fact
 * about the row instead of a fact about this build.
 */

/** One page of the staff directory. The API caps a page at 100. */
const DIRECTORY_PAGE_SIZE = 100;

/**
 * The most ids one read will name, and the cap the route enforces.
 *
 * `MAX_PAGE_SIZE` in `apps/api/src/schemas/pagination.ts`. A screen whose page
 * is larger than this would have the request refused outright and name nobody,
 * so the set is truncated here and the rest render unnamed - which is the same
 * absence they render for any other unresolvable id, rather than a broken
 * screen.
 */
const MAX_NAMED = 100;

/** The patient behind a row's id, or nothing where this build cannot name them. */
export type PatientLookup = (id: string | null) => Patient | undefined;

/** The clinician behind a row's id, or null where this build cannot name them. */
export type ProviderLookup = (id: string | null) => string | null;

/**
 * The distinct ids of a page, in a stable order.
 *
 * Sorted so the request key is a property of the SET rather than of the order
 * rows happened to arrive in: a re-sorted page of the same patients is the same
 * read, and keying on row order would refetch it.
 */
function named(ids: readonly (string | null)[]): readonly string[] {
  return [...new Set(ids.filter((id): id is string => id !== null))].sort().slice(0, MAX_NAMED);
}

/**
 * The patients of one page, in one request.
 *
 * `ids` on `GET /bff/v0/patients` rather than `GET /bff/v0/patients/{id}` per
 * row: a page is 25 rows by default, and 25 requests to render one column is a
 * list screen that stalls behind its own decoration.
 *
 * The list narrows on the caller's facility where the addressed read does not
 * (#139, decided, and the reasoning is on `patientSpec`). So a patient
 * registered at another site, carrying work visible here, stays unnamed. That
 * is a residual rather than a regression: the same row renders unnamed today.
 */
export function usePatientNames(
  ids: readonly (string | null)[],
  options: HookOptions = {}
): PatientLookup {
  const client: ApiClient = options.client ?? api;
  const wanted = named(ids);
  const state = useApiQuery(
    queryKey('patients.names', { ids: wanted }),
    (signal) => client.patients.list({ ids: wanted, pageSize: wanted.length }, signal),
    // No ids is no question. A page with no patients on it - an inbox of
    // practice-wide tasks - must not ask for every patient in the index.
    { enabled: (options.enabled ?? true) && wanted.length > 0 }
  );

  const byId = useMemo(
    () => new Map((state.data?.data ?? []).map((patient) => [patient.id, patient])),
    [state.data]
  );

  return useMemo(() => (id) => (id === null ? undefined : byId.get(id)), [byId]);
}

/**
 * The staff directory, as a display name per id.
 *
 * One page, and no `status` filter: a result ordered by someone who has since
 * left still has to carry their name, and filtering to active accounts would
 * erase the clinician from every older row. The same read `chart/live.ts` makes
 * to name a note's author, and it renders them the same way.
 */
export function useProviderNames(options: HookOptions = {}): ProviderLookup {
  const client: ApiClient = options.client ?? api;
  const state = useApiQuery(
    queryKey('users.names'),
    (signal) => client.users.list({ pageSize: DIRECTORY_PAGE_SIZE }, signal),
    { enabled: options.enabled }
  );

  const byId = useMemo(
    () =>
      new Map(
        (state.data?.data ?? []).map((user) => [
          user.id,
          formatCredentialed(`${user.givenName} ${user.familyName}`, user.credential ?? ''),
        ])
      ),
    [state.data]
  );

  return useMemo(() => (id) => (id === null ? null : (byId.get(id) ?? null)), [byId]);
}
