import type {
  Appointment,
  ClaimDto,
  ClinicalNoteDto,
  ClinicalNoteState,
  DiagnosticReportDto,
  EncounterDto,
  EncounterStatus,
  FormDefinitionDto,
  NoteAddendumDto,
  PaymentDto,
  RemittanceDto,
  ServiceRequestDto,
  StatementDto,
  TaskDto,
} from '../types';

import { MOCK_APPOINTMENTS, MOCK_FACILITY, MOCK_NOW, MOCK_PROVIDERS } from './fixtures';

/**
 * The API's own record of the demo clinic, in wire shapes.
 *
 * `fixtures.ts` holds what the screens render; this file holds what the server
 * would have stored. The two are separate because several screens still read
 * through a view type of their own - the order ledger and the billing
 * workbench both do - and mixing the two vocabularies in one file is how a
 * screen ends up rendering a status the API has never heard of.
 *
 * Everything here is derived from the appointments where it can be, so a visit
 * on the schedule and the encounter documented against it are the same visit
 * rather than two fixtures that happen to look alike.
 */

const CLINICIAN = MOCK_PROVIDERS[0].id;
const SECOND_CLINICIAN = MOCK_PROVIDERS[1].id;

/* An advice, a claim and a statement all belong to one payer in the demo. */
const PAYER = '0192f1a0-0000-7000-8000-00000000y001';
const COVERAGE = '0192f1a0-0000-7000-8000-00000000v001';

/** Appointments whose visit actually happened, and so have an encounter. */
const VISITED: ReadonlySet<Appointment['status']> = new Set<Appointment['status']>([
  'IN_PROGRESS',
  'CHECKED_OUT',
  'FULFILLED',
]);

/**
 * An appointment that produced a visit, so it certainly names a patient.
 *
 * Narrowing here rather than defaulting a null id to an empty string keeps the
 * impossible case impossible: a fixture with a hole in it should fail the build
 * that introduced it, not render as a visit belonging to nobody.
 */
type VisitedAppointment = Appointment & { patientId: string };

function isVisited(appointment: Appointment): appointment is VisitedAppointment {
  return VISITED.has(appointment.status) && appointment.patientId !== null;
}

/**
 * The visit's status, from the appointment's.
 *
 * A visit that is under way is `IN_PROGRESS`; one the patient has left is
 * `COMPLETED`, whether or not anybody has signed it. The distinction between
 * "finished" and "signed" is the whole subject of the signing debt board, so
 * the two are never collapsed into one column.
 */
function encounterStatusFor(appointment: Appointment): EncounterStatus {
  return appointment.status === 'IN_PROGRESS' ? 'IN_PROGRESS' : 'COMPLETED';
}

/** A visit is signed only once it is fulfilled. A checked-out visit is somebody's debt. */
function signedAtFor(appointment: Appointment): string | null {
  return appointment.status === 'FULFILLED' ? appointment.end : null;
}

function encounterFor(appointment: VisitedAppointment, index: number): EncounterDto {
  const signedAt = signedAtFor(appointment);
  return {
    id: `0192f1a0-0000-7000-8000-00000000e${String(index + 1).padStart(3, '0')}`,
    facilityId: appointment.facilityId,
    patientId: appointment.patientId,
    providerId: appointment.providerId,
    appointmentId: appointment.id,
    class: 'AMBULATORY',
    status: encounterStatusFor(appointment),
    reasonCode: null,
    reasonText: appointment.reasonText,
    startedAt: appointment.start,
    endedAt: appointment.status === 'IN_PROGRESS' ? null : appointment.end,
    signedAt,
    signedById: signedAt === null ? null : appointment.providerId,
    createdAt: appointment.start,
    updatedAt: appointment.end,
  };
}

/** Four visits: two signed, one carrying signing debt, one still under way. */
export const MOCK_ENCOUNTERS: readonly EncounterDto[] = MOCK_APPOINTMENTS.reduce<EncounterDto[]>(
  (visits, appointment) => {
    if (isVisited(appointment)) visits.push(encounterFor(appointment, visits.length));
    return visits;
  },
  []
);

/**
 * A visit by position in {@link MOCK_ENCOUNTERS}.
 *
 * The seeds below index into that list, and an index that has fallen off the
 * end is a broken fixture rather than a row to be quietly skipped: every note,
 * order and claim here is written against a visit that has to exist.
 */
