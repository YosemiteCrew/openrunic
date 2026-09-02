import type { Bundle, FhirResource } from '@openrunic/fhir';
import { describe, expect, it } from 'vitest';

import { SERVED_MODULES } from '../fhir/resources.js';
import type { AuditChainStore } from '../audit/chain-store.js';
import type { MemoryDataset } from '../repositories/memory.js';
import type { ScopedRow } from '../repositories/rows.js';
import type { ClaimStatus } from '../repositories/specs/financial.js';

import {
  DEMO_TENANT_A,
  DEMO_TENANT_B,
  bearer,
  createTestApp,
  DEMO_FACILITY_A,
  FIXED_NOW,
  makeAppointmentRow,
  makePatientRow,
  seed,
  storageColumns,
  testId,
  TOKENS,
  UNPRIVILEGED_TOKEN,
} from './support.js';

/**
 * Every served resource, seeded and read back.
 *
 * The conformance suite proves the router answers for each resource type; this
 * one proves the answer is a resource. They are separate because they fail for
 * different reasons: a missing route is a wiring mistake, and a projection that
 * drops a field or hands the mapper a shape it cannot read is a data mistake,
 * and a suite that only searched empty tables would catch the first and miss
 * the second entirely.
 */

const PATIENT = testId(1);
const PROVIDER = testId(900);
const ENCOUNTER = testId(20);
const CLAIM = testId(940);
const SECOND_CLAIM = testId(941);
const ORDER = testId(30);
const REPORT = testId(40);
const NURSE_ROLE = testId(970);
const SITE_GRANT = testId(971);
const ORG_GRANT = testId(972);
const SECOND_PROVIDER = testId(901);
const SECOND_GRANT = testId(976);
const SECOND_SITE = testId(975);

