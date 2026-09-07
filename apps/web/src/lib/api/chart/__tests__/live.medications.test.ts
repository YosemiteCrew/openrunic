import { describe, expect, it } from 'vitest';

import { readChartSummary } from '@/lib/api/chart/live';
import type {
  ApiClient,
  ListResponse,
  MedicationStatementDto,
  MedicationStatementListQuery,
  MedicationStatementSource,
  MedicationStatementStatus,
} from '@/lib/api/types';

/**
 * The live chart's medication list.
 *
 * `live.ts` hardcoded `medications: []`, so a clinician on the real API saw the
 * empty state for every patient including patients with recorded medications -
 * a screen that renders successfully and is wrong. These are the arms that fail
 * if it goes back to that, and the ones that fail if the mapping decides
 * something the record does not say.
 *
 * The client here is a stub rather than the mock client, because the mock chart
 * is composed elsewhere and would answer these questions from a different file.
 */

const PATIENT = 'p-1';

function statement(overrides: Partial<MedicationStatementDto> = {}): MedicationStatementDto {
  return {
    id: 'ms-1',
    patientId: PATIENT,
    encounterId: null,
    rxnormCode: null,
    display: 'Metformin 1000 mg tablet',
    sigText: 'Take 1 tablet by mouth twice daily',
    status: 'ACTIVE',
    source: 'PRESCRIBED',
    effectiveStart: '2024-06-04',
    effectiveEnd: null,
    reportedAt: '2024-06-04T09:00:00.000Z',
    note: null,
    createdAt: '2024-06-04T09:00:00.000Z',
    updatedAt: '2024-06-04T09:00:00.000Z',
    ...overrides,
  };
}

function page(
  data: MedicationStatementDto[],
  meta: Partial<ListResponse<MedicationStatementDto>['page']> = {}
): ListResponse<MedicationStatementDto> {
  return {
    data,
    page: { page: 1, pageSize: 50, total: data.length, totalPages: 1, ...meta },
  };
}

interface Stub {
  client: ApiClient;
  calls: MedicationStatementListQuery[];
}

function stubClient(pages: ListResponse<MedicationStatementDto>[]): Stub {
  const calls: MedicationStatementListQuery[] = [];
  const empty = { data: [], page: { page: 1, pageSize: 50, total: 0, totalPages: 1 } };
  const client = {
    patients: { get: () => Promise.resolve({ id: PATIENT }) },
    encounters: { list: () => Promise.resolve(empty) },
    notes: { list: () => Promise.resolve(empty) },
    users: { list: () => Promise.resolve(empty) },
    medicationStatements: {
      list: (query: MedicationStatementListQuery = {}) => {
        calls.push(query);
        const answer = pages[calls.length - 1];
        if (answer === undefined) throw new Error('asked for a page the test did not supply');
        return Promise.resolve(answer);
      },
    },
  } as unknown as ApiClient;
  return { client, calls };
}

