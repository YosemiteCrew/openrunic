import { describe, expect, it } from 'vitest';

import type { ScopedRow } from '../repositories/rows.js';
import { portalRouteContracts } from '../routes/portal.js';

import {
  DEMO_FACILITY_A,
  DEMO_PORTAL_PATIENT,
  FIXED_NOW,
  TOKENS,
  bearer,
  createTestApp,
  jsonBearer,
  makeAppointmentRow,
  makePatientRow,
  seed,
  storageColumns,
  testId,
} from './support.js';

const OTHER_PATIENT = testId(2);
const FACILITY = DEMO_FACILITY_A;

function enablePortal(dataset: ReturnType<typeof createTestApp>['dataset']): void {
  seed(
    dataset,
    'Patient',
    makePatientRow({ id: DEMO_PORTAL_PATIENT, portalEnabled: true }),
    makePatientRow({ id: OTHER_PATIENT, mrn: 'OR-100483', portalEnabled: true })
  );
}

function makeFacilityRow(overrides: Partial<ScopedRow<'Facility'>> = {}): ScopedRow<'Facility'> {
  return {
    ...storageColumns(FACILITY),
    name: 'Testville Clinic',
    code: 'TVC',
    npi: null,
    posCode: '11',
    timezone: 'UTC',
    addressLine1: '100 Example Way',
    addressLine2: null,
    city: 'Testville',
    state: 'CA',
    postalCode: '90000',
    country: 'US',
    phone: null,
    active: true,
    ...overrides,
  };
}

function makeObservationRow(
  overrides: Partial<ScopedRow<'Observation'>> = {}
): ScopedRow<'Observation'> {
  return {
    ...storageColumns(testId(300)),
    patientId: DEMO_PORTAL_PATIENT,
    encounterId: null,
    category: 'LABORATORY',
    status: 'FINAL',
    loincCode: '718-7',
    code: '718-7',
    codeSystem: 'http://loinc.org',
    display: 'Haemoglobin',
    valueNumber: 11.2,
    valueText: null,
    valueCode: null,
    valueBoolean: null,
    unit: 'g/dL',
    referenceLow: 12,
    referenceHigh: 16,
    interpretationCode: null,
    bodySiteCode: null,
    effectiveAt: FIXED_NOW,
    issuedAt: null,
    performerId: null,
    formSubmissionId: null,
    ...overrides,
  };
}

function makeProblemRow(overrides: Partial<ScopedRow<'Condition'>> = {}): ScopedRow<'Condition'> {
  return {
    ...storageColumns(testId(310)),
    patientId: DEMO_PORTAL_PATIENT,
    encounterId: null,
    category: 'PROBLEM_LIST_ITEM',
    code: 'J45.909',
    codeSystem: 'http://hl7.org/fhir/sid/icd-10-cm',
    display: 'Unspecified asthma, uncomplicated',
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
    ...overrides,
  };
}

function makeMedicationRow(
  overrides: Partial<ScopedRow<'MedicationStatement'>> = {}
): ScopedRow<'MedicationStatement'> {
  return {
    ...storageColumns(testId(320)),
    patientId: DEMO_PORTAL_PATIENT,
    encounterId: null,
    rxnormCode: '860975',
    display: 'Metformin 500 mg oral tablet',
    sigText: 'Take one tablet daily.',
    status: 'ACTIVE',
    source: 'REPORTED',
    effectiveStart: FIXED_NOW,
    effectiveEnd: null,
    reportedAt: FIXED_NOW,
    note: null,
    ...overrides,
  };
}

function makeAllergyRow(
  overrides: Partial<ScopedRow<'AllergyIntolerance'>> = {}
): ScopedRow<'AllergyIntolerance'> {
  return {
    ...storageColumns(testId(330)),
    patientId: DEMO_PORTAL_PATIENT,
    type: 'ALLERGY',
    category: 'MEDICATION',
    criticality: 'HIGH',
    clinicalStatus: 'ACTIVE',
    substanceCode: null,
    substanceCodeSystem: null,
    substanceDisplay: 'Penicillin V',
    reactionCodes: [],
    reactionText: 'Rash',
    severity: 'MODERATE',
    onsetDate: null,
    note: null,
    recordedAt: FIXED_NOW,
    recordedById: null,
    ...overrides,
  };
}