function seedChart(dataset: MemoryDataset): void {
  // The tenant's own row. Its id IS the tenant id, which is the whole reason
  // `Organisation` carries no `tenantId` column and cannot be a spec: it is the
  // thing every other row's `tenantId` points at.
  seed(dataset, 'Organisation', {
    id: DEMO_TENANT_A,
    slug: 'demo-practice',
    name: 'Demo Family Practice',
    mode: 'SELF_HOST',
    status: 'ACTIVE',
    timezone: 'UTC',
    flags: {},
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
  } as unknown as Parameters<typeof seed>[2]);

  seed(dataset, 'Patient', makePatientRow({ id: PATIENT }));
  seed(dataset, 'Appointment', makeAppointmentRow({ id: testId(101) }));

  seed(dataset, 'User', {
    ...storageColumns(PROVIDER),
    email: 'a.okafor@example.invalid',
    givenName: 'Adaeze',
    familyName: 'Okafor',
    credential: 'MD',
    npi: '1234567893',
    dea: null,
    taxonomyCode: '207Q00000X',
    isProvider: true,
    locale: 'en-US',
    status: 'ACTIVE',
    lastLoginAt: null,
  });

  seed(dataset, 'Facility', {
    ...storageColumns(DEMO_FACILITY_A),
    name: 'Testville Clinic',
    code: 'TVC',
    npi: null,
    posCode: '11',
    timezone: 'UTC',
    addressLine1: '1 Test Street',
    addressLine2: null,
    city: 'Testville',
    state: 'TS',
    postalCode: '00000',
    country: 'US',
    phone: '+15550100',
    active: true,
  });

  seed(dataset, 'Coverage', {
    ...storageColumns(testId(10)),
    patientId: PATIENT,
    payerId: testId(11),
    rank: 'PRIMARY',
    status: 'ACTIVE',
    memberId: 'TM-0001',
    groupNumber: 'GRP-1',
    planName: 'Testline Mutual Standard',
    subscriberRelationshipCode: 'self',
    subscriberGivenName: null,
    subscriberFamilyName: null,
    subscriberBirthDate: null,
    effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
    effectiveTo: null,
    copayCents: 2500,
    deductibleCents: 100000,
    acceptAssignment: true,
  });

  /* A guardian who is also the emergency contact, so the projection exercises
     both role codings rather than only the recorded relationship. */
  seed(dataset, 'RelatedPerson', {
    ...storageColumns(testId(12)),
    patientId: PATIENT,
    relationshipCode: 'MTH',
    relationshipText: 'Mother',
    givenName: 'Marisol',
    familyName: 'Verificada',
    phone: '+1 555 0142 118',
    email: null,
    addressLine1: null,
    city: null,
    state: null,
    postalCode: null,
    country: 'US',
    isGuardian: true,
    isEmergencyContact: true,
    isPortalProxy: false,
    active: true,
  });

  /*
   * A published form and one completed submission against it. The definition
   * has to be PUBLISHED and has to compile, because that is exactly the pair of
   * conditions the Questionnaire modules rely on: the search filters on the
   * first and the projection assumes the second.
   */
  seed(dataset, 'FormDefinition', {
    ...storageColumns(testId(13)),
    key: 'intake',
    version: 1,
    status: 'PUBLISHED',
    title: 'New patient intake',
    description: null,
    bindTo: 'PATIENT',
    definition: {
      fields: [{ type: 'shortText', key: 'reason', label: 'Reason for visit', maxLength: 120 }],
    },
    compiled: null,
    promotionManifest: null,
    publishedAt: FIXED_NOW,
    publishedById: PROVIDER,
    retiredAt: null,
  });

  seed(dataset, 'FormSubmission', {
    ...storageColumns(testId(14)),
    formDefinitionId: testId(13),
    patientId: PATIENT,
    encounterId: null,
    status: 'COMPLETED',
    values: { reason: 'Annual review' },
    completedByType: 'USER',
    completedByUserId: PROVIDER,
    completedAt: FIXED_NOW,
    signedAt: null,
    signedById: null,
    effectiveAt: FIXED_NOW,
  });

  /*
   * A dispense: the posting, the lot it came from, the item and the movement
   * that ties them together. All four are needed because the resource is
   * assembled from the ledger rather than read from one row.
   */
  seed(dataset, 'StockItem', {
    ...storageColumns(testId(30)),
    sku: 'MET-500',
    name: 'Metformin 500 mg tablet',
    unit: 'tablet',
    rxnormCode: '860975',
    ndcCode: null,
    cvxCode: null,
    packSize: null,
    reorderLevel: null,
    controlled: false,
    controlledSchedule: null,
    active: true,
  });

  seed(dataset, 'StockLot', {
    ...storageColumns(testId(31)),
    itemId: testId(30),
    facilityId: DEMO_FACILITY_A,
    lotNumber: 'LOT-7741',
    status: 'AVAILABLE',
    expiresOn: null,
    openedOn: null,
    beyondUseDays: null,
    manufacturer: null,
    ndcCode: null,
    receivedOn: FIXED_NOW,
  });

  seed(dataset, 'StockPosting', {
    ...storageColumns(testId(32)),
    kind: 'DISPENSE',
    facilityId: DEMO_FACILITY_A,
    patientId: PATIENT,
    encounterId: ENCOUNTER,
    prescriptionId: null,
    immunizationId: null,
    occurredOn: FIXED_NOW,
    postedById: PROVIDER,
    witnessedById: null,
    reference: null,
    note: null,
  });

  seed(dataset, 'StockMovement', {
    ...storageColumns(testId(33)),
    postingId: testId(32),
    lotId: testId(31),
    itemId: testId(30),
    facilityId: DEMO_FACILITY_A,
    kind: 'DISPENSE',
    quantity: 60,
    occurredOn: FIXED_NOW,
    actorId: PROVIDER,
    reason: null,
    correctsMovementId: null,
    lotSeq: 1,
  /* A completed procedure with both codings and a real span, so the projection
     exercises the period branch rather than the instant one. */
  seed(dataset, 'Procedure', {
    ...storageColumns(testId(40)),
    patientId: PATIENT,
    encounterId: ENCOUNTER,
    code: '45378',
    codeSystem: 'http://www.ama-assn.org/go/cpt',
    display: 'Diagnostic colonoscopy',
    snomedCode: '73761001',
    status: 'COMPLETED',
    performedStart: FIXED_NOW,
    performedEnd: null,
    bodySiteCode: null,
    outcomeCode: null,
    notDoneReason: null,
    note: null,
    performedById: PROVIDER,
    recordedAt: FIXED_NOW,
    recordedById: PROVIDER,
  });

  /* A team with one member of each kind, so the projection exercises all three
     member reference types rather than the practitioner one three times. */
  seed(dataset, 'CareTeam', {
    ...storageColumns(testId(41)),
    patientId: PATIENT,
    status: 'ACTIVE',
    name: 'Primary care',
    periodStart: FIXED_NOW,
    periodEnd: null,
  });

  seed(dataset, 'CareTeamParticipant', {
    ...storageColumns(testId(42)),
    careTeamId: testId(41),
    memberType: 'USER',
    memberUserId: PROVIDER,
    memberRelatedPersonId: null,
    roleCode: '207Q00000X',
    roleSystem: 'http://nucc.org/provider-taxonomy',
    roleText: 'Family medicine',
    periodStart: null,
    periodEnd: null,
  });

  seed(dataset, 'CareTeamParticipant', {
    ...storageColumns(testId(43)),
    careTeamId: testId(41),
    memberType: 'PATIENT',
    memberUserId: null,
    memberRelatedPersonId: null,
    roleCode: '116154003',
    roleSystem: 'http://snomed.info/sct',
    roleText: null,
    periodStart: null,
    periodEnd: null,
  });

  seed(dataset, 'Encounter', {
    ...storageColumns(ENCOUNTER),
    facilityId: DEMO_FACILITY_A,
    patientId: PATIENT,
    providerId: PROVIDER,
    appointmentId: null,
    class: 'AMBULATORY',
    status: 'COMPLETED',
    reasonCode: 'R51',
    reasonText: 'Headache',
    startedAt: FIXED_NOW,
    endedAt: null,
    signedAt: null,
    signedById: null,
  });

  seed(dataset, 'Condition', {
    ...storageColumns(testId(21)),
    patientId: PATIENT,
    encounterId: ENCOUNTER,
    category: 'PROBLEM_LIST_ITEM',
    code: 'E11.9',
    codeSystem: 'http://hl7.org/fhir/sid/icd-10-cm',
    display: 'Type 2 diabetes mellitus without complications',
    snomedCode: null,
    clinicalStatus: 'ACTIVE',
    verificationStatus: 'CONFIRMED',
    onsetDate: new Date('2024-05-01T00:00:00.000Z'),
    abatementDate: null,
    severityCode: null,
    bodySiteCode: null,
    note: null,
    recordedAt: FIXED_NOW,
    recordedById: PROVIDER,
  });

  seed(dataset, 'MedicationRequest', {
    ...storageColumns(testId(22)),
    patientId: PATIENT,
    encounterId: ENCOUNTER,
    prescriberId: PROVIDER,
    rxnormCode: '860975',
    ndcCode: null,
    display: 'Metformin 500 mg tablet',
    sig: {},
    sigText: 'One tablet twice daily with food',
    quantity: 60,
    quantityUnit: 'tablet',
    refills: 3,
    daysSupply: 30,
    dispenseAsWritten: false,
    controlledSchedule: null,
    pharmacyName: null,
    pharmacyNcpdpId: null,
    status: 'ACTIVE',
    intent: 'ORDER',
    erxRef: null,
    writtenAt: FIXED_NOW,
    transmittedAt: null,
  });

  seed(dataset, 'MedicationStatement', {
    ...storageColumns(testId(23)),
    patientId: PATIENT,
    encounterId: null,
    rxnormCode: null,
    display: 'Cholecalciferol 1000 unit capsule',
    sigText: 'One capsule daily',
    status: 'ACTIVE',
    source: 'REPORTED',
    effectiveStart: null,
    effectiveEnd: null,
    reportedAt: FIXED_NOW,
    note: null,
  });

  seed(dataset, 'AllergyIntolerance', {
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
    reactionText: 'Hives',
    severity: 'MODERATE',
    onsetDate: null,
    note: null,
    recordedAt: FIXED_NOW,
    recordedById: PROVIDER,
  });

  seed(dataset, 'Immunization', {
    ...storageColumns(testId(25)),
    patientId: PATIENT,
    encounterId: null,
    status: 'COMPLETED',
    cvxCode: '141',
    mvxCode: null,
    ndcCode: null,
    display: 'Influenza, seasonal, injectable',
    lotNumber: 'TEST-1',
    expirationDate: null,
    siteCode: 'LA',
    routeCode: 'IM',
    doseQuantity: 0.5,
    doseUnit: 'mL',
    administeredAt: FIXED_NOW,
    administeredById: PROVIDER,
    visDate: null,
    refusalReasonCode: null,
    reportedToRegistryAt: null,
  });

  seed(dataset, 'Observation', {
    ...storageColumns(testId(26)),
    patientId: PATIENT,
    encounterId: ENCOUNTER,
    category: 'VITAL_SIGNS',
    status: 'FINAL',
    loincCode: '8867-4',
    code: '8867-4',
    codeSystem: 'http://loinc.org',
    display: 'Heart rate',
    valueNumber: 72,
    valueText: null,
    valueCode: null,
    valueBoolean: null,
    unit: '/min',
    referenceLow: 60,
    referenceHigh: 100,
    interpretationCode: 'N',
    bodySiteCode: null,
    effectiveAt: FIXED_NOW,
    issuedAt: null,
    performerId: PROVIDER,
    formSubmissionId: null,
  });

  seed(dataset, 'ServiceRequest', {
    ...storageColumns(ORDER),
    patientId: PATIENT,
    encounterId: ENCOUNTER,
    orderedById: PROVIDER,
    category: 'LAB',
    status: 'TRANSMITTED',
    intent: 'ORDER',
    priority: 'ROUTINE',
    code: '24323-8',
    codeSystem: 'http://loinc.org',
    display: 'Comprehensive metabolic panel',
    specimenTypeCode: null,
    reasonCodes: ['E11.9'],
    aoeAnswers: null,
    note: null,
    requisitionNumber: 'REQ-1',
    performingLabName: 'Testville Reference Lab',
    labRef: null,
    requestedAt: FIXED_NOW,
    scheduledFor: null,
    transmittedAt: FIXED_NOW,
  });

  seed(dataset, 'Specimen', {
    ...storageColumns(testId(31)),
    patientId: PATIENT,
    serviceRequestId: ORDER,
    status: 'AVAILABLE',
    accessionNumber: 'ACC-1',
    typeCode: '119297000',
    typeDisplay: 'Blood specimen',
    collectionMethodCode: null,
    bodySiteCode: null,
    collectedAt: FIXED_NOW,
    collectedById: PROVIDER,
    receivedAt: null,
    containerType: null,
    volumeValue: 5,
    volumeUnit: 'mL',
    rejectionReason: null,
    note: null,
  });

  seed(dataset, 'DiagnosticReport', {
    ...storageColumns(REPORT),
    patientId: PATIENT,
    encounterId: ENCOUNTER,
    serviceRequestId: ORDER,
    specimenId: testId(31),
    status: 'FINAL',
    category: 'LAB',
    code: '24323-8',
    codeSystem: 'http://loinc.org',
    display: 'Comprehensive metabolic panel',
    performingLabName: 'Testville Reference Lab',
    abnormalFlag: 'NORMAL',
    narrative: null,
    rawStorageKey: null,
    effectiveAt: FIXED_NOW,
    issuedAt: FIXED_NOW,
    reviewedById: null,
    reviewedAt: null,
  });

  seed(dataset, 'ResultObservation', {
    ...storageColumns(testId(41)),
    diagnosticReportId: REPORT,
    patientId: PATIENT,
    status: 'FINAL',
    sequence: 1,
    loincCode: '2345-7',
    code: '2345-7',
    codeSystem: 'http://loinc.org',
    display: 'Glucose',
    valueNumber: 5.4,
    valueText: null,
    valueCode: null,
    unit: 'mmol/L',
    referenceLow: 3.9,
    referenceHigh: 5.8,
    referenceRangeText: null,
    interpretationCode: 'N',
    abnormalFlag: 'NORMAL',
    effectiveAt: FIXED_NOW,
  });

  seed(dataset, 'Document', {
    ...storageColumns(testId(50)),
    patientId: PATIENT,
    encounterId: ENCOUNTER,
    category: '11488-4',
    title: 'Consultation note',
    storageKey: 'documents/2026/08/consultation.pdf',
    contentType: 'application/pdf',
    sha256: 'a'.repeat(64),
    byteSize: 2048,
    source: 'UPLOAD',
    status: 'FILED',
    sensitivityClass: 'NORMAL',
    receivedAt: FIXED_NOW,
    filedAt: FIXED_NOW,
    filedById: PROVIDER,
    supersededById: null,
    errorReason: null,
    expiresAt: null,
  });

  seed(dataset, 'UserFacility', {
    ...storageColumns(testId(973)),
    userId: PROVIDER,
    facilityId: DEMO_FACILITY_A,
    isPrimary: true,
  });

  seed(dataset, 'Facility', {
    ...storageColumns(SECOND_SITE),
    name: 'Testville Annexe',
    code: 'TVA',
    npi: null,
    posCode: '11',
    timezone: 'UTC',
    addressLine1: '2 Test Street',
    addressLine2: null,
    city: 'Testville',
    state: 'TS',
    postalCode: '00000',
    country: 'US',
    phone: '+15550101',
    active: true,
  });

  seed(dataset, 'UserFacility', {
    ...storageColumns(testId(974)),
    userId: PROVIDER,
    facilityId: SECOND_SITE,
    isPrimary: false,
  });

  seed(dataset, 'Role', {
    ...storageColumns(NURSE_ROLE),
    key: 'nurse',
    name: 'Nurse',
    description: null,
    isSystem: true,
  });

  // Two grants of the same role to the same person, differing only in whether
  // they name a facility. That is the pair the projection has to tell apart:
  // one is scoped to a site and one is organisation-wide, and the resource says
  // so by carrying a `location` or by carrying none.
  seed(dataset, 'RoleAssignment', {
    ...storageColumns(SITE_GRANT),
    userId: PROVIDER,
    roleId: NURSE_ROLE,
    facilityId: DEMO_FACILITY_A,
  });

  seed(dataset, 'RoleAssignment', {
    ...storageColumns(ORG_GRANT),
    userId: PROVIDER,
    roleId: NURSE_ROLE,
    facilityId: null,
  });

  seed(dataset, 'ImagingStudy', {
    ...storageColumns(testId(80)),
    patientId: PATIENT,
    encounterId: ENCOUNTER,
    serviceRequestId: ORDER,
    diagnosticReportId: null,
    studyInstanceUid: '1.2.840.113619.2.55.3.604688119.868.1234567890.1',
    accessionNumber: 'ACC-100482',
    modalities: ['CT'],
    description: 'CT chest with contrast',
    status: 'AVAILABLE',
    startedAt: FIXED_NOW,
    numberOfSeries: 4,
    numberOfInstances: 512,
    retrieveUrl: 'https://pacs.example.invalid/dicomweb/studies/1.2.840',
  });

  seed(dataset, 'Task', {
    ...storageColumns(testId(60)),
    type: 'RESULT',
    status: 'OPEN',
    priority: 'NORMAL',
    patientId: PATIENT,
    encounterId: ENCOUNTER,
    subjectType: 'DiagnosticReport',
    subjectId: REPORT,
    title: 'Review the metabolic panel',
    description: null,
    assigneeType: 'USER',
    assigneeUserId: PROVIDER,
    assigneeTeamKey: null,
    dueAt: FIXED_NOW,
    slaState: 'OK',
    expiresAt: null,
    sourceEventId: null,
    completedAt: null,
    completedById: null,
    outcome: null,
  });
}

/**
 * One audit event, so Provenance has something to project.
 *
 * Appended to the chain store rather than seeded into the dataset, and the
 * distinction is the point: the audit log is not a table the API writes through
 * its repositories, it is a hash-chained store the sink appends to and the API
 * can only read. Pushing a row into `dataset.table('AuditEvent')` puts it
 * somewhere nothing reads - which is exactly what the first attempt at this
 * fixture did, and the search kept returning nothing.
 *
 * Going through `append` also means the row carries a real `seq` and a real
 * `prevHash`, so this fixture cannot drift from the shape the running system
 * produces.
 */
/**
 * A claim with two lines, so the Claim projection has both a claim and the
 * child list it is supposed to batch.
 *
 * Two lines rather than one on purpose: a single line cannot tell the
 * difference between "grouped the lines correctly" and "returned whatever came
 * back first", and the sequence ordering has nothing to prove with one row.
 */
/**
 * A claim in a given state, on the seeded patient and encounter.
 *
 * Both are load bearing rather than incidental: `claimSpec` compartments on
 * `patientId`, and `prepareClaims` resolves the billing provider through
 * `encounterId` and falls back to the tenant when the encounter is unreadable.
 * A claim seeded against anything else would quietly exercise that fallback
 * instead of the path under test.
 */
function claimRow(id: string, status: ClaimStatus): ScopedRow<'Claim'> {
  return {
    ...storageColumns(id),
    patientId: PATIENT,
    encounterId: ENCOUNTER,
    coverageId: testId(10),
    payerId: testId(11),
    status,
    frequency: 'ORIGINAL',
    diagnosisCodes: ['E11.9'],
    totalChargedCents: 24_500,
    totalPaidCents: 0,
    totalAdjustedCents: 0,
    patientResponsibilityCents: 0,
    secondaryOfId: null,
    priorClaimId: null,
    controlNumbers: {},
    snapshot: {},
    statusReason: null,
    submittedAt: FIXED_NOW,
    acknowledgedAt: null,
    adjudicatedAt: null,
  };
}

function seedClaim(dataset: MemoryDataset): void {
  seed(dataset, 'Claim', {
    ...storageColumns(CLAIM),
    patientId: PATIENT,
    encounterId: ENCOUNTER,
    coverageId: testId(10),
    payerId: testId(11),
    status: 'SUBMITTED',
    frequency: 'ORIGINAL',
    diagnosisCodes: ['E11.9'],
    totalChargedCents: 24_500,
    totalPaidCents: 0,
    totalAdjustedCents: 0,
    patientResponsibilityCents: 0,
    secondaryOfId: null,
    priorClaimId: null,
    controlNumbers: {},
    snapshot: {},
    statusReason: null,
    submittedAt: FIXED_NOW,
    acknowledgedAt: null,
    adjudicatedAt: null,
  });

  for (const [index, code] of [
    ['99213', 15_000],
    ['85025', 9_500],
  ].entries()) {
    seed(dataset, 'ClaimLine', {
      ...storageColumns(testId(950 + index)),
      claimId: CLAIM,
      chargeItemId: testId(960 + index),
      sequence: index + 1,
      code: String(code[0]),
      codeSystem: 'http://www.ama-assn.org/go/cpt',
      modifiers: [],
      units: 1,
      chargedCents: Number(code[1]),
      allowedCents: null,
      paidCents: 0,
      adjustedCents: 0,
      diagnosisPointers: [1],
      serviceDateFrom: FIXED_NOW,
      serviceDateTo: null,
      statusReason: null,
    });
  }
}

function seedAuditEvent(store: AuditChainStore): void {
  store.append(
    DEMO_TENANT_A,
    {
      actorType: 'user',
      actorId: PROVIDER,
      actorDisplay: 'Adaeze Okafor',
      action: 'PATIENT_READ',
      targetType: 'Patient',
      targetId: PATIENT,
      patientId: PATIENT,
      purposeOfUse: 'TREAT',
      outcome: 'success',
      metadata: {},
    },
    FIXED_NOW
  );
}

function harness(): ReturnType<typeof createTestApp> {
  const created = createTestApp();
  seedChart(created.dataset);
  seedClaim(created.dataset);
  seedAuditEvent(created.auditStore);
  return created;
}

describe('Questionnaire serves published forms only', () => {
  it('does not return a draft by id, which the search filter alone did not prevent', async () => {
    /*
     * A read goes straight to `findById` and never builds a query, so filtering
     * in `toQuery` left every draft readable at /fhir/Questionnaire/{id} by
     * anyone who could guess an id. A draft is a form somebody is still
     * editing; it should look absent, not unfinished.
     */
    const { app, dataset } = harness();
    seed(dataset, 'FormDefinition', {
      ...storageColumns(testId(16)),
      key: 'draft-intake',
      version: 1,
      status: 'DRAFT',
      title: 'Not published yet',
      description: null,
      bindTo: 'PATIENT',
      definition: { fields: [] },
      compiled: null,
      promotionManifest: null,
      publishedAt: null,
      publishedById: null,
      retiredAt: null,
    });

    const read = await app.request(`/fhir/Questionnaire/${testId(16)}`, {
      headers: bearer(TOKENS.adminA),
    });
    expect(read.status).toBe(404);

    /* And the published one beside it is still readable, so the guard narrows
       rather than simply refusing everything. */
    const published = await app.request(`/fhir/Questionnaire/${testId(13)}`, {
      headers: bearer(TOKENS.adminA),
    });
    expect(published.status).toBe(200);
  });

  it('keeps the draft out of the search as well', async () => {
    const { app, dataset } = harness();
    seed(dataset, 'FormDefinition', {
      ...storageColumns(testId(17)),
      key: 'draft-two',
      version: 1,
      status: 'DRAFT',
      title: 'Also not published',
      description: null,
      bindTo: 'PATIENT',
      definition: { fields: [] },
      compiled: null,
      promotionManifest: null,
      publishedAt: null,
      publishedById: null,
      retiredAt: null,
    });

    const bundle = (await (
      await app.request('/fhir/Questionnaire', { headers: bearer(TOKENS.adminA) })
    ).json()) as Bundle;

    expect(bundle.entry?.map((entry) => (entry.resource as { id?: string }).id)).toEqual([
      testId(13),
    ]);
  });
});

describe('the Questionnaire name filter is honoured, not merely advertised', () => {
  it('narrows to the named form and answers empty for one that does not exist', async () => {
    const { app } = harness();

    const matched = (await (
      await app.request('/fhir/Questionnaire?name=intake', { headers: bearer(TOKENS.adminA) })
    ).json()) as Bundle;
    expect(matched.total).toBe(1);

    /* The half that catches a declared-but-ignored parameter: a filter that is
       read and dropped returns the whole list here instead of nothing. */
    const missed = (await (
      await app.request('/fhir/Questionnaire?name=not-a-form', { headers: bearer(TOKENS.adminA) })
    ).json()) as Bundle;
    expect(missed.total).toBe(0);
  });
});

describe('a response answered during a visit', () => {
  it('carries the encounter and the member of staff who filled it in', async () => {
    /*
     * Both were dropped by the first version. An intake answered at a visit is
     * not the same clinical statement as one answered from home, and a
     * response with no author cannot be attributed.
     */
    const { app, dataset } = harness();
    seed(dataset, 'FormSubmission', {
      ...storageColumns(testId(18)),
      formDefinitionId: testId(13),
      patientId: PATIENT,
      encounterId: ENCOUNTER,
      status: 'COMPLETED',
      values: { reason: 'Filled in at the desk' },
      completedByType: 'USER',
      completedByUserId: PROVIDER,
      completedAt: FIXED_NOW,
      signedAt: null,
      signedById: null,
      effectiveAt: FIXED_NOW,
    });

    const bundle = (await (
      await app.request(`/fhir/QuestionnaireResponse?patient=Patient/${PATIENT}`, {
        headers: bearer(TOKENS.adminA),
      })
    ).json()) as Bundle;

    const answered = bundle.entry
      ?.map(
        (entry) =>
          entry.resource as {
            id?: string;
            encounter?: { reference?: string };
            author?: { reference?: string };
          }
      )
      .find((resource) => resource.id === testId(18));

    expect(answered?.encounter?.reference).toBe(`Encounter/${ENCOUNTER}`);
    expect(answered?.author?.reference).toBe(`Practitioner/${PROVIDER}`);
  });
});

describe('a submission whose definition cannot be read', () => {
  it('refuses rather than serving a response with no questions', async () => {
    /*
     * `formDefinitionId` is a required foreign key, so a submission that cannot
     * reach its definition means the row was deleted or belongs to another
     * tenant. Either way the answers cannot be attached to the questions they
     * answer, and a QuestionnaireResponse with bare values and no questionnaire
     * is a clinical record a reader cannot interpret.
     */
    const { app, dataset } = harness();
    seed(dataset, 'FormSubmission', {
      ...storageColumns(testId(15)),
      formDefinitionId: testId(9999),
      patientId: PATIENT,
      encounterId: null,
      status: 'COMPLETED',
      values: { reason: 'Orphaned' },
      completedByType: 'USER',
      completedByUserId: null,
      completedAt: FIXED_NOW,
      signedAt: null,
      signedById: null,
      effectiveAt: FIXED_NOW,
    });

    const res = await app.request('/fhir/QuestionnaireResponse', {
      headers: bearer(TOKENS.adminA),
    });

    expect(res.status).toBe(500);
  });
});

describe('every served resource', () => {
  it.each(SERVED_MODULES.map((module) => module.type))(
    '%s comes back from a search as a resource of its own type',
    async (type) => {
      const { app } = harness();

      const res = await app.request(`/fhir/${type}`, { headers: bearer(TOKENS.adminA) });

      expect(res.status).toBe(200);
      const bundle = (await res.json()) as Bundle;
      expect(bundle.total, `${type} search returned nothing to project`).toBeGreaterThan(0);
      for (const entry of bundle.entry ?? []) {
        expect((entry.resource as FhirResource).resourceType).toBe(type);
        expect(entry.search?.mode).toBe('match');
      }
    }
  );

  it.each(SERVED_MODULES.map((module) => module.type))(
    '%s comes back from a read as a resource of its own type',
    async (type) => {
      const { app } = harness();
      const bundle = (await (
        await app.request(`/fhir/${type}`, { headers: bearer(TOKENS.adminA) })
      ).json()) as Bundle;
      const id = (bundle.entry?.[0]?.resource as { id?: string } | undefined)?.id;
      expect(id, `${type} search returned nothing to read`).toBeDefined();

      const res = await app.request(`/fhir/${type}/${String(id)}`, {
        headers: bearer(TOKENS.adminA),
      });

      expect(res.status).toBe(200);
      expect(((await res.json()) as FhirResource).resourceType).toBe(type);
    }
  );
});

describe('the projections', () => {
  it('carries the clinical detail a chart summary needs', async () => {
    const { app } = harness();

    const observation = (await (
      await app.request(`/fhir/Observation/${testId(26)}`, { headers: bearer(TOKENS.adminA) })
    ).json()) as { valueQuantity?: { value?: number; unit?: string }; status?: string };

    expect(observation.status).toBe('final');
    expect(observation.valueQuantity).toMatchObject({ value: 72, unit: '/min' });
  });

  it('resolves a report to the analytes that hang off it', async () => {
    const { app } = harness();

    const report = (await (
      await app.request(`/fhir/DiagnosticReport/${REPORT}`, { headers: bearer(TOKENS.adminA) })
    ).json()) as { result?: { reference?: string }[] };

    expect(report.result?.map((entry) => entry.reference)).toEqual([`Observation/${testId(41)}`]);
  });

  it('never publishes the object-storage key of a document', async () => {
    const { app } = harness();

    const res = await app.request(`/fhir/DocumentReference/${testId(50)}`, {
      headers: bearer(TOKENS.adminA),
    });

    const body = await res.text();
    expect(body).not.toContain('documents/2026');
    expect(body).toContain(`Binary/${testId(50)}`);
  });

  it('serves a practitioner from the staff directory', async () => {
    const { app } = harness();

    const practitioner = (await (
      await app.request(`/fhir/Practitioner/${PROVIDER}`, { headers: bearer(TOKENS.adminA) })
    ).json()) as { name?: { family?: string }[]; active?: boolean };

    expect(practitioner.name?.[0]?.family).toBe('Okafor');
    expect(practitioner.active).toBe(true);
  });

  it('serves a facility as a Location', async () => {
    const { app } = harness();

    const location = (await (
      await app.request(`/fhir/Location/${DEMO_FACILITY_A}`, { headers: bearer(TOKENS.adminA) })
    ).json()) as { name?: string; address?: { city?: string } };

    expect(location.name).toBe('Testville Clinic');
    expect(location.address?.city).toBe('Testville');
  });

  it('binds a role grant to its practitioner, its organisation and its role code', async () => {
    const { app } = harness();

    const role = (await (
      await app.request(`/fhir/PractitionerRole/${SITE_GRANT}`, { headers: bearer(TOKENS.adminA) })
    ).json()) as {
      practitioner?: { reference?: string };
      organization?: { reference?: string };
      code?: { coding?: { code?: string }[] }[];
      active?: boolean;
    };

    expect(role.practitioner?.reference).toBe(`Practitioner/${PROVIDER}`);
    expect(role.organization?.reference).toBe(`Organization/${DEMO_TENANT_A}`);
    expect(role.code?.[0]?.coding?.[0]?.code).toBe('nurse');
    expect(role.active).toBe(true);
  });

  /**
   * Two tables carry a facility and they answer different questions.
   * `UserFacility` says where the person works; `RoleAssignment.facilityId`
   * says where the permission applies. A site-scoped grant is the intersection.
   */
  it('narrows a site-scoped grant to the one facility it applies at', async () => {
    const { app } = harness();

    const role = (await (
      await app.request(`/fhir/PractitionerRole/${SITE_GRANT}`, { headers: bearer(TOKENS.adminA) })
    ).json()) as { location?: { reference?: string }[] };

    expect(role.location?.map((entry) => entry.reference)).toEqual([`Location/${DEMO_FACILITY_A}`]);
  });

  /**
   * The case that made reading the assignment wrong rather than imprecise.
   *
   * A practitioner with one organisation-wide grant works at both sites, and
   * the grant names neither. Deriving `location` from the assignment returned
   * nothing at all for somebody a referring practice can demonstrably reach at
   * two addresses.
   */
  it('lists every facility a practitioner works at for an organisation-wide grant', async () => {
    const { app } = harness();

    const role = (await (
      await app.request(`/fhir/PractitionerRole/${ORG_GRANT}`, { headers: bearer(TOKENS.adminA) })
    ).json()) as { location?: { reference?: string }[] };

    expect(role.location?.map((entry) => entry.reference)).toEqual([
      `Location/${DEMO_FACILITY_A}`,
      `Location/${SECOND_SITE}`,
    ]);
  });

  /**
   * The same organisation-wide grant, read by somebody granted one site.
   *
   * `location` is derived from `UserFacility`, which is a different table from
   * the one the resource is built on, and it used to be read by user id alone.
   * So a principal confined to facility A could ask this boundary where a
   * colleague works and be told about facility B - the caller's own confinement
   * narrowed the assignments it could list and then said nothing at all about
   * the sites those assignments were enriched with.
   *
   * `read-only` is the role that makes this reachable in a real deployment: it
   * holds every `.read` permission, `role.read` included, and does not hold
   * `facility.all`. The admin tokens the tests above use hold `facility.all`
   * and would pass this whether or not the narrowing existed.
   */
  it('shows a site-confined reader only the facilities they were granted', async () => {
    const { app } = harness();

    const role = (await (
      await app.request(`/fhir/PractitionerRole/${ORG_GRANT}`, {
        headers: bearer(TOKENS.siteReaderA),
      })
    ).json()) as { location?: { reference?: string }[] };

    expect(role.location?.map((entry) => entry.reference)).toEqual([`Location/${DEMO_FACILITY_A}`]);
  });

  /**
   * The absent-versus-empty property, asserted rather than assumed.
   *
   * A role granted at a site the person is not attached to intersects to
   * nothing. That must not serialise as `location: []`, because a directory
   * client reading an empty array concludes the practitioner provides care
   * nowhere and routes a referral elsewhere - a positive claim, where the truth
   * is only that two grants disagree and nobody has reconciled them.
   *
   * `toHaveProperty` rather than a length check, because `[]` passes every
   * check that asks how many.
   */
  it('emits no location at all when the grants do not intersect', async () => {
    const { app, dataset } = harness();
    const grant = dataset.table('RoleAssignment').find((row) => row.id === SITE_GRANT);
    expect(grant, 'the fixture seeds the site-scoped grant this test moves').toBeDefined();
    Object.assign(grant!, { facilityId: testId(999) });

    const role = (await (
      await app.request(`/fhir/PractitionerRole/${SITE_GRANT}`, { headers: bearer(TOKENS.adminA) })
    ).json()) as Record<string, unknown>;

    expect(role).not.toHaveProperty('location');
  });

  it('reads a practitioner filter as the reference a directory client sends', async () => {
    const { app } = harness();

    const bundle = (await (
      await app.request(`/fhir/PractitionerRole?practitioner=Practitioner/${PROVIDER}`, {
        headers: bearer(TOKENS.adminA),
      })
    ).json()) as Bundle;

    expect(bundle.total).toBe(2);
  });

  /**
   * `specialty` is a US Core must-support parameter and the code it searches
   * lives on the practitioner, not on the role assignment the search returns.
   * So every case below is really testing one thing: that the code is resolved
   * to its practitioners and the rows narrowed to them.
   *
   * The second practitioner is seeded per test rather than in `harness()`,
   * which is shared by every assertion in this file. A globally seeded extra
   * user is the kind of fixture that makes an unrelated count assertion fail
   * six months later for reasons nobody can reconstruct.
   */
  const seedSecondPractitioner = (dataset: MemoryDataset, taxonomyCode: string): void => {
    seed(dataset, 'User', {
      ...storageColumns(SECOND_PROVIDER),
      email: 'r.mbeki@example.invalid',
      givenName: 'Refilwe',
      familyName: 'Mbeki',
      credential: 'MD',
      npi: '1234567810',
      dea: null,
      taxonomyCode,
      isProvider: true,
      locale: 'en-US',
      status: 'ACTIVE',
      lastLoginAt: null,
    });
    seed(dataset, 'RoleAssignment', {
      ...storageColumns(SECOND_GRANT),
      userId: SECOND_PROVIDER,
      roleId: NURSE_ROLE,
      facilityId: null,
    });
  };

  const roleIds = async (app: ReturnType<typeof harness>['app'], query: string) => {
    const res = await app.request(`/fhir/PractitionerRole?${query}`, {
      headers: bearer(TOKENS.adminA),
    });
    if (res.status !== 200) return res.status;
    const bundle = (await res.json()) as Bundle;
    return (bundle.entry ?? [])
      .map((entry) => (entry.resource as FhirResource).id)
      .sort((left, right) => (left ?? '').localeCompare(right ?? ''));
  };

  it('finds the roles held by every practitioner carrying the code', async () => {
    const created = harness();
    // The same code the seeded provider carries, so both practitioners match.
    seedSecondPractitioner(created.dataset, '207Q00000X');

    await expect(roleIds(created.app, 'specialty=207Q00000X')).resolves.toEqual(
      [SITE_GRANT, ORG_GRANT, SECOND_GRANT].sort((left, right) => left.localeCompare(right))
    );
  });

  it('leaves out the practitioners carrying a different code', async () => {
    const created = harness();
    // Internal medicine, against the seeded provider's family medicine.
    seedSecondPractitioner(created.dataset, '207R00000X');

    await expect(roleIds(created.app, 'specialty=207R00000X')).resolves.toEqual([SECOND_GRANT]);
    await expect(roleIds(created.app, 'specialty=207Q00000X')).resolves.toEqual(
      [SITE_GRANT, ORG_GRANT].sort((left, right) => left.localeCompare(right))
    );
  });

  /**
   * Both parameters at once. This is the case where the two filters write the
   * same `where` key: a spec that let one overwrite the other would answer with
   * every family-medicine practitioner's grants here, rather than with the
   * intersection the client asked for.
   */
  it('meets a practitioner filter and a specialty filter rather than picking one', async () => {
    const created = harness();
    seedSecondPractitioner(created.dataset, '207Q00000X');

    // Both carry the code; only one is the named practitioner.
    await expect(
      roleIds(created.app, `practitioner=Practitioner/${SECOND_PROVIDER}&specialty=207Q00000X`)
    ).resolves.toEqual([SECOND_GRANT]);

    // And a pair that cannot both hold matches nothing rather than everything.
    await expect(
      roleIds(created.app, `practitioner=Practitioner/${SECOND_PROVIDER}&specialty=207R00000X`)
    ).resolves.toEqual([]);
  });

  it('accepts the code qualified by the system it belongs to', async () => {
    const { app } = harness();

    await expect(
      roleIds(app, 'specialty=http://nucc.org/provider-taxonomy|207Q00000X')
    ).resolves.toEqual([SITE_GRANT, ORG_GRANT].sort((left, right) => left.localeCompare(right)));
  });

  /**
   * A system this server stores no codes in is a search whose answer is empty,
   * not a malformed search. The two are different things to a client: a 400
   * says "fix your query" and an empty bundle says "nobody here matches", and
   * only one of those is true.
   */
  it('matches nothing for a system it holds no codes in', async () => {
    const { app } = harness();

    await expect(roleIds(app, 'specialty=http://snomed.info/sct|207Q00000X')).resolves.toEqual([]);
    // `|code` is the form that means "this code, in no system at all".
    await expect(roleIds(app, 'specialty=|207Q00000X')).resolves.toEqual([]);
  });

  it('matches nothing for a code no practitioner carries, rather than refusing', async () => {
    const { app } = harness();

    await expect(roleIds(app, 'specialty=208D00000X')).resolves.toEqual([]);
  });

  /**
   * The bound is a refusal rather than a truncation, and this is the test that
   * says so. A truncated set would silently drop practitioners, and a client
   * that filtered on `specialty` and received a slice believing it received the
   * whole is the failure this boundary exists to prevent. The cost is stated
   * plainly on the constant: a practice with more than a thousand providers
   * sharing one code gets a 400 here rather than a wrong answer.
   */
  it('refuses to resolve a specialty more practitioners carry than it will read', async () => {
    const created = harness();
    for (let index = 0; index < 1001; index += 1) {
      seed(created.dataset, 'User', {
        ...storageColumns(testId(20_000 + index)),
        email: `bulk-${index}@example.invalid`,
        givenName: 'Bulk',
        familyName: `Provider${index}`,
        credential: 'MD',
        npi: null,
        dea: null,
        taxonomyCode: '363L00000X',
        isProvider: true,
        locale: 'en-US',
        status: 'ACTIVE',
        lastLoginAt: null,
      });
    }

    await expect(roleIds(created.app, 'specialty=363L00000X')).resolves.toBe(400);
  });

  it('resolves a specialty exactly at the bound rather than refusing it', async () => {
    const created = harness();
    for (let index = 0; index < 1000; index += 1) {
      seed(created.dataset, 'User', {
        ...storageColumns(testId(20_000 + index)),
        email: `bulk-${index}@example.invalid`,
        givenName: 'Bulk',
        familyName: `Provider${index}`,
        credential: 'MD',
        npi: null,
        dea: null,
        taxonomyCode: '363L00000X',
        isProvider: true,
        locale: 'en-US',
        status: 'ACTIVE',
        lastLoginAt: null,
      });
    }

    // None of them holds a role assignment, so the answer is empty - but it is
    // a 200 with an empty bundle, which is the point: the bound was not hit.
    await expect(roleIds(created.app, 'specialty=363L00000X')).resolves.toEqual([]);
  });

  it('refuses a practitioner filter that references the wrong resource type', async () => {
    const { app } = harness();

    const res = await app.request(`/fhir/PractitionerRole?practitioner=Patient/${PATIENT}`, {
      headers: bearer(TOKENS.adminA),
    });

    expect(res.status).toBe(400);
  });

  it('carries the specialty the practice recorded against the user', async () => {
    const { app } = harness();

    const role = (await (
      await app.request(`/fhir/PractitionerRole/${SITE_GRANT}`, { headers: bearer(TOKENS.adminA) })
    ).json()) as { specialty?: { coding?: { code?: string; system?: string }[] }[] };

    expect(role.specialty?.[0]?.coding?.[0]?.code).toBe('207Q00000X');
  });

  /**
   * The incremental-export hole, asserted rather than assumed.
   *
   * Deactivating a practitioner changes `active` on this resource and touches
   * nothing on the grant row it is stamped from. Without the later of the two
   * timestamps, an `$export?_since=` between them filters the resource out and
   * reports success, so the consumer never learns the practitioner went
   * inactive - a silent staleness with no error anywhere.
   */
  it('stamps lastUpdated from the user when the user changed after the grant', async () => {
    const { app, dataset } = harness();
    const later = new Date('2026-09-01T00:00:00.000Z');
    const user = dataset.table('User').find((row) => row.id === PROVIDER);
    expect(user, 'the fixture seeds the provider this test deactivates').toBeDefined();
    Object.assign(user!, { status: 'DISABLED', updatedAt: later });

    const role = (await (
      await app.request(`/fhir/PractitionerRole/${SITE_GRANT}`, { headers: bearer(TOKENS.adminA) })
    ).json()) as { active?: boolean; meta?: { lastUpdated?: string } };

    expect(role.active).toBe(false);
    expect(role.meta?.lastUpdated).toBe(later.toISOString());
  });

  /**
   * The dependency the earlier fix added and the stamp did not follow.
   *
   * Adding a facility grant changes the emitted `location` and touches neither
   * the user nor the assignment, so the resource kept its old stamp and an
   * incremental export dropped a practitioner who had just started at a second
   * site - the same silent staleness the user-timestamp fix was written for,
   * reintroduced by the fix that started reading the grants.
   */
  it('stamps lastUpdated from a facility grant added after everything else', async () => {
    const { app, dataset } = harness();
    const later = new Date('2026-10-01T00:00:00.000Z');
    const grant = dataset.table('UserFacility').find((row) => row.id === testId(974));
    expect(grant, 'the fixture seeds the second-site grant this test moves').toBeDefined();
    Object.assign(grant!, { updatedAt: later });

    const role = (await (
      await app.request(`/fhir/PractitionerRole/${ORG_GRANT}`, { headers: bearer(TOKENS.adminA) })
    ).json()) as { meta?: { lastUpdated?: string } };

    expect(role.meta?.lastUpdated).toBe(later.toISOString());
  });

  it('keeps the grant timestamp when the grant is the thing that changed last', async () => {
    const { app } = harness();

    const role = (await (
      await app.request(`/fhir/PractitionerRole/${SITE_GRANT}`, { headers: bearer(TOKENS.adminA) })
    ).json()) as { meta?: { lastUpdated?: string } };

    expect(role.meta?.lastUpdated).toBe(FIXED_NOW.toISOString());
  });

  it('filters a chart search by the patient compartment reference', async () => {
    const { app } = harness();

    const bundle = (await (
      await app.request(`/fhir/Condition?patient=Patient/${PATIENT}`, {
        headers: bearer(TOKENS.adminA),
      })
    ).json()) as Bundle;

    expect(bundle.total).toBe(1);
  });

  it('answers a date window on a chart resource', async () => {
    const { app } = harness();

    const inside = (await (
      await app.request('/fhir/Observation?date=2026-08-13', { headers: bearer(TOKENS.adminA) })
    ).json()) as Bundle;
    const outside = (await (
      await app.request('/fhir/Observation?date=2026-08-14', { headers: bearer(TOKENS.adminA) })
    ).json()) as Bundle;

    expect(inside.total).toBe(1);
    expect(outside.total).toBe(0);
  });

  it('refuses a status token the value set does not contain', async () => {
    const { app } = harness();

    const res = await app.request('/fhir/Observation?status=definitely-not-a-status', {
      headers: bearer(TOKENS.adminA),
    });

    expect(res.status).toBe(400);
  });
});

/**
 * The permission a resource is served under, compared with the one the BFF uses
 * for the same rows.
 *
 * PractitionerRole projects `RoleAssignment` - the access-control matrix - and
 * `/bff/v0/users/{id}/roles` serves those same rows. Serving them at the FHIR
 * boundary under `user.read` meant a clinician or biller holding `user.read`
 * and not `role.read` could enumerate every grant in the organisation through
 * the route that does not check, having been refused by the route that does. A
 * boundary that answers a question another door will not is not a second door;
 * it is the way round.
 *
 * The first version of this test asserted the FHIR module against the literal
 * `'role.read'` while claiming to hold a pairing. It would have stayed green if
 * the BFF route had been tightened to something stricter, which is the drift a
 * pairing test exists to catch - so it was checking one side and describing
 * two. The published OpenAPI document carries the BFF permission as
 * `x-openrunic-permission`, so both sides are readable and both are read.
 */
describe('the permission each resource is served under', () => {
  interface SpecDocument {
    paths?: Record<string, Record<string, { 'x-openrunic-permission'?: string }>>;
  }

  async function bffPermission(app: ReturnType<typeof createTestApp>['app'], path: string) {
    const spec = (await (await app.request('/openapi.json')).json()) as SpecDocument;
    return spec.paths?.[path]?.['get']?.['x-openrunic-permission'];
  }

  it('gates PractitionerRole on the same permission as the BFF route for the same rows', async () => {
    const { app } = harness();

    const bff = await bffPermission(app, '/bff/v0/users/{id}/roles');
    const module = SERVED_MODULES.find((entry) => entry.type === 'PractitionerRole');

    expect(bff, 'the BFF route publishes its permission').toBeDefined();
    expect(module?.permission).toBe(bff);
  });

  it('refuses a principal holding no permissions at all', async () => {
    const { app } = harness();

    const res = await app.request('/fhir/PractitionerRole', {
      headers: { authorization: `Bearer ${UNPRIVILEGED_TOKEN}` },
    });

    expect(res.status).toBe(403);
  });
});

describe('Provenance', () => {
  it('is advertised in the CapabilityStatement', async () => {
    const { app } = harness();

    const statement = (await (await app.request('/fhir/metadata')).json()) as {
      rest?: { resource?: { type?: string }[] }[];
    };

    expect(statement.rest?.[0]?.resource?.map((entry) => entry.type)).toContain('Provenance');
  });

  /**
   * The security property, asserted rather than assumed.
   *
   * The audit row carries the columns that make the log tamper-evident - `seq`,
   * `prevHash`, `hash` - plus the request forensics `sourceIp` and `userAgent`.
   * None of them belongs in a resource any SMART app with audit scope can read:
   * the chain is verified through the audit export, and the forensics would hand
   * a third party a picture of staff network layout.
   *
   * The mapper takes a DomainProvenance, which has no field for any of them, so
   * this is structural. The test exists because "structural" is a claim about
   * today's shape, and the cost of it quietly stopping being true is a leak.
   */
  it('carries no chain column and no request forensics', async () => {
    const created = harness();
    const stored = created.auditStore.chain(DEMO_TENANT_A)[0];
    expect(stored, 'the fixture appended no event').toBeDefined();

    const body = await (
      await created.app.request('/fhir/Provenance', { headers: bearer(TOKENS.adminA) })
    ).text();

    // Two different checks, because the two kinds of leak look different.
    //
    // The hashes are long and unique, so their VALUES are worth searching the
    // payload for - and they are read from the store rather than typed here,
    // because an assertion against a hash this test invented would pass whether
    // or not the boundary leaks.
    for (const [name, value] of [
      ['hash', stored?.hash],
      ['prevHash', stored?.prevHash],
    ] as const) {
      expect(value, `${name} was empty, so the assertion below proves nothing`).toBeTruthy();
      expect(body, `${name} reached the Provenance boundary`).not.toContain(String(value));
    }

    // `seq` is a small integer: searching the payload for "1" would match an id,
    // a date or a page count and fail for reasons that have nothing to do with a
    // leak. The question for these is whether the FIELD exists on the resource,
    // which is a structural check rather than a textual one.
    const bundle = JSON.parse(body) as Bundle;
    for (const entry of bundle.entry ?? []) {
      const resource = entry.resource as unknown as Record<string, unknown>;
      for (const field of ['seq', 'hash', 'prevHash', 'sourceIp', 'userAgent', 'tenantId']) {
        expect(resource, `${field} reached the Provenance boundary`).not.toHaveProperty(field);
      }
    }
    expect(bundle.total).toBeGreaterThan(0);
  });

  it('narrows on target, and accepts a bare id as well as a typed reference', async () => {
    const { app } = harness();

    const typed = (await (
      await app.request(`/fhir/Provenance?target=Patient/${PATIENT}`, {
        headers: bearer(TOKENS.adminA),
      })
    ).json()) as Bundle;
    const bare = (await (
      await app.request(`/fhir/Provenance?target=${PATIENT}`, { headers: bearer(TOKENS.adminA) })
    ).json()) as Bundle;
    const other = (await (
      await app.request(`/fhir/Provenance?target=Patient/${testId(777)}`, {
        headers: bearer(TOKENS.adminA),
      })
    ).json()) as Bundle;

    expect(typed.total).toBe(1);
    expect(bare.total).toBe(1);
    expect(other.total).toBe(0);
  });

  /**
   * A patient's own token must not become a window onto the practice's activity
   * log. The audit permission is what stops it, and it is checked here rather
   * than trusted because Provenance is the one served resource whose rows are
   * about staff rather than about the patient reading them.
   */
  it('refuses a principal without the audit permission', async () => {
    const { app } = harness();

    const res = await app.request('/fhir/Provenance', { headers: bearer(TOKENS.portalA) });

    expect(res.status).toBe(403);
  });
});

describe('Claim', () => {
  /**
   * The biller, and the one case where it is not a person.
   *
   * `provider` normally names the clinician the encounter records. When the
   * encounter is unreadable in the caller's scope there is no clinician to
   * name, and the truthful answer is the practice - a claim naming no biller at
   * all would fail validation at the clearinghouse.
   *
   * The reference has to say which it is. Emitting the practice as
   * `Practitioner/{id}` named a practitioner that does not exist, and once this
   * server began serving Organization it resolved at the wrong type, which a
   * client is less likely to catch than a 404.
   */
  const providerOf = async (app: ReturnType<typeof harness>['app'], id: string) => {
    const claim = (await (
      await app.request(`/fhir/Claim/${id}`, { headers: bearer(TOKENS.adminA) })
    ).json()) as { provider?: { reference?: string; type?: string } };
    return claim.provider;
  };

  it('names the encounter clinician as a Practitioner', async () => {
    const { app } = harness();

    await expect(providerOf(app, CLAIM)).resolves.toMatchObject({
      type: 'Practitioner',
      reference: `Practitioner/${PROVIDER}`,
    });
  });

  it('names the practice as an Organization when no clinician can be resolved', async () => {
    const created = harness();
    // A claim on an encounter this dataset does not hold, which is the shape a
    // caller sees when the encounter is outside their scope.
    seed(created.dataset, 'Claim', claimRow(SECOND_CLAIM, 'SUBMITTED'));
    const orphan = created.dataset.table('Claim').find((row) => row.id === SECOND_CLAIM);
    if (orphan !== undefined) orphan.encounterId = testId(9_999);

    await expect(providerOf(created.app, SECOND_CLAIM)).resolves.toMatchObject({
      type: 'Organization',
      reference: `Organization/${DEMO_TENANT_A}`,
    });
  });

  it('emits a provider reference that resolves at the type it claims', async () => {
    const created = harness();
    seed(created.dataset, 'Claim', claimRow(SECOND_CLAIM, 'SUBMITTED'));
    const orphan = created.dataset.table('Claim').find((row) => row.id === SECOND_CLAIM);
    if (orphan !== undefined) orphan.encounterId = testId(9_999);

    const reference = (await providerOf(created.app, SECOND_CLAIM))?.reference ?? '';
    const followed = await created.app.request(`/fhir/${reference}`, {
      headers: bearer(TOKENS.adminA),
    });

    // The whole point: following the pointer as the type it names finds
    // something. Before this it named Practitioner and found nothing.
    expect(followed.status).toBe(200);
  });

  it('carries every line of the claim, in sequence order', async () => {
    const { app } = harness();

    const bundle = (await (
      await app.request(`/fhir/Claim/${CLAIM}`, { headers: bearer(TOKENS.adminA) })
    ).json()) as {
      item?: { sequence?: number; productOrService?: { coding?: { code?: string }[] } }[];
    };

    expect(bundle.item?.map((line) => line.sequence)).toEqual([1, 2]);
    expect(bundle.item?.map((line) => line.productOrService?.coding?.[0]?.code)).toEqual([
      '99213',
      '85025',
    ]);
  });

  /**
   * Adjudicated money belongs to ClaimResponse and to the remittance ledger, not
   * to the claim as submitted; `snapshot` and `controlNumbers` are the as-built
   * X12 payload. CLAIM_DROPPED_FIELDS in packages/fhir lists them, and this is
   * the assertion that the list is obeyed rather than merely written down.
   */
  it('does not leak adjudicated money or the X12 payload', async () => {
    const { app } = harness();

    const body = await (
      await app.request(`/fhir/Claim/${CLAIM}`, { headers: bearer(TOKENS.adminA) })
    ).text();

    const resource = JSON.parse(body) as Record<string, unknown>;
    for (const field of [
      'totalPaidCents',
      'totalAdjustedCents',
      'patientResponsibilityCents',
      'snapshot',
      'controlNumbers',
      'tenantId',
    ]) {
      expect(resource, `${field} reached the Claim boundary`).not.toHaveProperty(field);
    }
  });

  /**
   * `status` answers the FHIR code, not the ten domain states behind it.
   *
   * `CLAIM_STATUS` collapses seven of those states into `active`, so the test
   * that matters is not that `active` is accepted but that it returns all of
   * them. A scalar filter resolving the code to its canonical state would pass
   * an "is it accepted" test and return one claim out of two here.
   */
  const claimStatuses = async (app: ReturnType<typeof harness>['app'], value: string) => {
    const res = await app.request(`/fhir/Claim?status=${value}`, {
      headers: bearer(TOKENS.adminA),
    });
    if (res.status !== 200) return res.status;
    const bundle = (await res.json()) as Bundle;
    return (bundle.entry ?? [])
      .map((entry) => (entry.resource as FhirResource).id)
      .sort((left, right) => (left ?? '').localeCompare(right ?? ''));
  };

  it('answers a FHIR code with every domain state it collapses', async () => {
    const created = harness();
    seed(created.dataset, 'Claim', claimRow(SECOND_CLAIM, 'DENIED'));

    // SUBMITTED and DENIED are different domain states that both map to
    // `active`, and both have to come back.
    await expect(claimStatuses(created.app, 'active')).resolves.toEqual(
      [CLAIM, SECOND_CLAIM].sort((left, right) => left.localeCompare(right))
    );
  });

  it('does not match a code none of the seeded states map to', async () => {
    const created = harness();
    seed(created.dataset, 'Claim', claimRow(SECOND_CLAIM, 'DENIED'));

    await expect(claimStatuses(created.app, 'draft')).resolves.toEqual([]);
    await expect(claimStatuses(created.app, 'cancelled')).resolves.toEqual([]);
  });

  it('finds the one claim whose state maps to the code, not its neighbours', async () => {
    const created = harness();
    seed(created.dataset, 'Claim', claimRow(SECOND_CLAIM, 'VOID'));

    await expect(claimStatuses(created.app, 'cancelled')).resolves.toEqual([SECOND_CLAIM]);
    await expect(claimStatuses(created.app, 'active')).resolves.toEqual([CLAIM]);
  });

  /**
   * The domain names used to work here, and that was the bug: an integrator who
   * read `active` in the CapabilityStatement, got a 400 and went looking would
   * find `SUBMITTED` and write an integration against a vocabulary no client
   * outside this repository can discover.
   */
  it('refuses the domain status names it used to accept', async () => {
    const { app } = harness();

    await expect(claimStatuses(app, 'SUBMITTED')).resolves.toBe(400);
    await expect(claimStatuses(app, 'submitted')).resolves.toBe(400);
  });

  /**
   * `entered-in-error` is inside R4's Claim status value set and no domain state
   * maps to it. Refused rather than answered with an empty bundle, because an
   * empty bundle reads as "no claims" rather than "this server has no such
   * state" - and because `Observation` already 400s `status=unknown` for the
   * same reason, fourteen lines away in the same file.
   */
  it('refuses a legal FHIR code no domain state maps to', async () => {
    const { app } = harness();

    await expect(claimStatuses(app, 'entered-in-error')).resolves.toBe(400);
    await expect(claimStatuses(app, 'not-a-status')).resolves.toBe(400);
  });
});

/**
 * The caller's facility scope, applied at the FHIR boundary.
 *
 * Every resource below is seeded into the SAME tenant as the caller and differs
 * only in which site it belongs to. That is deliberate: tenant isolation would
 * hide a row in the other organisation all on its own, so a fixture placed
 * there would pass whether or not facility narrowing existed. The annexe is
 * tenant A's own second site, and nothing except the facility scope can explain
 * a row there being out of reach.
 *
 * The admin tokens used everywhere else in this file hold `facility.all` and
 * skip the narrowing by design, so these tests use `siteReaderA`: the shipping
 * `read-only` role, which holds every `.read` permission and not that one,
 * granted facility A alone.
 */
const ANNEXE_PATIENT = testId(990);
const ANNEXE_APPOINTMENT = testId(991);
const ANNEXE_ENCOUNTER = testId(992);
const ANNEXE_GRANT = testId(993);
const UNSITED_PATIENT = testId(994);

/** Rows at the annexe, one per resource type that carries a facility. */
/**
 * The rows a site-limited caller must not reach, and Patient is not among them.
 *
 * Every entry here narrows on `facilityId`: the appointment happened at that
 * site, the encounter happened there, the grant is held there. Containment.
 *
 * `Patient.primaryFacilityId` is attribution - the site that registered
 * somebody - and #139 decided it is not a boundary. It hid the chart of a
 * patient registered at one site from the clinician treating them at another,
 * while still showing a patient registered here who has only ever been seen
 * elsewhere. The `patients` collection carries the column and does not narrow
 * on it; `repositories.facility-scope.test.ts` records the exemption.
 */
const ANNEXE_ROWS = [
  { type: 'Appointment', id: ANNEXE_APPOINTMENT },
  { type: 'Encounter', id: ANNEXE_ENCOUNTER },
  { type: 'PractitionerRole', id: ANNEXE_GRANT },
] as const;

function seedSecondSite(dataset: MemoryDataset): void {
  seed(
    dataset,
    'Patient',
    makePatientRow({
      id: ANNEXE_PATIENT,
      mrn: 'OR-100990',
      familyName: 'Annexeson',
      primaryFacilityId: SECOND_SITE,
    })
  );

  // A patient with no home site at all. Facility narrowing has to let this one
  // through: a chart is registered before anyone decides which site it belongs
  // to, and a scope that dropped every unsited row would hide new patients from
  // the staff registering them.
  seed(
    dataset,
    'Patient',
    makePatientRow({
      id: UNSITED_PATIENT,
      mrn: 'OR-100994',
      familyName: 'Unsitedsson',
      primaryFacilityId: null,
    })
  );

  seed(
    dataset,
    'Appointment',
    makeAppointmentRow({ id: ANNEXE_APPOINTMENT, facilityId: SECOND_SITE })
  );

  seed(dataset, 'Encounter', {
    ...storageColumns(ANNEXE_ENCOUNTER),
    facilityId: SECOND_SITE,
    patientId: ANNEXE_PATIENT,
    providerId: PROVIDER,
    appointmentId: null,
    class: 'AMBULATORY',
    status: 'COMPLETED',
    reasonCode: 'R51',
    reasonText: 'Headache',
    startedAt: FIXED_NOW,
    endedAt: null,
    signedAt: null,
    signedById: null,
  });

  seed(dataset, 'RoleAssignment', {
    ...storageColumns(ANNEXE_GRANT),
    userId: PROVIDER,
    roleId: NURSE_ROLE,
    facilityId: SECOND_SITE,
  });
}

function scopedHarness(): ReturnType<typeof createTestApp> {
  const created = harness();
  seedSecondSite(created.dataset);
  return created;
}

async function bundleIds(
  app: ReturnType<typeof createTestApp>['app'],
  type: string,
  token: string
): Promise<string[]> {
  const res = await app.request(`/fhir/${type}?_count=50`, { headers: bearer(token) });
  expect(res.status, `${type} search`).toBe(200);
  const bundle = (await res.json()) as Bundle;
  return (bundle.entry ?? []).map((entry) => (entry.resource as FhirResource).id ?? '');
}

describe('the facility scope the caller arrived with', () => {
  /**
   * The decision in #139, asserted on the boundary that used to implement the
   * opposite.
   *
   * The FHIR boundary narrowed patient reads on `primaryFacilityId` and the BFF
   * did not, so the same caller got 404 from one and 200 from the other for the
   * same chart. They agree now, and they agree on the answer that lets a
   * clinician open the chart of the patient in front of them.
   */
  it('serves a chart registered at another site, because that is not containment', async () => {
    const { app } = scopedHarness();

    const res = await app.request(`/fhir/Patient/${ANNEXE_PATIENT}`, {
      headers: bearer(TOKENS.siteReaderA),
    });

    expect(res.status).toBe(200);
  });

  /**
   * The other half of #139, and the half the first draft of it got wrong.
   *
   * A list stays narrowed. A work queue should be local, and this is what keeps
   * a site-limited caller from paging the whole practice's index of names, MRNs
   * and birth dates. Dropping it would have widened a listing surface to fix a
   * lookup problem.
   */
  it('still leaves that chart out of a search, because a work queue is local', async () => {
    const { app } = scopedHarness();

    expect(await bundleIds(app, 'Patient', TOKENS.siteReaderA)).not.toContain(ANNEXE_PATIENT);
  });

  it.each(ANNEXE_ROWS)(
    '$type: a row at another site reads as absent, not as forbidden',
    async ({ type, id }) => {
      const { app } = scopedHarness();

      const res = await app.request(`/fhir/${type}/${id}`, {
        headers: bearer(TOKENS.siteReaderA),
      });

      // 404 rather than 403 on purpose. A 403 confirms the row exists, which
      // turns an id guess into a way to learn that a person was seen at a site
      // the caller cannot reach. Out of scope reads as never there.
      expect(res.status).toBe(404);
    }
  );

  it.each(ANNEXE_ROWS)("$type: a search omits the other site's row", async ({ type, id }) => {
    const { app } = scopedHarness();

    expect(await bundleIds(app, type, TOKENS.siteReaderA)).not.toContain(id);
  });

  it.each(ANNEXE_ROWS)(
    '$type: a principal holding facility.all still sees the other site',
    async ({ type, id }) => {
      const { app } = scopedHarness();

      // The narrowing is a floor for principals who lack `facility.all`, not a
      // new restriction on the ones who hold it. Without this, a scope bug that
      // hid the annexe from everybody would look like a pass above.
      const res = await app.request(`/fhir/${type}/${id}`, { headers: bearer(TOKENS.adminA) });

      expect(res.status).toBe(200);
      expect(await bundleIds(app, type, TOKENS.adminA)).toContain(id);
    }
  );

  it('keeps a patient with no home site visible to a site-scoped caller', async () => {
    const { app } = scopedHarness();

    const res = await app.request(`/fhir/Patient/${UNSITED_PATIENT}`, {
      headers: bearer(TOKENS.siteReaderA),
    });

    expect(res.status).toBe(200);
    expect(await bundleIds(app, 'Patient', TOKENS.siteReaderA)).toContain(UNSITED_PATIENT);
  });

  it('keeps an organisation-wide role grant visible to a site-scoped caller', async () => {
    const { app } = scopedHarness();

    // `ORG_GRANT` carries no facility, which is how this schema says "everywhere
    // in the organisation". Narrowing that dropped null rows would quietly
    // revoke every organisation-wide grant for anyone not holding facility.all.
    const res = await app.request(`/fhir/PractitionerRole/${ORG_GRANT}`, {
      headers: bearer(TOKENS.siteReaderA),
    });

    expect(res.status).toBe(200);
    expect(await bundleIds(app, 'PractitionerRole', TOKENS.siteReaderA)).toContain(ORG_GRANT);
  });

  it("still serves the caller's own site", async () => {
    const { app } = scopedHarness();

    // The narrowing has to remove the annexe and nothing else. A clause that
    // matched no rows at all would satisfy every assertion above.
    const res = await app.request(`/fhir/Patient/${PATIENT}`, {
      headers: bearer(TOKENS.siteReaderA),
    });

    expect(res.status).toBe(200);
    expect(await bundleIds(app, 'Patient', TOKENS.siteReaderA)).toContain(PATIENT);
  });
});

/**
 * The practice itself, and the one narrowing that holds it.
 *
 * `Organisation` is the only model in the schema with no `tenantId` column,
 * because it *is* the tenant. Every other collection is confined by a tenant
 * filter it inherits from a spec; this one is confined by `id === tenantId` in
 * a hand-written repository. So the tests that matter are the ones that would
 * still pass if that narrowing were deleted, and these are written to fail.
 */
describe('the practice organisation', () => {
  const organisationRow = (id: string, name: string): Parameters<typeof seed>[2] =>
    ({
      id,
      slug: name.toLowerCase().replaceAll(' ', '-'),
      name,
      mode: 'SELF_HOST',
      status: 'ACTIVE',
      timezone: 'UTC',
      flags: {},
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    }) as unknown as Parameters<typeof seed>[2];

  it('serves the caller their own practice, as a page of one', async () => {
    const { app } = harness();

    const bundle = (await (
      await app.request('/fhir/Organization', { headers: bearer(TOKENS.adminA) })
    ).json()) as Bundle;

    expect(bundle.total).toBe(1);
    expect((bundle.entry?.[0]?.resource as FhirResource).id).toBe(DEMO_TENANT_A);
  });

  it('leaves another practice out of the search entirely', async () => {
    const created = harness();
    seed(created.dataset, 'Organisation', organisationRow(DEMO_TENANT_B, 'Other Practice'));

    const bundle = (await (
      await created.app.request('/fhir/Organization', { headers: bearer(TOKENS.adminA) })
    ).json()) as Bundle;

    // Two rows in the table, one in the bundle. Nothing about the other
    // practice reaches this caller, not even its existence.
    expect(created.dataset.table('Organisation')).toHaveLength(2);
    expect(bundle.total).toBe(1);
    expect((bundle.entry?.[0]?.resource as FhirResource).id).toBe(DEMO_TENANT_A);
  });

  it('reports another practice as absent rather than forbidden', async () => {
    const created = harness();
    seed(created.dataset, 'Organisation', organisationRow(DEMO_TENANT_B, 'Other Practice'));

    const res = await created.app.request(`/fhir/Organization/${DEMO_TENANT_B}`, {
      headers: bearer(TOKENS.adminA),
    });

    // 404 and not 403: a 403 would confirm the id names something real, which
    // is a fact about another practice this caller has no business learning.
    expect(res.status).toBe(404);
  });

  it('gives each practice its own row, not the first one seeded', async () => {
    const created = harness();
    seed(created.dataset, 'Organisation', organisationRow(DEMO_TENANT_B, 'Other Practice'));

    const bundle = (await (
      await created.app.request('/fhir/Organization', { headers: bearer(TOKENS.adminB) })
    ).json()) as Bundle;

    expect((bundle.entry?.[0]?.resource as FhirResource).id).toBe(DEMO_TENANT_B);
  });

  it('filters by name, and matching nothing is an empty bundle', async () => {
    const { app } = harness();

    const hit = (await (
      await app.request('/fhir/Organization?name=family', { headers: bearer(TOKENS.adminA) })
    ).json()) as Bundle;
    const miss = (await (
      await app.request('/fhir/Organization?name=nowhere', { headers: bearer(TOKENS.adminA) })
    ).json()) as Bundle;

    // Case-insensitive substring, as the FHIR string parameter means it.
    expect(hit.total).toBe(1);
    expect(miss.total).toBe(0);
  });

  it('carries the practice name and the provider type', async () => {
    const { app } = harness();

    const organization = (await (
      await app.request(`/fhir/Organization/${DEMO_TENANT_A}`, { headers: bearer(TOKENS.adminA) })
    ).json()) as fhir4.Organization;

    expect(organization.name).toBe('Demo Family Practice');
    expect(organization.active).toBe(true);
    expect(organization.type?.[0]?.coding?.[0]?.code).toBe('prov');
  });

  it('refuses a caller without the permission Location needs', async () => {
    const { app } = harness();

    const res = await app.request('/fhir/Organization', { headers: bearer(UNPRIVILEGED_TOKEN) });

    expect(res.status).toBe(403);
  });

  it('resolves the references other resources emit at it', async () => {
    const { app } = harness();

    const role = (await (
      await app.request(`/fhir/PractitionerRole/${SITE_GRANT}`, { headers: bearer(TOKENS.adminA) })
    ).json()) as { organization?: { reference?: string } };
    const reference = role.organization?.reference ?? '';

    expect(reference).toBe(`Organization/${DEMO_TENANT_A}`);
    // The point of serving it: following the pointer now finds something.
    const followed = await app.request(`/fhir/${reference}`, { headers: bearer(TOKENS.adminA) });
    expect(followed.status).toBe(200);
  });
});
