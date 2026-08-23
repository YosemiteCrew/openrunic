import { describe, expect, it } from 'vitest';

import { AuditCollector } from '../audit/collector.js';
import { createMemoryAuditSink } from '../audit/memory-sink.js';
import type { ProblemDocument } from '../http/problem.js';
import {
  createEmptyDataset,
  createMemoryRepositoryRegistry,
  type MemoryDataset,
} from '../repositories/memory.js';
import { financialSpecs } from '../repositories/specs/financial.js';
import type { ClaimStatus } from '../repositories/specs/financial.js';
import type { ScopedRow } from '../repositories/rows.js';
import type { Repositories } from '../repositories/types.js';
import { financialRouteContracts } from '../routes/financial.js';
import type {
  ChargeDto,
  ChargeItemRow,
  ClaimDto,
  ClaimLineDto,
  ClaimLineRow,
  ClaimRow,
  ClaimStatusHistoryDto,
  ClaimStatusHistoryRow,
  CoverageDto,
  CoverageRow,
  EligibilityResult,
  PaymentAllocationDto,
  PaymentAllocationRow,
  PaymentDto,
  PaymentRow,
  RemittanceDto,
  RemittanceLineDto,
  RemittanceLineRow,
  RemittanceParseResult,
  RemittancePostResult,
  RemittanceRow,
  StatementDto,
  CollectionsWorklistEntry,
  StatementRow,
} from '../schemas/financial.js';
import type { ListResponse } from '../schemas/pagination.js';

import {
  DEMO_FACILITY_A,
  DEMO_FACILITY_B,
  DEMO_TENANT_A,
  FIXED_NOW,
  TOKENS,
  UNPRIVILEGED_TOKEN,
  bearer,
  createTestApp,
  jsonBearer,
  seed,
  storageColumns,
  testId,
} from './support.js';

/**
 * The revenue cycle over HTTP, end to end through the real middleware chain.
 *
 * Synthetic throughout: Testina Patientsson, MRN OR-100482, and an invented
 * payer called Testline Mutual. No real payer, member number or instrument
 * appears here, and none could: the write contracts have nowhere to put one.
 */

const PATIENT_ID = testId(1);
const OTHER_PATIENT_ID = testId(2);
const PAYER_ID = testId(300);
const OTHER_PAYER_ID = testId(301);
const ENCOUNTER_ID = testId(200);
const OTHER_ENCOUNTER_ID = testId(201);
const PROVIDER_ID = testId(900);
/** The biller principal's subject, from the static resolver. */
const BILLER_SUBJECT = testId(103);
const SERVICE_DAY = new Date('2026-08-01T00:00:00.000Z');

/* ---------------------------------------------------------------- fixtures */

function makeCoverageRow(overrides: Partial<CoverageRow> = {}): CoverageRow {
  return {
    ...storageColumns(testId(10)),
    patientId: PATIENT_ID,
    payerId: PAYER_ID,
    rank: 'PRIMARY',
    status: 'ACTIVE',
    memberId: 'TM-4471',
    groupNumber: 'GRP-88',
    planName: 'Testline Mutual Choice',
    subscriberRelationshipCode: 'self',
    subscriberGivenName: 'Testina',
    subscriberFamilyName: 'Patientsson',
    subscriberBirthDate: new Date('1994-03-02T00:00:00.000Z'),
    effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
    effectiveTo: new Date('2026-12-31T00:00:00.000Z'),
    copayCents: 2500,
    deductibleCents: 150_000,
    acceptAssignment: true,
    ...overrides,
  };
}

function makeChargeRow(overrides: Partial<ChargeItemRow> = {}): ChargeItemRow {
  return {
    ...storageColumns(testId(20)),
    facilityId: DEMO_FACILITY_A,
    encounterId: ENCOUNTER_ID,
    patientId: PATIENT_ID,
    code: '99213',
    codeSystem: 'http://www.ama-assn.org/go/cpt',
    display: 'Office visit, established patient',
    modifiers: [],
    units: 1,
    unitPriceCents: 12_500,
    totalPriceCents: 12_500,
    diagnosisPointers: [1],
    renderingProviderId: PROVIDER_ID,
    supervisingProviderId: null,
    placeOfServiceCode: '11',
    serviceDate: new Date('2026-08-01T00:00:00.000Z'),
    status: 'OPEN',
    voidReason: null,
    voidedById: null,
    ...overrides,
  };
}

function makeClaimRow(overrides: Partial<ClaimRow> = {}): ClaimRow {
  return {
    ...storageColumns(testId(30)),
    patientId: PATIENT_ID,
    encounterId: ENCOUNTER_ID,
    coverageId: testId(10),
    payerId: PAYER_ID,
    status: 'DRAFT',
    frequency: 'ORIGINAL',
    diagnosisCodes: ['J06.9'],
    totalChargedCents: 12_500,
    totalPaidCents: 0,
    totalAdjustedCents: 0,
    patientResponsibilityCents: 0,
    secondaryOfId: null,
    priorClaimId: null,
    controlNumbers: {},
    snapshot: {},
    statusReason: null,
    submittedAt: null,
    acknowledgedAt: null,
    adjudicatedAt: null,
    ...overrides,
  };
}

function makeClaimLineRow(overrides: Partial<ClaimLineRow> = {}): ClaimLineRow {
  return {
    ...storageColumns(testId(40)),
    claimId: testId(30),
    chargeItemId: testId(20),
    sequence: 1,
    code: '99213',
    codeSystem: 'http://www.ama-assn.org/go/cpt',
    modifiers: [],
    units: 1,
    chargedCents: 12_500,
    allowedCents: null,
    paidCents: 0,
    adjustedCents: 0,
    diagnosisPointers: [1],
    serviceDateFrom: new Date('2026-08-01T00:00:00.000Z'),
    serviceDateTo: null,
    statusReason: null,
    ...overrides,
  };
}

function makeClaimHistoryRow(
  overrides: Partial<ClaimStatusHistoryRow> = {}
): ClaimStatusHistoryRow {
  return {
    ...storageColumns(testId(45)),
    claimId: testId(30),
    status: 'DRAFT',
    occurredAt: new Date('2026-08-01T09:00:00.000Z'),
    source: 'system',
    detail: null,
    byUserId: null,
    ...overrides,
  };
}

function makePaymentRow(overrides: Partial<PaymentRow> = {}): PaymentRow {
  return {
    ...storageColumns(testId(50)),
    patientId: PATIENT_ID,
    payerId: null,
    remittanceId: null,
    source: 'PATIENT',
    method: 'CARD',
    status: 'PENDING',
    amountCents: 5_000,
    currency: 'USD',
    reference: null,
    adapterRef: 'adapter-ref-testonly',
    receivedAt: new Date('2026-08-10T09:00:00.000Z'),
    postedAt: null,
    postedById: null,
    note: null,
    ...overrides,
  };
}

function makeAllocationRow(overrides: Partial<PaymentAllocationRow> = {}): PaymentAllocationRow {
  return {
    ...storageColumns(testId(55)),
    paymentId: testId(50),
    patientId: PATIENT_ID,
    claimId: testId(30),
    claimLineId: null,
    chargeItemId: null,
    amountCents: 5_000,
    adjustmentGroupCode: 'CO',
    adjustmentReasonCode: '45',
    appliedAt: new Date('2026-08-10T09:05:00.000Z'),
    note: null,
    ...overrides,
  };
}

function makeRemittanceRow(overrides: Partial<RemittanceRow> = {}): RemittanceRow {
  return {
    ...storageColumns(testId(60)),
    payerId: PAYER_ID,
    status: 'RECEIVED',
    checkOrEftNumber: 'EFT-90210',
    totalPaidCents: 10_000,
    receivedAt: new Date('2026-08-11T09:00:00.000Z'),
    paidAt: null,
    rawStorageKey: null,
    parsed: null,
    exceptionCount: 0,
    postedAt: null,
    postedById: null,
    ...overrides,
  };
}

function makeRemittanceLineRow(overrides: Partial<RemittanceLineRow> = {}): RemittanceLineRow {
  return {
    ...storageColumns(testId(65)),
    remittanceId: testId(60),
    claimId: testId(30),
    claimLineId: null,
    sequence: 1,
    payerControlNumber: 'CLP-1',
    code: '99213',
    chargedCents: 12_500,
    allowedCents: 10_000,
    paidCents: 10_000,
    patientResponsibilityCents: 2_500,
    adjustmentGroupCode: 'CO',
    adjustmentReasonCode: '45',
    remarkCodes: ['N130'],
    serviceDateFrom: new Date('2026-08-01T00:00:00.000Z'),
    matched: true,
    ...overrides,
  };
}

function makeStatementRow(overrides: Partial<StatementRow> = {}): StatementRow {
  return {
    ...storageColumns(testId(70)),
    patientId: PATIENT_ID,
    status: 'DRAFT',
    balanceCents: 2_500,
    dunningCycle: 0,
    lastNoticeAt: null,
    holdUntil: null,
    holdReason: null,
    closedReason: null,
    periodStart: new Date('2026-07-01T00:00:00.000Z'),
    periodEnd: new Date('2026-07-31T00:00:00.000Z'),
    generatedAt: new Date('2026-08-01T09:00:00.000Z'),
    deliveredVia: null,
    deliveredAt: null,
    pdfStorageKey: null,
    payLinkToken: null,
    payLinkExpiresAt: null,
    paidAt: null,
    ...overrides,
  };
}

/* ------------------------------------------------------------------ helpers */

const COVERAGE_BODY = { patientId: PATIENT_ID, payerId: PAYER_ID, memberId: 'TM-4471' };

const CHARGE_BODY = {
  facilityId: DEMO_FACILITY_A,
  encounterId: ENCOUNTER_ID,
  patientId: PATIENT_ID,
  code: '99213',
  display: 'Office visit, established patient',
  unitPriceCents: 12_500,
  totalPriceCents: 12_500,
  renderingProviderId: PROVIDER_ID,
  serviceDate: '2026-08-01',
};

const CLAIM_BODY = {
  patientId: PATIENT_ID,
  encounterId: ENCOUNTER_ID,
  coverageId: testId(10),
  payerId: PAYER_ID,
  diagnosisCodes: ['J06.9'],
  lines: [
    {
      chargeItemId: testId(20),
      sequence: 1,
      code: '99213',
      chargedCents: 12_500,
      serviceDateFrom: '2026-08-01',
    },
    {
      chargeItemId: testId(21),
      sequence: 2,
      code: '85025',
      chargedCents: 3_200,
      serviceDateFrom: '2026-08-01',
    },
  ],
};

const PAYMENT_BODY = {
  patientId: PATIENT_ID,
  source: 'PATIENT',
  method: 'CARD',
  amountCents: 5_000,
  adapterRef: 'adapter-ref-testonly',
};

const REMITTANCE_BODY = { payerId: PAYER_ID, checkOrEftNumber: 'EFT-90210' };

const STATEMENT_BODY = { patientId: PATIENT_ID, balanceCents: 2_500 };

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

function post(path: string, token: string, body?: unknown): [string, RequestInit] {
  return [
    path,
    body === undefined
      ? { method: 'POST', headers: bearer(token) }
      : { method: 'POST', headers: jsonBearer(token), body: JSON.stringify(body) },
  ];
}

function patch(path: string, token: string, body: unknown): [string, RequestInit] {
  return [path, { method: 'PATCH', headers: jsonBearer(token), body: JSON.stringify(body) }];
}

/* ----------------------------------------------------------------- coverage */

describe('GET /bff/v0/coverage', () => {
  it('pages, and reports the whole-set total', async () => {
    const { app, dataset } = createTestApp();
    for (let index = 0; index < 3; index += 1) {
      seed(dataset, 'Coverage', makeCoverageRow({ id: testId(10 + index) }));
    }

    const res = await app.request('/bff/v0/coverage?page=2&pageSize=2', {
      headers: bearer(TOKENS.billerA),
    });

    expect(res.status).toBe(200);
    const body = await json<ListResponse<CoverageDto>>(res);
    expect(body.data).toHaveLength(1);
    expect(body.page).toEqual({ page: 2, pageSize: 2, total: 3, totalPages: 2 });
  });

  it('filters by patient, payer, rank and status', async () => {
    const { app, dataset } = createTestApp();
    seed(
      dataset,
      'Coverage',
      makeCoverageRow({ id: testId(10) }),
      makeCoverageRow({
        id: testId(11),
        patientId: OTHER_PATIENT_ID,
        payerId: OTHER_PAYER_ID,
        rank: 'SECONDARY',
        status: 'CANCELLED',
      })
    );
    const search = async (query: string): Promise<ListResponse<CoverageDto>> =>
      json(await app.request(`/bff/v0/coverage?${query}`, { headers: bearer(TOKENS.billerA) }));

    expect((await search(`patientId=${PATIENT_ID}`)).data.map((row) => row.id)).toEqual([
      testId(10),
    ]);
    expect((await search(`payerId=${OTHER_PAYER_ID}`)).data.map((row) => row.id)).toEqual([
      testId(11),
    ]);
    expect((await search('rank=SECONDARY')).data.map((row) => row.id)).toEqual([testId(11)]);
    expect((await search('status=ACTIVE')).data.map((row) => row.id)).toEqual([testId(10)]);
  });

  it('sorts by rank, effective date and creation, in both directions', async () => {
    const { app, dataset } = createTestApp();
    seed(
      dataset,
      'Coverage',
      makeCoverageRow({ id: testId(10), rank: 'PRIMARY' }),
      makeCoverageRow({
        id: testId(11),
        rank: 'SECONDARY',
        effectiveFrom: new Date('2025-01-01T00:00:00.000Z'),
      })
    );
    const order = async (query: string): Promise<string[]> =>
      (
        await json<ListResponse<CoverageDto>>(
          await app.request(`/bff/v0/coverage?${query}`, { headers: bearer(TOKENS.billerA) })
        )
      ).data.map((row) => row.id);

    expect(await order('sort=rank&order=desc')).toEqual([testId(11), testId(10)]);
    expect(await order('sort=effectiveFrom')).toEqual([testId(11), testId(10)]);
    expect(await order('sort=createdAt')).toEqual([testId(10), testId(11)]);
  });

  it('400s an unknown filter rather than searching unfiltered', async () => {
    const { app } = createTestApp();
    const res = await app.request('/bff/v0/coverage?payorId=x', {
      headers: bearer(TOKENS.billerA),
    });

    expect(res.status).toBe(400);
    expect((await json<ProblemDocument>(res)).type).toBe(
      'https://openrunic.org/problems/malformed-request'
    );
  });

  it('401s with no token and 403s a role that holds nothing', async () => {
    const { app } = createTestApp();

    expect((await app.request('/bff/v0/coverage')).status).toBe(401);
    expect(
      (await app.request('/bff/v0/coverage', { headers: bearer(UNPRIVILEGED_TOKEN) })).status
    ).toBe(403);
  });
});

