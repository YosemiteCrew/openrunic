import type { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import type { AppEnv } from '../context.js';
import type { ProblemDocument } from '../http/problem.js';
import { toHonoPath } from '../openapi/registry.js';
import type { BaseQuery, CollectionSpec, RowContext } from '../repositories/collection.js';
import type { MemoryDataset } from '../repositories/memory.js';
import type { PrismaModelName, ScopedRow } from '../repositories/rows.js';
import {
  allergySpec,
  clinicalNoteSpec,
  conditionSpec,
  encounterSpec,
  immunisationSpec,
  medicationRequestSpec,
  medicationStatementSpec,
  noteAddendumSpec,
  observationSpec,
  type AllergyIntoleranceRow,
  type ClinicalNoteRow,
  type ConditionRow,
  type EncounterRow,
  type ImmunizationRow,
  type MedicationRequestRow,
  type MedicationStatementRow,
  type NoteAddendumRow,
  type ObservationRow,
} from '../repositories/specs/clinical.js';
import type {
  EncounterDto,
  NoteAddendumDto,
  NoteDto,
  ObservationDto,
  PrescriptionDto,
} from '../schemas/clinical.js';
import type { ListResponse } from '../schemas/pagination.js';
import { clinicalRouteContracts } from '../routes/clinical.js';

import { matchesWhere } from './fake-port.js';
import {
  bearer,
  createTestApp,
  DEMO_FACILITY_A,
  DEMO_FACILITY_B,
  DEMO_PORTAL_PATIENT,
  DEMO_TENANT_A,
  FIXED_NOW,
  jsonBearer,
  seed,
  TOKENS,
  testId,
  UNPRIVILEGED_TOKEN,
} from './support.js';

/**
 * The chart endpoints, driven through the real app.
 *
 * Everything here goes through `app.request()` against the in-memory store, so
 * what is under test is the middleware chain, the permission, the compartment,
 * the repository and the handler together. Synthetic data only: Testina
 * Patientsson's chart, invented codes and no identifier that could belong to
 * anyone.
 *
 * The suite is deliberately lopsided. The four plain operations are checked
 * from one table, because they are one implementation shared by eight
 * aggregates and testing them eight times by hand would only prove that the
 * table was copied correctly. The transitions get the space instead: each one
 * is exercised in both directions, because a state machine that only ever gets
 * asked for the moves it allows has not been tested at all.
 */

const PATIENT_ID = testId(1);
const OTHER_PATIENT_ID = testId(2);
const PROVIDER_ID = testId(900);
const ENCOUNTER_ID = testId(201);
const OTHER_ENCOUNTER_ID = testId(202);
const NOTE_ID = testId(301);
const PROBLEM_ID = testId(321);
const STATEMENT_ID = testId(331);
const PRESCRIPTION_ID = testId(341);
const ALLERGY_ID = testId(351);
const IMMUNISATION_ID = testId(361);
const OBSERVATION_ID = testId(371);

/** The subject on the `dev-clinician-a` token. A public fixture, not a credential. */
const CLINICIAN_A = '01890000-0000-7000-8000-000000000101';

const EARLIER = new Date('2026-08-12T08:00:00.000Z');
const LATER = new Date('2026-08-13T08:00:00.000Z');

/* ------------------------------------------------------------------ rows */

function makeEncounterRow(overrides: Partial<EncounterRow> = {}): EncounterRow {
  return {
    id: ENCOUNTER_ID,
    tenantId: DEMO_TENANT_A,
    facilityId: DEMO_FACILITY_A,
    patientId: PATIENT_ID,
    providerId: PROVIDER_ID,
    appointmentId: null,
    class: 'AMBULATORY',
    status: 'IN_PROGRESS',
    reasonCode: null,
    reasonText: null,
    startedAt: LATER,
    endedAt: null,
    signedAt: null,
    signedById: null,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...overrides,
  };
}

function makeNoteRow(overrides: Partial<ClinicalNoteRow> = {}): ClinicalNoteRow {
  return {
    id: NOTE_ID,
    tenantId: DEMO_TENANT_A,
    patientId: PATIENT_ID,
    encounterId: ENCOUNTER_ID,
    authorId: PROVIDER_ID,
    title: 'Progress note',
    blocks: [{ type: 'text', text: 'Reviewed the problem list.' }],
    state: 'DRAFT',
    cosignerId: null,
    cosignedAt: null,
    signedAt: null,
    signedById: null,
    lockedAt: null,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...overrides,
  };
}

function makeAddendumRow(overrides: Partial<NoteAddendumRow> = {}): NoteAddendumRow {
  return {
    id: testId(311),
    tenantId: DEMO_TENANT_A,
    noteId: NOTE_ID,
    authorId: PROVIDER_ID,
    blocks: [{ type: 'text', text: 'Corrected the dose.' }],
    reason: null,
    signedAt: FIXED_NOW,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...overrides,
  };
}

function makeProblemRow(overrides: Partial<ConditionRow> = {}): ConditionRow {
  return {
    id: PROBLEM_ID,
    tenantId: DEMO_TENANT_A,
    patientId: PATIENT_ID,
    encounterId: ENCOUNTER_ID,
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
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...overrides,
  };
}

function makeStatementRow(overrides: Partial<MedicationStatementRow> = {}): MedicationStatementRow {
  return {
    id: STATEMENT_ID,
    tenantId: DEMO_TENANT_A,
    patientId: PATIENT_ID,
    encounterId: ENCOUNTER_ID,
    rxnormCode: '860975',
    display: 'Metformin 500 mg oral tablet',
    sigText: null,
    status: 'ACTIVE',
    source: 'REPORTED',
    effectiveStart: null,
    effectiveEnd: null,
    reportedAt: FIXED_NOW,
    note: null,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...overrides,
  };
}

function makePrescriptionRow(overrides: Partial<MedicationRequestRow> = {}): MedicationRequestRow {
  return {
    id: PRESCRIPTION_ID,
    tenantId: DEMO_TENANT_A,
    patientId: PATIENT_ID,
    encounterId: ENCOUNTER_ID,
    prescriberId: PROVIDER_ID,
    rxnormCode: null,
    ndcCode: null,
    display: 'Amoxicillin 500 mg oral capsule',
    sig: {},
    sigText: 'One capsule by mouth three times daily',
    quantity: 21,
    quantityUnit: 'capsule',
    refills: 0,
    daysSupply: 7,
    dispenseAsWritten: false,
    controlledSchedule: null,
    pharmacyName: null,
    pharmacyNcpdpId: null,
    status: 'DRAFT',
    intent: 'ORDER',
    erxRef: null,
    writtenAt: FIXED_NOW,
    transmittedAt: null,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...overrides,
  };
}

function makeAllergyRow(overrides: Partial<AllergyIntoleranceRow> = {}): AllergyIntoleranceRow {
  return {
    id: ALLERGY_ID,
    tenantId: DEMO_TENANT_A,
    patientId: PATIENT_ID,
    type: 'ALLERGY',
    category: 'MEDICATION',
    criticality: 'HIGH',
    clinicalStatus: 'ACTIVE',
    substanceCode: null,
    substanceCodeSystem: null,
    substanceDisplay: 'Penicillin V',
    reactionCodes: [],
    reactionText: null,
    severity: null,
    onsetDate: null,
    note: null,
    recordedAt: FIXED_NOW,
    recordedById: null,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...overrides,
  };
}

function makeImmunisationRow(overrides: Partial<ImmunizationRow> = {}): ImmunizationRow {
  return {
    id: IMMUNISATION_ID,
    tenantId: DEMO_TENANT_A,
    patientId: PATIENT_ID,
    encounterId: ENCOUNTER_ID,
    status: 'COMPLETED',
    cvxCode: '150',
    mvxCode: null,
    ndcCode: null,
    display: 'Influenza vaccine, quadrivalent',
    lotNumber: null,
    expirationDate: null,
    siteCode: null,
    routeCode: null,
    doseQuantity: null,
    doseUnit: null,
    administeredAt: LATER,
    administeredById: null,
    visDate: null,
    refusalReasonCode: null,
    reportedToRegistryAt: null,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...overrides,
  };
}

function makeObservationRow(overrides: Partial<ObservationRow> = {}): ObservationRow {
  return {
    id: OBSERVATION_ID,
    tenantId: DEMO_TENANT_A,
    patientId: PATIENT_ID,
    encounterId: ENCOUNTER_ID,
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
    referenceLow: null,
    referenceHigh: null,
    interpretationCode: null,
    bodySiteCode: null,
    effectiveAt: LATER,
    issuedAt: null,
    performerId: null,
    formSubmissionId: null,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...overrides,
  };
}

/* -------------------------------------------------------------- utilities */

type App = Hono<AppEnv>;

async function listOf(
  app: App,
  url: string,
  token: string = TOKENS.clinicianA
): Promise<ListResponse<{ id: string }>> {
  const res = await app.request(url, { headers: bearer(token) });
  expect(res.status, url).toBe(200);
  return (await res.json()) as ListResponse<{ id: string }>;
}

async function problemOf(res: Response): Promise<ProblemDocument> {
  return (await res.json()) as ProblemDocument;
}

async function post(
  app: App,
  url: string,
  body: unknown,
  token: string = TOKENS.clinicianA
): Promise<Response> {
  return app.request(url, {
    method: 'POST',
    headers: jsonBearer(token),
    body: JSON.stringify(body),
  });
}

async function patch(
  app: App,
  url: string,
  body: unknown,
  token: string = TOKENS.clinicianA
): Promise<Response> {
  return app.request(url, {
    method: 'PATCH',
    headers: jsonBearer(token),
    body: JSON.stringify(body),
  });
}

/** A signing or transition call: a POST with no body at all. */
async function move(app: App, url: string, token: string = TOKENS.clinicianA): Promise<Response> {
  return app.request(url, { method: 'POST', headers: bearer(token) });
}

/* ------------------------------------------------------- the plain four */

interface CrudCase {
  name: string;
  path: string;
  id: string;
  /** The row every shared test reads, patches and filters for. */
  seedRow: (dataset: MemoryDataset) => void;
  /** Two rows that differ in the default sort column, in ascending order. */
  seedPair: (dataset: MemoryDataset) => readonly [string, string];
  /** Only the required fields, so every column default is exercised. */
  create: Record<string, unknown>;
  /** Every optional field as well, so no column is written only as a default. */
  createFull: Record<string, unknown>;
  invalidCreate: Record<string, unknown>;
  /** Every patchable field at once, so every column a patch can touch is. */
  patch: Record<string, unknown>;
  patched: readonly [field: string, value: unknown];
  /** A second field, patched on its own, so no column is only ever set. */
  alsoPatched: readonly [field: string, value: unknown];
  invalidPatch: Record<string, unknown>;
  /** Each advertised filter as a `[selects the row, selects nothing]` pair. */
  filters: readonly (readonly [string, string])[];
}

const CRUD_CASES: readonly CrudCase[] = [
  {
    name: 'encounters',
    path: '/bff/v0/encounters',
    id: ENCOUNTER_ID,
    seedRow: (dataset) => seed(dataset, 'Encounter', makeEncounterRow()),
    seedPair: (dataset) => {
      seed(
        dataset,
        'Encounter',
        makeEncounterRow({ id: ENCOUNTER_ID, startedAt: LATER }),
        makeEncounterRow({ id: OTHER_ENCOUNTER_ID, startedAt: EARLIER })
      );
      return [OTHER_ENCOUNTER_ID, ENCOUNTER_ID];
    },
    create: {
      facilityId: DEMO_FACILITY_A,
      patientId: PATIENT_ID,
      providerId: PROVIDER_ID,
      startedAt: '2026-08-13T09:00:00.000Z',
    },
    createFull: {
      facilityId: DEMO_FACILITY_A,
      patientId: PATIENT_ID,
      providerId: PROVIDER_ID,
      appointmentId: testId(101),
      class: 'VIRTUAL',
      status: 'IN_PROGRESS',
      reasonCode: 'R05',
      reasonText: 'Cough',
      startedAt: '2026-08-13T09:00:00.000Z',
      endedAt: '2026-08-13T09:30:00.000Z',
    },
    invalidCreate: {
      facilityId: 'not-a-uuid',
      patientId: PATIENT_ID,
      providerId: PROVIDER_ID,
      startedAt: '2026-08-13T09:00:00.000Z',
    },
    patch: {
      status: 'ON_HOLD',
      class: 'VIRTUAL',
      providerId: testId(901),
      reasonCode: 'R05',
      reasonText: 'Cough',
      endedAt: '2026-08-13T10:00:00.000Z',
    },
    patched: ['reasonText', 'Cough'],
    alsoPatched: ['class', 'VIRTUAL'],
    invalidPatch: {},
    filters: [
      [`patientId=${PATIENT_ID}`, `patientId=${OTHER_PATIENT_ID}`],
      [`facilityId=${DEMO_FACILITY_A}`, `facilityId=${DEMO_FACILITY_B}`],
      [`providerId=${PROVIDER_ID}`, `providerId=${testId(901)}`],
      ['status=IN_PROGRESS', 'status=COMPLETED'],
      ['from=2026-08-13T00:00:00.000Z', 'from=2026-08-14T00:00:00.000Z'],
      ['to=2026-08-14T00:00:00.000Z', 'to=2026-08-13T00:00:00.000Z'],
    ],
  },
  {
    name: 'notes',
    path: '/bff/v0/notes',
    id: NOTE_ID,
    seedRow: (dataset) => seed(dataset, 'ClinicalNote', makeNoteRow()),
    seedPair: (dataset) => {
      seed(
        dataset,
        'ClinicalNote',
        makeNoteRow({ id: NOTE_ID, createdAt: LATER }),
        makeNoteRow({ id: testId(302), createdAt: EARLIER })
      );
      return [testId(302), NOTE_ID];
    },
    create: {
      patientId: PATIENT_ID,
      encounterId: ENCOUNTER_ID,
      authorId: PROVIDER_ID,
      title: 'Progress note',
      blocks: [{ type: 'text', text: 'Reviewed.' }],
    },
    createFull: {
      patientId: PATIENT_ID,
      encounterId: ENCOUNTER_ID,
      authorId: PROVIDER_ID,
      title: 'Progress note',
      blocks: [{ type: 'text', text: 'Reviewed.' }],
      state: 'UNSIGNED',
      cosignerId: testId(902),
    },
    invalidCreate: {
      patientId: PATIENT_ID,
      encounterId: ENCOUNTER_ID,
      authorId: PROVIDER_ID,
      title: 'Progress note',
      blocks: 'not a block list',
    },
    patch: {
      title: 'Progress note, revised',
      blocks: [{ type: 'text', text: 'Revised.' }],
      state: 'UNSIGNED',
      cosignerId: testId(902),
    },
    patched: ['title', 'Progress note, revised'],
    alsoPatched: ['cosignerId', testId(902)],
    invalidPatch: {},
    filters: [
      [`patientId=${PATIENT_ID}`, `patientId=${OTHER_PATIENT_ID}`],
      [`encounterId=${ENCOUNTER_ID}`, `encounterId=${OTHER_ENCOUNTER_ID}`],
      [`authorId=${PROVIDER_ID}`, `authorId=${testId(901)}`],
      ['state=DRAFT', 'state=SIGNED'],
    ],
  },
  {
    name: 'problems',
    path: '/bff/v0/problems',
    id: PROBLEM_ID,
    seedRow: (dataset) => seed(dataset, 'Condition', makeProblemRow()),
    seedPair: (dataset) => {
      seed(
        dataset,
        'Condition',
        makeProblemRow({ id: PROBLEM_ID, recordedAt: LATER }),
        makeProblemRow({ id: testId(322), recordedAt: EARLIER })
      );
      return [testId(322), PROBLEM_ID];
    },
    create: {
      patientId: PATIENT_ID,
      code: 'J45.909',
      display: 'Unspecified asthma, uncomplicated',
    },
    createFull: {
      patientId: PATIENT_ID,
      encounterId: ENCOUNTER_ID,
      category: 'ENCOUNTER_DIAGNOSIS',
      code: 'J45.909',
      codeSystem: 'http://snomed.info/sct',
      display: 'Unspecified asthma, uncomplicated',
      snomedCode: '195967001',
      clinicalStatus: 'RECURRENCE',
      verificationStatus: 'PROVISIONAL',
      onsetDate: '2020-04-01',
      abatementDate: '2026-01-15',
      severityCode: '255604002',
      bodySiteCode: '39607008',
      note: 'Well controlled on an inhaled steroid.',
    },
    invalidCreate: { patientId: PATIENT_ID, code: 'J45.909' },
    patch: {
      category: 'ENCOUNTER_DIAGNOSIS',
      display: 'Mild intermittent asthma',
      clinicalStatus: 'RESOLVED',
      verificationStatus: 'REFUTED',
      abatementDate: '2026-08-13',
      severityCode: '255604002',
      bodySiteCode: '39607008',
      note: 'Resolved at follow-up.',
    },
    patched: ['clinicalStatus', 'RESOLVED'],
    alsoPatched: ['note', 'Reviewed at follow-up.'],
    invalidPatch: {},
    filters: [
      [`patientId=${PATIENT_ID}`, `patientId=${OTHER_PATIENT_ID}`],
      [`encounterId=${ENCOUNTER_ID}`, `encounterId=${OTHER_ENCOUNTER_ID}`],
      ['category=PROBLEM_LIST_ITEM', 'category=SURGERY'],
      ['clinicalStatus=ACTIVE', 'clinicalStatus=RESOLVED'],
      ['code=J45.909', 'code=E11.9'],
    ],
  },
  {
    name: 'medication statements',
    path: '/bff/v0/medications/statements',
    id: STATEMENT_ID,
    seedRow: (dataset) => seed(dataset, 'MedicationStatement', makeStatementRow()),
    seedPair: (dataset) => {
      seed(
        dataset,
        'MedicationStatement',
        makeStatementRow({ id: STATEMENT_ID, reportedAt: LATER }),
        makeStatementRow({ id: testId(332), reportedAt: EARLIER })
      );
      return [testId(332), STATEMENT_ID];
    },
    create: { patientId: PATIENT_ID, display: 'Metformin 500 mg oral tablet' },
    createFull: {
      patientId: PATIENT_ID,
      encounterId: ENCOUNTER_ID,
      rxnormCode: '860975',
      display: 'Metformin 500 mg oral tablet',
      sigText: 'One tablet by mouth twice daily',
      status: 'STOPPED',
      source: 'RECONCILED',
      effectiveStart: '2024-02-01',
      effectiveEnd: '2026-08-01',
      note: 'Stopped for a contrast study.',
    },
    invalidCreate: { patientId: PATIENT_ID },
    patch: {
      status: 'STOPPED',
      source: 'RECONCILED',
      display: 'Metformin 850 mg oral tablet',
      sigText: 'One tablet by mouth twice daily',
      effectiveEnd: '2026-08-13',
      note: 'Stopped.',
    },
    patched: ['status', 'STOPPED'],
    alsoPatched: ['sigText', 'One tablet by mouth twice daily'],
    invalidPatch: {},
    filters: [
      [`patientId=${PATIENT_ID}`, `patientId=${OTHER_PATIENT_ID}`],
      [`encounterId=${ENCOUNTER_ID}`, `encounterId=${OTHER_ENCOUNTER_ID}`],
      ['status=ACTIVE', 'status=STOPPED'],
    ],
  },
  {
    name: 'prescriptions',
    path: '/bff/v0/medications/prescriptions',
    id: PRESCRIPTION_ID,
    seedRow: (dataset) => seed(dataset, 'MedicationRequest', makePrescriptionRow()),
    seedPair: (dataset) => {
      seed(
        dataset,
        'MedicationRequest',
        makePrescriptionRow({ id: PRESCRIPTION_ID, writtenAt: LATER }),
        makePrescriptionRow({ id: testId(342), writtenAt: EARLIER })
      );
      return [testId(342), PRESCRIPTION_ID];
    },
    create: {
      patientId: PATIENT_ID,
      prescriberId: PROVIDER_ID,
      display: 'Amoxicillin 500 mg oral capsule',
      sigText: 'One capsule by mouth three times daily',
      quantity: 21,
      quantityUnit: 'capsule',
      refills: 0,
    },
    createFull: {
      patientId: PATIENT_ID,
      encounterId: ENCOUNTER_ID,
      prescriberId: PROVIDER_ID,
      rxnormCode: '308182',
      ndcCode: '00000-0000-01',
      display: 'Amoxicillin 500 mg oral capsule',
      sig: { dose: 1, unit: 'capsule', frequency: 3 },
      sigText: 'One capsule by mouth three times daily',
      quantity: 21,
      quantityUnit: 'capsule',
      refills: 1,
      daysSupply: 7,
      dispenseAsWritten: true,
      controlledSchedule: '4',
      pharmacyName: 'Testville Community Pharmacy',
      pharmacyNcpdpId: '1234567',
      status: 'PENDED',
      intent: 'ORIGINAL_ORDER',
    },
    invalidCreate: {
      patientId: PATIENT_ID,
      prescriberId: PROVIDER_ID,
      display: 'Amoxicillin 500 mg oral capsule',
      sigText: 'One capsule by mouth three times daily',
      quantity: 21,
      quantityUnit: 'capsule',
      refills: -1,
    },
    patch: {
      display: 'Amoxicillin 250 mg oral capsule',
      sigText: 'One capsule by mouth twice daily',
      quantity: 14,
      quantityUnit: 'capsule',
      refills: 2,
      daysSupply: 10,
      dispenseAsWritten: true,
      pharmacyName: 'Testville Community Pharmacy',
      pharmacyNcpdpId: '1234567',
    },
    patched: ['refills', 2],
    alsoPatched: ['daysSupply', 10],
    invalidPatch: { status: 'SIGNED' },
    filters: [
      [`patientId=${PATIENT_ID}`, `patientId=${OTHER_PATIENT_ID}`],
      [`encounterId=${ENCOUNTER_ID}`, `encounterId=${OTHER_ENCOUNTER_ID}`],
      [`prescriberId=${PROVIDER_ID}`, `prescriberId=${testId(901)}`],
      ['status=DRAFT', 'status=SIGNED'],
    ],
  },
  {
    name: 'allergies',
    path: '/bff/v0/allergies',
    id: ALLERGY_ID,
    seedRow: (dataset) => seed(dataset, 'AllergyIntolerance', makeAllergyRow()),
    seedPair: (dataset) => {
      seed(
        dataset,
        'AllergyIntolerance',
        makeAllergyRow({ id: ALLERGY_ID, recordedAt: LATER }),
        makeAllergyRow({ id: testId(352), recordedAt: EARLIER })
      );
      return [testId(352), ALLERGY_ID];
    },
    create: { patientId: PATIENT_ID, substanceDisplay: 'Penicillin V' },
    createFull: {
      patientId: PATIENT_ID,
      type: 'INTOLERANCE',
      category: 'FOOD',
      criticality: 'LOW',
      clinicalStatus: 'INACTIVE',
      substanceCode: '7980',
      substanceCodeSystem: 'http://www.nlm.nih.gov/research/umls/rxnorm',
      substanceDisplay: 'Penicillin V',
      reactionCodes: ['247472004'],
      reactionText: 'Hives',
      severity: 'MODERATE',
      onsetDate: '2019-06-02',
      note: 'Reported by the patient.',
    },
    invalidCreate: {
      patientId: PATIENT_ID,
      substanceDisplay: 'Penicillin V',
      criticality: 'MAYBE',
    },
    patch: {
      clinicalStatus: 'RESOLVED',
      criticality: 'LOW',
      category: 'FOOD',
      severity: 'MILD',
      reactionCodes: ['247472004'],
      reactionText: 'Hives',
      note: 'Rechecked at review.',
    },
    patched: ['criticality', 'LOW'],
    alsoPatched: ['reactionText', 'Hives'],
    invalidPatch: {},
    filters: [
      [`patientId=${PATIENT_ID}`, `patientId=${OTHER_PATIENT_ID}`],
      ['clinicalStatus=ACTIVE', 'clinicalStatus=RESOLVED'],
      ['criticality=HIGH', 'criticality=LOW'],
    ],
  },
  {
    name: 'immunisations',
    path: '/bff/v0/immunisations',
    id: IMMUNISATION_ID,
    seedRow: (dataset) => seed(dataset, 'Immunization', makeImmunisationRow()),
    seedPair: (dataset) => {
      seed(
        dataset,
        'Immunization',
        makeImmunisationRow({ id: IMMUNISATION_ID, administeredAt: LATER }),
        makeImmunisationRow({ id: testId(362), administeredAt: EARLIER })
      );
      return [testId(362), IMMUNISATION_ID];
    },
    create: {
      patientId: PATIENT_ID,
      cvxCode: '150',
      display: 'Influenza vaccine, quadrivalent',
      administeredAt: '2026-08-13T09:00:00.000Z',
    },
    createFull: {
      patientId: PATIENT_ID,
      encounterId: ENCOUNTER_ID,
      status: 'NOT_DONE',
      cvxCode: '150',
      mvxCode: 'TST',
      ndcCode: '00000-0000-02',
      display: 'Influenza vaccine, quadrivalent',
      lotNumber: 'LOT-4417',
      expirationDate: '2027-03-31',
      siteCode: 'LD',
      routeCode: 'IM',
      doseQuantity: 0.5,
      doseUnit: 'mL',
      administeredAt: '2026-08-13T09:00:00.000Z',
      administeredById: PROVIDER_ID,
      visDate: '2026-01-02',
      refusalReasonCode: 'IMMUNE',
    },
    invalidCreate: {
      patientId: PATIENT_ID,
      cvxCode: '150',
      display: 'Influenza vaccine, quadrivalent',
    },
    patch: {
      status: 'ENTERED_IN_ERROR',
      lotNumber: 'LOT-4417',
      expirationDate: '2027-03-31',
      siteCode: 'LD',
      routeCode: 'IM',
      refusalReasonCode: 'IMMUNE',
      reportedToRegistryAt: '2026-08-13T12:00:00.000Z',
    },
    patched: ['lotNumber', 'LOT-4417'],
    alsoPatched: ['siteCode', 'LD'],
    invalidPatch: {},
    filters: [
      [`patientId=${PATIENT_ID}`, `patientId=${OTHER_PATIENT_ID}`],
      [`encounterId=${ENCOUNTER_ID}`, `encounterId=${OTHER_ENCOUNTER_ID}`],
      ['cvxCode=150', 'cvxCode=141'],
      ['from=2026-08-13T00:00:00.000Z', 'from=2026-08-14T00:00:00.000Z'],
      ['to=2026-08-14T00:00:00.000Z', 'to=2026-08-13T00:00:00.000Z'],
    ],
  },
  {
    name: 'observations',
    path: '/bff/v0/observations',
    id: OBSERVATION_ID,
    seedRow: (dataset) => seed(dataset, 'Observation', makeObservationRow()),
    seedPair: (dataset) => {
      seed(
        dataset,
        'Observation',
        makeObservationRow({ id: OBSERVATION_ID, effectiveAt: LATER }),
        makeObservationRow({ id: testId(372), effectiveAt: EARLIER })
      );
      return [testId(372), OBSERVATION_ID];
    },
    create: {
      patientId: PATIENT_ID,
      code: '8867-4',
      display: 'Heart rate',
      valueText: 'Regular',
      effectiveAt: '2026-08-13T09:00:00.000Z',
    },
    createFull: {
      patientId: PATIENT_ID,
      encounterId: ENCOUNTER_ID,
      category: 'LABORATORY',
      status: 'PRELIMINARY',
      loincCode: '8867-4',
      code: '8867-4',
      codeSystem: 'http://snomed.info/sct',
      display: 'Heart rate',
      valueNumber: 72,
      valueText: 'Regular',
      valueCode: '271636001',
      valueBoolean: false,
      unit: '/min',
      referenceLow: 60,
      referenceHigh: 100,
      interpretationCode: 'N',
      bodySiteCode: '368209003',
      effectiveAt: '2026-08-13T09:00:00.000Z',
      issuedAt: '2026-08-13T09:05:00.000Z',
      performerId: PROVIDER_ID,
      formSubmissionId: testId(903),
    },
    invalidCreate: {
      patientId: PATIENT_ID,
      code: '8867-4',
      display: 'Heart rate',
      valueNumber: 72,
      effectiveAt: '2026-08-13T09:00:00.000Z',
    },
    patch: {
      status: 'CORRECTED',
      valueNumber: 68,
      valueText: 'Regular',
      valueCode: '271636001',
      valueBoolean: false,
      unit: '/min',
      referenceLow: 60,
      referenceHigh: 100,
      interpretationCode: 'N',
      issuedAt: '2026-08-13T09:05:00.000Z',
    },
    patched: ['valueNumber', 68],
    alsoPatched: ['interpretationCode', 'H'],
    invalidPatch: { referenceLow: 100, referenceHigh: 60 },
    filters: [
      [`patientId=${PATIENT_ID}`, `patientId=${OTHER_PATIENT_ID}`],
      [`encounterId=${ENCOUNTER_ID}`, `encounterId=${OTHER_ENCOUNTER_ID}`],
      ['category=VITAL_SIGNS', 'category=LABORATORY'],
      ['code=8867-4', 'code=8480-6'],
      ['loincCode=8867-4', 'loincCode=8480-6'],
      ['from=2026-08-13T00:00:00.000Z', 'from=2026-08-14T00:00:00.000Z'],
      ['to=2026-08-14T00:00:00.000Z', 'to=2026-08-13T00:00:00.000Z'],
    ],
  },
];

describe.each(CRUD_CASES)('$name', (testCase) => {
  const app = (): ReturnType<typeof createTestApp> => {
    const harness = createTestApp();
    testCase.seedRow(harness.dataset);
    return harness;
  };

  it('lists the page it was asked for, and says how many there were', async () => {
    const harness = app();

    const first = await listOf(harness.app, testCase.path);
    expect(first.data.map((row) => row.id)).toEqual([testCase.id]);
    expect(first.page).toEqual({ page: 1, pageSize: 25, total: 1, totalPages: 1 });

    const beyond = await listOf(harness.app, `${testCase.path}?page=2&pageSize=1`);
    expect(beyond.data).toEqual([]);
    expect(beyond.page).toMatchObject({ page: 2, pageSize: 1, total: 1 });
  });

  it('sorts on either key it advertises, in either direction', async () => {
    const harness = createTestApp();
    const ascending = testCase.seedPair(harness.dataset);

    const asc = await listOf(harness.app, testCase.path);
    expect(asc.data.map((row) => row.id)).toEqual([...ascending]);

    const desc = await listOf(harness.app, `${testCase.path}?order=desc`);
    expect(desc.data.map((row) => row.id)).toEqual([...ascending].reverse());

    // Both rows were created at the same instant, so this asks the other sort
    // key for a comparison it can only resolve on the id tie-break.
    const byCreation = await listOf(harness.app, `${testCase.path}?sort=createdAt&order=desc`);
    expect(byCreation.data).toHaveLength(2);
  });

  it('narrows on every filter it advertises, in both directions', async () => {
    const harness = app();

    for (const [hit, miss] of testCase.filters) {
      const selected = await listOf(harness.app, `${testCase.path}?${hit}`);
      expect(
        selected.data.map((row) => row.id),
        hit
      ).toEqual([testCase.id]);

      const rejected = await listOf(harness.app, `${testCase.path}?${miss}`);
      expect(rejected.data, miss).toEqual([]);
    }
  });

  it('400s a filter name it does not know, rather than ignoring it', async () => {
    const harness = app();
    const res = await harness.app.request(`${testCase.path}?patinetId=${PATIENT_ID}`, {
      headers: bearer(TOKENS.clinicianA),
    });

    expect(res.status).toBe(400);
    expect((await problemOf(res)).type).toBe('https://openrunic.org/problems/malformed-request');
  });

  it('reads one record', async () => {
    const harness = app();
    const res = await harness.app.request(`${testCase.path}/${testCase.id}`, {
      headers: bearer(TOKENS.clinicianA),
    });

    expect(res.status).toBe(200);
    expect((await res.json()) as { id: string }).toMatchObject({ id: testCase.id });
  });

  it('404s an id that is not there', async () => {
    const harness = app();
    const res = await harness.app.request(`${testCase.path}/${testId(77)}`, {
      headers: bearer(TOKENS.clinicianA),
    });

    expect(res.status).toBe(404);
  });

  it('creates from the required fields alone and points at what it made', async () => {
    const harness = app();
    const res = await post(harness.app, testCase.path, testCase.create);

    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string };
    expect(res.headers.get('location')).toBe(`${testCase.path}/${body.id}`);
  });

  it('creates with every optional field the contract offers', async () => {
    const harness = app();
    const res = await post(harness.app, testCase.path, testCase.createFull);

    expect(res.status).toBe(201);
  });

  it('422s a body that parses but breaks the contract', async () => {
    const harness = app();
    const res = await post(harness.app, testCase.path, testCase.invalidCreate);

    expect(res.status).toBe(422);
    expect((await problemOf(res)).type).toBe('https://openrunic.org/problems/validation-failed');
  });

  it('422s a field the contract does not have, rather than dropping it', async () => {
    const harness = app();
    const res = await post(harness.app, testCase.path, {
      ...testCase.create,
      tenantId: DEMO_TENANT_A,
    });

    expect(res.status).toBe(422);
  });

  it('amends every field a patch may touch', async () => {
    const harness = app();
    const res = await patch(harness.app, `${testCase.path}/${testCase.id}`, testCase.patch);

    expect(res.status).toBe(200);
    const [field, value] = testCase.patched;
    expect((await res.json()) as Record<string, unknown>).toMatchObject({ [field]: value });
  });

  it('amends one field and leaves every other column where it was', async () => {
    const harness = app();

    for (const [field, value] of [testCase.patched, testCase.alsoPatched]) {
      const res = await patch(harness.app, `${testCase.path}/${testCase.id}`, { [field]: value });

      expect(res.status, field).toBe(200);
      expect((await res.json()) as Record<string, unknown>).toMatchObject({ [field]: value });
    }
  });

  it('422s a patch the contract refuses', async () => {
    const harness = app();
    const res = await patch(harness.app, `${testCase.path}/${testCase.id}`, testCase.invalidPatch);

    expect(res.status).toBe(422);
  });

  it('404s a patch to an id that is not there', async () => {
    const harness = app();
    const res = await patch(harness.app, `${testCase.path}/${testId(77)}`, testCase.patch);

    expect(res.status).toBe(404);
  });

  it('401s a request with no bearer token', async () => {
    const harness = app();

    expect((await harness.app.request(testCase.path)).status).toBe(401);
  });

  it('403s a principal whose roles grant nothing', async () => {
    const harness = app();
    const res = await harness.app.request(testCase.path, {
      headers: bearer(UNPRIVILEGED_TOKEN),
    });

    expect(res.status).toBe(403);
    expect((await problemOf(res)).detail).toContain('encounter.read');
  });

  it('403s a write from a role that may only read', async () => {
    const harness = app();
    const res = await post(harness.app, testCase.path, testCase.create, TOKENS.billerA);

    expect(res.status).toBe(403);
    expect((await problemOf(res)).detail).toContain('encounter.write');
  });
});

