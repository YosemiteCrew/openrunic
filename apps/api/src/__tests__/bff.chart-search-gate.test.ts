import { describe, expect, it } from 'vitest';

import {
  bearer,
  createTestApp,
  DEMO_TENANT_A,
  FIXED_NOW,
  makePatientRow,
  seed,
  seedCareRelationship,
  testId,
  TOKENS,
} from './support.js';

/**
 * A set-search of chart data is a read of every chart it returns.
 *
 * The care-relationship gate first fired only on a search that named a chart
 * (`patient`, `_id`, `identifier`), which closed `?patient=` and left the widest
 * hole behind it: `GET /fhir/Condition?code=` and a bare `GET /fhir/Condition`
 * named no chart, skipped the gate, and returned every matching row in the
 * tenant to a reader with no relationship to any of them - a clinical resource
 * carries a patient compartment but no facility of its own, so nothing else
 * narrowed it. Both boundaries now gate the returned page.
 */
const STRANGER = testId(73001);
const COND = testId(73002);

function seedStrangerCondition(dataset: ReturnType<typeof createTestApp>['dataset']): void {
  seed(dataset, 'Patient', makePatientRow({ id: STRANGER, mrn: 'OR-730010' }));
  seed(dataset, 'Condition', {
    id: COND,
    tenantId: DEMO_TENANT_A,
    patientId: STRANGER,
    encounterId: null,
    category: 'PROBLEM_LIST_ITEM',
    code: 'E11.9',
    codeSystem: 'http://hl7.org/fhir/sid/icd-10-cm',
    display: 'Type 2 diabetes mellitus',
    snomedCode: null,
    clinicalStatus: 'ACTIVE',
    verificationStatus: 'CONFIRMED',
    onsetDate: null,
    abatementDate: null,
    severityCode: null,
    bodySiteCode: null,
    note: null,
    recordedAt: FIXED_NOW,
    recordedById: null,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
  });
}

const authorise = (dataset: ReturnType<typeof createTestApp>['dataset']): void =>
  seedCareRelationship(dataset, {
    patientId: STRANGER,
    providerId: '01890000-0000-7000-8000-000000000101',
    as: 'appointment',
    id: testId(73003),
  });

describe('the FHIR set-search gate on clinical resources', () => {
  it('refuses ?code= for a reader with no relationship', async () => {
    const { app, dataset } = createTestApp();
    seedStrangerCondition(dataset);
    const res = await app.request(`/fhir/Condition?code=E11.9`, {
      headers: bearer(TOKENS.clinicianA),
    });
    expect(res.status).toBe(404);
  });

  it('refuses a bare search for a reader with no relationship', async () => {
    const { app, dataset } = createTestApp();
    seedStrangerCondition(dataset);
    const res = await app.request(`/fhir/Condition`, { headers: bearer(TOKENS.clinicianA) });
    expect(res.status).toBe(404);
  });

  it('answers ?code= once a relationship exists', async () => {
    const { app, dataset } = createTestApp();
    seedStrangerCondition(dataset);
    authorise(dataset);
    const res = await app.request(`/fhir/Condition?code=E11.9`, {
      headers: bearer(TOKENS.clinicianA),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { entry?: unknown[] }).entry).toHaveLength(1);
  });

  it('keeps the Patient demographic search open, because registration precedes any relationship', async () => {
    // The one exemption: a Patient search that names no chart is how you find a
    // chart you have no relationship with yet. It must not be gated, or nobody
    // could register or de-duplicate a patient.
    const { app, dataset } = createTestApp();
    seedStrangerCondition(dataset);
    const res = await app.request(`/fhir/Patient?family=${encodeURIComponent('Testsson')}`, {
      headers: bearer(TOKENS.clinicianA),
    });
    expect(res.status).toBe(200);
  });
});

/**
 * The charts on one page are decided one at a time, and the first refusal ends
 * the request.
 *
 * A refused page is a 404 however the decisions are made, so the status alone
 * cannot tell a gate that stops at the refusal from one that went on deciding
 * the rest of the page. The audit trail can: a chart the request never got to
 * must not be recorded as accessed by a request that returned nothing.
 */
describe('a page with a refused chart stops at the refusal', () => {
  const KNOWN = testId(73011);

  /** Two charts, one condition each. Only KNOWN has a relationship. */
  const twoCharts = (dataset: ReturnType<typeof createTestApp>['dataset']): void => {
    seedStrangerCondition(dataset);
    seed(dataset, 'Patient', makePatientRow({ id: KNOWN, mrn: 'OR-730110' }));
    seed(dataset, 'Condition', {
      id: testId(73012),
      tenantId: DEMO_TENANT_A,
      patientId: KNOWN,
      encounterId: null,
      category: 'PROBLEM_LIST_ITEM',
      code: 'E11.9',
      codeSystem: 'http://hl7.org/fhir/sid/icd-10-cm',
      display: 'Type 2 diabetes mellitus',
      snomedCode: null,
      clinicalStatus: 'ACTIVE',
      verificationStatus: 'CONFIRMED',
      onsetDate: null,
      abatementDate: null,
      severityCode: null,
      bodySiteCode: null,
      note: null,
      // Earlier than the stranger's, so newest first puts the stranger's chart
      // first on the page.
      recordedAt: new Date(FIXED_NOW.getTime() - 60_000),
      recordedById: null,
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    });
    seedCareRelationship(dataset, {
      patientId: KNOWN,
      providerId: '01890000-0000-7000-8000-000000000101',
      as: 'appointment',
      id: testId(73013),
    });
  };

  const decisions = (sink: ReturnType<typeof createTestApp>['sink']): string[] =>
    sink.events
      .filter((entry) => entry.event.action.startsWith('chart.access'))
      .map((entry) => `${entry.event.action} ${String(entry.event.patientId)}`);

  it.each([
    ['a FHIR search', '/fhir/Condition?code=E11.9'],
    ['a BFF list', '/bff/v0/problems?pageSize=10&sort=recordedAt&order=desc'],
  ])('%s records the refusal and nothing after it', async (_, path) => {
    const { app, dataset, sink } = createTestApp();
    twoCharts(dataset);

    const res = await app.request(path, { headers: bearer(TOKENS.clinicianA) });

    expect(res.status).toBe(404);
    expect(decisions(sink)).toEqual([`chart.access.denied ${STRANGER}`]);
  });

  it.each([
    ['a FHIR search', '/fhir/Condition?code=E11.9'],
    ['a BFF list', '/bff/v0/problems?pageSize=10&sort=recordedAt&order=desc'],
  ])('%s decides every chart in page order once both are known', async (_, path) => {
    const { app, dataset, sink } = createTestApp();
    twoCharts(dataset);
    authorise(dataset);

    const res = await app.request(path, { headers: bearer(TOKENS.clinicianA) });

    expect(res.status).toBe(200);
    // Also the premise of the case above: the stranger's chart is first on the page.
    expect(decisions(sink)).toEqual([`chart.access ${STRANGER}`, `chart.access ${KNOWN}`]);
  });
});