function visit(index: number): EncounterDto {
  const encounter = MOCK_ENCOUNTERS[index];
  if (encounter === undefined) {
    throw new RangeError(`records.ts: no fixture visit at index ${index}`);
  }
  return encounter;
}

/* -------------------------------------------------------------------------- */
/* Notes                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The narrative each visit was documented with.
 *
 * Blocks are stored the way the API stores them: opaque JSON whose shape the
 * note editor owns. A `key` and a `text` is all this demo's editor needs, and
 * writing anything richer here would be inventing an editor format the editor
 * has not asked for.
 */
interface NoteSeed {
  encounterIndex: number;
  title: string;
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
}

const NOTE_SEEDS: readonly NoteSeed[] = [
  {
    encounterIndex: 0,
    title: 'Follow-up: blood pressure',
    subjective: 'Reports the morning headaches have settled since the dose change. No dizziness.',
    objective: 'BP 128/78 seated, repeat 126/76. Weight steady. Chest clear.',
    assessment: 'Hypertension, responding to current dose.',
    plan: 'Continue lisinopril 10 mg daily. Recheck in three months. Home readings twice weekly.',
  },
  {
    encounterIndex: 1,
    title: 'Chronic care: diabetes review',
    subjective: 'Home glucose mostly 6 to 8 mmol/L. Occasional evening highs after late meals.',
    objective: 'HbA1c 53 mmol/mol. Feet examined, sensation intact, no ulceration.',
    assessment: 'Type 2 diabetes, adequate control. No neuropathy.',
    plan: 'Continue metformin. Dietitian referral for evening meal timing. Retinal screening due.',
  },
  {
    encounterIndex: 2,
    title: 'Well-child visit',
    subjective:
      'Parent reports normal appetite, sleeping through. Walking steadily since 13 months.',
    objective: 'Growth on the 50th centile. Development age-appropriate across all domains.',
    assessment: 'Well child, growth and development normal.',
    plan: 'Immunisations given today. Next review at three years.',
  },
  {
    encounterIndex: 3,
    title: 'Acute visit: ankle',
    subjective:
      'Twisted the right ankle on a kerb yesterday. Weight-bearing but painful laterally.',
    objective: 'Swelling over the lateral malleolus. No bony tenderness. Able to take four steps.',
    assessment: 'Lateral ankle sprain. Ottawa rules negative, so no imaging indicated.',
    plan: 'Rest, ice, compression. Review in one week if not improving.',
  },
];

/**
 * The note's state, from its visit's.
 *
 * A signed visit has a signed note; a completed but unsigned visit has an
 * unsigned one, which is exactly the row the signing debt board is looking for;
 * a visit under way has a draft.
 */
function noteStateFor(encounter: EncounterDto): ClinicalNoteState {
  if (encounter.signedAt !== null) return 'SIGNED';
  return encounter.status === 'IN_PROGRESS' ? 'DRAFT' : 'UNSIGNED';
}

function noteFor(seed: NoteSeed, index: number): ClinicalNoteDto {
  const encounter = visit(seed.encounterIndex);
  const state = noteStateFor(encounter);
  return {
    id: `0192f1a0-0000-7000-8000-00000000n${String(index + 1).padStart(3, '0')}`,
    patientId: encounter.patientId,
    encounterId: encounter.id,
    authorId: encounter.providerId,
    title: seed.title,
    blocks: [
      { key: 'subjective', text: seed.subjective },
      { key: 'objective', text: seed.objective },
      { key: 'assessment', text: seed.assessment },
      { key: 'plan', text: seed.plan },
    ],
    state,
    cosignerId: null,
    cosignedAt: null,
    signedAt: encounter.signedAt,
    signedById: encounter.signedById,
    lockedAt: encounter.signedAt,
    createdAt: encounter.startedAt,
    updatedAt: encounter.updatedAt,
  };
}

export const MOCK_NOTES: readonly ClinicalNoteDto[] = NOTE_SEEDS.map(noteFor);

/** The note a fixture refers to by position, for the same reason {@link visit} exists. */
function note(index: number): ClinicalNoteDto {
  const found = MOCK_NOTES[index];
  if (found === undefined) {
    throw new RangeError(`records.ts: no fixture note at index ${index}`);
  }
  return found;
}

/** One correction on the record already, so the addendum path has something to read. */
export const MOCK_NOTE_ADDENDA: readonly NoteAddendumDto[] = [
  {
    id: '0192f1a0-0000-7000-8000-00000000q001',
    noteId: note(0).id,
    authorId: CLINICIAN,
    blocks: [
      {
        key: 'addendum',
        text: 'Home readings brought in after the visit average 124/76 over two weeks.',
      },
    ],
    reason: 'Home readings received',
    signedAt: MOCK_NOW,
    createdAt: MOCK_NOW,
    updatedAt: MOCK_NOW,
  },
];