/* ------------------------------------------------------- visit transitions */

const ENCOUNTER_MOVES: readonly (readonly [
  from: EncounterRow['status'],
  to: EncounterRow['status'],
  expected: number,
])[] = [
  ['PLANNED', 'IN_PROGRESS', 200],
  ['PLANNED', 'CANCELLED', 200],
  ['PLANNED', 'COMPLETED', 409],
  ['IN_PROGRESS', 'ON_HOLD', 200],
  ['IN_PROGRESS', 'COMPLETED', 200],
  ['IN_PROGRESS', 'PLANNED', 409],
  ['ON_HOLD', 'IN_PROGRESS', 200],
  ['ON_HOLD', 'COMPLETED', 409],
  ['COMPLETED', 'ENTERED_IN_ERROR', 200],
  ['COMPLETED', 'IN_PROGRESS', 409],
  ['CANCELLED', 'ENTERED_IN_ERROR', 200],
  ['CANCELLED', 'PLANNED', 409],
  ['ENTERED_IN_ERROR', 'PLANNED', 409],
];

describe('PATCH /bff/v0/encounters/:id, the status table', () => {
  it.each(ENCOUNTER_MOVES)('%s to %s answers %i', async (from, to, expected) => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'Encounter', makeEncounterRow({ status: from }));

    const res = await patch(app, `/bff/v0/encounters/${ENCOUNTER_ID}`, { status: to });

    expect(res.status).toBe(expected);
    if (expected === 409) {
      const problem = await problemOf(res);
      expect(problem.type).toBe('https://openrunic.org/problems/invalid-transition');
      expect(problem.detail).toContain(from);
    }
  });

  it('leaves a status alone when the patch sets it to what it already was', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'Encounter', makeEncounterRow({ status: 'COMPLETED' }));

    const res = await patch(app, `/bff/v0/encounters/${ENCOUNTER_ID}`, {
      status: 'COMPLETED',
      reasonText: 'Cough',
    });

    expect(res.status).toBe(200);
    expect((await res.json()) as EncounterDto).toMatchObject({
      status: 'COMPLETED',
      reasonText: 'Cough',
    });
  });

  it('changes only what it was given', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'Encounter', makeEncounterRow({ reasonCode: 'R05' }));

    const body = (await (
      await patch(app, `/bff/v0/encounters/${ENCOUNTER_ID}`, { reasonText: 'Cough' })
    ).json()) as EncounterDto;

    expect(body).toMatchObject({ reasonText: 'Cough', reasonCode: 'R05', endedAt: null });
  });
});