describe('coverage reads, writes and amendments', () => {
  it('reads one record and serialises its dates as calendar days', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'Coverage', makeCoverageRow());

    const body = await json<CoverageDto>(
      await app.request(`/bff/v0/coverage/${testId(10)}`, { headers: bearer(TOKENS.billerA) })
    );

    expect(body).toMatchObject({
      id: testId(10),
      memberId: 'TM-4471',
      planName: 'Testline Mutual Choice',
      effectiveFrom: '2026-01-01',
      effectiveTo: '2026-12-31',
    });
    expect(body.subscriber.birthDate).toBe('1994-03-02');
    expect(body.createdAt).toMatch(/T.*Z$/);
  });

  it('404s an unknown id', async () => {
    const { app } = createTestApp();
    const res = await app.request(`/bff/v0/coverage/${testId(999)}`, {
      headers: bearer(TOKENS.billerA),
    });

    expect(res.status).toBe(404);
  });

  it('records a policy, defaults its columns and points at it', async () => {
    const { app } = createTestApp();
    const res = await app.request(...post('/bff/v0/coverage', TOKENS.billerA, COVERAGE_BODY));

    expect(res.status).toBe(201);
    const body = await json<CoverageDto>(res);
    expect(res.headers.get('location')).toBe(`/bff/v0/coverage/${body.id}`);
    expect(body).toMatchObject({
      rank: 'PRIMARY',
      status: 'ACTIVE',
      acceptAssignment: true,
      groupNumber: null,
      effectiveFrom: null,
    });
    expect(body.subscriber.relationshipCode).toBe('self');
  });

  it('422s a body that parses but breaks the contract', async () => {
    const { app } = createTestApp();
    const res = await app.request(
      ...post('/bff/v0/coverage', TOKENS.billerA, { ...COVERAGE_BODY, memberId: '' })
    );

    expect(res.status).toBe(422);
    expect((await json<ProblemDocument>(res)).errors?.[0]?.path).toBe('memberId');
  });

  it('amends the fields it was given', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'Coverage', makeCoverageRow());

    const res = await app.request(
      ...patch(`/bff/v0/coverage/${testId(10)}`, TOKENS.billerA, {
        rank: 'SECONDARY',
        copayCents: 3_000,
        subscriberBirthDate: '1994-03-02',
        effectiveFrom: '2026-02-01',
        effectiveTo: '2026-11-30',
        planName: 'Testline Mutual Basic',
        groupNumber: 'GRP-89',
        memberId: 'TM-9999',
        subscriberRelationshipCode: 'spouse',
        subscriberGivenName: 'Testar',
        subscriberFamilyName: 'Patientsson',
        deductibleCents: 100_000,
        acceptAssignment: false,
        status: 'DRAFT',
      })
    );

    expect(res.status).toBe(200);
    const body = await json<CoverageDto>(res);
    expect(body).toMatchObject({
      rank: 'SECONDARY',
      copayCents: 3_000,
      effectiveFrom: '2026-02-01',
      acceptAssignment: false,
    });
  });

  it('422s a patch that changes nothing and one whose window runs backwards', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'Coverage', makeCoverageRow());

    expect(
      (await app.request(...patch(`/bff/v0/coverage/${testId(10)}`, TOKENS.billerA, {}))).status
    ).toBe(422);
    const backwards = await app.request(
      ...patch(`/bff/v0/coverage/${testId(10)}`, TOKENS.billerA, {
        effectiveFrom: '2026-06-01',
        effectiveTo: '2026-01-01',
      })
    );
    expect(backwards.status).toBe(422);
  });

  it('403s a clinician, who may read coverage but not write it', async () => {
    const { app } = createTestApp();
    const res = await app.request(...post('/bff/v0/coverage', TOKENS.clinicianA, COVERAGE_BODY));

    expect(res.status).toBe(403);
    expect((await json<ProblemDocument>(res)).detail).toContain('coverage.write');
  });
});

describe('POST /bff/v0/coverage/:id/eligibility', () => {
  const check = (id: string, serviceDate: string, token = TOKENS.billerA): [string, RequestInit] =>
    post(`/bff/v0/coverage/${id}/eligibility`, token, { serviceDate });

  it('answers locally, and says so', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'Coverage', makeCoverageRow());

    const body = await json<EligibilityResult>(
      await app.request(...check(testId(10), '2026-06-15'))
    );

    expect(body).toMatchObject({
      coverageId: testId(10),
      eligible: true,
      reasons: [],
      rank: 'PRIMARY',
      planName: 'Testline Mutual Choice',
      copayCents: 2500,
      deductibleCents: 150_000,
      determination: 'local',
      serviceDate: '2026-06-15',
    });
  });

  it('gives a reason for a cancelled policy, a draft one, and a date outside the window', async () => {
    const { app, dataset } = createTestApp();
    seed(
      dataset,
      'Coverage',
      makeCoverageRow({ id: testId(10), status: 'CANCELLED' }),
      makeCoverageRow({ id: testId(11), status: 'DRAFT' }),
      makeCoverageRow({ id: testId(12) })
    );
    const reasons = async (id: string, on: string): Promise<string[]> =>
      (await json<EligibilityResult>(await app.request(...check(id, on)))).reasons;

    expect(await reasons(testId(10), '2026-06-15')).toEqual(['The coverage is cancelled.']);
    expect(await reasons(testId(11), '2026-06-15')).toEqual([
      'The coverage has not been verified.',
    ]);
    expect(await reasons(testId(12), '2025-06-15')).toEqual([
      'The service date precedes the policy effective date.',
    ]);
    expect(await reasons(testId(12), '2027-06-15')).toEqual([
      'The service date falls after the policy end date.',
    ]);
  });

  it('answers for an open-ended policy, which has no window to fall outside', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'Coverage', makeCoverageRow({ effectiveFrom: null, effectiveTo: null }));

    const body = await json<EligibilityResult>(
      await app.request(...check(testId(10), '2019-01-01'))
    );

    expect(body.eligible).toBe(true);
  });

  it('refuses a record entered in error rather than answering about it', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'Coverage', makeCoverageRow({ status: 'ENTERED_IN_ERROR' }));

    const res = await app.request(...check(testId(10), '2026-06-15'));

    expect(res.status).toBe(409);
    expect((await json<ProblemDocument>(res)).type).toMatch(/invalid-transition$/);
  });

  it('404s an unknown record and 422s a body with no service date', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'Coverage', makeCoverageRow());

    expect((await app.request(...check(testId(999), '2026-06-15'))).status).toBe(404);
    const empty = await app.request(
      ...post(`/bff/v0/coverage/${testId(10)}/eligibility`, TOKENS.billerA)
    );
    expect(empty.status).toBe(422);
    expect((await json<ProblemDocument>(empty)).errors?.[0]?.path).toBe('serviceDate');
  });

  it('400s an id that is not a UUID, without reaching the store', async () => {
    const { app } = createTestApp();
    const res = await app.request(...check('12', '2026-06-15'));

    expect(res.status).toBe(400);
    expect((await json<ProblemDocument>(res)).errors?.[0]?.path).toBe('id');
  });
});

/* ------------------------------------------------------------------ charges */

describe('charges', () => {
  it('filters by patient, encounter, status and a service-date window', async () => {
    const { app, dataset } = createTestApp();
    // Both at facility A, which is the only site this principal is granted. A
    // row at another site is not a filtering question at all - it is invisible,
    // which the test below is about - and seeding one here would have made
    // every assertion in this test depend on which of the two rules refused it.
    seed(
      dataset,
      'ChargeItem',
      makeChargeRow({ id: testId(20) }),
      makeChargeRow({
        id: testId(21),
        patientId: OTHER_PATIENT_ID,
        encounterId: OTHER_ENCOUNTER_ID,
        status: 'BILLED',
        serviceDate: new Date('2026-09-01T00:00:00.000Z'),
      })
    );
    const search = async (query: string): Promise<string[]> =>
      (
        await json<ListResponse<ChargeDto>>(
          await app.request(`/bff/v0/charges?${query}`, { headers: bearer(TOKENS.billerA) })
        )
      ).data.map((row) => row.id);

    expect(await search(`patientId=${PATIENT_ID}`)).toEqual([testId(20)]);
    expect(await search(`encounterId=${OTHER_ENCOUNTER_ID}`)).toEqual([testId(21)]);
    expect(await search('status=BILLED')).toEqual([testId(21)]);
    expect(await search('from=2026-08-01&to=2026-08-31')).toEqual([testId(20)]);
    expect(await search('order=asc')).toEqual([testId(20), testId(21)]);
    expect(await search('sort=totalPriceCents&order=desc')).toEqual([testId(20), testId(21)]);
    expect(await search('sort=createdAt')).toEqual([testId(20), testId(21)]);
  });

  it('keeps an ungranted facility out of the list, and refuses a filter naming one', async () => {
    const { app, dataset } = createTestApp();
    seed(
      dataset,
      'ChargeItem',
      makeChargeRow({ id: testId(20) }),
      makeChargeRow({ id: testId(22), facilityId: DEMO_FACILITY_B })
    );
    const search = async (query: string): Promise<Response> =>
      app.request(`/bff/v0/charges?${query}`, { headers: bearer(TOKENS.billerA) });
    const ids = async (query: string): Promise<string[]> =>
      (await json<ListResponse<ChargeDto>>(await search(query))).data.map((row) => row.id);

    // The case this exists for: no facilityId in the query at all. There is
    // nothing for the route to refuse, so the repository narrows instead, and
    // the charge at the other site is simply not in the page. Before the
    // narrowing this returned both, which handed a biller granted one site
    // every billing row in the organisation.
    expect(await ids('')).toEqual([testId(20)]);
    expect(await ids('status=OPEN')).toEqual([testId(20)]);
    expect(await ids(`facilityId=${DEMO_FACILITY_A}`)).toEqual([testId(20)]);

    // Naming the ungranted site is a different answer on this boundary: 403,
    // not an empty page that reads as "no charges there".
    expect((await search(`facilityId=${DEMO_FACILITY_B}`)).status).toBe(403);

    // And the single read still refuses rather than hides, which is the BFF
    // contract the FHIR boundary deliberately does not share.
    expect(
      (await app.request(`/bff/v0/charges/${testId(22)}`, { headers: bearer(TOKENS.billerA) }))
        .status
    ).toBe(403);
  });

  it('reads one charge, records one, and amends one', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'ChargeItem', makeChargeRow());

    const read = await json<ChargeDto>(
      await app.request(`/bff/v0/charges/${testId(20)}`, { headers: bearer(TOKENS.billerA) })
    );
    expect(read).toMatchObject({ code: '99213', serviceDate: '2026-08-01', status: 'OPEN' });

    const created = await app.request(...post('/bff/v0/charges', TOKENS.billerA, CHARGE_BODY));
    expect(created.status).toBe(201);
    const createdBody = await json<ChargeDto>(created);
    expect(created.headers.get('location')).toBe(`/bff/v0/charges/${createdBody.id}`);
    expect(createdBody).toMatchObject({ units: 1, modifiers: [], voidedById: null });

    const amended = await app.request(
      ...patch(`/bff/v0/charges/${testId(20)}`, TOKENS.billerA, {
        display: 'Office visit, established patient, 20 minutes',
        modifiers: ['25'],
        units: 2,
        unitPriceCents: 6_250,
        totalPriceCents: 12_500,
        diagnosisPointers: [1, 2],
        code: '99214',
        codeSystem: 'http://www.ama-assn.org/go/cpt',
        renderingProviderId: PROVIDER_ID,
        supervisingProviderId: PROVIDER_ID,
        placeOfServiceCode: '02',
        serviceDate: '2026-08-02',
      })
    );
    expect(amended.status).toBe(200);
    expect(await json<ChargeDto>(amended)).toMatchObject({
      code: '99214',
      units: 2,
      serviceDate: '2026-08-02',
      modifiers: ['25'],
    });
  });

  it('404s an unknown id, 422s an empty patch, 403s an unprivileged token', async () => {
    const { app } = createTestApp();

    expect(
      (await app.request(`/bff/v0/charges/${testId(999)}`, { headers: bearer(TOKENS.billerA) }))
        .status
    ).toBe(404);
    expect(
      (await app.request(...post('/bff/v0/charges', UNPRIVILEGED_TOKEN, CHARGE_BODY))).status
    ).toBe(403);
    expect((await app.request('/bff/v0/charges')).status).toBe(401);
  });

  it('422s a charge whose body fails validation', async () => {
    const { app } = createTestApp();
    const res = await app.request(
      ...post('/bff/v0/charges', TOKENS.billerA, { ...CHARGE_BODY, unitPriceCents: -1 })
    );

    expect(res.status).toBe(422);
  });

  it('403s a charge in a facility the principal has no grant for', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'ChargeItem', makeChargeRow({ facilityId: DEMO_FACILITY_B }));

    const res = await app.request(`/bff/v0/charges/${testId(20)}`, {
      headers: bearer(TOKENS.billerA),
    });

    expect(res.status).toBe(403);
  });
});