describe('the live chart medication list', () => {
  it('asks for this patient, newest first, and maps the row', async () => {
    /* The request is asserted as well as the answer: a list that read the whole
       tenant would also return this patient's rows, and a test on the mapping
       alone cannot tell the two apart. */
    const { client, calls } = stubClient([page([statement()])]);

    const summary = await readChartSummary(client, PATIENT);

    expect(calls).toStrictEqual([
      { patientId: PATIENT, page: 1, pageSize: 50, sort: 'reportedAt', order: 'desc' },
    ]);
    expect(summary.medications).toStrictEqual([
      {
        id: 'ms-1',
        drug: 'Metformin 1000 mg tablet',
        sig: 'Take 1 tablet by mouth twice daily',
        prescriber: null,
        status: 'ACTIVE',
        source: 'PRESCRIBED',
        startedOn: '2024-06-04',
        stoppedOn: null,
        refillsRemaining: null,
      },
    ]);
  });

  it('carries every state through rather than collapsing them into two', async () => {
    /*
     * The one the issue is about. `ON_HOLD` folded into `ACTIVE` is a chart
     * saying a patient takes something they have been told to stop; folded the
     * other way it says they once did and no longer do. Both are wrong in a way
     * a reader cannot see, so each state has to arrive as itself.
     */
    const states: MedicationStatementStatus[] = [
      'ACTIVE',
      'COMPLETED',
      'ENTERED_IN_ERROR',
      'INTENDED',
      'NOT_TAKEN',
      'ON_HOLD',
      'STOPPED',
      'UNKNOWN',
    ];
    const { client } = stubClient([
      page(states.map((status, index) => statement({ id: `ms-${String(index)}`, status }))),
    ]);

    const summary = await readChartSummary(client, PATIENT);

    expect(summary.medications.map((med) => med.status)).toStrictEqual(states);
  });

  it('carries all four provenances, imported included', async () => {
    /* `IMPORTED` had no member in the view model at all before this, so an
       imported statement would have had to be rendered as one of the other
       three - which is a record claiming a provenance nobody recorded. */
    const sources: MedicationStatementSource[] = [
      'REPORTED',
      'PRESCRIBED',
      'RECONCILED',
      'IMPORTED',
    ];
    const { client } = stubClient([
      page(sources.map((source, index) => statement({ id: `ms-${String(index)}`, source }))),
    ]);

    const summary = await readChartSummary(client, PATIENT);

    expect(summary.medications.map((med) => med.source)).toStrictEqual(sources);
  });

  it('leaves what the record does not say absent, and does not fill it from a neighbour', async () => {
    /*
     * `reportedAt` is always present and is the nearest plausible substitute for
     * an unknown effective start, which is exactly why it must not be used: it
     * is when somebody wrote the record down, not when the patient started
     * taking anything. `prescriber` and `refillsRemaining` belong to a
     * prescription and this endpoint carries neither.
     */
    const { client } = stubClient([
      page([statement({ sigText: null, effectiveStart: null, effectiveEnd: null })]),
    ]);

    const summary = await readChartSummary(client, PATIENT);
    const med = summary.medications[0];

    expect(med?.sig).toBeNull();
    expect(med?.startedOn).toBeNull();
    expect(med?.startedOn).not.toBe('2024-06-04T09:00:00.000Z');
    expect(med?.stoppedOn).toBeNull();
    expect(med?.prescriber).toBeNull();
    expect(med?.refillsRemaining).toBeNull();
  });

  it('reads every page rather than stopping at the first', async () => {
    /*
     * A medication list that silently stops at fifty is the same failure as an
     * empty one, and harder to notice: the tab renders, the rows look right,
     * and the missing ones are the ones nobody knows to look for.
     */
    const { client, calls } = stubClient([
      page([statement({ id: 'ms-a' })], { page: 1, total: 3, totalPages: 3 }),
      page([statement({ id: 'ms-b' })], { page: 2, total: 3, totalPages: 3 }),
      page([statement({ id: 'ms-c' })], { page: 3, total: 3, totalPages: 3 }),
    ]);

    const summary = await readChartSummary(client, PATIENT);

    expect(calls.map((call) => call.page)).toStrictEqual([1, 2, 3]);
    expect(summary.medications.map((med) => med.id)).toStrictEqual(['ms-a', 'ms-b', 'ms-c']);
  });

  it('stops when a page comes back empty, whatever the count claimed', async () => {
    /* The count and the rows are two answers from one server and they can
       disagree. Trusting `totalPages` alone turns that disagreement into a loop
       that never ends, on a screen a clinician is waiting for. */
    const { client, calls } = stubClient([
      page([statement({ id: 'ms-a' })], { page: 1, total: 99, totalPages: 9 }),
      page([], { page: 2, total: 99, totalPages: 9 }),
    ]);

    const summary = await readChartSummary(client, PATIENT);

    expect(calls).toHaveLength(2);
    expect(summary.medications.map((med) => med.id)).toStrictEqual(['ms-a']);
  });

  it('lets a failed read fail rather than reporting no medications', async () => {
    /*
     * "Found nothing" and "could not look" are different sentences and the
     * chart renders them differently. Swallowing the second into an empty list
     * is the failure this whole issue is about, in its most direct form.
     */
    const { client } = stubClient([]);
    const failing = {
      ...client,
      medicationStatements: { list: () => Promise.reject(new Error('403')) },
    } as unknown as ApiClient;

    await expect(readChartSummary(failing, PATIENT)).rejects.toThrow('403');
  });
});