describe('POST /bff/v0/encounters/:id/sign', () => {
  it('signs a completed visit for the acting principal', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'Encounter', makeEncounterRow({ status: 'COMPLETED' }));

    const res = await move(app, `/bff/v0/encounters/${ENCOUNTER_ID}/sign`);

    expect(res.status).toBe(200);
    const body = (await res.json()) as EncounterDto;
    expect(body.signedById).toBe(CLINICIAN_A);
    expect(body.signedAt).toMatch(/T.*Z$/);
  });

  it('refuses to sign a visit that is not over', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'Encounter', makeEncounterRow({ status: 'IN_PROGRESS' }));

    const res = await move(app, `/bff/v0/encounters/${ENCOUNTER_ID}/sign`);

    expect(res.status).toBe(409);
    expect((await problemOf(res)).type).toBe('https://openrunic.org/problems/invalid-transition');
  });

  it('refuses a second signature rather than overwriting the first', async () => {
    const { app, dataset } = createTestApp();
    seed(
      dataset,
      'Encounter',
      makeEncounterRow({ status: 'COMPLETED', signedAt: FIXED_NOW, signedById: PROVIDER_ID })
    );

    const res = await move(app, `/bff/v0/encounters/${ENCOUNTER_ID}/sign`);

    expect(res.status).toBe(409);
    expect((await problemOf(res)).detail).toContain('signature');
    expect(dataset.table('Encounter')[0]?.signedById).toBe(PROVIDER_ID);
  });

  it('refuses a visit at a facility this principal has no grant for', async () => {
    const { app, dataset } = createTestApp();
    seed(
      dataset,
      'Encounter',
      makeEncounterRow({ status: 'COMPLETED', facilityId: DEMO_FACILITY_B })
    );

    const res = await move(app, `/bff/v0/encounters/${ENCOUNTER_ID}/sign`);

    expect(res.status).toBe(403);
    expect((await problemOf(res)).detail).toContain('facility');
  });

  it('404s a visit that is not there', async () => {
    const { app } = createTestApp();

    expect((await move(app, `/bff/v0/encounters/${testId(77)}/sign`)).status).toBe(404);
  });

  it('400s an id that is not a UUID', async () => {
    const { app } = createTestApp();

    expect((await move(app, '/bff/v0/encounters/12/sign')).status).toBe(400);
  });

  it('403s a role that may read but not write', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'Encounter', makeEncounterRow({ status: 'COMPLETED' }));

    expect(
      (await move(app, `/bff/v0/encounters/${ENCOUNTER_ID}/sign`, TOKENS.billerA)).status
    ).toBe(403);
  });

  it('401s with no token at all', async () => {
    const { app } = createTestApp();
    const res = await app.request(`/bff/v0/encounters/${ENCOUNTER_ID}/sign`, { method: 'POST' });

    expect(res.status).toBe(401);
  });
});

