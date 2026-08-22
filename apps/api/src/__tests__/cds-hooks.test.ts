import { describe, expect, it } from 'vitest';

import { CDS_SERVICES, checkedLine } from '../cds/services.js';
import { internalRouteContracts } from '../routes/index.js';

import {
  createTestApp,
  DEMO_TENANT_A,
  jsonBearer,
  makePatientRow,
  seed,
  storageColumns,
  testId,
  TOKENS,
  UNPRIVILEGED_TOKEN,
} from './support.js';

/**
 * The hook surface, as a calling EMR sees it.
 *
 * A CDS Hooks request is a read of a patient's chart dressed as a question about
 * a decision, so most of these are about the two things that makes true: it goes
 * through the same authorisation as every other read, and it says out loud what
 * it did and did not check.
 */

const PATIENT = testId(1);
const INSTANCE = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

interface CardBody {
  cards: { summary: string; detail?: string; indicator: string; source: { label: string } }[];
}

function harness(): ReturnType<typeof createTestApp> {
  const created = createTestApp();
  seed(created.dataset, 'Patient', makePatientRow({ id: PATIENT }));
  return created;
}

function seedAllergy(
  dataset: ReturnType<typeof createTestApp>['dataset'],
  overrides: Record<string, unknown> = {}
): void {
  seed(dataset, 'AllergyIntolerance', {
    ...storageColumns(testId(400)),
    patientId: PATIENT,
    encounterId: null,
    substanceCode: '7980',
    substanceDisplay: 'Penicillin',
    type: 'ALLERGY',
    category: 'MEDICATION',
    criticality: 'HIGH',
    clinicalStatus: 'ACTIVE',
    verificationStatus: 'CONFIRMED',
    reactionText: 'Anaphylaxis',
    onsetDate: null,
    recordedAt: new Date('2026-01-01T00:00:00.000Z'),
    recordedById: testId(900),
    note: null,
    ...overrides,
  } as never);
}

function invocation(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    hook: 'order-sign',
    hookInstance: INSTANCE,
    context: {
      userId: 'Practitioner/1',
      patientId: PATIENT,
      draftOrders: {
        resourceType: 'Bundle',
        entry: [
          {
            resource: {
              resourceType: 'MedicationRequest',
              id: 'draft-1',
              medicationCodeableConcept: {
                coding: [{ code: '7980', display: 'Penicillin V Potassium 500mg' }],
              },
            },
          },
        ],
      },
    },
    ...overrides,
  });
}

describe('discovery', () => {
  /**
   * A calling EMR needs the document before it has been configured with
   * anything, which is why the specification treats it as open. It is safe to be
   * because it is identical whichever organisation asks.
   */
  it('is served without a token', async () => {
    const { app } = harness();

    const res = await app.request('/cds-services');
    const body = (await res.json()) as { services: { id: string; hook: string }[] };

    expect(res.status).toBe(200);
    expect(body.services.map((service) => service.id).sort()).toEqual([
      'allergy-summary',
      'order-select-safety',
      'order-sign-safety',
    ]);
  });

  it('describes every service it serves, and serves every one it describes', async () => {
    const { app } = harness();
    const body = (await (await app.request('/cds-services')).json()) as {
      services: { id: string; hook: string; description: string }[];
    };

    expect(body.services).toHaveLength(CDS_SERVICES.length);
    for (const service of body.services) {
      expect(service.description, service.id).not.toBe('');

      const res = await app.request(`/cds-services/${service.id}`, {
        method: 'POST',
        headers: jsonBearer(TOKENS.clinicianA),
        body: JSON.stringify({
          hook: service.hook,
          hookInstance: INSTANCE,
          context: { userId: 'Practitioner/1', patientId: PATIENT },
        }),
      });

      expect(res.status, service.id).toBe(200);
    }
  });

  it('says nothing about this practice or its patients', async () => {
    const { app } = harness();

    const body = await (await app.request('/cds-services')).text();

    expect(body).not.toContain(PATIENT);
    expect(body).not.toContain(DEMO_TENANT_A);
  });
});