function makeImmunisationRow(
  overrides: Partial<ScopedRow<'Immunization'>> = {}
): ScopedRow<'Immunization'> {
  return {
    ...storageColumns(testId(340)),
    patientId: DEMO_PORTAL_PATIENT,
    encounterId: null,
    status: 'COMPLETED',
    cvxCode: '150',
    mvxCode: null,
    ndcCode: null,
    display: 'Influenza vaccine, quadrivalent',
    lotNumber: null,
    expirationDate: null,
    siteCode: null,
    routeCode: null,
    doseQuantity: 1,
    doseUnit: 'dose',
    administeredAt: FIXED_NOW,
    administeredById: null,
    visDate: null,
    refusalReasonCode: null,
    reportedToRegistryAt: null,
    ...overrides,
  };
}

function makeDocumentRow(overrides: Partial<ScopedRow<'Document'>> = {}): ScopedRow<'Document'> {
  return {
    ...storageColumns(testId(350)),
    patientId: DEMO_PORTAL_PATIENT,
    encounterId: null,
    category: '11488-4',
    title: 'Consult note',
    storageKey: 'documents/consult-note.pdf',
    contentType: 'application/pdf',
    sha256: 'a'.repeat(64),
    byteSize: 20_480,
    source: 'FAX',
    status: 'FILED',
    sensitivityClass: 'NORMAL',
    receivedAt: FIXED_NOW,
    filedAt: FIXED_NOW,
    filedById: null,
    expiresAt: null,
    supersededById: null,
    errorReason: null,
    ...overrides,
  };
}

function makeThreadRow(
  overrides: Partial<ScopedRow<'MessageThread'>> = {}
): ScopedRow<'MessageThread'> {
  return {
    ...storageColumns(testId(400)),
    kind: 'PATIENT',
    patientId: DEMO_PORTAL_PATIENT,
    subject: 'Question about my results',
    lastMessageAt: FIXED_NOW,
    closedAt: null,
    ...overrides,
  };
}

function makeMessageRow(overrides: Partial<ScopedRow<'Message'>> = {}): ScopedRow<'Message'> {
  return {
    ...storageColumns(testId(410)),
    threadId: testId(400),
    patientId: DEMO_PORTAL_PATIENT,
    senderType: 'USER',
    senderUserId: testId(900),
    senderPatientId: null,
    body: 'Your results are ready to discuss.',
    sentAt: FIXED_NOW,
    readAt: null,
    ...overrides,
  };
}

function makeStatementRow(overrides: Partial<ScopedRow<'Statement'>> = {}): ScopedRow<'Statement'> {
  return {
    ...storageColumns(testId(500)),
    patientId: DEMO_PORTAL_PATIENT,
    status: 'SENT',
    balanceCents: 2_500,
    currency: 'EUR',
    dunningCycle: 1,
    lastNoticeAt: null,
    holdUntil: null,
    holdReason: null,
    closedReason: null,
    periodStart: null,
    periodEnd: null,
    generatedAt: FIXED_NOW,
    deliveredVia: 'PORTAL',
    deliveredAt: FIXED_NOW,
    pdfStorageKey: null,
    payLinkToken: null,
    payLinkExpiresAt: null,
    paidAt: null,
    ...overrides,
  };
}

function makeFormDefinitionRow(): ScopedRow<'FormDefinition'> {
  return {
    ...storageColumns(testId(600)),
    key: 'patient-intake',
    version: 1,
    status: 'PUBLISHED',
    title: 'Patient intake',
    description: 'Information for your care team.',
    bindTo: 'PORTAL',
    definition: { fields: [] },
    compiled: null,
    promotionManifest: null,
    publishedAt: FIXED_NOW,
    publishedById: testId(900),
    retiredAt: null,
  };
}

function makeFormSubmissionRow(
  overrides: Partial<ScopedRow<'FormSubmission'>> = {}
): ScopedRow<'FormSubmission'> {
  return {
    ...storageColumns(testId(610)),
    formDefinitionId: testId(600),
    patientId: DEMO_PORTAL_PATIENT,
    encounterId: null,
    status: 'IN_PROGRESS',
    values: { consent: true, note: 'Synthetic answer', ignored: 17 },
    completedByType: 'PATIENT',
    completedByUserId: null,
    completedAt: null,
    signedAt: null,
    signedById: null,
    effectiveAt: FIXED_NOW,
    ...overrides,
  };
}