/* -------------------------------------------------------- note transitions */

describe('POST /bff/v0/notes/:id/sign', () => {
  it.each([['DRAFT'], ['AI_DRAFT_REVIEW'], ['UNSIGNED']] as const)(
    'signs a note in %s, stamping the signature and the lock together',
    async (state) => {
      const { app, dataset } = createTestApp();
      seed(dataset, 'ClinicalNote', makeNoteRow({ state }));

      const res = await move(app, `/bff/v0/notes/${NOTE_ID}/sign`);

      expect(res.status).toBe(200);
      const body = (await res.json()) as NoteDto;
      expect(body.state).toBe('SIGNED');
      expect(body.signedById).toBe(CLINICIAN_A);
      expect(body.signedAt).toBe(body.lockedAt);
    }
  );

  it.each([['SIGNED'], ['AMENDED'], ['ENTERED_IN_ERROR']] as const)(
    'refuses to sign a note in %s',
    async (state) => {
      const { app, dataset } = createTestApp();
      seed(dataset, 'ClinicalNote', makeNoteRow({ state }));

      const res = await move(app, `/bff/v0/notes/${NOTE_ID}/sign`);

      expect(res.status).toBe(409);
      expect((await problemOf(res)).type).toBe('https://openrunic.org/problems/invalid-transition');
    }
  );

  it('404s a note that is not there', async () => {
    const { app } = createTestApp();

    expect((await move(app, `/bff/v0/notes/${testId(77)}/sign`)).status).toBe(404);
  });
});