describe('POST /bff/v0/charges/:id/void', () => {
  it('voids an open charge, recording the reason and the author', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'ChargeItem', makeChargeRow());

    const res = await app.request(
      ...post(`/bff/v0/charges/${testId(20)}/void`, TOKENS.billerA, {
        voidReason: 'Coded against the wrong visit.',
      })
    );

    expect(res.status).toBe(200);
    expect(await json<ChargeDto>(res)).toMatchObject({
      status: 'VOIDED',
      voidReason: 'Coded against the wrong visit.',
      voidedById: BILLER_SUBJECT,
    });
  });

  it('voids a billed charge too', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'ChargeItem', makeChargeRow({ status: 'BILLED' }));

    const res = await app.request(
      ...post(`/bff/v0/charges/${testId(20)}/void`, TOKENS.billerA, { voidReason: 'Duplicate.' })
    );

    expect(res.status).toBe(200);
  });

  it('refuses a void with no reason', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'ChargeItem', makeChargeRow());

    const res = await app.request(...post(`/bff/v0/charges/${testId(20)}/void`, TOKENS.billerA));

    expect(res.status).toBe(422);
    expect((await json<ProblemDocument>(res)).errors?.[0]?.path).toBe('voidReason');
    expect(dataset.table('ChargeItem')[0]?.status).toBe('OPEN');
  });

  it('refuses to void an already voided charge, with the typed 409', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'ChargeItem', makeChargeRow({ status: 'VOIDED', voidReason: 'Already gone.' }));

    const res = await app.request(
      ...post(`/bff/v0/charges/${testId(20)}/void`, TOKENS.billerA, { voidReason: 'Again.' })
    );

    expect(res.status).toBe(409);
    const body = await json<ProblemDocument>(res);
    expect(body.type).toMatch(/invalid-transition$/);
    expect(body.detail).toContain('VOIDED');
  });

  it('404s an unknown charge and 403s a facility with no grant', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'ChargeItem', makeChargeRow({ id: testId(22), facilityId: DEMO_FACILITY_B }));

    expect(
      (
        await app.request(
          ...post(`/bff/v0/charges/${testId(999)}/void`, TOKENS.billerA, { voidReason: 'Gone.' })
        )
      ).status
    ).toBe(404);
    expect(
      (
        await app.request(
          ...post(`/bff/v0/charges/${testId(22)}/void`, TOKENS.billerA, { voidReason: 'Gone.' })
        )
      ).status
    ).toBe(403);
  });
});

/* ------------------------------------------------------------------- claims */

describe('claims', () => {
  it('writes the lines in the same call and derives the total from them', async () => {
    const { app, dataset } = createTestApp();

    const res = await app.request(...post('/bff/v0/claims', TOKENS.billerA, CLAIM_BODY));

    expect(res.status).toBe(201);
    const body = await json<ClaimDto>(res);
    expect(res.headers.get('location')).toBe(`/bff/v0/claims/${body.id}`);
    expect(body.totals.chargedCents).toBe(15_700);
    expect(dataset.table('ClaimLine')).toHaveLength(2);
    expect(dataset.table('ClaimLine').map((line) => line.claimId)).toEqual([body.id, body.id]);
  });

  it('keeps a stated total rather than recomputing it', async () => {
    const { app } = createTestApp();

    const body = await json<ClaimDto>(
      await app.request(
        ...post('/bff/v0/claims', TOKENS.billerA, { ...CLAIM_BODY, totalChargedCents: 20_000 })
      )
    );

    expect(body.totals.chargedCents).toBe(20_000);
  });

  it('filters the accounts-receivable queue by patient, payer, encounter, status and window', async () => {
    const { app, dataset } = createTestApp();
    seed(
      dataset,
      'Claim',
      makeClaimRow({ id: testId(30) }),
      makeClaimRow({
        id: testId(31),
        patientId: OTHER_PATIENT_ID,
        payerId: OTHER_PAYER_ID,
        encounterId: OTHER_ENCOUNTER_ID,
        status: 'SUBMITTED',
        submittedAt: new Date('2026-08-05T09:00:00.000Z'),
        totalChargedCents: 40_000,
      })
    );
    const search = async (query: string): Promise<string[]> =>
      (
        await json<ListResponse<ClaimDto>>(
          await app.request(`/bff/v0/claims?${query}`, { headers: bearer(TOKENS.billerA) })
        )
      ).data.map((row) => row.id);

    expect(await search(`patientId=${PATIENT_ID}`)).toEqual([testId(30)]);
    expect(await search(`payerId=${OTHER_PAYER_ID}`)).toEqual([testId(31)]);
    expect(await search(`encounterId=${ENCOUNTER_ID}`)).toEqual([testId(30)]);
    expect(await search('status=SUBMITTED')).toEqual([testId(31)]);
    expect(
      await search('window=submittedAt&from=2026-08-01T00:00:00Z&to=2026-08-31T00:00:00Z')
    ).toEqual([testId(31)]);
    expect(await search('from=2020-01-01T00:00:00Z')).toEqual([testId(30), testId(31)]);
    expect(await search('sort=totalChargedCents&order=desc')).toEqual([testId(31), testId(30)]);
    expect(await search('sort=submittedAt')).toEqual([testId(31), testId(30)]);
  });

  it('reads, amends and 404s', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'Claim', makeClaimRow());

    const read = await json<ClaimDto>(
      await app.request(`/bff/v0/claims/${testId(30)}`, { headers: bearer(TOKENS.billerA) })
    );
    expect(read).toMatchObject({ status: 'DRAFT', controlNumbers: {}, submittedAt: null });

    const amended = await app.request(
      ...patch(`/bff/v0/claims/${testId(30)}`, TOKENS.billerA, {
        coverageId: testId(10),
        payerId: OTHER_PAYER_ID,
        frequency: 'REPLACEMENT',
        diagnosisCodes: ['J06.9', 'R05'],
        totalChargedCents: 16_000,
        totalPaidCents: 1_000,
        totalAdjustedCents: -500,
        patientResponsibilityCents: 250,
        controlNumbers: { ST: '0001' },
        snapshot: { built: true },
        statusReason: 'Rebuilt after a coding correction.',
      })
    );
    expect(amended.status).toBe(200);
    expect(await json<ClaimDto>(amended)).toMatchObject({
      frequency: 'REPLACEMENT',
      controlNumbers: { ST: '0001' },
      totals: {
        chargedCents: 16_000,
        paidCents: 1_000,
        adjustedCents: -500,
        patientResponsibilityCents: 250,
      },
    });

    expect(
      (await app.request(`/bff/v0/claims/${testId(999)}`, { headers: bearer(TOKENS.billerA) }))
        .status
    ).toBe(404);
  });

  it('refuses a clinician the write, and an unprivileged token everything', async () => {
    const { app } = createTestApp();

    const denied = await app.request(...post('/bff/v0/claims', TOKENS.clinicianA, CLAIM_BODY));
    expect(denied.status).toBe(403);
    expect((await json<ProblemDocument>(denied)).detail).toContain('claim.write');

    expect(
      (await app.request('/bff/v0/claims', { headers: bearer(UNPRIVILEGED_TOKEN) })).status
    ).toBe(403);
    expect((await app.request('/bff/v0/claims')).status).toBe(401);
  });

  it('422s a claim whose lines repeat a sequence', async () => {
    const { app } = createTestApp();
    const first = CLAIM_BODY.lines[0];
    const res = await app.request(
      ...post('/bff/v0/claims', TOKENS.billerA, { ...CLAIM_BODY, lines: [first, first] })
    );

    expect(res.status).toBe(422);
  });
});

describe('claim transitions', () => {
  it('scrubs a draft and refuses to scrub a scrubbed claim', async () => {
    const { app, dataset } = createTestApp();
    seed(
      dataset,
      'Claim',
      makeClaimRow({ id: testId(30) }),
      makeClaimRow({ id: testId(31), status: 'SCRUBBED' })
    );

    const ok = await app.request(...post(`/bff/v0/claims/${testId(30)}/scrub`, TOKENS.billerA));
    expect(ok.status).toBe(200);
    expect((await json<ClaimDto>(ok)).status).toBe('SCRUBBED');

    const refused = await app.request(
      ...post(`/bff/v0/claims/${testId(31)}/scrub`, TOKENS.billerA)
    );
    expect(refused.status).toBe(409);
    expect((await json<ProblemDocument>(refused)).type).toMatch(/invalid-transition$/);
  });

  it('submits a scrubbed claim, stamping the submission time', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'Claim', makeClaimRow({ status: 'SCRUBBED' }));

    const res = await app.request(
      ...post(`/bff/v0/claims/${testId(30)}/submit`, TOKENS.billerA, {
        statusReason: 'Batch 2026-08-13.',
      })
    );

    expect(res.status).toBe(200);
    const body = await json<ClaimDto>(res);
    expect(body.status).toBe('SUBMITTED');
    expect(body.submittedAt).toMatch(/T.*Z$/);
    expect(body.statusReason).toBe('Batch 2026-08-13.');
  });

  it('refuses to submit a claim that has not been scrubbed', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'Claim', makeClaimRow());

    const res = await app.request(...post(`/bff/v0/claims/${testId(30)}/submit`, TOKENS.billerA));

    expect(res.status).toBe(409);
    expect((await json<ProblemDocument>(res)).detail).toContain('SCRUBBED');
    expect(dataset.table('Claim')[0]?.status).toBe('DRAFT');
  });

  it('records an acknowledgement, then an adjudication, stamping each', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'Claim', makeClaimRow({ status: 'SUBMITTED' }));
    const status = (body: unknown): [string, RequestInit] =>
      post(`/bff/v0/claims/${testId(30)}/status`, TOKENS.billerA, body);

    const acked = await json<ClaimDto>(
      await app.request(...status({ status: 'ACKNOWLEDGED', source: '999' }))
    );
    expect(acked.acknowledgedAt).toMatch(/T.*Z$/);
    expect(acked.adjudicatedAt).toBeNull();

    const paid = await json<ClaimDto>(
      await app.request(
        ...status({ status: 'PAID', source: '835', detail: { checkNumber: 'EFT-90210' } })
      )
    );
    expect(paid.status).toBe('PAID');
    expect(paid.adjudicatedAt).toMatch(/T.*Z$/);
  });

  it('honours an occurredAt the payer stated', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'Claim', makeClaimRow({ status: 'SUBMITTED' }));

    const body = await json<ClaimDto>(
      await app.request(
        ...post(`/bff/v0/claims/${testId(30)}/status`, TOKENS.billerA, {
          status: 'REJECTED',
          source: '277',
          occurredAt: '2026-08-12T10:00:00.000Z',
          statusReason: 'Subscriber not found on the date of service.',
        })
      )
    );

    expect(body.status).toBe('REJECTED');
    // A rejection is not an adjudication: nothing was decided about the money.
    expect(body.adjudicatedAt).toBeNull();
    expect(dataset.table('ClaimStatusHistory')[0]?.occurredAt.toISOString()).toBe(
      '2026-08-12T10:00:00.000Z'
    );
  });

  it('refuses a move the table does not allow', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'Claim', makeClaimRow({ status: 'SUBMITTED' }));

    const res = await app.request(
      ...post(`/bff/v0/claims/${testId(30)}/status`, TOKENS.billerA, {
        status: 'PAID',
        source: 'user',
      })
    );

    expect(res.status).toBe(409);
    const body = await json<ProblemDocument>(res);
    expect(body.type).toMatch(/invalid-transition$/);
    expect(body.detail).toContain('ACKNOWLEDGED');
  });

  it('404s a transition on an unknown claim and 422s one with no status', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'Claim', makeClaimRow());

    expect(
      (await app.request(...post(`/bff/v0/claims/${testId(999)}/scrub`, TOKENS.billerA))).status
    ).toBe(404);
    expect(
      (await app.request(...post(`/bff/v0/claims/${testId(30)}/status`, TOKENS.billerA))).status
    ).toBe(422);
  });

  it('appends a history row for every move, and serves it oldest first', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'Claim', makeClaimRow());
    seed(dataset, 'ClaimStatusHistory', makeClaimHistoryRow());

    await app.request(...post(`/bff/v0/claims/${testId(30)}/scrub`, TOKENS.billerA));
    await app.request(...post(`/bff/v0/claims/${testId(30)}/submit`, TOKENS.billerA));

    const res = await app.request(`/bff/v0/claims/${testId(30)}/history`, {
      headers: bearer(TOKENS.billerA),
    });
    expect(res.status).toBe(200);
    const body = await json<ListResponse<ClaimStatusHistoryDto>>(res);
    expect(body.data.map((row) => row.status)).toEqual(['DRAFT', 'SCRUBBED', 'SUBMITTED']);
    expect(body.data[1]).toMatchObject({ source: 'system', byUserId: BILLER_SUBJECT });
  });
});

describe('GET /bff/v0/claims/:id/lines', () => {
  it('resolves as a literal sub-path, not as a claim id, and orders by sequence', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'Claim', makeClaimRow());
    seed(
      dataset,
      'ClaimLine',
      makeClaimLineRow({ id: testId(41), sequence: 2, code: '85025' }),
      makeClaimLineRow({ id: testId(40), sequence: 1 })
    );

    const res = await app.request(`/bff/v0/claims/${testId(30)}/lines`, {
      headers: bearer(TOKENS.billerA),
    });

    expect(res.status).toBe(200);
    const body = await json<ListResponse<ClaimLineDto>>(res);
    expect(body.data.map((line) => line.sequence)).toEqual([1, 2]);
    expect(body.page.total).toBe(2);
    expect(body.data[0]).toMatchObject({ serviceDateFrom: '2026-08-01', serviceDateTo: null });
  });

  it('404s the lines of a claim that does not exist', async () => {
    const { app } = createTestApp();
    const res = await app.request(`/bff/v0/claims/${testId(999)}/lines`, {
      headers: bearer(TOKENS.billerA),
    });

    expect(res.status).toBe(404);
  });

  it('403s a role without claim.read', async () => {
    const { app } = createTestApp();

    expect(
      (
        await app.request(`/bff/v0/claims/${testId(30)}/lines`, {
          headers: bearer(UNPRIVILEGED_TOKEN),
        })
      ).status
    ).toBe(403);
    expect((await app.request(`/bff/v0/claims/${testId(30)}/history`)).status).toBe(401);
  });
});

/* ----------------------------------------------------------------- payments */

