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