describe('invocation is a read of the chart, and is authorised as one', () => {
  it('refuses a caller with no token', async () => {
    const { app } = harness();

    const res = await app.request('/cds-services/allergy-summary', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: invocation({ hook: 'patient-view' }),
    });

    expect(res.status).toBe(401);
  });

  it('refuses a caller whose role cannot read the chart, and says which permission', async () => {
    const { app } = harness();

    const res = await app.request('/cds-services/allergy-summary', {
      method: 'POST',
      headers: jsonBearer(UNPRIVILEGED_TOKEN),
      body: invocation({ hook: 'patient-view' }),
    });

    expect(res.status).toBe(403);
    // The permission NAMED matters as much as the refusal. The mount used to
    // demand `patient.read` while every service read allergies and medication
    // statements, so a role given demographics and denied the chart could read
    // the chart through a hook. This asserts the gate is the one the service
    // declares, not one fixed for the surface.
    expect(((await res.json()) as { detail?: string }).detail).toContain('encounter.read');
  });

  /**
   * The rule the fix is actually about: the same data may not sit behind two
   * different gates.
   *
   * A behavioural test can only show that the permission the route enforces is
   * the one the service declares. This shows the declaration is the RIGHT one,
   * by reading it off the BFF contract for the collection the service reads
   * rather than restating a permission name here - so a change to either side
   * that separates them fails, which is how they came apart in the first place.
   */
  it('gates each service with the permission its own data sits behind elsewhere', () => {
    const contracts = internalRouteContracts();
    const readPermissionOf = (path: string): string | undefined =>
      contracts.find((contract) => contract.path === path && contract.method === 'get')?.permission;

    const allergies = readPermissionOf('/bff/v0/allergies');
    const statements = readPermissionOf('/bff/v0/medications/statements');
    expect(allergies, 'the allergy list contract has moved').toBeDefined();
    expect(statements, 'the medication statement list contract has moved').toBeDefined();
    expect(statements).toBe(allergies);

    for (const service of CDS_SERVICES) {
      expect(service.permission, service.definition.id).toBe(allergies);
    }
  });

  it('records the invocation as the chart read it is', async () => {
    const { app, dataset, auditStore } = harness();
    seedAllergy(dataset);

    await app.request('/cds-services/order-sign-safety', {
      method: 'POST',
      headers: jsonBearer(TOKENS.clinicianA),
      body: invocation(),
    });

    const events = auditStore
      .chain(DEMO_TENANT_A)
      .filter((event) => event.action === 'cds.invoked');

    expect(events).toHaveLength(1);
    expect(events[0]?.metadata).toMatchObject({ hook: 'order-sign', hookInstance: INSTANCE });
  });

  /**
   * Honouring `fhirServer` would be a server-side request forgery with a
   * specification behind it. It is recorded, and recorded as not followed, so
   * that a caller offering one can be shown not to have been.
   */
  it('records a FHIR server a caller offered, and that it was not followed', async () => {
    const { app, auditStore } = harness();

    await app.request('/cds-services/allergy-summary', {
      method: 'POST',
      headers: jsonBearer(TOKENS.clinicianA),
      body: invocation({
        hook: 'patient-view',
        fhirServer: 'http://169.254.169.254/latest/meta-data',
        prefetch: { patient: { resourceType: 'Patient' } },
      }),
    });

    const event = auditStore.chain(DEMO_TENANT_A).find((entry) => entry.action === 'cds.invoked');

    expect(event?.metadata).toMatchObject({
      offeredFhirServer: 'http://169.254.169.254/latest/meta-data',
      followed: false,
      prefetchOffered: true,
      used: false,
    });
  });
});