/* -------------------------------------------------------------------------- */
/* Orders, results and tasks                                                   */
/* -------------------------------------------------------------------------- */

const FIRST_PATIENT = visit(0).patientId;
const SECOND_PATIENT = visit(1).patientId;

/**
 * Three orders, one in each state a transition starts from.
 *
 * Sized to exercise the state machine rather than to fill a ledger: pended
 * signs, signed transmits, and transmitted can only be cancelled. The order
 * ledger screen still reads its own richer fixtures.
 */
export const MOCK_SERVICE_REQUESTS: readonly ServiceRequestDto[] = [
  {
    id: '0192f1a0-0000-7000-8000-00000000s001',
    patientId: FIRST_PATIENT,
    encounterId: visit(0).id,
    orderedById: CLINICIAN,
    category: 'LAB',
    status: 'PENDED',
    intent: 'ORDER',
    priority: 'ROUTINE',
    code: '24323-8',
    codeSystem: 'http://loinc.org',
    display: 'Comprehensive metabolic panel',
    specimenTypeCode: 'SER',
    reasonCodes: ['I10'],
    aoeAnswers: null,
    note: null,
    requisitionNumber: null,
    performingLabName: 'Cedar Valley Laboratory',
    labRef: null,
    requestedAt: MOCK_NOW,
    scheduledFor: null,
    transmittedAt: null,
    createdAt: MOCK_NOW,
    updatedAt: MOCK_NOW,
  },
  {
    id: '0192f1a0-0000-7000-8000-00000000s002',
    patientId: SECOND_PATIENT,
    encounterId: visit(1).id,
    orderedById: CLINICIAN,
    category: 'LAB',
    status: 'SIGNED',
    intent: 'ORDER',
    priority: 'ROUTINE',
    code: '4548-4',
    codeSystem: 'http://loinc.org',
    display: 'Haemoglobin A1c',
    specimenTypeCode: 'WB',
    reasonCodes: ['E11.9'],
    aoeAnswers: null,
    note: null,
    requisitionNumber: null,
    performingLabName: 'Cedar Valley Laboratory',
    labRef: null,
    requestedAt: MOCK_NOW,
    scheduledFor: null,
    transmittedAt: null,
    createdAt: MOCK_NOW,
    updatedAt: MOCK_NOW,
  },
  {
    id: '0192f1a0-0000-7000-8000-00000000s003',
    patientId: SECOND_PATIENT,
    encounterId: null,
    orderedById: SECOND_CLINICIAN,
    category: 'IMAGING',
    status: 'TRANSMITTED',
    intent: 'ORDER',
    priority: 'URGENT',
    code: '36643-5',
    codeSystem: 'http://loinc.org',
    display: 'Chest X-ray, two views',
    specimenTypeCode: null,
    reasonCodes: ['R05'],
    aoeAnswers: null,
    note: null,
    requisitionNumber: 'REQ-40218',
    performingLabName: 'Birchwood Imaging',
    labRef: null,
    requestedAt: MOCK_NOW,
    scheduledFor: null,
    transmittedAt: MOCK_NOW,
    createdAt: MOCK_NOW,
    updatedAt: MOCK_NOW,
  },
];

/** One unreviewed report and one already signed off, so a second review is a 409. */
export const MOCK_DIAGNOSTIC_REPORTS: readonly DiagnosticReportDto[] = [
  {
    id: '0192f1a0-0000-7000-8000-00000000r001',
    patientId: FIRST_PATIENT,
    encounterId: visit(0).id,
    serviceRequestId: '0192f1a0-0000-7000-8000-00000000s001',
    specimenId: null,
    status: 'FINAL',
    category: 'LAB',
    code: '24323-8',
    codeSystem: 'http://loinc.org',
    display: 'Comprehensive metabolic panel',
    performingLabName: 'Cedar Valley Laboratory',
    abnormalFlag: 'ABNORMAL',
    narrative: null,
    rawStorageKey: null,
    effectiveAt: MOCK_NOW,
    issuedAt: MOCK_NOW,
    reviewedById: null,
    reviewedAt: null,
    createdAt: MOCK_NOW,
    updatedAt: MOCK_NOW,
  },
  {
    id: '0192f1a0-0000-7000-8000-00000000r002',
    patientId: SECOND_PATIENT,
    encounterId: null,
    serviceRequestId: null,
    specimenId: null,
    status: 'FINAL',
    category: 'IMAGING',
    code: '36643-5',
    codeSystem: 'http://loinc.org',
    display: 'Chest X-ray, two views',
    performingLabName: 'Birchwood Imaging',
    abnormalFlag: 'NORMAL',
    narrative: 'Lung fields clear. Heart size within normal limits. No effusion.',
    rawStorageKey: null,
    effectiveAt: MOCK_NOW,
    issuedAt: MOCK_NOW,
    reviewedById: CLINICIAN,
    reviewedAt: MOCK_NOW,
    createdAt: MOCK_NOW,
    updatedAt: MOCK_NOW,
  },
];

