import { describe, expect, it } from 'vitest';

import type { SmartLaunchSettings } from '../env.js';

import {
  bearer,
  createTestApp,
  FIXED_NOW,
  makePatientRow,
  seed,
  seedCareRelationship,
  storageColumns,
  SUBJECTS,
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
  // Screening answers a question about this chart - whether this patient is
  // allergic to the drug you named - so it asks the care-relationship gate
  // (#315). These tests are about the screening outcome and not about
  // authorisation, so they get the cheapest relationship there is. The refusal
  // has its own case in `policy.care-relationship.test.ts`.
  seedCareRelationship(created.dataset, {
    patientId: PATIENT,
    providerId: SUBJECTS.clinicianA,
    as: 'appointment',
  });
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

  /**
   * The claim, made true.
   *
   * The response has always named `duplicate-therapy` in `checked`, and the
   * handler never gave the port a medication list to check against - so the one
   * field that exists to stop an empty result reading as a clean bill was
   * itself the misleading part: a prescriber was told duplicate therapy had been
   * assessed on every response, and it never had been.
   *
   * Read off the chart rather than taken from the request body, so the claim
   * does not depend on which screen happened to send a list.
   */
  it('finds a duplicate against the medication list on the chart', async () => {
    const { app, dataset } = harness();
    seed(dataset, 'MedicationStatement', {
      ...storageColumns(testId(500)),
      patientId: PATIENT,
      encounterId: null,
      rxnormCode: '860975',
      display: 'Metformin 500 mg oral tablet',
      sigText: null,
      status: 'ACTIVE',
      source: 'REPORTED',
      effectiveStart: null,
      effectiveEnd: null,
      reportedAt: FIXED_NOW,
      note: null,
    } as never);

    const result = await screen(app, {
      patientId: PATIENT,
      rxnormCode: '860975',
      display: 'Metformin 500 mg oral tablet',
    });

    expect(result.checked).toContain('duplicate-therapy');
    expect(result.findings.length).toBeGreaterThan(0);
  });

  it('says nothing about a medication the patient is not already on', async () => {
    const { app, dataset } = harness();
    seed(dataset, 'MedicationStatement', {
      ...storageColumns(testId(501)),
      patientId: PATIENT,
      encounterId: null,
      rxnormCode: '860975',
      display: 'Metformin 500 mg oral tablet',
      sigText: null,
      status: 'ACTIVE',
      source: 'REPORTED',
      effectiveStart: null,
      effectiveEnd: null,
      reportedAt: FIXED_NOW,
      note: null,
    } as never);

    expect(
      (await screen(app, { patientId: PATIENT, display: 'Lisinopril 10mg' })).findings
    ).toEqual([]);
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

  async function discovery(smartLaunch?: SmartLaunchSettings): Promise<Record<string, unknown>> {
    const app = createTestApp({ smartLaunch }).app;
    const res = await app.request('/fhir/.well-known/smart-configuration');
    expect(res.status).toBe(200);
    return (await res.json()) as Record<string, unknown>;
  }

  const LAUNCH: SmartLaunchSettings = {
    authorizationEndpoint: 'https://idp.example.invalid/authorize',
    tokenEndpoint: 'https://idp.example.invalid/oauth/token',
  };

  it('describes how it reads a scope whether or not a launch is published', async () => {
    const document = await discovery();

    // These two say how this server interprets a scope it is handed, which is
    // true of any token it accepts, whoever issued it.
    expect(document.capabilities).toContain('permission-patient');
    expect(document.capabilities).toContain('permission-user');
    expect(document.issuer).toContain('/fhir');
    expect(document.scopes_supported).toContain('patient/*.read');
  });

  it('publishes no launch, and no endpoints, when no authorisation server is configured', async () => {
    const document = await discovery();

    // The document used to name `/authorize` and `/token` on this API's own
    // origin. Neither has ever been served, so an app that believed the
    // document was redirected to a 404 with the user already sitting in front
    // of it. Silence here is what tells a client to stop before that happens.
    expect(document.authorization_endpoint).toBeUndefined();
    expect(document.token_endpoint).toBeUndefined();
    expect(document.capabilities).not.toContain('launch-standalone');
    expect(document.capabilities).not.toContain('client-public');
  });

  it('publishes the configured authorisation server, and only then claims a launch', async () => {
    const document = await discovery(LAUNCH);

    expect(document.authorization_endpoint).toBe(LAUNCH.authorizationEndpoint);
    expect(document.token_endpoint).toBe(LAUNCH.tokenEndpoint);
    expect(document.capabilities).toContain('launch-standalone');
    expect(document.capabilities).toContain('client-public');
    expect(document.capabilities).toContain('context-standalone-patient');
  });

  it('never claims an EHR launch, configured or not', async () => {
    // This server has no EHR launch context to hand an app. Configuring an
    // authorisation server does not create one, so the answer is the same in
    // both directions.
    for (const document of [await discovery(), await discovery(LAUNCH)]) {
      expect(document.capabilities).not.toContain('launch-ehr');
      expect(document.capabilities).not.toContain('context-ehr-patient');
    }
  });

  it('offers only S256, so a downgrade to plain is not on the table', async () => {
    const document = await discovery(LAUNCH);

    expect(document.code_challenge_methods_supported).toStrictEqual(['S256']);
  });

  it('names no patient, because discovery is public', async () => {
    const { app } = harness();

    const body = await (await app.request('/fhir/.well-known/smart-configuration')).text();

    expect(body).not.toContain(PATIENT);
  });
});
