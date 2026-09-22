import { describe, expect, it, vi } from 'vitest';

import {
  createHttpClient,
  createMockClient,
  liveResults,
  toReportQuery,
  toResultAnalyte,
  toResultPage,
  toResultReport,
} from '@/lib/api';
import type { ApiClient, DiagnosticReportDto, ListResponse, ResultObservationDto } from '@/lib/api';
import { filterDiagnosticReports } from '@/lib/api/mock/client';
import { MOCK_DIAGNOSTIC_REPORTS, MOCK_RESULT_OBSERVATIONS } from '@/lib/api/mock/records';

/**
 * The seam between `GET /bff/v0/results` and the sign-off queue's view type.
 *
 * The same two failure directions as the orders seam, plus one of its own. A
 * field read off the wrong key is a plausible wrong value rather than a blank;
 * a category the queue has no word for must be refused rather than folded; and
 * the report carries TWO status vocabularies - the laboratory's correction
 * states and the sign-off state this screen tracks - so a mapper that read the
 * wrong one would show an amended report as unsigned work.
 */

const DTO: DiagnosticReportDto = {
  id: 'report-1',
  patientId: 'patient-1',
  encounterId: 'encounter-1',
  serviceRequestId: 'order-1',
  specimenId: 'specimen-1',
  status: 'FINAL',
  category: 'LAB',
  code: '24323-8',
  codeSystem: 'http://loinc.org',
  display: 'Comprehensive metabolic panel',
  performingLabName: 'Cedar Valley Laboratory',
  abnormalFlag: 'ABNORMAL',
  narrative: null,
  rawStorageKey: null,
  effectiveAt: '2026-02-01T07:00:00.000Z',
  issuedAt: '2026-02-01T09:00:00.000Z',
  reviewedById: null,
  reviewedAt: null,
  createdAt: '2026-01-31T23:00:00.000Z',
  updatedAt: '2026-02-01T09:30:00.000Z',
};

function dto(overrides: Partial<DiagnosticReportDto> = {}): DiagnosticReportDto {
  return { ...DTO, ...overrides };
}

describe('toResultReport', () => {
  it('carries every rendered field from the field the API sends', () => {
    expect(toResultReport(DTO)).toEqual({
      id: 'report-1',
      orderId: 'order-1',
      patientId: 'patient-1',
      panel: 'Comprehensive metabolic panel',
      category: 'LAB',
      collectedAt: '2026-02-01T07:00:00.000Z',
      reportedAt: '2026-02-01T09:00:00.000Z',
      flag: 'ABNORMAL',
      status: 'UNREVIEWED',
      performer: 'Cedar Valley Laboratory',
      orderedBy: null,
      assignedTo: null,
      analytes: [],
      narrative: null,
    });
  });

  /* The four instants on the DTO are distinct above, so a mapper reading
     `createdAt` where it should read `effectiveAt`, or `updatedAt` where it
     should read `issuedAt`, fails rather than agreeing with itself. The queue
     sorts on the reported instant and the reading pane states the collected
     one, so swapping them is invisible on one surface and wrong on the other. */
  it('reads the collected and reported instants from different fields', () => {
    const report = toResultReport(dto({ effectiveAt: '2026-03-01T00:00:00.000Z' }));
    expect(report?.collectedAt).toBe('2026-03-01T00:00:00.000Z');
    expect(report?.reportedAt).toBe('2026-02-01T09:00:00.000Z');
  });

  /* The two status axes. `status` on the DTO is the laboratory's correction
     vocabulary and moves independently of sign-off, so each case below pairs a
     correction state with the OPPOSITE sign-off state: a mapper reading
     `dto.status` answers the wrong word on every one of them. */
  it.each([
    [
      'an amended report nobody has signed',
      { status: 'AMENDED' as const, reviewedAt: null },
      'UNREVIEWED',
    ],
    [
      'a preliminary report somebody has signed',
      { status: 'PRELIMINARY' as const, reviewedAt: '2026-02-02T00:00:00.000Z' },
      'SIGNED',
    ],
    [
      'a corrected report somebody has signed',
      { status: 'CORRECTED' as const, reviewedAt: '2026-02-02T00:00:00.000Z' },
      'SIGNED',
    ],
  ])('reads the sign-off state from reviewedAt for %s', (_why, overrides, expected) => {
    expect(toResultReport(dto(overrides))?.status).toBe(expected);
  });

  it('leaves the collection instant and the laboratory null rather than inventing them', () => {
    const report = toResultReport(dto({ effectiveAt: null, performingLabName: null }));
    expect(report?.collectedAt).toBeNull();
    expect(report?.performer).toBeNull();
  });

  it('carries the narrative an imaging report reads as, and the order it belongs to', () => {
    expect(toResultReport(dto({ narrative: 'Lung fields clear.' }))?.narrative).toBe(
      'Lung fields clear.'
    );
    expect(toResultReport(dto({ serviceRequestId: null }))?.orderId).toBeNull();
  });

  /* Each is a legal `SERVICE_REQUEST_CATEGORIES` value with no word in OR-01's
     three, listed separately so a fold onto the nearest word - REFERRAL as
     PROCEDURE - fails on its own row rather than hiding behind a sibling. */
  it.each([
    ['a referral, which has its own surface', { category: 'REFERRAL' as const }],
    ['a therapy report', { category: 'THERAPY' as const }],
  ])('refuses %s rather than folding it onto the nearest word', (_why, overrides) => {
    expect(toResultReport(dto(overrides))).toBeNull();
  });

  it('maps every fixture the mock API serves, so the seam is not vacuous', () => {
    const mapped = MOCK_DIAGNOSTIC_REPORTS.map(toResultReport);
    expect(mapped.length).toBeGreaterThan(0);
    expect(mapped.every((report) => report !== null)).toBe(true);
  });
});