describe('PATCH /bff/v0/notes/:id, once a note is signed', () => {
  it.each([['SIGNED'], ['AMENDED']] as const)(
    'refuses to rewrite the text of a %s note',
    async (state) => {
      const { app, dataset } = createTestApp();
      seed(dataset, 'ClinicalNote', makeNoteRow({ state }));

      const res = await patch(app, `/bff/v0/notes/${NOTE_ID}`, { title: 'Rewritten' });

      expect(res.status).toBe(409);
      const problem = await problemOf(res);
      expect(problem.type).toBe('https://openrunic.org/problems/conflict');
      expect(problem.detail).toContain('addendum');
      expect(dataset.table('ClinicalNote')[0]?.title).toBe('Progress note');
    }
  );

  it('refuses to rewrite the blocks of a signed note', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'ClinicalNote', makeNoteRow({ state: 'SIGNED' }));

    const res = await patch(app, `/bff/v0/notes/${NOTE_ID}`, {
      blocks: [{ type: 'text', text: 'Rewritten.' }],
    });

    expect(res.status).toBe(409);
  });

  it('is not a transition when the patch names the state it is already in', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'ClinicalNote', makeNoteRow({ state: 'DRAFT' }));

    const res = await patch(app, `/bff/v0/notes/${NOTE_ID}`, {
      state: 'DRAFT',
      title: 'Progress note, revised',
    });

    expect(res.status).toBe(200);
    expect((await res.json()) as NoteDto).toMatchObject({
      state: 'DRAFT',
      title: 'Progress note, revised',
    });
  });

  it('still accepts the correction that marks it recorded in error', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'ClinicalNote', makeNoteRow({ state: 'SIGNED' }));

    const res = await patch(app, `/bff/v0/notes/${NOTE_ID}`, { state: 'ENTERED_IN_ERROR' });

    expect(res.status).toBe(200);
    expect((await res.json()) as NoteDto).toMatchObject({ state: 'ENTERED_IN_ERROR' });
  });

  it.each([
    ['DRAFT', 'UNSIGNED', 200],
    ['DRAFT', 'AI_DRAFT_REVIEW', 200],
    ['UNSIGNED', 'DRAFT', 200],
    ['AI_DRAFT_REVIEW', 'UNSIGNED', 200],
    ['DRAFT', 'SIGNED', 409],
    ['DRAFT', 'AMENDED', 409],
    ['ENTERED_IN_ERROR', 'DRAFT', 409],
  ] as const)('moves a %s note to %s with %i', async (from, to, expected) => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'ClinicalNote', makeNoteRow({ state: from }));

    const res = await patch(app, `/bff/v0/notes/${NOTE_ID}`, { state: to });

    expect(res.status).toBe(expected);
  });
});

/**
 * A JSON column holds whatever was written into it, and what was written may
 * have come from another version of the note editor or from an import. Reading
 * one back therefore degrades to an empty document rather than failing, because
 * the rest of the chart is still worth showing.
 */