describe('patient portal identity boundary', () => {
  it.each([
    ['an anonymous request', undefined, 401],
    ['a staff session', TOKENS.adminA, 403],
    ['a patient actor without a compartment', TOKENS.portalNoCompartmentA, 403],
    ['a user actor with the portal role', TOKENS.portalUserActorA, 403],
    ['a patient actor without the portal role', TOKENS.portalNoRoleA, 403],
    ['a patient actor bound to a different compartment', TOKENS.portalMismatchedCompartmentA, 403],
  ])('refuses %s', async (_label, token, status) => {
    const { app, dataset } = createTestApp();
    enablePortal(dataset);
    const response = await app.request('/bff/v0/portal/patient', {
      ...(token === undefined ? {} : { headers: bearer(token) }),
    });
    expect(response.status).toBe(status);
    if (status === 403) {
      expect(await response.json()).toMatchObject({
        detail: 'This route is available only to a patient portal session.',
      });
    }
  });

  it('refuses a patient whose portal access is disabled', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'Patient', makePatientRow({ id: DEMO_PORTAL_PATIENT, portalEnabled: false }));
    expect(
      (await app.request('/bff/v0/portal/patient', { headers: bearer(TOKENS.portalA) })).status
    ).toBe(403);
  });

  it('returns only the patient bound to the verified principal', async () => {
    const { app, dataset } = createTestApp();
    enablePortal(dataset);
    const response = await app.request('/bff/v0/portal/patient', {
      headers: bearer(TOKENS.portalA),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      id: DEMO_PORTAL_PATIENT,
      name: 'Testina Patientsson',
      mrn: 'OR-100482',
      dateOfBirth: '1994-03-02',
    });
  });
});