describe('payments', () => {
  it('filters by patient, payer, remittance, status, source and a received window', async () => {
    const { app, dataset } = createTestApp();
    seed(
      dataset,
      'Payment',
      makePaymentRow({ id: testId(50) }),
      makePaymentRow({
        id: testId(51),
        patientId: null,
        payerId: PAYER_ID,
        remittanceId: testId(60),
        source: 'PAYER_ERA',
        status: 'POSTED',
        amountCents: 10_000,
        receivedAt: new Date('2026-08-12T09:00:00.000Z'),
      })
    );
    const search = async (query: string): Promise<string[]> =>
      (
        await json<ListResponse<PaymentDto>>(
          await app.request(`/bff/v0/payments?${query}`, { headers: bearer(TOKENS.billerA) })
        )
      ).data.map((row) => row.id);

    expect(await search(`patientId=${PATIENT_ID}`)).toEqual([testId(50)]);
    expect(await search(`payerId=${PAYER_ID}`)).toEqual([testId(51)]);
    expect(await search(`remittanceId=${testId(60)}`)).toEqual([testId(51)]);
    expect(await search('status=POSTED')).toEqual([testId(51)]);
    expect(await search('source=PATIENT')).toEqual([testId(50)]);
    expect(await search('from=2026-08-12T00:00:00Z')).toEqual([testId(51)]);
    expect(await search('to=2026-08-12T00:00:00Z')).toEqual([testId(50)]);
    expect(await search('order=asc')).toEqual([testId(50), testId(51)]);
    expect(await search('sort=amountCents&order=desc')).toEqual([testId(51), testId(50)]);
    expect(await search('sort=createdAt')).toEqual([testId(50), testId(51)]);
  });

  it('records a payment with its allocations in one call', async () => {
    const { app, dataset } = createTestApp();

    const res = await app.request(
      ...post('/bff/v0/payments', TOKENS.billerA, {
        ...PAYMENT_BODY,
        allocations: [
          { patientId: PATIENT_ID, claimId: testId(30), amountCents: 3_000 },
          { patientId: PATIENT_ID, chargeItemId: testId(20), amountCents: 2_000, note: 'Copay.' },
        ],
      })
    );

    expect(res.status).toBe(201);
    const body = await json<PaymentDto>(res);
    expect(res.headers.get('location')).toBe(`/bff/v0/payments/${body.id}`);
    expect(body).toMatchObject({ status: 'PENDING', currency: 'USD', postedAt: null });
    expect(dataset.table('PaymentAllocation')).toHaveLength(2);
    expect(dataset.table('PaymentAllocation').map((row) => row.paymentId)).toEqual([
      body.id,
      body.id,
    ]);
  });

  it('records a payment with nothing allocated yet', async () => {
    const { app, dataset } = createTestApp();

    const res = await app.request(...post('/bff/v0/payments', TOKENS.billerA, PAYMENT_BODY));

    expect(res.status).toBe(201);
    expect(await json<PaymentDto>(res)).toMatchObject({
      status: 'PENDING',
      payerId: null,
      remittanceId: null,
      reference: null,
      note: null,
      postedAt: null,
      postedById: null,
    });
    expect(dataset.table('PaymentAllocation')).toHaveLength(0);
  });

  it('reads, amends, 404s, 401s, 403s and 422s', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'Payment', makePaymentRow());

    expect(
      (
        await json<PaymentDto>(
          await app.request(`/bff/v0/payments/${testId(50)}`, { headers: bearer(TOKENS.billerA) })
        )
      ).adapterRef
    ).toBe('adapter-ref-testonly');

    const amended = await app.request(
      ...patch(`/bff/v0/payments/${testId(50)}`, TOKENS.billerA, {
        patientId: OTHER_PATIENT_ID,
        payerId: PAYER_ID,
        remittanceId: testId(60),
        method: 'CHECK',
        reference: 'CHK-1042',
        adapterRef: 'adapter-ref-two',
        receivedAt: '2026-08-11T09:00:00.000Z',
        note: 'Split cheque.',
      })
    );
    expect(amended.status).toBe(200);
    expect(await json<PaymentDto>(amended)).toMatchObject({
      method: 'CHECK',
      reference: 'CHK-1042',
      note: 'Split cheque.',
    });

    expect(
      (await app.request(`/bff/v0/payments/${testId(999)}`, { headers: bearer(TOKENS.billerA) }))
        .status
    ).toBe(404);
    expect((await app.request('/bff/v0/payments')).status).toBe(401);
    expect(
      (await app.request('/bff/v0/payments', { headers: bearer(UNPRIVILEGED_TOKEN) })).status
    ).toBe(403);
    expect(
      (
        await app.request(
          ...post('/bff/v0/payments', TOKENS.billerA, { ...PAYMENT_BODY, patientId: undefined })
        )
      ).status
    ).toBe(422);
  });
});

describe('payment transitions', () => {
  it('posts a pending payment, stamping the time and the author', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'Payment', makePaymentRow());

    const res = await app.request(
      ...post(`/bff/v0/payments/${testId(50)}/post`, TOKENS.billerA, { note: 'Batch deposit.' })
    );

    expect(res.status).toBe(200);
    const body = await json<PaymentDto>(res);
    expect(body).toMatchObject({
      status: 'POSTED',
      postedById: BILLER_SUBJECT,
      note: 'Batch deposit.',
    });
    expect(body.postedAt).toMatch(/T.*Z$/);
  });

  it('voids a pending payment and a posted one', async () => {
    const { app, dataset } = createTestApp();
    seed(
      dataset,
      'Payment',
      makePaymentRow({ id: testId(50) }),
      makePaymentRow({ id: testId(51), status: 'POSTED' })
    );

    for (const id of [testId(50), testId(51)]) {
      const res = await app.request(...post(`/bff/v0/payments/${id}/void`, TOKENS.billerA));
      expect(res.status).toBe(200);
      expect((await json<PaymentDto>(res)).status).toBe('VOIDED');
    }
  });

  it('refunds a posted payment', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'Payment', makePaymentRow({ status: 'POSTED' }));

    const res = await app.request(...post(`/bff/v0/payments/${testId(50)}/refund`, TOKENS.billerA));

    expect(res.status).toBe(200);
    expect((await json<PaymentDto>(res)).status).toBe('REFUNDED');
  });

  it.each([
    ['post', 'POSTED' as const],
    ['refund', 'REFUNDED' as const],
    ['void', 'VOIDED' as const],
  ])('refuses %s on a terminal payment', async (verb, status) => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'Payment', makePaymentRow({ status: 'FAILED' }));

    const res = await app.request(
      ...post(`/bff/v0/payments/${testId(50)}/${verb}`, TOKENS.billerA)
    );

    expect(res.status).toBe(409);
    const body = await json<ProblemDocument>(res);
    expect(body.type).toMatch(/invalid-transition$/);
    expect(body.detail).toContain(status);
  });

  it('refuses to refund a payment that was never posted', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'Payment', makePaymentRow());

    const res = await app.request(...post(`/bff/v0/payments/${testId(50)}/refund`, TOKENS.billerA));

    expect(res.status).toBe(409);
    expect(dataset.table('Payment')[0]?.status).toBe('PENDING');
  });

  it('404s a transition on an unknown payment', async () => {
    const { app } = createTestApp();
    const res = await app.request(...post(`/bff/v0/payments/${testId(999)}/post`, TOKENS.billerA));

    expect(res.status).toBe(404);
  });

  it('serves what a payment was applied to', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'Payment', makePaymentRow());
    seed(
      dataset,
      'PaymentAllocation',
      makeAllocationRow({ id: testId(56), amountCents: -1_000, adjustmentGroupCode: null }),
      makeAllocationRow({ id: testId(55) })
    );

    const res = await app.request(`/bff/v0/payments/${testId(50)}/allocations`, {
      headers: bearer(TOKENS.billerA),
    });

    expect(res.status).toBe(200);
    const body = await json<ListResponse<PaymentAllocationDto>>(res);
    expect(body.page.total).toBe(2);
    expect(body.data.map((row) => row.amountCents).sort((a, b) => a - b)).toEqual([-1_000, 5_000]);
    expect(body.data.some((row) => row.adjustmentGroupCode === 'CO')).toBe(true);
  });

  it('404s the allocations of a payment that does not exist', async () => {
    const { app } = createTestApp();
    const res = await app.request(`/bff/v0/payments/${testId(999)}/allocations`, {
      headers: bearer(TOKENS.billerA),
    });

    expect(res.status).toBe(404);
  });
});

/* -------------------------------------------------------------- remittances */

describe('remittances', () => {
  it('filters by payer, status and a received window, and sorts three ways', async () => {
    const { app, dataset } = createTestApp();
    seed(
      dataset,
      'Remittance',
      makeRemittanceRow({ id: testId(60) }),
      makeRemittanceRow({
        id: testId(61),
        payerId: OTHER_PAYER_ID,
        status: 'PARSED',
        totalPaidCents: 50_000,
        receivedAt: new Date('2026-08-12T09:00:00.000Z'),
      })
    );
    const search = async (query: string): Promise<string[]> =>
      (
        await json<ListResponse<RemittanceDto>>(
          await app.request(`/bff/v0/remittances?${query}`, { headers: bearer(TOKENS.billerA) })
        )
      ).data.map((row) => row.id);

    expect(await search(`payerId=${PAYER_ID}`)).toEqual([testId(60)]);
    expect(await search('status=PARSED')).toEqual([testId(61)]);
    expect(await search('to=2026-08-12T00:00:00Z')).toEqual([testId(60)]);
    expect(await search('from=2026-08-12T00:00:00Z')).toEqual([testId(61)]);
    expect(await search('order=asc')).toEqual([testId(60), testId(61)]);
    expect(await search('sort=totalPaidCents&order=desc')).toEqual([testId(61), testId(60)]);
    expect(await search('sort=createdAt')).toEqual([testId(60), testId(61)]);
  });

  it('writes the service lines in the same call and sums what was paid', async () => {
    const { app, dataset } = createTestApp();

    const res = await app.request(
      ...post('/bff/v0/remittances', TOKENS.billerA, {
        ...REMITTANCE_BODY,
        lines: [
          { sequence: 1, claimId: testId(30), paidCents: 10_000, matched: true },
          { sequence: 2, paidCents: 2_500 },
        ],
      })
    );

    expect(res.status).toBe(201);
    const body = await json<RemittanceDto>(res);
    expect(body).toMatchObject({ status: 'RECEIVED', totalPaidCents: 12_500, exceptionCount: 0 });
    expect(dataset.table('RemittanceLine')).toHaveLength(2);
    expect(dataset.table('RemittanceLine')[1]).toMatchObject({ matched: false, chargedCents: 0 });
  });

  it('records an advice with no lines at all, defaulting every column', async () => {
    const { app } = createTestApp();

    const res = await app.request(...post('/bff/v0/remittances', TOKENS.billerA, REMITTANCE_BODY));

    expect(res.status).toBe(201);
    const body = await json<RemittanceDto>(res);
    expect(res.headers.get('location')).toBe(`/bff/v0/remittances/${body.id}`);
    expect(body).toMatchObject({
      status: 'RECEIVED',
      totalPaidCents: 0,
      exceptionCount: 0,
      paidAt: null,
      rawStorageKey: null,
      parsed: null,
      postedAt: null,
      postedById: null,
    });

    const anonymous = await json<RemittanceDto>(
      await app.request(...post('/bff/v0/remittances', TOKENS.billerA, { payerId: PAYER_ID }))
    );
    expect(anonymous.checkOrEftNumber).toBeNull();
  });

  it('treats a line that states no payment as having paid nothing', async () => {
    const { app } = createTestApp();

    const body = await json<RemittanceDto>(
      await app.request(
        ...post('/bff/v0/remittances', TOKENS.billerA, {
          ...REMITTANCE_BODY,
          lines: [{ sequence: 1 }, { sequence: 2, paidCents: 4_000 }],
        })
      )
    );

    expect(body.totalPaidCents).toBe(4_000);
  });

  it('keeps a stated total rather than summing the lines', async () => {
    const { app } = createTestApp();

    const body = await json<RemittanceDto>(
      await app.request(
        ...post('/bff/v0/remittances', TOKENS.billerA, {
          ...REMITTANCE_BODY,
          totalPaidCents: 25_000,
          receivedAt: '2026-08-11T09:00:00.000Z',
          paidAt: '2026-08-11T09:00:00.000Z',
          rawStorageKey: 'era/2026/08/11.edi',
          parsed: { segments: 12 },
          status: 'EXCEPTIONS',
          lines: [{ sequence: 1, paidCents: 1_000 }],
        })
      )
    );

    expect(body).toMatchObject({
      totalPaidCents: 25_000,
      status: 'EXCEPTIONS',
      rawStorageKey: 'era/2026/08/11.edi',
      parsed: { segments: 12 },
    });
  });

  it('reads, amends, 404s, 401s, 403s and 422s', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'Remittance', makeRemittanceRow());

    const amended = await app.request(
      ...patch(`/bff/v0/remittances/${testId(60)}`, TOKENS.billerA, {
        checkOrEftNumber: 'EFT-90211',
        totalPaidCents: 11_000,
        paidAt: '2026-08-12T09:00:00.000Z',
        rawStorageKey: 'era/2026/08/12.edi',
        parsed: { segments: 42 },
      })
    );
    expect(amended.status).toBe(200);
    expect(await json<RemittanceDto>(amended)).toMatchObject({
      checkOrEftNumber: 'EFT-90211',
      parsed: { segments: 42 },
    });

    expect(
      (
        await app.request(`/bff/v0/remittances/${testId(999)}`, {
          headers: bearer(TOKENS.billerA),
        })
      ).status
    ).toBe(404);
    expect((await app.request('/bff/v0/remittances')).status).toBe(401);
    expect(
      (await app.request('/bff/v0/remittances', { headers: bearer(UNPRIVILEGED_TOKEN) })).status
    ).toBe(403);
    expect(
      (await app.request(...post('/bff/v0/remittances', TOKENS.billerA, { payerId: 'nope' })))
        .status
    ).toBe(422);
  });

  it('serves the service lines in sequence, and 404s an unknown advice', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'Remittance', makeRemittanceRow());
    seed(
      dataset,
      'RemittanceLine',
      makeRemittanceLineRow({
        id: testId(66),
        sequence: 2,
        matched: false,
        claimId: null,
        adjustmentGroupCode: null,
        serviceDateFrom: null,
      }),
      makeRemittanceLineRow({ id: testId(65), sequence: 1 })
    );

    const res = await app.request(`/bff/v0/remittances/${testId(60)}/lines`, {
      headers: bearer(TOKENS.billerA),
    });
    expect(res.status).toBe(200);
    const body = await json<ListResponse<RemittanceLineDto>>(res);
    expect(body.data.map((line) => line.sequence)).toEqual([1, 2]);
    expect(body.data[0]).toMatchObject({
      adjustmentGroupCode: 'CO',
      remarkCodes: ['N130'],
      serviceDateFrom: '2026-08-01',
    });
    expect(body.data[1]).toMatchObject({ adjustmentGroupCode: null, serviceDateFrom: null });

    expect(
      (
        await app.request(`/bff/v0/remittances/${testId(999)}/lines`, {
          headers: bearer(TOKENS.billerA),
        })
      ).status
    ).toBe(404);
  });
});