describe('JSON columns this version cannot make sense of', () => {
  it('reads a block list that is not a list as an empty document', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'ClinicalNote', makeNoteRow({ id: NOTE_ID, blocks: 'not a list' }));
    seed(
      dataset,
      'ClinicalNote',
      makeNoteRow({ id: testId(302), blocks: [1, { type: 'text', text: 'Kept.' }] })
    );

    const unreadable = (await (
      await app.request(`/bff/v0/notes/${NOTE_ID}`, { headers: bearer(TOKENS.clinicianA) })
    ).json()) as NoteDto;
    const partial = (await (
      await app.request(`/bff/v0/notes/${testId(302)}`, { headers: bearer(TOKENS.clinicianA) })
    ).json()) as NoteDto;

    expect(unreadable.blocks).toEqual([]);
    expect(partial.blocks).toEqual([{ type: 'text', text: 'Kept.' }]);
  });

  it('reads a structured sig that is not an object as an empty one', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'MedicationRequest', makePrescriptionRow({ sig: 'one capsule' }));

    const body = (await (
      await app.request(`/bff/v0/medications/prescriptions/${PRESCRIPTION_ID}`, {
        headers: bearer(TOKENS.clinicianA),
      })
    ).json()) as PrescriptionDto;

    expect(body.sig).toEqual({});
    expect(body.sigText).toBe('One capsule by mouth three times daily');
  });
});

describe('POST /bff/v0/observations', () => {
  it('records a coded observation, which carries no number and no unit', async () => {
    const { app } = createTestApp();

    const res = await post(app, '/bff/v0/observations', {
      patientId: PATIENT_ID,
      category: 'SOCIAL_HISTORY',
      code: '72166-2',
      display: 'Tobacco smoking status',
      valueCode: '266919005',
      effectiveAt: '2026-08-13T09:00:00.000Z',
    });

    expect(res.status).toBe(201);
    expect((await res.json()) as ObservationDto).toMatchObject({
      valueCode: '266919005',
      valueNumber: null,
      valueText: null,
      valueBoolean: null,
      unit: null,
    });
  });
});

describe('GET /bff/v0/notes, the signing debt board', () => {
  it('sorts a note with no signature last, which is where the work is', async () => {
    const { app, dataset } = createTestApp();
    seed(
      dataset,
      'ClinicalNote',
      makeNoteRow({ id: NOTE_ID, state: 'SIGNED', signedAt: EARLIER }),
      makeNoteRow({ id: testId(302) })
    );

    const body = await listOf(app, '/bff/v0/notes?sort=signedAt');

    expect(body.data.map((row) => row.id)).toEqual([NOTE_ID, testId(302)]);
  });
});

/* -------------------------------------------------------------- addenda */

describe('/bff/v0/notes/:id/addenda', () => {
  const ADDENDUM_BODY = {
    blocks: [{ type: 'text', text: 'The dose was 500 mg, not 250 mg.' }],
    reason: 'Transcription error',
  };

  it('records an addendum against a signed note and moves the note to AMENDED', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'ClinicalNote', makeNoteRow({ state: 'SIGNED' }));

    const res = await post(app, `/bff/v0/notes/${NOTE_ID}/addenda`, ADDENDUM_BODY);

    expect(res.status).toBe(201);
    expect(res.headers.get('location')).toBe(`/bff/v0/notes/${NOTE_ID}/addenda`);
    const body = (await res.json()) as NoteAddendumDto;
    expect(body).toMatchObject({ noteId: NOTE_ID, reason: 'Transcription error' });
    // An addendum only exists against a signed note, so it is signed as written.
    expect(body.signedAt).not.toBeNull();
    expect(dataset.table('ClinicalNote')[0]?.state).toBe('AMENDED');
  });

  it('accepts a second addendum, with no stated reason, on an amended note', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'ClinicalNote', makeNoteRow({ state: 'AMENDED' }));

    const res = await post(app, `/bff/v0/notes/${NOTE_ID}/addenda`, {
      blocks: [{ type: 'text', text: 'Also reviewed the allergy list.' }],
    });

    expect(res.status).toBe(201);
    expect((await res.json()) as NoteAddendumDto).toMatchObject({ reason: null });
  });

  it.each([['DRAFT'], ['AI_DRAFT_REVIEW'], ['UNSIGNED'], ['ENTERED_IN_ERROR']] as const)(
    'refuses an addendum to a note in %s, which would just be an edit',
    async (state) => {
      const { app, dataset } = createTestApp();
      seed(dataset, 'ClinicalNote', makeNoteRow({ state }));

      const res = await post(app, `/bff/v0/notes/${NOTE_ID}/addenda`, ADDENDUM_BODY);

      expect(res.status).toBe(409);
      expect((await problemOf(res)).type).toBe('https://openrunic.org/problems/invalid-transition');
      expect(dataset.table('NoteAddendum')).toHaveLength(0);
    }
  );

  it('lists a note addenda oldest first', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'ClinicalNote', makeNoteRow({ state: 'AMENDED' }));
    seed(
      dataset,
      'NoteAddendum',
      makeAddendumRow({ id: testId(312), createdAt: LATER }),
      makeAddendumRow({ id: testId(311), createdAt: EARLIER }),
      makeAddendumRow({ id: testId(313), noteId: testId(302) })
    );

    const body = await listOf(app, `/bff/v0/notes/${NOTE_ID}/addenda`);

    expect(body.data.map((row) => row.id)).toEqual([testId(311), testId(312)]);
    expect(body.page.total).toBe(2);
  });

  it('reverses the trail on request, and pages it', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'ClinicalNote', makeNoteRow({ state: 'AMENDED' }));
    seed(
      dataset,
      'NoteAddendum',
      makeAddendumRow({ id: testId(311), createdAt: EARLIER }),
      makeAddendumRow({ id: testId(312), createdAt: LATER })
    );

    const body = await listOf(
      app,
      `/bff/v0/notes/${NOTE_ID}/addenda?order=desc&sort=createdAt&pageSize=1`
    );

    expect(body.data.map((row) => row.id)).toEqual([testId(312)]);
    expect(body.page).toEqual({ page: 1, pageSize: 1, total: 2, totalPages: 2 });
  });

  it('reports addenda on an unreachable note as absent, not as none', async () => {
    const { app } = createTestApp();
    const res = await app.request(`/bff/v0/notes/${testId(77)}/addenda`, {
      headers: bearer(TOKENS.clinicianA),
    });

    expect(res.status).toBe(404);
  });

  it('404s an addendum written against a note that is not there', async () => {
    const { app } = createTestApp();

    expect((await post(app, `/bff/v0/notes/${testId(77)}/addenda`, ADDENDUM_BODY)).status).toBe(
      404
    );
  });

  it('attributes an addendum to the acting principal, never to the note it corrects', async () => {
    const { app, dataset } = createTestApp();
    // The note was written and signed by someone else. A correction filed
    // against it must carry the corrector's name, not the original author's.
    seed(dataset, 'ClinicalNote', makeNoteRow({ state: 'SIGNED', authorId: PROVIDER_ID }));

    const res = await post(app, `/bff/v0/notes/${NOTE_ID}/addenda`, {
      blocks: [{ type: 'text', text: 'Corrected the laterality.' }],
    });

    expect(res.status).toBe(201);
    expect(((await res.json()) as NoteAddendumDto).authorId).toBe(CLINICIAN_A);
  });

  it('refuses an addendum that tries to name its own author', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'ClinicalNote', makeNoteRow({ state: 'SIGNED' }));

    // Authorship is a claim about a person on an amendment to a locked record.
    // A body that states it is refused outright rather than quietly ignored, so
    // a client cannot believe it succeeded in filing under another name.
    const res = await post(app, `/bff/v0/notes/${NOTE_ID}/addenda`, {
      authorId: PROVIDER_ID,
      blocks: [{ type: 'text', text: 'Filed as somebody else.' }],
    });

    expect(res.status).toBe(422);
  });

  it('422s an addendum that names its own note, which the path already did', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'ClinicalNote', makeNoteRow({ state: 'SIGNED' }));

    const res = await post(app, `/bff/v0/notes/${NOTE_ID}/addenda`, {
      ...ADDENDUM_BODY,
      noteId: NOTE_ID,
    });

    expect(res.status).toBe(422);
  });

  it('403s an addendum from a role that may only read', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'ClinicalNote', makeNoteRow({ state: 'SIGNED' }));

    expect(
      (await post(app, `/bff/v0/notes/${NOTE_ID}/addenda`, ADDENDUM_BODY, TOKENS.billerA)).status
    ).toBe(403);
  });

  it('400s a paging parameter the list does not have', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'ClinicalNote', makeNoteRow());

    const res = await app.request(`/bff/v0/notes/${NOTE_ID}/addenda?noteId=${NOTE_ID}`, {
      headers: bearer(TOKENS.clinicianA),
    });

    expect(res.status).toBe(400);
  });

  it('resolves the note itself and its addenda from the same prefix', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'ClinicalNote', makeNoteRow({ state: 'AMENDED' }));
    seed(dataset, 'NoteAddendum', makeAddendumRow());

    const note = await app.request(`/bff/v0/notes/${NOTE_ID}`, {
      headers: bearer(TOKENS.clinicianA),
    });
    const addenda = await app.request(`/bff/v0/notes/${NOTE_ID}/addenda`, {
      headers: bearer(TOKENS.clinicianA),
    });

    expect(note.status).toBe(200);
    expect(addenda.status).toBe(200);
    expect(((await note.json()) as NoteDto).id).toBe(NOTE_ID);
    expect(((await addenda.json()) as ListResponse<NoteAddendumDto>).data).toHaveLength(1);
  });
});

