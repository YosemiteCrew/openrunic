import { describe, expect, it, vi } from 'vitest';

import {
  createHttpClient,
  createMockClient,
  filterServiceRequests,
  liveOrders,
  toOrder,
  toOrderPage,
} from '@/lib/api';
import type { ApiClient, ListResponse, ServiceRequestDto } from '@/lib/api';
import { MOCK_SERVICE_REQUESTS } from '@/lib/api/mock/records';

/**
 * The seam between `GET /bff/v0/orders` and the order ledger's view type.
 *
 * Two things are being protected, and they fail in opposite directions. The
 * mapper must carry every field the screen renders from the field the API
 * actually sends, because a field read off the wrong key is a plausible wrong
 * value rather than a blank. And it must refuse a domain value the ledger has
 * no word for, because the alternative - folding it onto the nearest word -
 * puts a wrong badge on a clinical row and nothing downstream can tell.
 */

const DTO: ServiceRequestDto = {
  id: 'order-1',
  patientId: 'patient-1',
  encounterId: 'encounter-1',
  orderedById: 'clinician-1',
  category: 'LAB',
  status: 'TRANSMITTED',
  intent: 'ORDER',
  priority: 'URGENT',
  code: '24323-8',
  codeSystem: 'http://loinc.org',
  display: 'Comprehensive metabolic panel',
  specimenTypeCode: 'SER',
  reasonCodes: ['I10', 'E11.9'],
  aoeAnswers: null,
  note: null,
  requisitionNumber: null,
  performingLabName: 'Cedar Valley Laboratory',
  labRef: null,
  requestedAt: '2026-02-01T08:00:00.000Z',
  scheduledFor: null,
  transmittedAt: '2026-02-01T09:00:00.000Z',
  createdAt: '2026-01-31T23:00:00.000Z',
  updatedAt: '2026-02-01T09:30:00.000Z',
};

function dto(overrides: Partial<ServiceRequestDto> = {}): ServiceRequestDto {
  return { ...DTO, ...overrides };
}

describe('toOrder', () => {
  it('carries every rendered field from the field the API sends', () => {
    expect(toOrder(DTO)).toEqual({
      id: 'order-1',
      patientId: 'patient-1',
      code: '24323-8',
      name: 'Comprehensive metabolic panel',
      category: 'LAB',
      status: 'TRANSMITTED',
      priority: 'URGENT',
      placedAt: '2026-02-01T08:00:00.000Z',
      lastEventAt: '2026-02-01T09:30:00.000Z',
      providerId: 'clinician-1',
      destination: 'Cedar Valley Laboratory',
      specimen: 'SER',
      diagnosisCode: 'I10',
      diagnosisDisplay: null,
      resultId: null,
      cancelReason: null,
    });
  });

  /* Each of the four dates on the DTO is distinct above, so a mapper reading
     `createdAt` where it should read `requestedAt`, or `transmittedAt` where it
     should read `updatedAt`, fails rather than agreeing with itself. The age
     chip is computed from `lastEventAt` and the ledger sorts on `placedAt`, so
     the two are read by different things and swapping them is invisible on one
     screen and wrong on the other. */
  it('reads the placed and last-event instants from different fields', () => {
    const order = toOrder(dto({ requestedAt: '2026-03-01T00:00:00.000Z' }));
    expect(order?.placedAt).toBe('2026-03-01T00:00:00.000Z');
    expect(order?.lastEventAt).toBe('2026-02-01T09:30:00.000Z');
  });

  it('takes the first reason code as the linked diagnosis, and none when there is none', () => {
    expect(toOrder(dto({ reasonCodes: ['E11.9', 'I10'] }))?.diagnosisCode).toBe('E11.9');
    expect(toOrder(dto({ reasonCodes: [] }))?.diagnosisCode).toBeNull();
  });

  it('leaves the destination null before a lab is chosen rather than inventing one', () => {
    expect(toOrder(dto({ performingLabName: null }))?.destination).toBeNull();
  });

  /* The point of the mapper. Each of these is a legal database value with no
     word in the ledger's own enums, and each is listed separately so that a
     fold onto the nearest word - REFERRAL as PROCEDURE, ASAP as URGENT,
     COMPLETED as RESULTED - fails on its own row rather than hiding behind a
     sibling that happens to be refused for another reason. */
  it.each([
    ['a referral, which has its own surface', { category: 'REFERRAL' as const }],
    ['a therapy order', { category: 'THERAPY' as const }],
    ['an unsigned draft', { status: 'DRAFT' as const }],
    ['a completed order', { status: 'COMPLETED' as const }],
    ['an order entered in error', { status: 'ENTERED_IN_ERROR' as const }],
    ['an ASAP priority the ledger cannot render', { priority: 'ASAP' as const }],
  ])('refuses %s rather than folding it onto the nearest word', (_why, overrides) => {
    expect(toOrder(dto(overrides))).toBeNull();
  });

  it('maps every fixture the mock API serves, so the seam is not vacuous', () => {
    const mapped = MOCK_SERVICE_REQUESTS.map(toOrder);
    expect(mapped.length).toBeGreaterThan(0);
    expect(mapped.every((order) => order !== null)).toBe(true);
  });
});