describe('GET /bff/v0/portal/appointments', () => {
  it('paginates every own-chart row and never invents visit mode or clinician identity', async () => {
    const { app, dataset } = createTestApp();
    enablePortal(dataset);
    seed(dataset, 'Facility', makeFacilityRow());
    for (let index = 0; index < 101; index += 1) {
      seed(
        dataset,
        'Appointment',
        makeAppointmentRow({
          id: testId(10_000 + index),
          patientId: DEMO_PORTAL_PATIENT,
          facilityId: FACILITY,
          room: 'Room 4',
        })
      );
    }
    seed(
      dataset,
      'Appointment',
      makeAppointmentRow({ id: testId(11_000), patientId: OTHER_PATIENT, facilityId: FACILITY })
    );

    const response = await app.request('/bff/v0/portal/appointments', {
      headers: bearer(TOKENS.portalA),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      upcoming: Array<Record<string, unknown>>;
      past: Array<Record<string, unknown>>;
      requestsSupported: boolean;
    };
    expect(body.upcoming).toHaveLength(101);
    expect(body.past).toHaveLength(0);
    expect(body.requestsSupported).toBe(false);
    expect(body.upcoming[0]).toMatchObject({
      clinician: null,
      department: 'Testville Clinic',
      mode: null,
      joinUrl: null,
      cancellationSupported: false,
      rescheduleSupported: false,
    });
    expect(body.upcoming.map((row) => row.id)).not.toContain(testId(11_000));
  });

  it('separates past and cancelled visits and omits entered-in-error rows', async () => {
    const { app, dataset } = createTestApp();
    enablePortal(dataset);
    seed(
      dataset,
      'Appointment',
      makeAppointmentRow({
        id: testId(12_000),
        patientId: DEMO_PORTAL_PATIENT,
        facilityId: testId(9_999),
        reasonText: null,
        room: null,
        start: new Date(FIXED_NOW.getTime() - 60_000),
      }),
      makeAppointmentRow({
        id: testId(12_001),
        patientId: DEMO_PORTAL_PATIENT,
        facilityId: testId(9_999),
        status: 'CANCELLED',
      }),
      makeAppointmentRow({
        id: testId(12_002),
        patientId: DEMO_PORTAL_PATIENT,
        facilityId: testId(9_999),
        status: 'ENTERED_IN_ERROR',
      })
    );

    const response = await app.request('/bff/v0/portal/appointments', {
      headers: bearer(TOKENS.portalA),
    });
    const body = (await response.json()) as {
      upcoming: Array<Record<string, unknown>>;
      past: Array<Record<string, unknown>>;
    };

    expect(body.upcoming).toHaveLength(0);
    expect(body.past).toEqual([
      expect.objectContaining({ id: testId(12_000), location: null }),
      expect.objectContaining({ id: testId(12_001) }),
    ]);
  });
});

describe('GET /bff/v0/portal/health-record', () => {
  it('returns own-chart facts without fake glosses and omits numeric results with no unit', async () => {
    const { app, dataset } = createTestApp();
    enablePortal(dataset);
    seed(
      dataset,
      'Condition',
      makeProblemRow(),
      makeProblemRow({ id: testId(311), patientId: OTHER_PATIENT })
    );
    seed(
      dataset,
      'Observation',
      makeObservationRow(),
      makeObservationRow({ id: testId(301), unit: null }),
      makeObservationRow({ id: testId(302), patientId: OTHER_PATIENT })
    );

    const response = await app.request('/bff/v0/portal/health-record', {
      headers: bearer(TOKENS.portalA),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      problems: Array<Record<string, unknown>>;
      results: Array<Record<string, unknown>>;
    };
    expect(body.problems).toEqual([
      expect.objectContaining({ id: testId(310), plain: null, status: 'active' }),
    ]);
    expect(body.results).toEqual([
      expect.objectContaining({
        id: testId(300),
        plain: null,
        unit: 'g/dL',
        range: 'out-of-range',
      }),
    ]);
  });

  it('maps the supported clinical families and filters unsafe rows', async () => {
    const { app, dataset } = createTestApp();
    enablePortal(dataset);
    seed(
      dataset,
      'MedicationStatement',
      makeMedicationRow(),
      makeMedicationRow({ id: testId(321), status: 'ENTERED_IN_ERROR' })
    );
    seed(dataset, 'AllergyIntolerance', makeAllergyRow());
    seed(
      dataset,
      'Immunization',
      makeImmunisationRow(),
      makeImmunisationRow({ id: testId(341), status: 'ENTERED_IN_ERROR' })
    );
    seed(
      dataset,
      'Document',
      makeDocumentRow(),
      makeDocumentRow({ id: testId(351), status: 'INBOX' }),
      makeDocumentRow({ id: testId(352), sensitivityClass: 'RESTRICTED' })
    );

    const response = await app.request('/bff/v0/portal/health-record', {
      headers: bearer(TOKENS.portalA),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      medications: [
        {
          id: testId(320),
          name: 'Metformin 500 mg oral tablet',
          instruction: 'Take one tablet daily.',
          startedOn: FIXED_NOW.toISOString(),
        },
      ],
      allergies: [
        {
          id: testId(330),
          substance: 'Penicillin V',
          reaction: 'Rash',
          severity: 'moderate',
        },
      ],
      immunisations: [
        {
          id: testId(340),
          vaccine: 'Influenza vaccine, quadrivalent',
          doseQuantity: 1,
          doseUnit: 'dose',
        },
      ],
      documents: [
        {
          id: testId(350),
          title: 'Consult note',
          contentType: 'application/pdf',
          byteSize: 20_480,
        },
      ],
    });
  });

  it('drops a half-recorded dose rather than sending a number with no unit', async () => {
    // The DTO says both halves are present or neither is, and the naive mapping - passing
    // each column through on its own - satisfies every other test in this file, because
    // `makeImmunisationRow` has both. This is the row that separates them.
    const { app, dataset } = createTestApp();
    enablePortal(dataset);
    seed(
      dataset,
      'Immunization',
      makeImmunisationRow({ id: testId(342), doseUnit: null }),
      makeImmunisationRow({ id: testId(343), doseQuantity: null })
    );

    const response = await app.request('/bff/v0/portal/health-record', {
      headers: bearer(TOKENS.portalA),
    });
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      immunisations: { id: string; doseQuantity: number | null; doseUnit: string | null }[];
    };
    // A quantity with no unit is not a reading: `5` with the unit missing is a number the
    // reader would have to guess at, and guessing is what a dose must never invite.
    expect(body.immunisations).toEqual([
      expect.objectContaining({ id: testId(342), doseQuantity: null, doseUnit: null }),
      expect.objectContaining({ id: testId(343), doseQuantity: null, doseUnit: null }),
    ]);
  });

  it('derives reference labels without diagnosing a result', async () => {
    const { app, dataset } = createTestApp();
    enablePortal(dataset);
    seed(
      dataset,
      'Observation',
      makeObservationRow({ id: testId(360), interpretationCode: 'N' }),
      makeObservationRow({ id: testId(361), interpretationCode: 'H' }),
      makeObservationRow({
        id: testId(362),
        referenceLow: null,
        referenceHigh: null,
      }),
      makeObservationRow({ id: testId(363), referenceHigh: null, valueNumber: 13 }),
      makeObservationRow({ id: testId(364), referenceLow: null, valueNumber: 13 }),
      makeObservationRow({ id: testId(365), status: 'ENTERED_IN_ERROR' })
    );

    const response = await app.request('/bff/v0/portal/health-record', {
      headers: bearer(TOKENS.portalA),
    });
    const body = (await response.json()) as {
      results: Array<{ id: string; range: string; referenceRange: string }>;
    };

    expect(body.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: testId(360), range: 'in-range' }),
        expect.objectContaining({ id: testId(361), range: 'out-of-range' }),
        expect.objectContaining({ id: testId(362), range: 'unknown', referenceRange: '' }),
        expect.objectContaining({ id: testId(363), referenceRange: 'at least 12' }),
        expect.objectContaining({ id: testId(364), referenceRange: 'up to 16' }),
      ])
    );
    expect(body.results.map((result) => result.id)).not.toContain(testId(365));
  });
});