describe('remittance parse and post', () => {
  it('parses a received advice and counts the lines it could not match', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'Remittance', makeRemittanceRow());
    seed(
      dataset,
      'RemittanceLine',
      makeRemittanceLineRow({ id: testId(65), sequence: 1, matched: true }),
      makeRemittanceLineRow({ id: testId(66), sequence: 2, matched: false, claimId: null })
    );

    const res = await app.request(
      ...post(`/bff/v0/remittances/${testId(60)}/parse`, TOKENS.billerA)
    );

    expect(res.status).toBe(200);
    const body = await json<RemittanceParseResult>(res);
    expect(body).toMatchObject({ lineCount: 2, matchedCount: 1, exceptionCount: 1 });
    expect(body.remittance).toMatchObject({ status: 'PARSED', exceptionCount: 1 });
  });

  it('refuses to parse an advice that was already parsed', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'Remittance', makeRemittanceRow({ status: 'PARSED' }));

    const res = await app.request(
      ...post(`/bff/v0/remittances/${testId(60)}/parse`, TOKENS.billerA)
    );

    expect(res.status).toBe(409);
    expect((await json<ProblemDocument>(res)).type).toMatch(/invalid-transition$/);
  });

  it('posts a parsed advice, creating one payment and an allocation per matched line', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'Claim', makeClaimRow({ status: 'SUBMITTED' }));
    seed(dataset, 'Remittance', makeRemittanceRow({ status: 'PARSED', totalPaidCents: 10_000 }));
    seed(dataset, 'RemittanceLine', makeRemittanceLineRow({ id: testId(65), sequence: 1 }));

    const res = await app.request(
      ...post(`/bff/v0/remittances/${testId(60)}/post`, TOKENS.billerA)
    );

    expect(res.status).toBe(200);
    const body = await json<RemittancePostResult>(res);
    expect(body).toMatchObject({ allocationCount: 1, allocatedCents: 10_000, skippedLineCount: 0 });
    expect(body.remittance).toMatchObject({ status: 'POSTED', postedById: BILLER_SUBJECT });
    expect(body.payment).toMatchObject({
      source: 'PAYER_ERA',
      method: 'EFT',
      status: 'POSTED',
      amountCents: 10_000,
      reference: 'EFT-90210',
      remittanceId: testId(60),
      postedById: BILLER_SUBJECT,
    });
    expect(dataset.table('PaymentAllocation')).toHaveLength(1);
    expect(dataset.table('PaymentAllocation')[0]).toMatchObject({
      patientId: PATIENT_ID,
      claimId: testId(30),
      amountCents: 10_000,
      adjustmentGroupCode: 'CO',
      adjustmentReasonCode: '45',
    });
  });

  it('reports the lines it skipped rather than hiding them', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'Claim', makeClaimRow());
    seed(dataset, 'Remittance', makeRemittanceRow({ status: 'EXCEPTIONS', totalPaidCents: 0 }));
    seed(
      dataset,
      'RemittanceLine',
      // Matched and payable: becomes an allocation.
      makeRemittanceLineRow({ id: testId(65), sequence: 1 }),
      // Never matched.
      makeRemittanceLineRow({ id: testId(66), sequence: 2, matched: false, claimId: null }),
      // Matched, but names a claim this organisation cannot see.
      makeRemittanceLineRow({ id: testId(67), sequence: 3, claimId: testId(998) }),
      // Matched to a claim, but paid nothing.
      makeRemittanceLineRow({ id: testId(68), sequence: 4, paidCents: 0 }),
      // Matched, with no claim line and no adjustment codes.
      makeRemittanceLineRow({
        id: testId(69),
        sequence: 5,
        claimLineId: testId(40),
        adjustmentGroupCode: null,
        adjustmentReasonCode: null,
        paidCents: 500,
      })
    );

    const body = await json<RemittancePostResult>(
      await app.request(
        ...post(`/bff/v0/remittances/${testId(60)}/post`, TOKENS.billerA, {
          method: 'CHECK',
        })
      )
    );

    expect(body).toMatchObject({
      allocationCount: 2,
      allocatedCents: 10_500,
      skippedLineCount: 3,
    });
    // No total was stated, so the payment holds at least what it hands out.
    expect(body.payment).toMatchObject({ amountCents: 10_500, method: 'CHECK' });
    expect(dataset.table('PaymentAllocation')[1]).toMatchObject({
      claimLineId: testId(40),
      adjustmentGroupCode: null,
    });
  });

  it('posts an advice that arrived with no cheque or trace number', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'Claim', makeClaimRow());
    seed(
      dataset,
      'Remittance',
      makeRemittanceRow({ status: 'PARSED', checkOrEftNumber: null, totalPaidCents: 10_000 })
    );
    seed(dataset, 'RemittanceLine', makeRemittanceLineRow({ id: testId(65), sequence: 1 }));

    const body = await json<RemittancePostResult>(
      await app.request(...post(`/bff/v0/remittances/${testId(60)}/post`, TOKENS.billerA))
    );

    expect(body.payment.reference).toBeNull();
    expect(body.allocationCount).toBe(1);
  });

  it('refuses to post an advice nothing has parsed, leaving no payment behind', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'Remittance', makeRemittanceRow());

    const res = await app.request(
      ...post(`/bff/v0/remittances/${testId(60)}/post`, TOKENS.billerA)
    );

    expect(res.status).toBe(409);
    expect((await json<ProblemDocument>(res)).detail).toContain('PARSED');
    expect(dataset.table('Payment')).toHaveLength(0);
  });

  it('404s parse and post on an unknown advice', async () => {
    const { app } = createTestApp();

    expect(
      (await app.request(...post(`/bff/v0/remittances/${testId(999)}/parse`, TOKENS.billerA)))
        .status
    ).toBe(404);
    expect(
      (await app.request(...post(`/bff/v0/remittances/${testId(999)}/post`, TOKENS.billerA))).status
    ).toBe(404);
  });
});

/* --------------------------------------------------------------- statements */

describe('statements', () => {
  it('filters by patient, status, dunning cycle and a generated window', async () => {
    const { app, dataset } = createTestApp();
    seed(
      dataset,
      'Statement',
      makeStatementRow({ id: testId(70) }),
      makeStatementRow({
        id: testId(71),
        patientId: OTHER_PATIENT_ID,
        status: 'SENT',
        dunningCycle: 3,
        balanceCents: 40_000,
        generatedAt: new Date('2026-08-12T09:00:00.000Z'),
      })
    );
    const search = async (query: string): Promise<string[]> =>
      (
        await json<ListResponse<StatementDto>>(
          await app.request(`/bff/v0/statements?${query}`, { headers: bearer(TOKENS.billerA) })
        )
      ).data.map((row) => row.id);

    expect(await search(`patientId=${PATIENT_ID}`)).toEqual([testId(70)]);
    expect(await search('status=SENT')).toEqual([testId(71)]);
    expect(await search('dunningCycle=3')).toEqual([testId(71)]);
    expect(await search('from=2026-08-10T00:00:00Z')).toEqual([testId(71)]);
    expect(await search('to=2026-08-10T00:00:00Z')).toEqual([testId(70)]);
    expect(await search('order=asc')).toEqual([testId(70), testId(71)]);
    expect(await search('sort=balanceCents&order=desc')).toEqual([testId(71), testId(70)]);
    expect(await search('sort=createdAt')).toEqual([testId(70), testId(71)]);
  });

  it('records, reads and amends a statement without ever emitting the pay-link token', async () => {
    const { app, dataset } = createTestApp();
    seed(
      dataset,
      'Statement',
      makeStatementRow({ payLinkToken: 'a'.repeat(40), payLinkExpiresAt: new Date() })
    );

    const created = await app.request(
      ...post('/bff/v0/statements', TOKENS.billerA, STATEMENT_BODY)
    );
    expect(created.status).toBe(201);
    const createdBody = await json<StatementDto>(created);
    expect(created.headers.get('location')).toBe(`/bff/v0/statements/${createdBody.id}`);
    expect(createdBody).toMatchObject({
      status: 'DRAFT',
      // Zero notices, because none has been sent. This asserted 1 while the
      // column defaulted to 1, which claimed a notice for a statement that had
      // never left the building.
      dunningCycle: 0,
      deliveredVia: null,
      deliveredAt: null,
      payLinkSet: false,
    });

    const read = await json<StatementDto>(
      await app.request(`/bff/v0/statements/${testId(70)}`, { headers: bearer(TOKENS.billerA) })
    );
    expect(read).toMatchObject({ payLinkSet: true, periodStart: '2026-07-01' });
    expect(JSON.stringify(read)).not.toContain('aaaa');

    const amended = await app.request(
      ...patch(`/bff/v0/statements/${testId(70)}`, TOKENS.billerA, {
        balanceCents: 3_000,
        dunningCycle: 2,
        periodStart: '2026-08-01',
        periodEnd: '2026-08-31',
        pdfStorageKey: 'statements/2026/08.pdf',
      })
    );
    expect(amended.status).toBe(200);
    expect(await json<StatementDto>(amended)).toMatchObject({
      balanceCents: 3_000,
      dunningCycle: 2,
      periodEnd: '2026-08-31',
    });
  });

  it('404s, 401s, 403s and 422s', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'Statement', makeStatementRow());

    expect(
      (await app.request(`/bff/v0/statements/${testId(999)}`, { headers: bearer(TOKENS.billerA) }))
        .status
    ).toBe(404);
    expect((await app.request('/bff/v0/statements')).status).toBe(401);
    expect(
      (await app.request('/bff/v0/statements', { headers: bearer(UNPRIVILEGED_TOKEN) })).status
    ).toBe(403);
    expect(
      (
        await app.request(
          ...patch(`/bff/v0/statements/${testId(70)}`, TOKENS.billerA, {
            periodStart: '2026-09-01',
            periodEnd: '2026-08-01',
          })
        )
      ).status
    ).toBe(422);
  });
});

describe('statement transitions', () => {
  it('generates a draft, stamping the time and taking a refreshed balance', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'Statement', makeStatementRow());

    const res = await app.request(
      ...post(`/bff/v0/statements/${testId(70)}/generate`, TOKENS.billerA, {
        balanceCents: 4_000,
        pdfStorageKey: 'statements/2026/08/testina.pdf',
      })
    );

    expect(res.status).toBe(200);
    const body = await json<StatementDto>(res);
    expect(body).toMatchObject({
      status: 'GENERATED',
      balanceCents: 4_000,
      pdfStorageKey: 'statements/2026/08/testina.pdf',
    });
    expect(body.generatedAt).toMatch(/T.*Z$/);
  });

  it('sends a generated statement, recording the channel and the time', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'Statement', makeStatementRow({ status: 'GENERATED' }));

    const res = await app.request(
      ...post(`/bff/v0/statements/${testId(70)}/send`, TOKENS.billerA, {
        deliveredVia: 'EMAIL',
        payLinkToken: 'b'.repeat(40),
        payLinkExpiresAt: '2026-09-13T09:00:00.000Z',
      })
    );

    expect(res.status).toBe(200);
    const body = await json<StatementDto>(res);
    expect(body).toMatchObject({
      status: 'SENT',
      deliveredVia: 'EMAIL',
      payLinkSet: true,
      payLinkExpiresAt: '2026-09-13T09:00:00.000Z',
    });
    expect(body.deliveredAt).toMatch(/T.*Z$/);
    expect(JSON.stringify(body)).not.toContain('bbbb');
  });

  it('generates and sends with nothing but the move itself', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'Statement', makeStatementRow());

    const generated = await app.request(
      ...post(`/bff/v0/statements/${testId(70)}/generate`, TOKENS.billerA)
    );
    expect(generated.status).toBe(200);
    expect(await json<StatementDto>(generated)).toMatchObject({
      status: 'GENERATED',
      balanceCents: 2_500,
      pdfStorageKey: null,
    });

    const sent = await app.request(
      ...post(`/bff/v0/statements/${testId(70)}/send`, TOKENS.billerA, { deliveredVia: 'PRINT' })
    );
    expect(sent.status).toBe(200);
    expect(await json<StatementDto>(sent)).toMatchObject({
      status: 'SENT',
      deliveredVia: 'PRINT',
      payLinkSet: false,
      payLinkExpiresAt: null,
    });
  });

  it('refuses a pay link with no expiry', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'Statement', makeStatementRow({ status: 'GENERATED' }));

    const res = await app.request(
      ...post(`/bff/v0/statements/${testId(70)}/send`, TOKENS.billerA, {
        deliveredVia: 'SMS',
        payLinkToken: 'c'.repeat(40),
      })
    );

    expect(res.status).toBe(422);
    expect((await json<ProblemDocument>(res)).errors?.[0]?.path).toBe('payLinkExpiresAt');
  });

  it('refuses to regenerate a sent statement and to send a draft one', async () => {
    const { app, dataset } = createTestApp();
    seed(
      dataset,
      'Statement',
      makeStatementRow({ id: testId(70), status: 'SENT' }),
      makeStatementRow({ id: testId(71) })
    );

    const regenerate = await app.request(
      ...post(`/bff/v0/statements/${testId(70)}/generate`, TOKENS.billerA)
    );
    expect(regenerate.status).toBe(409);
    expect((await json<ProblemDocument>(regenerate)).type).toMatch(/invalid-transition$/);

    const send = await app.request(
      ...post(`/bff/v0/statements/${testId(71)}/send`, TOKENS.billerA, { deliveredVia: 'PRINT' })
    );
    expect(send.status).toBe(409);
    expect((await json<ProblemDocument>(send)).detail).toContain('GENERATED');
  });

  it('404s a transition on an unknown statement and 422s a send with no channel', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'Statement', makeStatementRow({ status: 'GENERATED' }));

    expect(
      (await app.request(...post(`/bff/v0/statements/${testId(999)}/generate`, TOKENS.billerA)))
        .status
    ).toBe(404);
    expect(
      (await app.request(...post(`/bff/v0/statements/${testId(70)}/send`, TOKENS.billerA))).status
    ).toBe(422);
  });
});

describe('a patch mentions only what it changes', () => {
  it.each([
    ['coverage', 'Coverage', makeCoverageRow(), testId(10), { planName: 'Testline Mutual Plus' }],
    ['coverage', 'Coverage', makeCoverageRow(), testId(10), { groupNumber: 'GRP-90' }],
    ['charges', 'ChargeItem', makeChargeRow(), testId(20), { display: 'Office visit, brief' }],
    ['charges', 'ChargeItem', makeChargeRow(), testId(20), { code: '99212' }],
    ['claims', 'Claim', makeClaimRow(), testId(30), { statusReason: 'Held for review.' }],
    ['claims', 'Claim', makeClaimRow(), testId(30), { payerId: OTHER_PAYER_ID }],
    ['payments', 'Payment', makePaymentRow(), testId(50), { note: 'Deposited late.' }],
    ['payments', 'Payment', makePaymentRow(), testId(50), { reference: 'CHK-1043' }],
    ['remittances', 'Remittance', makeRemittanceRow(), testId(60), { totalPaidCents: 9_000 }],
    ['remittances', 'Remittance', makeRemittanceRow(), testId(60), { checkOrEftNumber: 'EFT-1' }],
    ['statements', 'Statement', makeStatementRow(), testId(70), { dunningCycle: 2 }],
    ['statements', 'Statement', makeStatementRow(), testId(70), { balanceCents: 4_000 }],
  ] as const)('leaves the rest of a %s alone (case %#)', async (segment, model, row, id, body) => {
    const { app, dataset } = createTestApp();
    seed(dataset, model, row);

    const res = await app.request(...patch(`/bff/v0/${segment}/${id}`, TOKENS.billerA, body));

    expect(res.status).toBe(200);
    expect(await json<Record<string, unknown>>(res)).toMatchObject(body);
  });
});