describe('filterServiceRequests', () => {
  const rows: readonly ServiceRequestDto[] = [
    dto({
      id: 'a',
      patientId: 'p-1',
      encounterId: 'e-1',
      status: 'PENDED',
      category: 'LAB',
      priority: 'ROUTINE',
      orderedById: 'u-1',
      requestedAt: '2026-02-01T00:00:00.000Z',
      scheduledFor: '2026-02-05T00:00:00.000Z',
      createdAt: '2026-01-02T00:00:00.000Z',
    }),
    dto({
      id: 'b',
      patientId: 'p-2',
      encounterId: 'e-2',
      status: 'TRANSMITTED',
      category: 'IMAGING',
      priority: 'STAT',
      orderedById: 'u-2',
      requestedAt: '2026-02-03T00:00:00.000Z',
      scheduledFor: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    }),
  ];

  const ids = (query: Parameters<typeof filterServiceRequests>[1]): string[] =>
    filterServiceRequests(rows, query).map((row) => row.id);

  it('narrows on each field the route publishes', () => {
    expect(ids({ patientId: 'p-1' })).toEqual(['a']);
    expect(ids({ encounterId: 'e-2' })).toEqual(['b']);
    expect(ids({ status: 'PENDED' })).toEqual(['a']);
    expect(ids({ category: 'IMAGING' })).toEqual(['b']);
    expect(ids({ priority: 'STAT' })).toEqual(['b']);
    expect(ids({ orderedById: 'u-1' })).toEqual(['a']);
    expect(ids({})).toEqual(['a', 'b']);
  });

  /* Half-open, the way the published list description says: an order requested
     at exactly `to` belongs to the next window, not this one and the next. */
  it('takes from inclusive and to exclusive over the requested instant', () => {
    expect(ids({ from: '2026-02-03T00:00:00.000Z' })).toEqual(['b']);
    expect(ids({ to: '2026-02-03T00:00:00.000Z' })).toEqual(['a']);
  });

  it('sorts on the requested instant by default, and on the other two on request', () => {
    expect(ids({})).toEqual(['a', 'b']);
    expect(ids({ order: 'desc' })).toEqual(['b', 'a']);
    expect(ids({ sort: 'createdAt' })).toEqual(['b', 'a']);
  });

  /* Unscheduled sorts last ascending and first descending, because the route
     reads the column through `comparable()` - absent becomes `+Infinity` - and
     then multiplies the comparison by the direction. Postgres does the same:
     `orderBy` names no `nulls` option, so NULLS LAST on asc, NULLS FIRST on
     desc. A mock that pinned unscheduled last in both directions would disagree
     with the route it stands in for on exactly the descending page. */
  it('sorts an order with no scheduled date last ascending and first descending', () => {
    expect(ids({ sort: 'scheduledFor' })).toEqual(['a', 'b']);
    expect(ids({ sort: 'scheduledFor', order: 'desc' })).toEqual(['b', 'a']);
  });
});