describe('GET /bff/v0/portal/home', () => {
  it('aggregates only the signed-in patient home facts', async () => {
    const { app, dataset } = createTestApp();
    enablePortal(dataset);
    seed(dataset, 'Facility', makeFacilityRow());
    seed(
      dataset,
      'Appointment',
      makeAppointmentRow({ patientId: DEMO_PORTAL_PATIENT, facilityId: FACILITY })
    );
    seed(dataset, 'MessageThread', makeThreadRow());
    seed(dataset, 'Message', makeMessageRow());
    seed(dataset, 'Statement', makeStatementRow());

    const response = await app.request('/bff/v0/portal/home', {
      headers: bearer(TOKENS.portalA),
    });
    const body = (await response.json()) as {
      nextAppointment: Record<string, unknown>;
    };

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      patient: { id: DEMO_PORTAL_PATIENT },
      nextAppointment: { id: testId(101) },
      balance: {
        outstanding: { amountMinor: 2_500, currency: 'EUR' },
        dueOn: null,
        statementCount: 1,
      },
      unreadMessages: 1,
      actionItems: [],
      appointmentRequestsSupported: false,
    });
    expect(body.nextAppointment).not.toHaveProperty('patientId');
  });

  it('does not combine balances denominated in different currencies', async () => {
    const { app, dataset } = createTestApp();
    enablePortal(dataset);
    seed(
      dataset,
      'Statement',
      makeStatementRow(),
      makeStatementRow({ id: testId(501), currency: 'USD' })
    );

    const response = await app.request('/bff/v0/portal/home', {
      headers: bearer(TOKENS.portalA),
    });

    expect(await response.json()).toMatchObject({
      nextAppointment: null,
      balance: { outstanding: null, statementCount: 2 },
      unreadMessages: 0,
    });
  });
});