/**
 * The analyte mapper.
 *
 * Reference bounds are OMITTED rather than set to null, because the view type
 * spells them optional and `formatVital` reads `low`/`high` as "is there a
 * bound": an explicit undefined and an absent key read the same to it, but only
 * the absent key round-trips through `toEqual` as the type describes.
 */
describe('toResultAnalyte', () => {
  const observation: ResultObservationDto = {
    id: 'observation-1',
    diagnosticReportId: 'report-1',
    patientId: 'patient-1',
    status: 'FINAL',
    sequence: 1,
    loincCode: '2823-3',
    code: '2823-3',
    codeSystem: 'http://loinc.org',
    display: 'Potassium',
    valueNumber: 5.9,
    valueText: null,
    valueCode: null,
    unit: 'mmol/L',
    referenceLow: 3.5,
    referenceHigh: 5.1,
    referenceRangeText: '3.5 - 5.1 mmol/L',
    interpretationCode: 'H',
    abnormalFlag: 'ABNORMAL',
    effectiveAt: '2026-02-01T07:00:00.000Z',
    createdAt: '2026-02-01T07:00:00.000Z',
    updatedAt: '2026-02-01T07:00:00.000Z',
  };

  it('carries the label, value, unit and both bounds', () => {
    expect(toResultAnalyte(observation)).toEqual({
      code: '2823-3',
      label: 'Potassium',
      value: 5.9,
      unit: 'mmol/L',
      low: 3.5,
      high: 5.1,
    });
  });

  it('omits each bound separately when the laboratory reported none', () => {
    expect(toResultAnalyte({ ...observation, referenceLow: null })).not.toHaveProperty('low');
    expect(toResultAnalyte({ ...observation, referenceLow: null }).high).toBe(5.1);
    expect(toResultAnalyte({ ...observation, referenceHigh: null })).not.toHaveProperty('high');
    expect(toResultAnalyte({ ...observation, referenceHigh: null }).low).toBe(3.5);
  });

  /* A qualitative analyte - a culture, a presence - has a text value and no
     unit at all, and the view type says null rather than `''` so the reading
     pane can tell that from a unit nobody filled in. */
  it('carries a qualitative analyte as no value and no unit', () => {
    const analyte = toResultAnalyte({ ...observation, valueNumber: null, unit: null });
    expect(analyte.value).toBeNull();
    expect(analyte.unit).toBeNull();
  });

  /* `decimals` and `previous` have no served shape. Absent rather than invented:
     rendering 5.9 as 5.90, or an empty trend where the lab reported none, is
     this layer making up laboratory context. */
  it('invents neither a display precision nor a prior value', () => {
    expect(toResultAnalyte(observation)).not.toHaveProperty('decimals');
    expect(toResultAnalyte(observation)).not.toHaveProperty('previous');
  });
});