describe('what it refuses', () => {
  it('answers 404 for a service it does not serve', async () => {
    const { app } = harness();

    const res = await app.request('/cds-services/nonsense', {
      method: 'POST',
      headers: jsonBearer(TOKENS.clinicianA),
      body: invocation(),
    });

    expect(res.status).toBe(404);
  });

  it('refuses a body that is not JSON, and one that is not a hook request', async () => {
    const { app } = harness();

    const notJson = await app.request('/cds-services/allergy-summary', {
      method: 'POST',
      headers: jsonBearer(TOKENS.clinicianA),
      body: 'not json',
    });
    const notARequest = await app.request('/cds-services/allergy-summary', {
      method: 'POST',
      headers: jsonBearer(TOKENS.clinicianA),
      body: JSON.stringify({ hook: 'patient-view' }),
    });

    expect(notJson.status).toBe(400);
    expect(notARequest.status).toBe(400);
  });

  /**
   * A service answers one hook. Letting `order-sign-safety` answer a
   * `patient-view` invocation would mean screening draft orders that are not
   * there and reporting no findings, which reads as a clean bill.
   */
  it('refuses an invocation naming a hook the service does not answer', async () => {
    const { app } = harness();

    const res = await app.request('/cds-services/order-sign-safety', {
      method: 'POST',
      headers: jsonBearer(TOKENS.clinicianA),
      body: invocation({ hook: 'patient-view' }),
    });

    expect(res.status).toBe(400);
    expect(await res.text()).toContain('order-sign');
  });

  it('refuses an invocation with no patient in its context', async () => {
    const { app } = harness();

    const res = await app.request('/cds-services/allergy-summary', {
      method: 'POST',
      headers: jsonBearer(TOKENS.clinicianA),
      body: JSON.stringify({
        hook: 'patient-view',
        hookInstance: INSTANCE,
        context: { userId: 'Practitioner/1' },
      }),
    });

    expect(res.status).toBe(400);
    expect(await res.text()).toContain('patientId');
  });
});

describe('the allergy summary', () => {
  it('says nothing when there is nothing worth interrupting for', async () => {
    const { app } = harness();

    const res = await app.request('/cds-services/allergy-summary', {
      method: 'POST',
      headers: jsonBearer(TOKENS.clinicianA),
      body: invocation({ hook: 'patient-view' }),
    });

    expect((await res.json()) as CardBody).toEqual({ cards: [] });
  });

  it('names a high-criticality allergy and its reaction', async () => {
    const { app, dataset } = harness();
    seedAllergy(dataset);

    const res = await app.request('/cds-services/allergy-summary', {
      method: 'POST',
      headers: jsonBearer(TOKENS.clinicianA),
      body: invocation({ hook: 'patient-view' }),
    });
    const body = (await res.json()) as CardBody;

    expect(body.cards).toHaveLength(1);
    expect(body.cards[0]?.summary).toContain('Penicillin');
    expect(body.cards[0]?.detail).toContain('Anaphylaxis');
    expect(body.cards[0]?.indicator).toBe('warning');
  });

  /**
   * A card on every chart open is a card nobody reads by the second week, and
   * this one has to still be read on the day it matters.
   */
  it('stays silent for a low-criticality allergy', async () => {
    const { app, dataset } = harness();
    seedAllergy(dataset, { criticality: 'LOW' });

    const res = await app.request('/cds-services/allergy-summary', {
      method: 'POST',
      headers: jsonBearer(TOKENS.clinicianA),
      body: invocation({ hook: 'patient-view' }),
    });

    expect(((await res.json()) as CardBody).cards).toEqual([]);
  });

  it('accepts a patient reference as well as a bare id', async () => {
    const { app, dataset } = harness();
    seedAllergy(dataset);

    const res = await app.request('/cds-services/allergy-summary', {
      method: 'POST',
      headers: jsonBearer(TOKENS.clinicianA),
      body: JSON.stringify({
        hook: 'patient-view',
        hookInstance: INSTANCE,
        context: { userId: 'Practitioner/1', patientId: `Patient/${PATIENT}` },
      }),
    });

    expect(((await res.json()) as CardBody).cards).toHaveLength(1);
  });
});