/* ------------------------------------------------- prescription transitions */

describe('the prescription state machine', () => {
  const url = (action: string): string =>
    `/bff/v0/medications/prescriptions/${PRESCRIPTION_ID}/${action}`;

  it.each([
    ['DRAFT', 'sign', 200],
    ['PENDED', 'sign', 200],
    ['SIGNED', 'sign', 409],
    ['CANCELLED', 'sign', 409],
    ['SIGNED', 'transmit', 200],
    ['DRAFT', 'transmit', 409],
    ['TRANSMITTED', 'transmit', 409],
    ['DRAFT', 'cancel', 200],
    ['SIGNED', 'cancel', 200],
    ['TRANSMITTED', 'cancel', 200],
    ['ACTIVE', 'cancel', 200],
    ['ON_HOLD', 'cancel', 200],
    ['CANCELLED', 'cancel', 409],
    ['COMPLETED', 'cancel', 409],
    ['STOPPED', 'cancel', 409],
    ['ERROR', 'cancel', 409],
  ] as const)('%s + %s answers %i', async (status, action, expected) => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'MedicationRequest', makePrescriptionRow({ status }));

    const res = await move(app, url(action));

    expect(res.status).toBe(expected);
    if (expected === 409) {
      expect((await problemOf(res)).type).toBe('https://openrunic.org/problems/invalid-transition');
    }
  });

  it('stamps the moment a prescription left for the pharmacy', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'MedicationRequest', makePrescriptionRow({ status: 'SIGNED' }));

    const body = (await (await move(app, url('transmit'))).json()) as PrescriptionDto;

    expect(body.status).toBe('TRANSMITTED');
    expect(body.transmittedAt).toMatch(/T.*Z$/);
  });

  it('leaves the transmission stamp alone once it is set', async () => {
    const { app, dataset } = createTestApp();
    seed(
      dataset,
      'MedicationRequest',
      makePrescriptionRow({ status: 'TRANSMITTED', transmittedAt: FIXED_NOW })
    );

    const body = (await (await move(app, url('cancel'))).json()) as PrescriptionDto;

    expect(body.status).toBe('CANCELLED');
    expect(body.transmittedAt).toBe(FIXED_NOW.toISOString());
  });

  it('404s a prescription that is not there', async () => {
    const { app } = createTestApp();
    const res = await move(app, `/bff/v0/medications/prescriptions/${testId(77)}/sign`);

    expect(res.status).toBe(404);
  });

  it('403s a move from a role that may only read', async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'MedicationRequest', makePrescriptionRow());

    expect((await move(app, url('sign'), TOKENS.billerA)).status).toBe(403);
  });
});

/* ----------------------------------------------------- the compartment */

describe('a patient-scoped token', () => {
  it('sees its own chart and nobody else in a list', async () => {
    const { app, dataset } = createTestApp();
    seed(
      dataset,
      'Observation',
      makeObservationRow({ id: OBSERVATION_ID, patientId: DEMO_PORTAL_PATIENT }),
      makeObservationRow({ id: testId(372), patientId: OTHER_PATIENT_ID })
    );

    const body = await listOf(app, '/bff/v0/observations', TOKENS.portalA);

    expect(body.data.map((row) => row.id)).toEqual([OBSERVATION_ID]);
  });

  it("reads another chart's record as absent", async () => {
    const { app, dataset } = createTestApp();
    seed(dataset, 'Observation', makeObservationRow({ patientId: OTHER_PATIENT_ID }));

    const res = await app.request(`/bff/v0/observations/${OBSERVATION_ID}`, {
      headers: bearer(TOKENS.portalA),
    });

    expect(res.status).toBe(404);
  });

  it('is refused the addendum table outright, since no column narrows it', async () => {
    const { app, dataset } = createTestApp();
    seed(
      dataset,
      'ClinicalNote',
      makeNoteRow({ state: 'AMENDED', patientId: DEMO_PORTAL_PATIENT })
    );
    seed(dataset, 'NoteAddendum', makeAddendumRow());

    const body = await listOf(app, `/bff/v0/notes/${NOTE_ID}/addenda`, TOKENS.portalA);

    // The note is readable, because a chart column narrows it. Its addenda are
    // not, because nothing on that table names a chart.
    expect(body.data).toEqual([]);
    expect(body.page.total).toBe(0);
  });
});

/* ------------------------------------------------------------------ audit */

describe('the audit trail', () => {
  it('records a create as a transactional write naming the chart it touched', async () => {
    const { app, sink } = createTestApp();

    await post(app, '/bff/v0/problems', {
      patientId: PATIENT_ID,
      code: 'J45.909',
      display: 'Unspecified asthma, uncomplicated',
    });

    expect(sink.writes()).toHaveLength(1);
    expect(sink.writes()[0]).toMatchObject({
      transactional: true,
      event: {
        action: 'condition.created',
        targetType: 'Condition',
        patientId: PATIENT_ID,
        actorId: CLINICIAN_A,
      },
    });
  });

  it('names the visit and the site on a write that hangs off one', async () => {
    const { app, dataset, sink } = createTestApp();
    seed(dataset, 'Encounter', makeEncounterRow({ status: 'COMPLETED' }));

    await move(app, `/bff/v0/encounters/${ENCOUNTER_ID}/sign`);

    expect(sink.writes()[0]?.event).toMatchObject({
      action: 'encounter.updated',
      facilityId: DEMO_FACILITY_A,
      patientId: PATIENT_ID,
      metadata: { signed: true },
    });
  });

  it('reports a status move as the pair of states it was', async () => {
    const { app, dataset, sink } = createTestApp();
    seed(dataset, 'MedicationRequest', makePrescriptionRow({ status: 'DRAFT' }));

    await move(app, `/bff/v0/medications/prescriptions/${PRESCRIPTION_ID}/sign`);

    expect(sink.writes()[0]?.event.metadata).toMatchObject({
      statusFrom: 'DRAFT',
      statusTo: 'SIGNED',
    });
  });

  it('says nothing about a status that did not move', async () => {
    const { app, dataset, sink } = createTestApp();
    seed(dataset, 'MedicationRequest', makePrescriptionRow());

    await patch(app, `/bff/v0/medications/prescriptions/${PRESCRIPTION_ID}`, { refills: 2 });

    expect(sink.writes()[0]?.event.metadata).not.toHaveProperty('statusFrom');
  });

  it('records a note create and its state, then the state it moved to', async () => {
    const { app, dataset, sink } = createTestApp();
    seed(dataset, 'ClinicalNote', makeNoteRow());

    await move(app, `/bff/v0/notes/${NOTE_ID}/sign`);

    expect(sink.writes()[0]?.event).toMatchObject({
      action: 'note.updated',
      encounterId: ENCOUNTER_ID,
      metadata: { stateFrom: 'DRAFT', stateTo: 'SIGNED' },
    });
  });

  it('emits one batched read event per request, naming what was read', async () => {
    const { app, dataset, sink } = createTestApp();
    seed(
      dataset,
      'Observation',
      makeObservationRow({ id: OBSERVATION_ID }),
      makeObservationRow({ id: testId(372) })
    );

    await listOf(app, '/bff/v0/observations');

    expect(sink.reads()).toHaveLength(1);
    expect(sink.reads()[0]?.event).toMatchObject({
      action: 'phi.read',
      patientId: PATIENT_ID,
      metadata: { targetCount: 2, targets: [{ type: 'Observation' }, { type: 'Observation' }] },
    });
  });

  it('audits a denial rather than letting it pass unrecorded', async () => {
    const { app, sink } = createTestApp();

    await app.request('/bff/v0/allergies', { headers: bearer(UNPRIVILEGED_TOKEN) });

    expect(sink.writes()[0]?.event).toMatchObject({
      action: 'authorisation.denied',
      outcome: 'failure',
      metadata: { permission: 'encounter.read' },
    });
  });
});

/* ------------------------------------------- the two halves of one filter */

/** A spec with its parameters erased, which is all a generic walk can hold. */
type ErasedSpec = CollectionSpec<PrismaModelName, unknown, unknown, BaseQuery>;

function erase<M extends PrismaModelName, TCreate, TPatch, TQuery extends BaseQuery>(
  spec: CollectionSpec<M, TCreate, TPatch, TQuery>
): ErasedSpec {
  return spec as unknown as ErasedSpec;
}

/** A stored row as the filter evaluator wants it: a plain record of columns. */
function columnsOf(row: ScopedRow<PrismaModelName>): Record<string, unknown> {
  return { ...row };
}