/**
 * The view query as the route can answer it.
 *
 * `assignedTo` is the one that matters. It has no served field, and the nearest
 * one - `reviewedById` - answers a different question, so it must leave no
 * trace on the wire rather than narrow by something else.
 */
describe('toReportQuery', () => {
  it('translates each filter the route serves onto its own field', () => {
    expect(toReportQuery({ patientId: 'p-1' })).toEqual({ patientId: 'p-1' });
    expect(toReportQuery({ flag: 'CRITICAL' })).toEqual({ abnormalFlag: 'CRITICAL' });
    expect(toReportQuery({ pageSize: 100 })).toEqual({ pageSize: 100 });
  });

  /* Both directions, because a mapper that hard-coded `reviewed: true` would
     pass a one-sided test and answer the signed pile to a screen asking for the
     sign-off queue. */
  it('turns the sign-off state into the reviewed flag, both ways round', () => {
    expect(toReportQuery({ status: 'SIGNED' })).toEqual({ reviewed: true });
    expect(toReportQuery({ status: 'UNREVIEWED' })).toEqual({ reviewed: false });
  });

  it('sends nothing at all for an assignment the route cannot narrow on', () => {
    expect(toReportQuery({ assignedTo: 'ME' })).toEqual({});
    expect(toReportQuery({ assignedTo: 'TEAM', flag: 'NORMAL' })).toEqual({
      abnormalFlag: 'NORMAL',
    });
  });

  it('sends nothing for a query that asked for nothing', () => {
    expect(toReportQuery({})).toEqual({});
  });
});

describe('filterDiagnosticReports', () => {
  const rows: readonly DiagnosticReportDto[] = [
    dto({
      id: 'a',
      patientId: 'p-1',
      encounterId: 'e-1',
      serviceRequestId: 's-1',
      status: 'FINAL',
      category: 'LAB',
      abnormalFlag: 'CRITICAL',
      reviewedAt: null,
      effectiveAt: '2026-02-05T00:00:00.000Z',
      issuedAt: '2026-02-01T00:00:00.000Z',
      createdAt: '2026-01-02T00:00:00.000Z',
    }),
    dto({
      id: 'b',
      patientId: 'p-2',
      encounterId: 'e-2',
      serviceRequestId: 's-2',
      status: 'AMENDED',
      category: 'IMAGING',
      abnormalFlag: 'NORMAL',
      reviewedAt: '2026-02-04T00:00:00.000Z',
      effectiveAt: null,
      issuedAt: '2026-02-03T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
    }),
  ];

  const ids = (query: Parameters<typeof filterDiagnosticReports>[1]): string[] =>
    filterDiagnosticReports(rows, query).map((row) => row.id);

  it('narrows on each field the route publishes', () => {
    expect(ids({ patientId: 'p-1' })).toEqual(['a']);
    expect(ids({ encounterId: 'e-2' })).toEqual(['b']);
    expect(ids({ serviceRequestId: 's-1' })).toEqual(['a']);
    expect(ids({ status: 'AMENDED' })).toEqual(['b']);
    expect(ids({ category: 'IMAGING' })).toEqual(['b']);
    expect(ids({ abnormalFlag: 'CRITICAL' })).toEqual(['a']);
    expect(ids({})).toEqual(['a', 'b']);
  });

  /* The sign-off queue is `reviewed=false`, and the flag is a boolean over a
     nullable timestamp rather than a column: absent selects both piles, which
     is a third answer and not the default of either. */
  it('reads the reviewed flag off the timestamp, in both directions and absent', () => {
    expect(ids({ reviewed: false })).toEqual(['a']);
    expect(ids({ reviewed: true })).toEqual(['b']);
    expect(ids({})).toEqual(['a', 'b']);
  });

  it('takes from inclusive and to exclusive over the issued instant', () => {
    expect(ids({ from: '2026-02-03T00:00:00.000Z' })).toEqual(['b']);
    expect(ids({ to: '2026-02-03T00:00:00.000Z' })).toEqual(['a']);
  });

  it('sorts on the issued instant by default, and on the other two on request', () => {
    expect(ids({})).toEqual(['a', 'b']);
    expect(ids({ order: 'desc' })).toEqual(['b', 'a']);
    expect(ids({ sort: 'createdAt' })).toEqual(['b', 'a']);
  });

  /* `effectiveAt` is the only nullable sort key, and it carries the direction
     the way `scheduledFor` does on the orders route: absent last ascending,
     first descending. A mock that pinned absent last in both directions would
     disagree with the route on exactly the descending page. */
  it('sorts a report with no collection instant last ascending and first descending', () => {
    expect(ids({ sort: 'effectiveAt' })).toEqual(['a', 'b']);
    expect(ids({ sort: 'effectiveAt', order: 'desc' })).toEqual(['b', 'a']);
  });

  /* And two collected reports compare on the instant itself, which the pair
     above cannot show: one of them is absent, so that arm answers from the
     absence alone and a comparator that never read `effectiveAt` would pass. */
  it('orders two collected reports by their collection instant', () => {
    const collected = [rows[0], dto({ id: 'c', effectiveAt: '2026-02-06T00:00:00.000Z' })];
    const sorted = (query: Parameters<typeof filterDiagnosticReports>[1]): string[] =>
      filterDiagnosticReports(collected, query).map((row) => row.id);

    expect(sorted({ sort: 'effectiveAt' })).toEqual(['a', 'c']);
    expect(sorted({ sort: 'effectiveAt', order: 'desc' })).toEqual(['c', 'a']);
  });
});