describe('screening the draft orders', () => {
  it('warns about a draft that matches a recorded allergy', async () => {
    const { app, dataset } = harness();
    seedAllergy(dataset);

    const res = await app.request('/cds-services/order-sign-safety', {
      method: 'POST',
      headers: jsonBearer(TOKENS.clinicianA),
      body: invocation(),
    });
    const body = (await res.json()) as CardBody;

    expect(body.cards).toHaveLength(1);
    expect(body.cards[0]?.summary).toContain('Penicillin');
    expect(body.cards[0]?.indicator).toBe('critical');
  });

  /**
   * `clinical-safety` reports its own capabilities precisely so an empty result
   * is not read as a clean bill, and dropping that on the way into a card would
   * undo the whole point of it.
   */
  it('names what it did not check on every card it produces', async () => {
    const { app, dataset } = harness();
    seedAllergy(dataset);

    const res = await app.request('/cds-services/order-sign-safety', {
      method: 'POST',
      headers: jsonBearer(TOKENS.clinicianA),
      body: invocation(),
    });
    const body = (await res.json()) as CardBody;

    expect(body.cards[0]?.detail).toContain('Not checked');
    expect(body.cards[0]?.detail).toContain('drug-drug');
  });

  it('says nothing about a draft that matches nothing', async () => {
    const { app, dataset } = harness();
    seedAllergy(dataset);

    const res = await app.request('/cds-services/order-sign-safety', {
      method: 'POST',
      headers: jsonBearer(TOKENS.clinicianA),
      body: invocation({
        context: {
          userId: 'Practitioner/1',
          patientId: PATIENT,
          draftOrders: {
            entry: [
              {
                resource: {
                  resourceType: 'MedicationRequest',
                  medicationCodeableConcept: { text: 'Metformin 500mg' },
                },
              },
            ],
          },
        },
      }),
    });

    expect(((await res.json()) as CardBody).cards).toEqual([]);
  });

  /**
   * Screening nothing and reporting no findings is the one outcome worse than
   * not screening at all, so an order whose medication cannot be read is skipped
   * rather than screened against an empty value.
   */
  it('skips an order it cannot read a medication out of', async () => {
    const { app, dataset } = harness();
    seedAllergy(dataset);

    const res = await app.request('/cds-services/order-sign-safety', {
      method: 'POST',
      headers: jsonBearer(TOKENS.clinicianA),
      body: invocation({
        context: {
          userId: 'Practitioner/1',
          patientId: PATIENT,
          draftOrders: {
            entry: [
              { resource: { resourceType: 'ServiceRequest', id: 'not a medication' } },
              { resource: { resourceType: 'MedicationRequest', id: 'no medication at all' } },
              {
                resource: {
                  resourceType: 'MedicationRequest',
                  medicationReference: { reference: 'Medication/1' },
                },
              },
              // The dangerous one: a concept is present and names nothing. An
              // empty display screened against the chart matches EVERY recorded
              // allergy, because every substance name contains the empty string.
              {
                resource: {
                  resourceType: 'MedicationRequest',
                  medicationCodeableConcept: { coding: [{ code: '7980' }] },
                },
              },
              {
                resource: {
                  resourceType: 'MedicationRequest',
                  medicationCodeableConcept: { text: '' },
                },
              },
              {
                resource: {
                  resourceType: 'MedicationRequest',
                  medicationCodeableConcept: {},
                },
              },
            ],
          },
        },
      }),
    });

    expect(res.status).toBe(200);
    expect(((await res.json()) as CardBody).cards).toEqual([]);
  });

  it('produces one card per finding, so a prescriber sees which order is the problem', async () => {
    const { app, dataset } = harness();
    seedAllergy(dataset);

    const res = await app.request('/cds-services/order-select-safety', {
      method: 'POST',
      headers: jsonBearer(TOKENS.clinicianA),
      body: invocation({
        hook: 'order-select',
        context: {
          userId: 'Practitioner/1',
          patientId: PATIENT,
          selections: ['MedicationRequest/draft-1'],
          draftOrders: {
            entry: [
              {
                resource: {
                  resourceType: 'MedicationRequest',
                  medicationCodeableConcept: { text: 'Penicillin V Potassium' },
                },
              },
              {
                resource: {
                  resourceType: 'MedicationRequest',
                  medicationCodeableConcept: { text: 'Amoxicillin 500mg' },
                },
              },
            ],
          },
        },
      }),
    });
    const body = (await res.json()) as CardBody;

    expect(body.cards.length).toBeGreaterThanOrEqual(2);
    expect(body.cards.some((entry) => entry.summary.includes('Penicillin V Potassium'))).toBe(true);
    expect(body.cards.some((entry) => entry.summary.includes('Amoxicillin'))).toBe(true);
  });

  it('names the source on every card, so a clinician knows what is advising them', async () => {
    const { app, dataset } = harness();
    seedAllergy(dataset);

    const res = await app.request('/cds-services/order-sign-safety', {
      method: 'POST',
      headers: jsonBearer(TOKENS.clinicianA),
      body: invocation(),
    });
    const body = (await res.json()) as CardBody;

    expect(body.cards.every((entry) => entry.source.label === 'openrunic clinical safety')).toBe(
      true
    );
  });

  it('cannot see another organisation’s chart', async () => {
    const { app, dataset } = harness();
    seedAllergy(dataset);

    const res = await app.request('/cds-services/allergy-summary', {
      method: 'POST',
      headers: jsonBearer(TOKENS.clinicianB),
      body: invocation({ hook: 'patient-view' }),
    });

    // The repositories are bound to the caller's tenant, so the chart is simply
    // not there - which is the same answer as a patient with no allergies, and
    // deliberately so: a distinguishable response would confirm the id exists.
    expect(((await res.json()) as CardBody).cards).toEqual([]);
  });
});