/** Two open items and one already closed, so completing a closed task is a 409. */
export const MOCK_TASKS: readonly TaskDto[] = [
  {
    id: '0192f1a0-0000-7000-8000-00000000t001',
    type: 'RESULT',
    status: 'OPEN',
    priority: 'HIGH',
    patientId: FIRST_PATIENT,
    encounterId: null,
    subjectType: 'DiagnosticReport',
    subjectId: '0192f1a0-0000-7000-8000-00000000r001',
    title: 'Review abnormal metabolic panel',
    description: 'Potassium below the reference range.',
    assigneeType: 'USER',
    assigneeUserId: CLINICIAN,
    assigneeTeamKey: null,
    dueAt: MOCK_NOW,
    slaState: 'AGING',
    expiresAt: null,
    sourceEventId: null,
    completedAt: null,
    completedById: null,
    outcome: null,
    createdAt: MOCK_NOW,
    updatedAt: MOCK_NOW,
  },
  {
    id: '0192f1a0-0000-7000-8000-00000000t002',
    type: 'COSIGN',
    status: 'IN_PROGRESS',
    priority: 'NORMAL',
    patientId: SECOND_PATIENT,
    encounterId: visit(1).id,
    subjectType: 'ClinicalNote',
    subjectId: note(1).id,
    title: 'Cosign the chronic care note',
    description: null,
    assigneeType: 'USER',
    assigneeUserId: SECOND_CLINICIAN,
    assigneeTeamKey: null,
    dueAt: null,
    slaState: 'OK',
    expiresAt: null,
    sourceEventId: null,
    completedAt: null,
    completedById: null,
    outcome: null,
    createdAt: MOCK_NOW,
    updatedAt: MOCK_NOW,
  },
  {
    id: '0192f1a0-0000-7000-8000-00000000t003',
    type: 'REFILL',
    status: 'DONE',
    priority: 'NORMAL',
    patientId: FIRST_PATIENT,
    encounterId: null,
    subjectType: null,
    subjectId: null,
    title: 'Approve the lisinopril refill',
    description: null,
    assigneeType: 'TEAM',
    assigneeUserId: null,
    assigneeTeamKey: 'front-desk',
    dueAt: null,
    slaState: 'OK',
    expiresAt: null,
    sourceEventId: null,
    completedAt: MOCK_NOW,
    completedById: CLINICIAN,
    outcome: 'Approved for 90 days',
    createdAt: MOCK_NOW,
    updatedAt: MOCK_NOW,
  },
];

/* -------------------------------------------------------------------------- */
/* The revenue cycle                                                           */
/* -------------------------------------------------------------------------- */

function claim(id: string, status: ClaimDto['status'], chargedCents: number): ClaimDto {
  return {
    id,
    patientId: FIRST_PATIENT,
    encounterId: visit(0).id,
    coverageId: COVERAGE,
    payerId: PAYER,
    status,
    frequency: 'ORIGINAL',
    diagnosisCodes: ['I10'],
    totals: {
      chargedCents,
      paidCents: 0,
      adjustedCents: 0,
      patientResponsibilityCents: 0,
    },
    secondaryOfId: null,
    priorClaimId: null,
    controlNumbers: null,
    snapshot: null,
    statusReason: null,
    submittedAt: null,
    acknowledgedAt: null,
    adjudicatedAt: null,
    createdAt: MOCK_NOW,
    updatedAt: MOCK_NOW,
  };
}

/** A draft to scrub, a scrubbed one to submit, and a submitted one awaiting a payer. */
export const MOCK_CLAIM_RECORDS: readonly ClaimDto[] = [
  claim('0192f1a0-0000-7000-8000-00000000c001', 'DRAFT', 18_400),
  claim('0192f1a0-0000-7000-8000-00000000c002', 'SCRUBBED', 9_600),
  claim('0192f1a0-0000-7000-8000-00000000c003', 'SUBMITTED', 24_250),
];