describe('results reads on both clients', () => {
  it('reaches the routes the API serves, with the query strings they read', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn().mockImplementation((url: string) => {
      calls.push(url);
      return Promise.resolve(
        new Response(JSON.stringify({ data: [], page: { page: 1, pageSize: 25, total: 0 } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );
    });
    const client = createHttpClient({ baseUrl: 'http://api.test', fetchImpl });

    await client.results.list({ patientId: 'p-1', reviewed: false });
    await client.results.listObservations('report-1');

    expect(calls).toEqual([
      'http://api.test/bff/v0/results?patientId=p-1&reviewed=false',
      'http://api.test/bff/v0/results/report-1/observations',
    ]);
  });

  it('answers the same rows from fixtures, paged', async () => {
    const page = await createMockClient().results.list({ pageSize: 1 });
    expect(page.data).toHaveLength(1);
    expect(page.page.total).toBe(MOCK_DIAGNOSTIC_REPORTS.length);
  });

  /* Read through the report: an id naming a report the client has no row for is
     absent rather than an empty list, which would read as a report whose
     laboratory reported nothing. */
  it('answers the analytes of one report, and refuses an id it has no report for', async () => {
    const client = createMockClient();
    const page = await client.results.listObservations(MOCK_DIAGNOSTIC_REPORTS[0]!.id);

    expect(page.data.map((row) => row.display)).toEqual(
      MOCK_RESULT_OBSERVATIONS.filter(
        (row) => row.diagnosticReportId === MOCK_DIAGNOSTIC_REPORTS[0]!.id
      ).map((row) => row.display)
    );
    expect(page.data.length).toBeGreaterThan(0);
    await expect(client.results.listObservations('no-such-report')).rejects.toThrow();
  });

  it('answers no analytes for the report that reads as a narrative', async () => {
    const page = await createMockClient().results.listObservations(MOCK_DIAGNOSTIC_REPORTS[1]!.id);
    expect(page.data).toEqual([]);
  });
});

/**
 * The page mapper. Same argument as `toOrderPage`: a clinician reading "25
 * results" above 24 rows cannot tell whether one is missing or one is
 * elsewhere, so the difference leaves the mapping layer rather than dying in it.
 */
describe('toResultPage', () => {
  /* The refused row is FIRST, so a mapper that dropped the null by truncating
     rather than filtering would lose the rendered row too and fail here. */
  const response: ListResponse<DiagnosticReportDto> = {
    data: [dto({ id: 'referral', category: 'REFERRAL' }), dto({ id: 'lab' })],
    /* Deliberately not 2: a real page is one window onto a larger match, and a
       mapper that recomputed the total from the rows it was handed would agree
       with itself here and be wrong on every page but the last. */
    page: { page: 1, pageSize: 2, total: 25, totalPages: 13 },
  };

  it('keeps the total the API reported rather than recomputing it from the page', () => {
    expect(toResultPage(response).page).toEqual({
      page: 1,
      pageSize: 2,
      total: 25,
      totalPages: 13,
    });
  });

  it('lists only the rows the queue has a word for', () => {
    expect(toResultPage(response).data.map((report) => report.id)).toEqual(['lab']);
  });

  it('counts the refused rows rather than discarding them', () => {
    expect(toResultPage(response).refused).toBe(1);
  });

  it('reports no refusal when every row on the page mapped', () => {
    expect(toResultPage({ ...response, data: [dto({ id: 'lab' })] }).refused).toBe(0);
  });
});

describe('liveResults', () => {
  function stub(
    rows: readonly DiagnosticReportDto[],
    observations: readonly ResultObservationDto[] = []
  ): {
    client: ApiClient;
    queries: unknown[];
    observationIds: string[];
    observationQueries: unknown[];
  } {
    const queries: unknown[] = [];
    const observationIds: string[] = [];
    const observationQueries: unknown[] = [];
    const client = {
      results: {
        list: (query?: unknown) => {
          queries.push(query);
          return Promise.resolve({
            data: [...rows],
            page: { page: 1, pageSize: 25, total: 25, totalPages: 1 },
          });
        },
        listObservations: (id: string, query?: unknown) => {
          observationIds.push(id);
          observationQueries.push(query);
          return Promise.resolve({
            data: [...observations],
            page: { page: 1, pageSize: 100, total: observations.length, totalPages: 1 },
          });
        },
      },
    } as unknown as ApiClient;
    return { client, queries, observationIds, observationQueries };
  }

  it('sends the translated query, with the assignment filter dropped', async () => {
    const { client, queries } = stub([]);

    await liveResults(client).list({ assignedTo: 'ME', flag: 'CRITICAL', status: 'UNREVIEWED' });

    expect(queries).toEqual([{ abnormalFlag: 'CRITICAL', reviewed: false }]);
  });

  it('answers a mapped page whose refused count survives the mapping', async () => {
    const { client } = stub([dto({ id: 'referral', category: 'REFERRAL' }), dto({ id: 'lab' })]);

    const page = await liveResults(client).list();

    expect(page.data.map((report) => report.id)).toEqual(['lab']);
    expect(page.page.total).toBe(25);
    expect(page.refused).toBe(1);
  });

  it('fetches the analytes of the report it was asked for, and maps them', async () => {
    const { client, observationIds } = stub([], [...MOCK_RESULT_OBSERVATIONS]);

    const analytes = await liveResults(client).analytes('report-1');

    expect(observationIds).toEqual(['report-1']);
    expect(analytes.data.map((analyte) => analyte.label)).toEqual(
      MOCK_RESULT_OBSERVATIONS.map((row) => row.display)
    );
  });

  /* The route's default is 25 and its clamp is 100, so a pane that asked for
     nothing would render the first 25 analytes of a longer report as though
     they were all of them. */
  it('asks for the widest page the observations route will serve', async () => {
    const { client, observationQueries } = stub([], [...MOCK_RESULT_OBSERVATIONS]);

    await liveResults(client).analytes('report-1');

    expect(observationQueries).toEqual([{ pageSize: 100 }]);
  });

  /* The envelope, not just the rows: a bare array cannot say it is short, and
     the reading pane needs the total to name what it is missing. */
  it('carries the page the route reported rather than counting the rows it got', async () => {
    const { client } = stub([], [...MOCK_RESULT_OBSERVATIONS]);

    const analytes = await liveResults(client).analytes('report-1');

    expect(analytes.page.total).toBe(MOCK_RESULT_OBSERVATIONS.length);
    expect(analytes.page.pageSize).toBe(100);
  });
});