describe('orders.list on both clients', () => {
  it('reaches the route the API serves, with the query string it reads', async () => {
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

    await client.orders.list({ patientId: 'p-1', status: 'PENDED' });

    expect(calls).toEqual(['http://api.test/bff/v0/orders?patientId=p-1&status=PENDED']);
  });

  it('answers the same rows from fixtures, paged', async () => {
    const page = await createMockClient().orders.list({ pageSize: 1 });
    expect(page.data).toHaveLength(1);
    expect(page.page.total).toBe(MOCK_SERVICE_REQUESTS.length);
  });
});

/**
 * The page mapper, which is where the refusal stops being invisible (#539).
 *
 * `toOrder` answering null is correct and already covered above. What is
 * covered here is what happens to the null: `page.total` counts rows the API
 * matched and `data` holds rows the ledger can render, so the two are different
 * numbers on any page carrying a referral or a draft, and the difference has to
 * leave the mapping layer for the screen to be able to say so.
 */
describe('toOrderPage', () => {
  /* The refused row is FIRST, so a mapper that dropped the null by truncating
     rather than filtering would lose the rendered rows too and fail here. */
  const response: ListResponse<ServiceRequestDto> = {
    data: [dto({ id: 'referral', category: 'REFERRAL' }), dto({ id: 'lab' })],
    /* Deliberately not 2: a real page is one window onto a larger match, and a
       mapper that recomputed the total from the rows it was handed would agree
       with itself here and be wrong on every page but the last. */
    page: { page: 1, pageSize: 2, total: 25, totalPages: 13 },
  };

  it('keeps the total the API reported rather than recomputing it from the page', () => {
    expect(toOrderPage(response).page).toEqual({ page: 1, pageSize: 2, total: 25, totalPages: 13 });
  });

  it('lists only the rows the ledger has a word for', () => {
    expect(toOrderPage(response).data.map((order) => order.id)).toEqual(['lab']);
  });

  it('counts the refused rows rather than discarding them', () => {
    expect(toOrderPage(response).refused).toBe(1);
  });

  it('reports no refusal when every row on the page mapped', () => {
    expect(toOrderPage({ ...response, data: [dto({ id: 'lab' })] }).refused).toBe(0);
  });
});

describe('liveOrders', () => {
  function stub(rows: readonly ServiceRequestDto[]): {
    client: ApiClient;
    queries: unknown[];
  } {
    const queries: unknown[] = [];
    const client = {
      orders: {
        list: (query?: unknown) => {
          queries.push(query);
          return Promise.resolve({
            data: [...rows],
            page: { page: 1, pageSize: 25, total: 25, totalPages: 1 },
          });
        },
      },
    } as unknown as ApiClient;
    return { client, queries };
  }

  it('sends the view query to the route unchanged', async () => {
    const { client, queries } = stub([]);

    await liveOrders(client).list({ status: 'PENDED', category: 'LAB' });

    expect(queries).toEqual([{ status: 'PENDED', category: 'LAB' }]);
  });

  /* The whole point of the wiring: a page of 25 with one referral in it is 24
     rows and a stated difference, not 24 rows under a silent 25. */
  it('answers a mapped page whose refused count survives the mapping', async () => {
    const { client } = stub([dto({ id: 'referral', category: 'REFERRAL' }), dto({ id: 'lab' })]);

    const page = await liveOrders(client).list();

    expect(page.data.map((order) => order.id)).toEqual(['lab']);
    expect(page.page.total).toBe(25);
    expect(page.refused).toBe(1);
  });
});