/* -------------------------------------------------------------------- audit */

describe('audit', () => {
  it('records a create as a transactional write naming the aggregate', async () => {
    const { app, sink } = createTestApp();
    await app.request(...post('/bff/v0/claims', TOKENS.billerA, CLAIM_BODY));

    expect(sink.writes()[0]).toMatchObject({
      tenantId: DEMO_TENANT_A,
      transactional: true,
      event: {
        action: 'claim.created',
        targetType: 'Claim',
        patientId: PATIENT_ID,
        encounterId: ENCOUNTER_ID,
        metadata: { status: 'DRAFT', payerId: PAYER_ID, totalChargedCents: 15_700 },
      },
    });
  });

  it('records a transition as a status move plus the history row it wrote', async () => {
    const { app, dataset, sink } = createTestApp();
    seed(dataset, 'Claim', makeClaimRow({ status: 'SCRUBBED' }));

    await app.request(...post(`/bff/v0/claims/${testId(30)}/submit`, TOKENS.billerA));

    expect(sink.writes().map((entry) => entry.event.action)).toEqual([
      'claim.updated',
      'claimStatus.created',
    ]);
    expect(sink.writes()[0]?.event.metadata).toMatchObject({
      statusFrom: 'SCRUBBED',
      statusTo: 'SUBMITTED',
    });
  });

  it('records a charge void with its facility and its status move', async () => {
    const { app, dataset, sink } = createTestApp();
    seed(dataset, 'ChargeItem', makeChargeRow());

    await app.request(
      ...post(`/bff/v0/charges/${testId(20)}/void`, TOKENS.billerA, { voidReason: 'Duplicate.' })
    );

    expect(sink.writes()[0]?.event).toMatchObject({
      action: 'charge.updated',
      targetType: 'ChargeItem',
      facilityId: DEMO_FACILITY_A,
      encounterId: ENCOUNTER_ID,
      metadata: { statusFrom: 'OPEN', statusTo: 'VOIDED' },
    });
  });

  it('emits one batched read event per request, naming the right target type', async () => {
    const { app, dataset, sink } = createTestApp();
    seed(
      dataset,
      'Statement',
      makeStatementRow({ id: testId(70) }),
      makeStatementRow({ id: testId(71) })
    );

    await app.request('/bff/v0/statements', { headers: bearer(TOKENS.billerA) });

    expect(sink.reads()).toHaveLength(1);
    expect(sink.reads()[0]?.event).toMatchObject({
      action: 'phi.read',
      patientId: PATIENT_ID,
      metadata: { targetCount: 2, targets: [{ type: 'Statement' }, { type: 'Statement' }] },
    });
  });

  it('records an amendment that moves nothing as an update with no status change', async () => {
    const { app, dataset, sink } = createTestApp();
    seed(dataset, 'Coverage', makeCoverageRow());

    await app.request(
      ...patch(`/bff/v0/coverage/${testId(10)}`, TOKENS.billerA, { copayCents: 1 })
    );

    const metadata = sink.writes()[0]?.event.metadata ?? {};
    expect(metadata).toMatchObject({ fields: ['copayCents'] });
    expect(metadata).not.toHaveProperty('statusFrom');
  });
});

/* ---------------------------------------------------- specs: where and orderBy */

describe('the specs agree with themselves', () => {
  it('turns every filter into the Prisma where the in-memory filter mirrors', () => {
    expect(
      financialSpecs.coverages.where({
        page: 1,
        pageSize: 25,
        sort: 'rank',
        order: 'asc',
        patientId: PATIENT_ID,
        payerId: PAYER_ID,
        rank: 'PRIMARY',
        status: 'ACTIVE',
      })
    ).toEqual({ patientId: PATIENT_ID, payerId: PAYER_ID, rank: 'PRIMARY', status: 'ACTIVE' });

    expect(
      financialSpecs.charges.where({
        page: 1,
        pageSize: 25,
        sort: 'serviceDate',
        order: 'asc',
        patientId: PATIENT_ID,
        encounterId: ENCOUNTER_ID,
        facilityId: DEMO_FACILITY_A,
        status: 'OPEN',
        from: new Date('2026-08-01T00:00:00.000Z'),
      })
    ).toMatchObject({ status: 'OPEN', serviceDate: { gte: new Date('2026-08-01T00:00:00.000Z') } });

    expect(
      financialSpecs.claims.where({
        page: 1,
        pageSize: 25,
        sort: 'createdAt',
        order: 'asc',
        window: 'submittedAt',
        patientId: PATIENT_ID,
        payerId: PAYER_ID,
        encounterId: ENCOUNTER_ID,
        status: 'SUBMITTED',
        to: new Date('2026-09-01T00:00:00.000Z'),
      })
    ).toEqual({
      patientId: PATIENT_ID,
      payerId: PAYER_ID,
      encounterId: ENCOUNTER_ID,
      status: { in: ['SUBMITTED'] },
      submittedAt: { lt: new Date('2026-09-01T00:00:00.000Z') },
    });

    expect(
      financialSpecs.claims.where({
        page: 1,
        pageSize: 25,
        sort: 'createdAt',
        order: 'asc',
        window: 'createdAt',
        from: new Date('2026-08-01T00:00:00.000Z'),
      })
    ).toEqual({ createdAt: { gte: new Date('2026-08-01T00:00:00.000Z') } });

    expect(
      financialSpecs.claims.where({
        page: 1,
        pageSize: 25,
        sort: 'createdAt',
        order: 'asc',
        window: 'createdAt',
      })
    ).toEqual({});

    expect(
      financialSpecs.claimLines.where({
        page: 1,
        pageSize: 25,
        sort: 'sequence',
        order: 'asc',
        claimId: testId(30),
        chargeItemId: testId(20),
      })
    ).toEqual({ claimId: { in: [testId(30)] }, chargeItemId: testId(20) });

    expect(
      financialSpecs.claimStatusHistory.where({
        page: 1,
        pageSize: 25,
        sort: 'occurredAt',
        order: 'asc',
        claimId: testId(30),
        status: 'PAID',
      })
    ).toEqual({ claimId: testId(30), status: 'PAID' });

    expect(
      financialSpecs.payments.where({
        page: 1,
        pageSize: 25,
        sort: 'receivedAt',
        order: 'asc',
        patientId: PATIENT_ID,
        payerId: PAYER_ID,
        remittanceId: testId(60),
        status: 'POSTED',
        source: 'PAYER_ERA',
        from: new Date('2026-08-01T00:00:00.000Z'),
      })
    ).toMatchObject({
      status: 'POSTED',
      source: 'PAYER_ERA',
      receivedAt: { gte: new Date('2026-08-01T00:00:00.000Z') },
    });

    expect(
      financialSpecs.paymentAllocations.where({
        page: 1,
        pageSize: 25,
        sort: 'appliedAt',
        order: 'asc',
        paymentId: testId(50),
        patientId: PATIENT_ID,
        claimId: testId(30),
      })
    ).toEqual({ paymentId: testId(50), patientId: PATIENT_ID, claimId: testId(30) });

    expect(
      financialSpecs.remittances.where({
        page: 1,
        pageSize: 25,
        sort: 'receivedAt',
        order: 'asc',
        payerId: PAYER_ID,
        status: 'PARSED',
        from: new Date('2026-08-01T00:00:00.000Z'),
      })
    ).toEqual({
      payerId: PAYER_ID,
      status: 'PARSED',
      receivedAt: { gte: new Date('2026-08-01T00:00:00.000Z') },
    });

    expect(
      financialSpecs.remittanceLines.where({
        page: 1,
        pageSize: 25,
        sort: 'sequence',
        order: 'asc',
        remittanceId: testId(60),
        claimId: testId(30),
        matched: false,
      })
    ).toEqual({ remittanceId: testId(60), claimId: testId(30), matched: false });

    expect(
      financialSpecs.statements.where({
        page: 1,
        pageSize: 25,
        sort: 'generatedAt',
        order: 'asc',
        patientId: PATIENT_ID,
        status: 'SENT',
        dunningCycle: 2,
        from: new Date('2026-08-01T00:00:00.000Z'),
      })
    ).toEqual({
      patientId: PATIENT_ID,
      status: 'SENT',
      dunningCycle: 2,
      generatedAt: { gte: new Date('2026-08-01T00:00:00.000Z') },
    });
  });

  it('always tie-breaks the ordering on id, whatever the sort key', () => {
    const orderings = [
      financialSpecs.coverages.orderBy({ page: 1, pageSize: 25, sort: 'rank', order: 'asc' }),
      financialSpecs.coverages.orderBy({
        page: 1,
        pageSize: 25,
        sort: 'effectiveFrom',
        order: 'asc',
      }),
      financialSpecs.coverages.orderBy({ page: 1, pageSize: 25, sort: 'createdAt', order: 'asc' }),
      financialSpecs.charges.orderBy({ page: 1, pageSize: 25, sort: 'serviceDate', order: 'asc' }),
      financialSpecs.charges.orderBy({
        page: 1,
        pageSize: 25,
        sort: 'totalPriceCents',
        order: 'asc',
      }),
      financialSpecs.charges.orderBy({ page: 1, pageSize: 25, sort: 'createdAt', order: 'asc' }),
      financialSpecs.claims.orderBy({
        page: 1,
        pageSize: 25,
        sort: 'createdAt',
        order: 'asc',
        window: 'createdAt',
      }),
      financialSpecs.claims.orderBy({
        page: 1,
        pageSize: 25,
        sort: 'submittedAt',
        order: 'asc',
        window: 'createdAt',
      }),
      financialSpecs.claims.orderBy({
        page: 1,
        pageSize: 25,
        sort: 'totalChargedCents',
        order: 'asc',
        window: 'createdAt',
      }),
      financialSpecs.claimLines.orderBy({ page: 1, pageSize: 25, sort: 'sequence', order: 'asc' }),
      financialSpecs.claimLines.orderBy({
        page: 1,
        pageSize: 25,
        sort: 'chargedCents',
        order: 'asc',
      }),
      financialSpecs.claimLines.orderBy({ page: 1, pageSize: 25, sort: 'createdAt', order: 'asc' }),
      financialSpecs.claimStatusHistory.orderBy({
        page: 1,
        pageSize: 25,
        sort: 'occurredAt',
        order: 'asc',
      }),
      financialSpecs.claimStatusHistory.orderBy({
        page: 1,
        pageSize: 25,
        sort: 'createdAt',
        order: 'asc',
      }),
      financialSpecs.payments.orderBy({ page: 1, pageSize: 25, sort: 'receivedAt', order: 'asc' }),
      financialSpecs.payments.orderBy({ page: 1, pageSize: 25, sort: 'amountCents', order: 'asc' }),
      financialSpecs.payments.orderBy({ page: 1, pageSize: 25, sort: 'createdAt', order: 'asc' }),
      financialSpecs.paymentAllocations.orderBy({
        page: 1,
        pageSize: 25,
        sort: 'appliedAt',
        order: 'asc',
      }),
      financialSpecs.paymentAllocations.orderBy({
        page: 1,
        pageSize: 25,
        sort: 'amountCents',
        order: 'asc',
      }),
      financialSpecs.paymentAllocations.orderBy({
        page: 1,
        pageSize: 25,
        sort: 'createdAt',
        order: 'asc',
      }),
      financialSpecs.remittances.orderBy({
        page: 1,
        pageSize: 25,
        sort: 'receivedAt',
        order: 'asc',
      }),
      financialSpecs.remittances.orderBy({
        page: 1,
        pageSize: 25,
        sort: 'totalPaidCents',
        order: 'asc',
      }),
      financialSpecs.remittances.orderBy({
        page: 1,
        pageSize: 25,
        sort: 'createdAt',
        order: 'asc',
      }),
      financialSpecs.remittanceLines.orderBy({
        page: 1,
        pageSize: 25,
        sort: 'sequence',
        order: 'asc',
      }),
      financialSpecs.remittanceLines.orderBy({
        page: 1,
        pageSize: 25,
        sort: 'paidCents',
        order: 'asc',
      }),
      financialSpecs.remittanceLines.orderBy({
        page: 1,
        pageSize: 25,
        sort: 'createdAt',
        order: 'asc',
      }),
      financialSpecs.statements.orderBy({
        page: 1,
        pageSize: 25,
        sort: 'generatedAt',
        order: 'asc',
      }),
      financialSpecs.statements.orderBy({
        page: 1,
        pageSize: 25,
        sort: 'balanceCents',
        order: 'asc',
      }),
      financialSpecs.statements.orderBy({ page: 1, pageSize: 25, sort: 'createdAt', order: 'asc' }),
    ];

    for (const ordering of orderings) {
      expect(Array.isArray(ordering) ? ordering.at(-1) : ordering).toEqual({ id: 'asc' });
    }
  });

  it('narrows to nothing when a list carries no filters at all', () => {
    const paged = { page: 1, pageSize: 25, order: 'asc' } as const;

    expect(financialSpecs.coverages.where({ ...paged, sort: 'rank' })).toEqual({});
    expect(financialSpecs.charges.where({ ...paged, sort: 'serviceDate' })).toEqual({});
    expect(financialSpecs.claimLines.where({ ...paged, sort: 'sequence' })).toEqual({});
    expect(financialSpecs.claimStatusHistory.where({ ...paged, sort: 'occurredAt' })).toEqual({});
    expect(financialSpecs.payments.where({ ...paged, sort: 'receivedAt' })).toEqual({});
    expect(financialSpecs.paymentAllocations.where({ ...paged, sort: 'appliedAt' })).toEqual({});
    expect(financialSpecs.remittances.where({ ...paged, sort: 'receivedAt' })).toEqual({});
    expect(financialSpecs.remittanceLines.where({ ...paged, sort: 'sequence' })).toEqual({});
    expect(financialSpecs.statements.where({ ...paged, sort: 'generatedAt' })).toEqual({});
  });

  it('states the natural keys the database enforces', () => {
    const line = {
      claimId: testId(30),
      chargeItemId: testId(20),
      sequence: 1,
      code: '99213',
      chargedCents: 12_500,
      serviceDateFrom: SERVICE_DAY,
    };

    expect(financialSpecs.claimLines.uniqueBy?.where(line)).toEqual({
      claimId: testId(30),
      sequence: 1,
    });
    expect(financialSpecs.claimLines.uniqueBy?.message(line)).toContain('already exists');
    expect(
      financialSpecs.remittanceLines.uniqueBy?.where({ remittanceId: testId(60), sequence: 3 })
    ).toEqual({ remittanceId: testId(60), sequence: 3 });
    expect(
      financialSpecs.remittanceLines.uniqueBy?.message({ remittanceId: testId(60), sequence: 3 })
    ).toContain('already exists');
  });

  it('treats an explicitly undefined column as unmentioned rather than as a clear', () => {
    expect(
      financialSpecs.claimLines.patchData(
        { allowedCents: 10_000, paidCents: undefined },
        makeClaimLineRow(),
        { tenantId: DEMO_TENANT_A, now: FIXED_NOW, nextId: () => testId(801) }
      )
    ).toEqual({ allowedCents: 10_000 });
  });
});