interface FilterCase {
  name: string;
  spec: ErasedSpec;
  /** The first row satisfies the query below; the second does not. */
  rows: readonly ScopedRow<PrismaModelName>[];
  query: BaseQuery & Record<string, unknown>;
}

const page = { page: 1, pageSize: 25, order: 'asc' } as const;

const FILTER_CASES: readonly FilterCase[] = [
  {
    name: 'encounters',
    spec: erase(encounterSpec),
    rows: [
      makeEncounterRow(),
      makeEncounterRow({
        id: OTHER_ENCOUNTER_ID,
        patientId: OTHER_PATIENT_ID,
        facilityId: DEMO_FACILITY_B,
        providerId: testId(901),
        status: 'COMPLETED',
        startedAt: EARLIER,
      }),
    ],
    query: {
      ...page,
      sort: 'startedAt',
      patientId: PATIENT_ID,
      facilityId: DEMO_FACILITY_A,
      providerId: PROVIDER_ID,
      status: 'IN_PROGRESS',
      from: new Date('2026-08-13T00:00:00.000Z'),
      to: new Date('2026-08-14T00:00:00.000Z'),
    },
  },
  {
    name: 'notes',
    spec: erase(clinicalNoteSpec),
    rows: [
      makeNoteRow(),
      makeNoteRow({
        id: testId(302),
        patientId: OTHER_PATIENT_ID,
        encounterId: OTHER_ENCOUNTER_ID,
        authorId: testId(901),
        state: 'SIGNED',
      }),
    ],
    query: {
      ...page,
      sort: 'signedAt',
      patientId: PATIENT_ID,
      encounterId: ENCOUNTER_ID,
      authorId: PROVIDER_ID,
      state: 'DRAFT',
    },
  },
  {
    name: 'note addenda',
    spec: erase(noteAddendumSpec),
    rows: [
      makeAddendumRow(),
      makeAddendumRow({ id: testId(312), noteId: testId(302), authorId: testId(901) }),
    ],
    query: { ...page, sort: 'createdAt', noteId: NOTE_ID, authorId: PROVIDER_ID },
  },
  {
    name: 'problems',
    spec: erase(conditionSpec),
    rows: [
      makeProblemRow(),
      makeProblemRow({
        id: testId(322),
        patientId: OTHER_PATIENT_ID,
        encounterId: OTHER_ENCOUNTER_ID,
        category: 'SURGERY',
        clinicalStatus: 'RESOLVED',
        code: 'E11.9',
      }),
    ],
    query: {
      ...page,
      sort: 'recordedAt',
      patientId: PATIENT_ID,
      encounterId: ENCOUNTER_ID,
      category: 'PROBLEM_LIST_ITEM',
      clinicalStatus: 'ACTIVE',
      code: 'J45.909',
    },
  },
  {
    name: 'medication statements',
    spec: erase(medicationStatementSpec),
    rows: [
      makeStatementRow(),
      makeStatementRow({
        id: testId(332),
        patientId: OTHER_PATIENT_ID,
        encounterId: OTHER_ENCOUNTER_ID,
        status: 'STOPPED',
      }),
    ],
    query: {
      ...page,
      sort: 'reportedAt',
      patientId: PATIENT_ID,
      encounterId: ENCOUNTER_ID,
      status: 'ACTIVE',
    },
  },
  {
    name: 'prescriptions',
    spec: erase(medicationRequestSpec),
    rows: [
      makePrescriptionRow(),
      makePrescriptionRow({
        id: testId(342),
        patientId: OTHER_PATIENT_ID,
        encounterId: OTHER_ENCOUNTER_ID,
        prescriberId: testId(901),
        status: 'SIGNED',
      }),
    ],
    query: {
      ...page,
      sort: 'writtenAt',
      patientId: PATIENT_ID,
      encounterId: ENCOUNTER_ID,
      prescriberId: PROVIDER_ID,
      status: 'DRAFT',
    },
  },
  {
    name: 'allergies',
    spec: erase(allergySpec),
    rows: [
      makeAllergyRow(),
      makeAllergyRow({
        id: testId(352),
        patientId: OTHER_PATIENT_ID,
        clinicalStatus: 'RESOLVED',
        criticality: 'LOW',
      }),
    ],
    query: {
      ...page,
      sort: 'recordedAt',
      patientId: PATIENT_ID,
      clinicalStatus: 'ACTIVE',
      criticality: 'HIGH',
    },
  },
  {
    name: 'immunisations',
    spec: erase(immunisationSpec),
    rows: [
      makeImmunisationRow(),
      makeImmunisationRow({
        id: testId(362),
        patientId: OTHER_PATIENT_ID,
        encounterId: OTHER_ENCOUNTER_ID,
        cvxCode: '141',
        administeredAt: EARLIER,
      }),
    ],
    query: {
      ...page,
      sort: 'administeredAt',
      patientId: PATIENT_ID,
      encounterId: ENCOUNTER_ID,
      cvxCode: '150',
      from: new Date('2026-08-13T00:00:00.000Z'),
      to: new Date('2026-08-14T00:00:00.000Z'),
    },
  },
  {
    name: 'observations',
    spec: erase(observationSpec),
    rows: [
      makeObservationRow(),
      makeObservationRow({
        id: testId(372),
        patientId: OTHER_PATIENT_ID,
        encounterId: OTHER_ENCOUNTER_ID,
        category: 'LABORATORY',
        code: '8480-6',
        loincCode: '8480-6',
        effectiveAt: EARLIER,
      }),
    ],
    query: {
      ...page,
      sort: 'effectiveAt',
      patientId: PATIENT_ID,
      encounterId: ENCOUNTER_ID,
      category: 'VITAL_SIGNS',
      code: '8867-4',
      loincCode: '8867-4',
      from: new Date('2026-08-13T00:00:00.000Z'),
      to: new Date('2026-08-14T00:00:00.000Z'),
    },
  },
];

/**
 * Each spec states its filter twice - once as a predicate the in-memory store
 * runs, once as a `where` Postgres runs - and the two are only useful if they
 * agree. So both are run over the same rows here, through the same filter
 * evaluator the Prisma adapter's suite uses. A filter that a `where` silently
 * omits is the failure that matters: it would turn a narrowed query into an
 * unnarrowed one, and every screen above it would still look right.
 */
describe('the in-memory filter and the Prisma filter', () => {
  it.each(FILTER_CASES)('$name select the same rows', ({ spec, rows, query }) => {
    const inMemory = rows.filter((row) => spec.matches(row, query)).map((row) => row.id);
    const inPostgres = rows
      .filter((row) => matchesWhere(columnsOf(row), spec.where(query)))
      .map((row) => row.id);

    expect(inMemory).toEqual([rows[0]?.id]);
    expect(inPostgres).toEqual(inMemory);
  });

  it.each(FILTER_CASES)(
    '$name keep every row when nothing is filtered',
    ({ spec, rows, query }) => {
      const unfiltered = { page: 1, pageSize: 25, sort: query.sort, order: 'asc' as const };

      expect(rows.filter((row) => spec.matches(row, unfiltered))).toHaveLength(rows.length);
      expect(
        rows.filter((row) => matchesWhere(columnsOf(row), spec.where(unfiltered)))
      ).toHaveLength(rows.length);
    }
  );

  it.each(FILTER_CASES)('$name tie-break the Prisma ordering on id', ({ spec, query }) => {
    const sort = String(query.sort);

    expect(spec.orderBy({ page: 1, pageSize: 25, sort, order: 'desc' })).toEqual([
      { [sort]: 'desc' },
      { id: 'asc' },
    ]);
    expect(spec.orderBy({ page: 1, pageSize: 25, sort: 'createdAt', order: 'asc' })).toEqual([
      { createdAt: 'asc' },
      { id: 'asc' },
    ]);
  });
});

describe('a note addendum', () => {
  it('is not amendable, so a patch of it changes no column at all', () => {
    // The route surface offers no way to reach this, which is the point: an
    // addendum exists because the note it hangs off could not be edited, and a
    // correction to a correction is another addendum.
    const context: RowContext = {
      tenantId: DEMO_TENANT_A,
      now: FIXED_NOW,
      nextId: () => testId(9),
    };

    expect(
      erase(noteAddendumSpec).patchData({ reason: 'Rewritten' }, makeAddendumRow(), context)
    ).toEqual({});
  });
});

describe('the published contracts', () => {
  it('describes every route this module mounts, and mounts every route it describes', () => {
    const { app } = createTestApp();
    const registered = new Set(
      (app as unknown as { routes: { method: string; path: string }[] }).routes
        .filter((route) => route.method !== 'ALL' && route.method !== 'USE')
        .map((route) => `${route.method.toLowerCase()} ${route.path}`)
    );

    const documented = clinicalRouteContracts().map(
      (contract) => `${contract.method} ${toHonoPath(contract.path)}`
    );

    // Eight aggregates with four operations each, plus the seven transitions
    // and nested routes that are written by hand, plus the medication screen and
    // the growth chart.
    expect(documented).toHaveLength(41);
    for (const route of documented) {
      expect(registered, route).toContain(route);
    }
    expect(new Set(clinicalRouteContracts().map((c) => c.operationId)).size).toBe(41);
  });
});