describe('naming what was checked', () => {
  /**
   * The whole point of the port is that a deployer swaps in one that checks
   * more. A card that hard-coded this build's gaps would keep announcing them
   * after they were filled.
   */
  it('drops the "not checked" half when there is nothing left to name', () => {
    const complete = {
      capabilities: [
        'allergy',
        'drug-drug',
        'duplicate-therapy',
        'dose-range',
        'pregnancy',
      ] as const,
      screen: () => ({ findings: [], requiresAcknowledgement: false }),
    };

    expect(checkedLine(complete)).toContain('Checked: allergy, drug-drug');
    expect(checkedLine(complete)).not.toContain('Not checked');
  });

  it('names the gaps of a port that has them', () => {
    const allergyOnly = {
      capabilities: ['allergy'] as const,
      screen: () => ({ findings: [], requiresAcknowledgement: false }),
    };

    expect(checkedLine(allergyOnly)).toContain('Not checked: drug-drug');
  });
});

describe('the parts of a chart a card is built from', () => {
  it('reads an allergy recorded with no code and no reaction text', async () => {
    const { app, dataset } = harness();
    seedAllergy(dataset, {
      substanceCode: null,
      reactionText: null,
      substanceDisplay: 'Shellfish',
    });

    const res = await app.request('/cds-services/allergy-summary', {
      method: 'POST',
      headers: jsonBearer(TOKENS.clinicianA),
      body: invocation({ hook: 'patient-view' }),
    });
    const body = (await res.json()) as CardBody;

    expect(body.cards[0]?.summary).toContain('Shellfish');
    expect(body.cards[0]?.detail).not.toContain(' - ');
  });

  it('screens against the medication list as well as the allergies', async () => {
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
      reportedAt: new Date('2026-01-01T00:00:00.000Z'),
      note: null,
    } as never);

    const res = await app.request('/cds-services/order-sign-safety', {
      method: 'POST',
      headers: jsonBearer(TOKENS.clinicianA),
      body: invocation({
        context: {
          userId: 'Practitioner/1',
          patientId: PATIENT,
          draftOrders: {
            entry: [
              {
                resource: {
                  resourceType: 'MedicationRequest',
                  medicationCodeableConcept: {
                    coding: [{ code: '860975', display: 'Metformin 1000 mg' }],
                  },
                },
              },
            ],
          },
        },
      }),
    });
    const body = (await res.json()) as CardBody;

    expect(body.cards).toHaveLength(1);
    expect(body.cards[0]?.summary).toContain('duplicates');
  });

  it('falls back to the concept text when a coding carries no display', async () => {
    const { app, dataset } = harness();
    seedAllergy(dataset);

    const res = await app.request('/cds-services/order-sign-safety', {
      method: 'POST',
      headers: jsonBearer(TOKENS.clinicianA),
      body: invocation({
        context: {
          userId: 'Practitioner/1',
          patientId: PATIENT,
          draftOrders: {
            entry: [
              {
                resource: {
                  resourceType: 'MedicationRequest',
                  medicationCodeableConcept: {
                    text: 'Penicillin G',
                    coding: [{ code: '7980' }],
                  },
                },
              },
            ],
          },
        },
      }),
    });

    expect(((await res.json()) as CardBody).cards[0]?.summary).toContain('Penicillin G');
  });

  it('records the encounter a hook was invoked from, when the caller names one', async () => {
    const { app, auditStore } = harness();

    await app.request('/cds-services/allergy-summary', {
      method: 'POST',
      headers: jsonBearer(TOKENS.clinicianA),
      body: JSON.stringify({
        hook: 'patient-view',
        hookInstance: INSTANCE,
        context: { userId: 'Practitioner/1', patientId: PATIENT, encounterId: testId(300) },
      }),
    });

    const event = auditStore.chain(DEMO_TENANT_A).find((entry) => entry.action === 'cds.invoked');

    expect(event?.metadata).toMatchObject({ encounterId: testId(300) });
  });
});