/** A pending patient payment, waiting to be posted. */
export const MOCK_PAYMENT_RECORDS: readonly PaymentDto[] = [
  {
    id: '0192f1a0-0000-7000-8000-00000000m001',
    patientId: FIRST_PATIENT,
    payerId: null,
    remittanceId: null,
    source: 'PATIENT',
    method: 'CARD',
    status: 'PENDING',
    amountCents: 4_500,
    currency: 'USD',
    reference: null,
    adapterRef: null,
    receivedAt: MOCK_NOW,
    postedAt: null,
    postedById: null,
    note: null,
    createdAt: MOCK_NOW,
    updatedAt: MOCK_NOW,
  },
];

/**
 * One advice in each of the two states posting can start from.
 *
 * `RECEIVED` cannot be posted, because posting reads matched lines and nothing
 * has looked at them yet; that refusal is worth having a fixture for.
 */
export const MOCK_REMITTANCE_RECORDS: readonly RemittanceDto[] = [
  {
    id: '0192f1a0-0000-7000-8000-00000000w001',
    payerId: PAYER,
    status: 'RECEIVED',
    checkOrEftNumber: 'EFT-778201',
    totalPaidCents: 31_200,
    receivedAt: MOCK_NOW,
    paidAt: null,
    rawStorageKey: null,
    parsed: null,
    exceptionCount: 0,
    postedAt: null,
    postedById: null,
    createdAt: MOCK_NOW,
    updatedAt: MOCK_NOW,
  },
  {
    id: '0192f1a0-0000-7000-8000-00000000w002',
    payerId: PAYER,
    status: 'PARSED',
    checkOrEftNumber: 'EFT-778455',
    totalPaidCents: 12_800,
    receivedAt: MOCK_NOW,
    paidAt: null,
    rawStorageKey: null,
    parsed: null,
    exceptionCount: 1,
    postedAt: null,
    postedById: null,
    createdAt: MOCK_NOW,
    updatedAt: MOCK_NOW,
  },
];

/** A draft statement to generate, and a generated one to send. */
export const MOCK_STATEMENT_RECORDS: readonly StatementDto[] = [
  {
    id: '0192f1a0-0000-7000-8000-00000000x001',
    patientId: FIRST_PATIENT,
    status: 'DRAFT',
    balanceCents: 7_350,
    dunningCycle: 1,
    periodStart: null,
    periodEnd: null,
    generatedAt: MOCK_NOW,
    deliveredVia: null,
    deliveredAt: null,
    pdfStorageKey: null,
    payLinkSet: false,
    payLinkExpiresAt: null,
    paidAt: null,
    createdAt: MOCK_NOW,
    updatedAt: MOCK_NOW,
  },
  {
    id: '0192f1a0-0000-7000-8000-00000000x002',
    patientId: SECOND_PATIENT,
    status: 'GENERATED',
    balanceCents: 2_100,
    dunningCycle: 2,
    periodStart: null,
    periodEnd: null,
    generatedAt: MOCK_NOW,
    deliveredVia: null,
    deliveredAt: null,
    pdfStorageKey: null,
    payLinkSet: false,
    payLinkExpiresAt: null,
    paidAt: null,
    createdAt: MOCK_NOW,
    updatedAt: MOCK_NOW,
  },
];

/** One unpublished definition, so publishing has something to freeze. */
export const MOCK_FORM_DEFINITION_RECORDS: readonly FormDefinitionDto[] = [
  {
    id: '0192f1a0-0000-7000-8000-00000000g001',
    key: 'intake-general',
    version: 3,
    status: 'DRAFT',
    title: 'New patient intake',
    description: 'Demographics, history and consent, collected before the first visit.',
    bindTo: 'PATIENT',
    definition: { sections: 4, fields: 22 },
    compiled: null,
    promotionManifest: null,
    publishedAt: null,
    publishedById: null,
    retiredAt: null,
    createdAt: MOCK_NOW,
    updatedAt: MOCK_NOW,
  },
];

/** The facility every write in mock mode is scoped to, matching the fixtures. */
export const MOCK_ORGANISATION_FACILITY = MOCK_FACILITY.id;

/** Who a mock signature is attributed to, standing in for the signed-in principal. */
export const MOCK_ACTING_USER = CLINICIAN;