/* --------------------------------------------- the aggregates nobody routes to */

/**
 * Claim lines, claim status history, allocations and remittance lines have no
 * create or amend route: they are written as children of their parent and read
 * through it. Their specs still have to be right about every column, so they
 * are exercised one layer down, against the same in-memory store the HTTP tests
 * run on. Still no database and still no network.
 */
function nestedRepositories(dataset: MemoryDataset = createEmptyDataset()): Repositories {
  let counter = 800;
  return createMemoryRepositoryRegistry({
    dataset,
    clock: { now: () => FIXED_NOW },
    nextId: () => testId((counter += 1)),
  }).forRequest({
    tenantId: DEMO_TENANT_A,
    audit: new AuditCollector(createMemoryAuditSink(), {
      tenantId: DEMO_TENANT_A,
      actorType: 'user',
      actorId: BILLER_SUBJECT,
      requestId: 'req-financial',
      method: 'POST',
      path: '/test',
    }),
  });
}

describe('claim lines, written as children and read through their claim', () => {
  it('defaults every column the schema defaults, and keeps every column it is given', async () => {
    const repos = nestedRepositories();

    const bare = await repos.claimLines.create({
      claimId: testId(30),
      chargeItemId: testId(20),
      sequence: 1,
      code: '99213',
      chargedCents: 12_500,
      serviceDateFrom: SERVICE_DAY,
    });
    expect(bare).toMatchObject({
      codeSystem: 'http://www.ama-assn.org/go/cpt',
      modifiers: [],
      units: 1,
      allowedCents: null,
      paidCents: 0,
      adjustedCents: 0,
      diagnosisPointers: [],
      serviceDateTo: null,
      statusReason: null,
    });

    const full = await repos.claimLines.create({
      claimId: testId(30),
      chargeItemId: testId(21),
      sequence: 2,
      code: '85025',
      codeSystem: 'http://www.ama-assn.org/go/hcpcs',
      modifiers: ['26'],
      units: 2,
      chargedCents: 3_200,
      allowedCents: 2_000,
      paidCents: 1_500,
      adjustedCents: -500,
      diagnosisPointers: [1],
      serviceDateFrom: SERVICE_DAY,
      serviceDateTo: new Date('2026-08-02T00:00:00.000Z'),
      statusReason: 'Bundled into the office visit.',
    });
    expect(full).toMatchObject({ units: 2, modifiers: ['26'], adjustedCents: -500 });
  });

  it('refuses a second line with the same sequence, as the table does', async () => {
    const repos = nestedRepositories();
    const line = {
      claimId: testId(30),
      chargeItemId: testId(20),
      sequence: 1,
      code: '99213',
      chargedCents: 12_500,
      serviceDateFrom: SERVICE_DAY,
    };

    await repos.claimLines.create(line);

    await expect(repos.claimLines.create(line)).rejects.toThrow(
      'Line 1 already exists on that claim.'
    );
  });

  it('amends the adjudicated amounts and sorts by every key it advertises', async () => {
    const repos = nestedRepositories();
    const line = await repos.claimLines.create({
      claimId: testId(30),
      chargeItemId: testId(20),
      sequence: 1,
      code: '99213',
      chargedCents: 12_500,
      serviceDateFrom: SERVICE_DAY,
    });

    await repos.claimLines.create({
      claimId: testId(31),
      chargeItemId: testId(21),
      sequence: 1,
      code: '85025',
      chargedCents: 3_200,
      serviceDateFrom: SERVICE_DAY,
    });

    expect(
      await repos.claimLines.update(line.id, {
        allowedCents: 10_000,
        paidCents: 9_000,
        adjustedCents: -2_500,
        statusReason: 'Contractual write-off.',
      })
    ).toMatchObject({ allowedCents: 10_000, paidCents: 9_000 });
    expect(await repos.claimLines.update(testId(999), { paidCents: 1 })).toBeNull();

    for (const sort of ['sequence', 'chargedCents', 'createdAt'] as const) {
      const page = await repos.claimLines.list({ page: 1, pageSize: 25, sort, order: 'asc' });
      expect(page.total).toBe(2);
    }

    const narrowed = await repos.claimLines.list({
      page: 1,
      pageSize: 25,
      sort: 'sequence',
      order: 'asc',
      claimId: testId(30),
      chargeItemId: testId(20),
    });
    expect(narrowed.rows.map((row) => row.chargeItemId)).toEqual([testId(20)]);
  });
});

describe('claim status history, which is append-only', () => {
  it('stamps the moment when the caller does not state one, and keeps one that does', async () => {
    const repos = nestedRepositories();

    const stamped = await repos.claimStatusHistory.create({
      claimId: testId(30),
      status: 'DRAFT',
      source: 'system',
    });
    expect(stamped).toMatchObject({ occurredAt: FIXED_NOW, detail: null, byUserId: null });

    const stated = await repos.claimStatusHistory.create({
      claimId: testId(30),
      status: 'SUBMITTED',
      source: '835',
      occurredAt: new Date('2026-08-12T10:00:00.000Z'),
      detail: { checkNumber: 'EFT-90210' },
      byUserId: BILLER_SUBJECT,
    });
    expect(stated).toMatchObject({
      detail: { checkNumber: 'EFT-90210' },
      byUserId: BILLER_SUBJECT,
    });
  });

  it('ignores an amendment, because a transition that happened happened', async () => {
    const repos = nestedRepositories();
    const row = await repos.claimStatusHistory.create({
      claimId: testId(30),
      status: 'DRAFT',
      source: 'user',
    });

    await repos.claimStatusHistory.create({
      claimId: testId(30),
      status: 'DRAFT',
      source: 'user',
    });

    expect(await repos.claimStatusHistory.update(row.id, {})).toMatchObject({ status: 'DRAFT' });

    for (const sort of ['occurredAt', 'createdAt'] as const) {
      const page = await repos.claimStatusHistory.list({
        page: 1,
        pageSize: 25,
        sort,
        order: 'asc',
        status: 'DRAFT',
      });
      expect(page.total).toBe(2);
    }

    const otherClaim = await repos.claimStatusHistory.list({
      page: 1,
      pageSize: 25,
      sort: 'occurredAt',
      order: 'asc',
      claimId: testId(31),
    });
    expect(otherClaim.total).toBe(0);
  });
});

describe('allocations and remittance lines', () => {
  it('records an allocation with and without its X12 adjustment codes', async () => {
    const repos = nestedRepositories();

    const bare = await repos.paymentAllocations.create({
      paymentId: testId(50),
      patientId: PATIENT_ID,
      claimId: testId(30),
      amountCents: 5_000,
    });
    expect(bare).toMatchObject({
      claimLineId: null,
      chargeItemId: null,
      adjustmentGroupCode: null,
      adjustmentReasonCode: null,
      appliedAt: FIXED_NOW,
      note: null,
    });

    const full = await repos.paymentAllocations.create({
      paymentId: testId(50),
      patientId: PATIENT_ID,
      claimId: testId(30),
      claimLineId: testId(40),
      chargeItemId: testId(20),
      amountCents: -1_000,
      adjustmentGroupCode: 'CO',
      adjustmentReasonCode: '45',
      appliedAt: new Date('2026-08-12T10:00:00.000Z'),
      note: 'Reversal.',
    });
    expect(full).toMatchObject({ amountCents: -1_000, adjustmentGroupCode: 'CO' });

    expect(await repos.paymentAllocations.update(bare.id, { note: 'Copay.' })).toMatchObject({
      note: 'Copay.',
    });

    for (const sort of ['appliedAt', 'amountCents', 'createdAt'] as const) {
      const page = await repos.paymentAllocations.list({
        page: 1,
        pageSize: 25,
        sort,
        order: 'asc',
      });
      expect(page.total).toBe(2);
    }

    const narrowing = { page: 1, pageSize: 25, sort: 'appliedAt', order: 'asc' } as const;
    expect(
      (await repos.paymentAllocations.list({ ...narrowing, paymentId: testId(51) })).total
    ).toBe(0);
    expect(
      (await repos.paymentAllocations.list({ ...narrowing, patientId: OTHER_PATIENT_ID })).total
    ).toBe(0);
    expect((await repos.paymentAllocations.list({ ...narrowing, claimId: testId(31) })).total).toBe(
      0
    );
  });

  it('stamps a payment that arrives already posted, even with nobody to attribute it to', async () => {
    const repos = nestedRepositories();

    const posted = await repos.payments.create({
      payerId: PAYER_ID,
      source: 'PAYER_ERA',
      method: 'EFT',
      status: 'POSTED',
      amountCents: 10_000,
      remittanceId: testId(60),
    });

    expect(posted).toMatchObject({ postedAt: FIXED_NOW, postedById: null, currency: 'USD' });
  });

  it('defaults a sparse service line to zeroes and unmatched, and refuses a duplicate', async () => {
    const repos = nestedRepositories();

    const bare = await repos.remittanceLines.create({ remittanceId: testId(60), sequence: 1 });
    expect(bare).toMatchObject({
      claimId: null,
      claimLineId: null,
      payerControlNumber: null,
      code: null,
      chargedCents: 0,
      allowedCents: 0,
      paidCents: 0,
      patientResponsibilityCents: 0,
      adjustmentGroupCode: null,
      adjustmentReasonCode: null,
      remarkCodes: [],
      serviceDateFrom: null,
      matched: false,
    });

    const full = await repos.remittanceLines.create({
      remittanceId: testId(60),
      claimId: testId(30),
      claimLineId: testId(40),
      sequence: 2,
      payerControlNumber: 'CLP-2',
      code: '99213',
      chargedCents: 12_500,
      allowedCents: 10_000,
      paidCents: 10_000,
      patientResponsibilityCents: 2_500,
      adjustmentGroupCode: 'PR',
      adjustmentReasonCode: '1',
      remarkCodes: ['N130'],
      serviceDateFrom: SERVICE_DAY,
      matched: true,
    });
    expect(full).toMatchObject({ matched: true, adjustmentGroupCode: 'PR' });

    expect(
      await repos.remittanceLines.update(bare.id, { claimId: testId(30), matched: true })
    ).toMatchObject({ matched: true });

    await expect(
      repos.remittanceLines.create({ remittanceId: testId(60), sequence: 2 })
    ).rejects.toThrow('Line 2 already exists on that remittance.');

    for (const sort of ['sequence', 'paidCents', 'createdAt'] as const) {
      const page = await repos.remittanceLines.list({ page: 1, pageSize: 25, sort, order: 'asc' });
      expect(page.total).toBe(2);
    }

    const narrowing = { page: 1, pageSize: 25, sort: 'sequence', order: 'asc' } as const;
    expect(
      (await repos.remittanceLines.list({ ...narrowing, remittanceId: testId(61) })).total
    ).toBe(0);
    expect((await repos.remittanceLines.list({ ...narrowing, claimId: testId(31) })).total).toBe(0);
    expect((await repos.remittanceLines.list({ ...narrowing, matched: true })).total).toBe(2);
  });
});