describe('patient portal messages', () => {
  it('lists only the patient thread and counts an unread care-team message', async () => {
    const { app, dataset } = createTestApp();
    enablePortal(dataset);
    seed(
      dataset,
      'MessageThread',
      makeThreadRow(),
      makeThreadRow({ id: testId(401), patientId: OTHER_PATIENT })
    );
    seed(
      dataset,
      'Message',
      makeMessageRow(),
      makeMessageRow({
        id: testId(411),
        threadId: testId(401),
        patientId: OTHER_PATIENT,
      })
    );
    const response = await app.request('/bff/v0/portal/messages', {
      headers: bearer(TOKENS.portalA),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      expect.objectContaining({
        id: testId(400),
        unread: true,
        correspondent: null,
        replySupported: true,
        messages: [expect.objectContaining({ author: 'care-team', authorName: null })],
      }),
    ]);
  });

  it('stamps a reply from the verified patient into the same compartment', async () => {
    const { app, dataset } = createTestApp();
    enablePortal(dataset);
    seed(dataset, 'MessageThread', makeThreadRow());
    const response = await app.request(`/bff/v0/portal/messages/${testId(400)}/replies`, {
      method: 'POST',
      headers: jsonBearer(TOKENS.portalA),
      body: JSON.stringify({ body: 'Please call me after 15:00.' }),
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      author: 'patient',
      authorName: 'Testina Patientsson',
      body: 'Please call me after 15:00.',
    });
    expect(dataset.table('Message')).toContainEqual(
      expect.objectContaining({
        threadId: testId(400),
        patientId: DEMO_PORTAL_PATIENT,
        senderPatientId: DEMO_PORTAL_PATIENT,
        senderType: 'PATIENT',
      })
    );
  });

  it('does not let a patient reply to another chart thread by id', async () => {
    const { app, dataset } = createTestApp();
    enablePortal(dataset);
    seed(dataset, 'MessageThread', makeThreadRow({ patientId: OTHER_PATIENT }));

    const response = await app.request(`/bff/v0/portal/messages/${testId(400)}/replies`, {
      method: 'POST',
      headers: jsonBearer(TOKENS.portalA),
      body: JSON.stringify({ body: 'This must not cross the compartment.' }),
    });

    expect(response.status).toBe(404);
    expect(dataset.table('Message')).toHaveLength(0);
  });

  it('does not let a patient reply to a staff thread', async () => {
    const { app, dataset } = createTestApp();
    enablePortal(dataset);
    seed(dataset, 'MessageThread', makeThreadRow({ kind: 'STAFF' }));

    const response = await app.request(`/bff/v0/portal/messages/${testId(400)}/replies`, {
      method: 'POST',
      headers: jsonBearer(TOKENS.portalA),
      body: JSON.stringify({ body: 'This must stay in patient conversations.' }),
    });

    expect(response.status).toBe(404);
    expect(dataset.table('Message')).toHaveLength(0);
  });
});

describe('patient portal forms and statements', () => {
  it('shows only existing own-chart submissions and does not pretend unsupported editing works', async () => {
    const { app, dataset } = createTestApp();
    enablePortal(dataset);
    seed(dataset, 'FormDefinition', makeFormDefinitionRow());
    seed(
      dataset,
      'FormSubmission',
      makeFormSubmissionRow(),
      makeFormSubmissionRow({ id: testId(611), patientId: OTHER_PATIENT })
    );
    const response = await app.request('/bff/v0/portal/forms', {
      headers: bearer(TOKENS.portalA),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      expect.objectContaining({
        id: testId(610),
        dueOn: null,
        editable: false,
        questions: [],
        answers: { consent: 'Yes', note: 'Synthetic answer' },
      }),
    ]);
  });

  it('shows delivered own-chart statement balances in their persisted currency', async () => {
    const { app, dataset } = createTestApp();
    enablePortal(dataset);
    seed(
      dataset,
      'Statement',
      makeStatementRow(),
      makeStatementRow({ id: testId(501), status: 'DRAFT' }),
      makeStatementRow({ id: testId(502), patientId: OTHER_PATIENT })
    );
    const response = await app.request('/bff/v0/portal/statements', {
      headers: bearer(TOKENS.portalA),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      expect.objectContaining({
        id: testId(500),
        balance: { amountMinor: 2_500, currency: 'EUR' },
        total: null,
        lines: [],
        detailsAvailable: false,
        paymentAvailable: false,
      }),
    ]);
  });
});

describe('portal OpenAPI contracts', () => {
  it('publishes only subject-free patient paths', () => {
    expect(portalRouteContracts.map((contract) => contract.path)).toEqual([
      '/bff/v0/portal/patient',
      '/bff/v0/portal/home',
      '/bff/v0/portal/health-record',
      '/bff/v0/portal/messages',
      '/bff/v0/portal/messages/{id}/replies',
      '/bff/v0/portal/appointments',
      '/bff/v0/portal/forms',
      '/bff/v0/portal/statements',
    ]);
  });
});
