import { describe, expect, it } from 'vitest';

import {
  bearer,
  createTestApp,
  FIXED_NOW,
  makePatientRow,
  seed,
  storageColumns,
  testId,
  TOKENS,
} from './support.js';

/**
 * Screening is the check a prescriber relies on without thinking about it, so
 * these assert the outcomes rather than the plumbing: the drug that must be
 * stopped, the drug that must not be, and the honesty of an empty result.
 */

const PATIENT = testId(1);
const PROVIDER = testId(900);

function harness(): ReturnType<typeof createTestApp> {
  const created = createTestApp();
  seed(created.dataset, 'Patient', makePatientRow({ id: PATIENT }));
  seed(created.dataset, 'AllergyIntolerance', {
    ...storageColumns(testId(24)),
    patientId: PATIENT,
    type: 'ALLERGY',
    category: 'MEDICATION',
    criticality: 'HIGH',
    clinicalStatus: 'ACTIVE',
    substanceCode: '7980',
    substanceCodeSystem: 'http://www.nlm.nih.gov/research/umls/rxnorm',
    substanceDisplay: 'Penicillin',
    reactionCodes: ['247472004'],
    reactionText: 'Anaphylaxis',
    severity: 'SEVERE',
    onsetDate: null,
    note: null,
    recordedAt: FIXED_NOW,
    recordedById: PROVIDER,
  });
  // Resolved, and therefore not a reason to warn. Re-warning on an allergy
  // somebody has already disproved is how a prescriber learns to dismiss the
  // panel.
  seed(created.dataset, 'AllergyIntolerance', {
    ...storageColumns(testId(25)),
    patientId: PATIENT,
    type: 'ALLERGY',
    category: 'MEDICATION',
    criticality: 'HIGH',
    clinicalStatus: 'RESOLVED',
    substanceCode: null,
    substanceCodeSystem: null,
    substanceDisplay: 'Metformin',
    reactionCodes: [],
    reactionText: null,
    severity: 'MILD',
    onsetDate: null,
    note: null,
    recordedAt: FIXED_NOW,
    recordedById: PROVIDER,
  });
  // A food allergy: real, and not a reason to warn about an antibiotic.
  seed(created.dataset, 'AllergyIntolerance', {
    ...storageColumns(testId(26)),
    patientId: PATIENT,
    type: 'ALLERGY',
    category: 'FOOD',
    criticality: 'HIGH',
    clinicalStatus: 'ACTIVE',
    substanceCode: null,
    substanceCodeSystem: null,
    substanceDisplay: 'Peanut',
    reactionCodes: [],
    reactionText: 'Anaphylaxis',
    severity: 'SEVERE',
    onsetDate: null,
    note: null,
    recordedAt: FIXED_NOW,
    recordedById: PROVIDER,
  });
  return created;
}

const screen = async (
  app: ReturnType<typeof createTestApp>['app'],
  body: Record<string, unknown>
): Promise<{
  findings: { message: string; action: string }[];
  requiresAcknowledgement: boolean;
  checked: string[];
  notChecked: string[];
}> => {
  const res = await app.request('/bff/v0/medications/screen', {
    method: 'POST',
    headers: { ...bearer(TOKENS.clinicianA), 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as never;
};

describe('medication screening', () => {
  it('stops the prescription that would cause anaphylaxis', async () => {
    const { app } = harness();

    const result = await screen(app, {
      patientId: PATIENT,
      rxnormCode: '7980',
      display: 'Penicillin G 500mg',
    });

    expect(result.requiresAcknowledgement).toBe(true);
    expect(result.findings[0]?.message).toContain('Anaphylaxis');
  });

  it('warns on a drug in the same class, which is the one nobody remembers', async () => {
    const { app } = harness();

    const result = await screen(app, { patientId: PATIENT, display: 'Cefalexin 500mg' });

    expect(result.requiresAcknowledgement).toBe(true);
    expect(result.findings[0]?.message).toContain('penicillins and cephalosporins');
  });

  it('says nothing about an allergy that was resolved', async () => {
    const { app } = harness();

    const result = await screen(app, { patientId: PATIENT, display: 'Metformin 500mg' });

    expect(result.findings).toEqual([]);
  });

  it('does not warn about an antibiotic because of a food allergy', async () => {
    const { app } = harness();

    const result = await screen(app, { patientId: PATIENT, display: 'Peanut oil ointment' });

    expect(result.findings).toEqual([]);
  });

  /**
   * The honesty requirement. An empty finding list must not read as a clean
   * bill: a prescriber seeing a safety panel assumes it covers what safety
   * panels usually cover, so the response names what was not checked.
   */
  it('names what it did not check, so an empty result cannot mislead', async () => {
    const { app } = harness();

    const result = await screen(app, { patientId: PATIENT, display: 'Lisinopril 10mg' });

    expect(result.findings).toEqual([]);
    expect(result.checked).toEqual(['allergy', 'duplicate-therapy']);
    expect(result.notChecked).toContain('drug-drug');
  });

  it('refuses a request without the write capability', async () => {
    const { app } = harness();

    const res = await app.request('/bff/v0/medications/screen', {
      method: 'POST',
      headers: { ...bearer(TOKENS.portalA), 'content-type': 'application/json' },
      body: JSON.stringify({ patientId: PATIENT, display: 'Penicillin G' }),
    });

    expect(res.status).toBe(403);
  });
});

describe('SMART discovery', () => {
  /**
   * An app fetches this BEFORE it has a token - that is what discovery is for -
   * so requiring one would make the document unreachable by exactly the clients
   * that need it.
   */
  it('is readable without a token', async () => {
    const { app } = harness();

    const res = await app.request('/fhir/.well-known/smart-configuration');

    expect(res.status).toBe(200);
  });

  it('claims only launch modes this server implements', async () => {
    const { app } = harness();

    const document = (await (
      await app.request('/fhir/.well-known/smart-configuration')
    ).json()) as { capabilities: string[]; issuer: string; scopes_supported: string[] };

    expect(document.capabilities).toContain('launch-standalone');
    // Not claimed: this server has no EHR launch context to hand an app, and
    // advertising one would send a client down a flow that fails after the user
    // has already been redirected.
    expect(document.capabilities).not.toContain('launch-ehr');
    expect(document.issuer).toContain('/fhir');
    expect(document.scopes_supported).toContain('patient/*.read');
  });

  it('names no patient, because discovery is public', async () => {
    const { app } = harness();

    const body = await (await app.request('/fhir/.well-known/smart-configuration')).text();

    expect(body).not.toContain(PATIENT);
  });
});