describe('collections and dunning', () => {
  /**
   * The default policy is three notices, thirty days apart, with a seven-day
   * floor and a five-dollar write-off threshold. Every date below is expressed
   * relative to the clock the app runs on, so a test says "thirty-one days ago"
   * rather than naming a date that means nothing on its own.
   */
  const DAY_MS = 24 * 60 * 60 * 1000;

  function daysAgo(days: number): Date {
    return new Date(Date.now() - days * DAY_MS);
  }

  function sentStatement(overrides: Partial<StatementRow> = {}): Partial<StatementRow> {
    return {
      status: 'SENT',
      dunningCycle: 1,
      lastNoticeAt: daysAgo(31),
      deliveredVia: 'EMAIL',
      deliveredAt: daysAgo(31),
      ...overrides,
    };
  }

  const NOTICE = { deliveredVia: 'EMAIL' as const };

  it('sends the first notice, advancing the cycle and stamping the date', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'Statement', makeStatementRow({ status: 'GENERATED' }));

    const res = await app.request(
      ...post(`/bff/v0/statements/${testId(70)}/notice`, TOKENS.billerA, NOTICE)
    );

    expect(res.status).toBe(200);
    const body = await json<StatementDto>(res);
    expect(body.status).toBe('SENT');
    expect(body.dunningCycle).toBe(1);
    expect(body.lastNoticeAt).not.toBeNull();
  });

  it('refuses a second notice before the interval has passed', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'Statement', makeStatementRow(sentStatement({ lastNoticeAt: daysAgo(3) })));

    const res = await app.request(
      ...post(`/bff/v0/statements/${testId(70)}/notice`, TOKENS.billerA, NOTICE)
    );

    // The refusal is the feature. A job that runs twice, or an operator who
    // clicks twice, must not chase the same patient twice in a week.
    expect(res.status).toBe(409);
    expect(await res.text()).toContain('not due until');
  });

  it('sends the next notice once the interval has passed', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'Statement', makeStatementRow(sentStatement()));

    const res = await app.request(
      ...post(`/bff/v0/statements/${testId(70)}/notice`, TOKENS.billerA, NOTICE)
    );

    expect(res.status).toBe(200);
    expect((await json<StatementDto>(res)).dunningCycle).toBe(2);
  });

  it('will not let the caller choose which notice this is', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'Statement', makeStatementRow(sentStatement()));

    // A caller who can name the cycle can put a patient anywhere on the
    // schedule, including at the final notice on the first letter.
    const res = await app.request(
      ...post(`/bff/v0/statements/${testId(70)}/notice`, TOKENS.billerA, {
        ...NOTICE,
        dunningCycle: 3,
      })
    );

    expect(res.status).toBe(422);
  });

  it('refuses a notice on a balance the practice agreed not to chase', async () => {
    const { app, dataset } = createTestApp();
    seed(
      dataset,
      'Statement',
      makeStatementRow(sentStatement({ holdUntil: new Date(Date.now() + 30 * DAY_MS) }))
    );

    const res = await app.request(
      ...post(`/bff/v0/statements/${testId(70)}/notice`, TOKENS.billerA, NOTICE)
    );

    expect(res.status).toBe(409);
    expect(await res.text()).toContain('on hold');
  });

  it('refuses a notice once every notice in the policy has been sent', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'Statement', makeStatementRow(sentStatement({ dunningCycle: 3 })));

    const res = await app.request(
      ...post(`/bff/v0/statements/${testId(70)}/notice`, TOKENS.billerA, NOTICE)
    );

    expect(res.status).toBe(409);
    expect(await res.text()).toContain('Write it off or escalate');
  });

  it('refuses a notice on a balance that is no longer owed', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'Statement', makeStatementRow(sentStatement({ balanceCents: 0 })));

    const res = await app.request(
      ...post(`/bff/v0/statements/${testId(70)}/notice`, TOKENS.billerA, NOTICE)
    );

    expect(res.status).toBe(409);
    expect(await res.text()).toContain('no balance owed');
  });

  it.each(['DRAFT', 'PAID', 'VOID'] as const)(
    'refuses a notice on a statement in %s, which is not on a schedule',
    async (status) => {
      const { app, dataset } = createTestApp();
      seed(dataset, 'Statement', makeStatementRow({ status }));

      const res = await app.request(
        ...post(`/bff/v0/statements/${testId(70)}/notice`, TOKENS.billerA, NOTICE)
      );

      expect(res.status).toBe(409);
    }
  );

  it('holds a balance without taking it out of the ageing report', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'Statement', makeStatementRow(sentStatement()));
    const until = new Date(Date.now() + 60 * DAY_MS).toISOString();

    const res = await app.request(
      ...post(`/bff/v0/statements/${testId(70)}/hold`, TOKENS.billerA, {
        reason: 'Patient disputes the balance',
        until,
      })
    );

    expect(res.status).toBe(200);
    const body = await json<StatementDto>(res);
    expect(body.holdReason).toBe('Patient disputes the balance');
    // Still SENT, still owed. A hold suspends the schedule, and moving it to a
    // state of its own would take it out of the report it most needs to be in.
    expect(body.status).toBe('SENT');
  });

  it('refuses a hold with no reason', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'Statement', makeStatementRow(sentStatement()));

    const res = await app.request(
      ...post(`/bff/v0/statements/${testId(70)}/hold`, TOKENS.billerA, {
        until: new Date(Date.now() + DAY_MS).toISOString(),
      })
    );

    // The person who has to justify why a patient was not billed is not the
    // person who set the hold.
    expect(res.status).toBe(422);
  });

  it.each(['PAID', 'VOID'] as const)('refuses a hold on a statement in %s', async (status) => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'Statement', makeStatementRow({ status }));

    const res = await app.request(
      ...post(`/bff/v0/statements/${testId(70)}/hold`, TOKENS.billerA, {
        reason: 'Hardship',
        until: new Date(Date.now() + DAY_MS).toISOString(),
      })
    );

    expect(res.status).toBe(409);
  });

  it('writes off a real debt, keeping it apart from a voided one', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'Statement', makeStatementRow(sentStatement()));

    const res = await app.request(
      ...post(`/bff/v0/statements/${testId(70)}/write-off`, TOKENS.billerA, {
        reason: 'Uncollectable after three notices',
      })
    );

    expect(res.status).toBe(200);
    const body = await json<StatementDto>(res);
    expect(body.status).toBe('WRITTEN_OFF');
    expect(body.closedReason).toBe('Uncollectable after three notices');
  });

  it('refuses to write off a statement nobody has sent', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'Statement', makeStatementRow({ status: 'DRAFT' }));

    // Nothing has been asked for yet, so there is no debt to abandon. A draft
    // that should not exist is deleted or voided, not written off.
    const res = await app.request(
      ...post(`/bff/v0/statements/${testId(70)}/write-off`, TOKENS.billerA, { reason: 'Nope' })
    );

    expect(res.status).toBe(409);
  });

  it('leaves a written-off statement terminal', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'Statement', makeStatementRow(sentStatement()));
    await app.request(
      ...post(`/bff/v0/statements/${testId(70)}/write-off`, TOKENS.billerA, { reason: 'Bad debt' })
    );

    // A later payment is a payment against the ledger, not a reason to put the
    // statement back on a dunning schedule it had already left.
    const notice = await app.request(
      ...post(`/bff/v0/statements/${testId(70)}/notice`, TOKENS.billerA, NOTICE)
    );
    const hold = await app.request(
      ...post(`/bff/v0/statements/${testId(70)}/hold`, TOKENS.billerA, {
        reason: 'Too late',
        until: new Date(Date.now() + DAY_MS).toISOString(),
      })
    );

    expect(notice.status).toBe(409);
    expect(hold.status).toBe(409);
  });

  it('lists what needs chasing, oldest debt first, with the ageing bucket', async () => {
    const { app, dataset } = createTestApp();
    seed(
      dataset,
      'Statement',
      makeStatementRow({ id: testId(70), ...sentStatement({ deliveredAt: daysAgo(100) }) }),
      makeStatementRow({ id: testId(71), ...sentStatement({ deliveredAt: daysAgo(40) }) })
    );

    const res = await app.request('/bff/v0/collections/worklist', {
      headers: bearer(TOKENS.billerA),
    });

    expect(res.status).toBe(200);
    const body = await json<{ items: CollectionsWorklistEntry[]; total: number }>(res);
    expect(body.items.map((entry) => entry.statementId)).toStrictEqual([testId(70), testId(71)]);
    expect(body.items[0]?.bucket).toBe('90+');
    expect(body.items[1]?.bucket).toBe('31-60');
    expect(body.items[0]?.action).toBe('notice');
  });

  it.each(['PAID', 'VOID', 'WRITTEN_OFF'] as const)(
    'leaves a statement in %s off the worklist',
    async (status) => {
      const { app, dataset } = createTestApp();
      seed(dataset, 'Statement', makeStatementRow({ status }));

      const body = await json<{ items: CollectionsWorklistEntry[] }>(
        await app.request('/bff/v0/collections/worklist', { headers: bearer(TOKENS.billerA) })
      );

      // Outcomes, not work. A worklist that listed them would grow forever.
      expect(body.items).toHaveLength(0);
    }
  );

  it('narrows to one kind of work', async () => {
    const { app, dataset } = createTestApp();
    seed(
      dataset,
      'Statement',
      makeStatementRow({ id: testId(70), ...sentStatement() }),
      makeStatementRow({ id: testId(71), ...sentStatement({ lastNoticeAt: daysAgo(2) }) })
    );

    const body = await json<{ items: CollectionsWorklistEntry[] }>(
      await app.request('/bff/v0/collections/worklist?action=wait', {
        headers: bearer(TOKENS.billerA),
      })
    );

    expect(body.items.map((entry) => entry.statementId)).toStrictEqual([testId(71)]);
    expect(body.items[0]?.actionableAt).not.toBeNull();
  });

  it('recomputes the action, so a paid balance never reads as work', async () => {
    const { app, dataset } = createTestApp();
    // The row still says SENT and still carries three notices. What changed is
    // the money, and a stored decision would not have noticed.
    seed(
      dataset,
      'Statement',
      makeStatementRow(sentStatement({ balanceCents: 0, dunningCycle: 3 }))
    );

    const body = await json<{ items: CollectionsWorklistEntry[] }>(
      await app.request('/bff/v0/collections/worklist', { headers: bearer(TOKENS.billerA) })
    );

    expect(body.items[0]?.action).toBe('settled');
  });

  it('marks a small exhausted balance for write-off rather than another letter', async () => {
    const { app, dataset } = createTestApp();
    seed(
      dataset,
      'Statement',
      makeStatementRow(sentStatement({ balanceCents: 300, dunningCycle: 3 }))
    );

    const body = await json<{ items: CollectionsWorklistEntry[] }>(
      await app.request('/bff/v0/collections/worklist', { headers: bearer(TOKENS.billerA) })
    );

    expect(body.items[0]?.action).toBe('write-off');
  });

  it('refuses the worklist to a principal without the payment permission', async () => {
    const { app } = createTestApp();

    const res = await app.request('/bff/v0/collections/worklist', {
      headers: bearer(UNPRIVILEGED_TOKEN),
    });

    expect(res.status).toBe(403);
  });
});

/* ----------------------------------------------------------------- contracts */

describe('financialRouteContracts', () => {
  it('publishes exactly the endpoints this module mounts', () => {
    const inventory = financialRouteContracts()
      .map((contract) => `${contract.method.toUpperCase()} ${contract.path}`)
      .sort();

    expect(inventory).toEqual(
      [
        'GET /bff/v0/coverage',
        'GET /bff/v0/coverage/{id}',
        'POST /bff/v0/coverage',
        'PATCH /bff/v0/coverage/{id}',
        'POST /bff/v0/coverage/{id}/eligibility',
        'GET /bff/v0/charges',
        'GET /bff/v0/charges/{id}',
        'POST /bff/v0/charges',
        'PATCH /bff/v0/charges/{id}',
        'POST /bff/v0/charges/{id}/void',
        'GET /bff/v0/claims',
        'GET /bff/v0/claims/{id}',
        'POST /bff/v0/claims',
        'PATCH /bff/v0/claims/{id}',
        'POST /bff/v0/claims/{id}/scrub',
        'POST /bff/v0/claims/{id}/submit',
        'POST /bff/v0/claims/{id}/status',
        'GET /bff/v0/claims/{id}/lines',
        'GET /bff/v0/claims/{id}/history',
        'GET /bff/v0/payments',
        'GET /bff/v0/payments/{id}',
        'POST /bff/v0/payments',
        'PATCH /bff/v0/payments/{id}',
        'POST /bff/v0/payments/{id}/post',
        'POST /bff/v0/payments/{id}/void',
        'POST /bff/v0/payments/{id}/refund',
        'GET /bff/v0/payments/{id}/allocations',
        'GET /bff/v0/remittances',
        'GET /bff/v0/remittances/{id}',
        'POST /bff/v0/remittances',
        'PATCH /bff/v0/remittances/{id}',
        'POST /bff/v0/remittances/{id}/parse',
        'POST /bff/v0/remittances/{id}/post',
        'GET /bff/v0/remittances/{id}/lines',
        'GET /bff/v0/statements',
        'GET /bff/v0/statements/{id}',
        'POST /bff/v0/statements',
        'PATCH /bff/v0/statements/{id}',
        'POST /bff/v0/statements/{id}/generate',
        'POST /bff/v0/statements/{id}/send',
        'POST /bff/v0/statements/{id}/notice',
        'POST /bff/v0/statements/{id}/hold',
        'POST /bff/v0/statements/{id}/write-off',
        'GET /bff/v0/collections/worklist',
      ].sort()
    );
  });

  it('gives every operation a unique id and names the permission it needs', () => {
    const contracts = financialRouteContracts();
    const ids = contracts.map((contract) => contract.operationId);

    expect(new Set(ids).size).toBe(ids.length);
    expect(contracts.every((contract) => contract.permission !== undefined)).toBe(true);
  });
});

/**
 * The two ways a caller can ask for a claim status, and what happens when both
 * arrive.
 *
 * `status` is the collection's own scalar parameter. `statuses` is the set the
 * FHIR boundary sends, because `Claim.status` collapses ten domain states into
 * three FHIR codes. Both write the same `where` key, so the interesting cases
 * are the ones where they disagree: spread side by side, one of them would
 * silently stop applying, and a search that quietly widens hands somebody rows
 * they did not ask for.
 */
describe('the claim status filter', () => {
  const paged = {
    page: 1,
    pageSize: 25,
    sort: 'createdAt',
    order: 'asc',
    window: 'createdAt',
  } as const;
  const claim = (status: ClaimStatus): ScopedRow<'Claim'> =>
    ({ status }) as unknown as ScopedRow<'Claim'>;

  it('sends a set through as a set', () => {
    const query = { ...paged, statuses: ['SUBMITTED', 'DENIED'] } as const;

    expect(financialSpecs.claims.where(query)).toEqual({
      status: { in: ['SUBMITTED', 'DENIED'] },
    });
    expect(financialSpecs.claims.matches(claim('DENIED'), query)).toBe(true);
    expect(financialSpecs.claims.matches(claim('PAID'), query)).toBe(false);
  });

  it('intersects the two rather than letting one overwrite the other', () => {
    const query = { ...paged, status: 'DENIED', statuses: ['SUBMITTED', 'DENIED'] } as const;

    expect(financialSpecs.claims.where(query)).toEqual({ status: { in: ['DENIED'] } });
    expect(financialSpecs.claims.matches(claim('DENIED'), query)).toBe(true);
    // The row the scalar excludes. Were `statuses` to win, this would be true.
    expect(financialSpecs.claims.matches(claim('SUBMITTED'), query)).toBe(false);
  });

  it('matches nothing when the two cannot both hold', () => {
    const query = { ...paged, status: 'PAID', statuses: ['SUBMITTED', 'DENIED'] } as const;

    // `{ in: [] }` is this repository's spelling for a filter that matches
    // nothing, and it is the honest answer to an impossible intersection. An
    // absent clause would return every claim in the practice.
    expect(financialSpecs.claims.where(query)).toEqual({ status: { in: [] } });
    expect(financialSpecs.claims.matches(claim('PAID'), query)).toBe(false);
    expect(financialSpecs.claims.matches(claim('SUBMITTED'), query)).toBe(false);
  });

  it('leaves the clause out when neither is given', () => {
    expect(financialSpecs.claims.where({ ...paged })).toEqual({});
    expect(financialSpecs.claims.matches(claim('PAID'), { ...paged })).toBe(true);
  });
});
