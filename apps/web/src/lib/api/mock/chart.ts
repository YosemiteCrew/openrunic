import type {
  Addendum,
  Allergy,
  AllergyRecord,
  CareGap,
  CareTeamMember,
  ChartDocument,
  ChartSummary,
  EncounterNote,
  Medication,
  NoteSection,
  Problem,
  ResultObservation,
  SlashCommand,
  Visit,
} from '../chart/types';
import { ATTESTATION, contentHash } from '../chart/signature';

import { MOCK_CLINIC_DAY, MOCK_PATIENTS } from './fixtures';

/**
 * The chart half of the demo clinic.
 *
 * Same rules as `fixtures.ts`, which this file extends rather than replaces:
 * synthetic by construction, deterministic, no `Date.now()`, no randomness. The
 * clinical detail is plausible and internally coherent - a 2019 date of birth
 * gets a well-child visit and no lipid panel, a diabetic gets an A1c above
 * range and the medication that goes with it - because a chart populated with
 * noise cannot be reviewed for whether it reads correctly.
 *
 * Charts are keyed by patient id. A patient with no entry gets
 * {@link EMPTY_CHART}: nothing recorded, allergies explicitly `NOT_RECORDED`.
 * That is the honest state for a newly registered patient, and it is what makes
 * every empty state on the chart reachable in the running app rather than only
 * in a test.
 */

const PATIENT_IDS = {
  testina: MOCK_PATIENTS.find((patient) => patient.mrn === 'OR-100482')?.id ?? '',
  marek: MOCK_PATIENTS.find((patient) => patient.mrn === 'OR-100517')?.id ?? '',
  aiko: MOCK_PATIENTS.find((patient) => patient.mrn === 'OR-100608')?.id ?? '',
  synthea: MOCK_PATIENTS.find((patient) => patient.mrn === 'OR-100702')?.id ?? '',
} as const;

/**
 * Note ids are stable: they appear in `/encounters/<id>` URLs.
 *
 * Between them the four notes cover every state the editor has to render:
 * unsigned, signed with an addendum, signed clean, and draft.
 *
 * The dates are pinned to the appointment fixtures rather than invented. On the
 * clinic day Testina's 08:00 follow-up was fulfilled and its note is still
 * unsigned, which is the documentation debt the chart surfaces; Aiko's
 * well-child visit was fulfilled at 08:40, so her note is today's draft; Marek
 * was checked out of his 08:20 chronic-care visit, and his signed note is from
 * February.
 */
export const MOCK_ENCOUNTER_IDS = {
  testinaUnsigned: '0192f1a0-0000-7000-8000-00000000e001',
  testinaSigned: '0192f1a0-0000-7000-8000-00000000e002',
  marekSigned: '0192f1a0-0000-7000-8000-00000000e003',
  aikoDraft: '0192f1a0-0000-7000-8000-00000000e004',
} as const;

/* -------------------------------------------------------------------------- */
/* Allergies                                                                   */
/* -------------------------------------------------------------------------- */

function recorded(entries: Allergy[]): AllergyRecord {
  return { state: 'RECORDED', affirmedOn: null, entries };
}

/** The affirmed statement, with the date it was affirmed. Never a bare empty list. */
function noKnownAllergies(affirmedOn: string): AllergyRecord {
  return { state: 'NO_KNOWN_ALLERGIES', affirmedOn, entries: [] };
}

const NOT_RECORDED_ALLERGIES: AllergyRecord = {
  state: 'NOT_RECORDED',
  affirmedOn: null,
  entries: [],
};

/* -------------------------------------------------------------------------- */
/* Testina Patientsson - the worked chart                                      */
/* -------------------------------------------------------------------------- */

const TESTINA_ALLERGIES: Allergy[] = [
  {
    id: 'al-t-001',
    allergen: 'Penicillin',
    category: 'DRUG',
    reaction: 'Hives and facial swelling',
    severity: 'SEVERE',
    notedOn: '2019-04-11',
    source: 'Patient reported',
  },
  {
    id: 'al-t-002',
    allergen: 'Peanut',
    category: 'FOOD',
    reaction: 'Mouth tingling',
    severity: 'MODERATE',
    notedOn: '2021-09-02',
    source: 'Patient reported',
  },
];

const TESTINA_PROBLEMS: Problem[] = [
  {
    id: 'pr-t-001',
    name: 'Essential hypertension',
    code: 'I10',
    codeSystem: 'ICD-10',
    status: 'CHRONIC',
    onsetOn: '2022-02-18',
    lastAddressedOn: '2026-05-14',
  },
  {
    id: 'pr-t-002',
    name: 'Migraine without aura',
    code: 'G43.009',
    codeSystem: 'ICD-10',
    status: 'ACTIVE',
    onsetOn: '2018-06-30',
    lastAddressedOn: '2026-02-03',
  },
  {
    id: 'pr-t-003',
    name: 'Iron deficiency anaemia',
    code: 'D50.9',
    codeSystem: 'ICD-10',
    status: 'ACTIVE',
    onsetOn: '2025-11-20',
    lastAddressedOn: '2026-05-14',
  },
  {
    id: 'pr-t-004',
    name: 'Vitamin D deficiency',
    code: 'E55.9',
    codeSystem: 'ICD-10',
    status: 'RESOLVED',
    onsetOn: '2023-01-09',
    lastAddressedOn: '2024-03-22',
  },
];

const TESTINA_MEDICATIONS: Medication[] = [
  {
    id: 'md-t-001',
    drug: 'Lisinopril 10 mg tablet',
    sig: 'Take 1 tablet by mouth each morning',
    prescriber: 'Dr. Okafor',
    status: 'ACTIVE',
    source: 'PRESCRIBED_HERE',
    startedOn: '2022-02-18',
    stoppedOn: null,
    refillsRemaining: 2,
  },
  {
    id: 'md-t-002',
    drug: 'Ferrous sulfate 325 mg tablet',
    sig: 'Take 1 tablet by mouth twice daily with food',
    prescriber: 'Dr. Okafor',
    status: 'ACTIVE',
    source: 'PRESCRIBED_HERE',
    startedOn: '2025-11-20',
    stoppedOn: null,
    refillsRemaining: 0,
  },
  {
    id: 'md-t-003',
    drug: 'Sumatriptan 50 mg tablet',
    sig: 'Take 1 tablet by mouth at onset of migraine, may repeat once after 2 hours',
    prescriber: 'Dr. Okafor',
    status: 'ACTIVE',
    source: 'PRESCRIBED_HERE',
    startedOn: '2018-07-14',
    stoppedOn: null,
    refillsRemaining: 5,
  },
  {
    id: 'md-t-004',
    drug: 'Cholecalciferol 1000 unit capsule',
    sig: 'Take 1 capsule by mouth daily',
    prescriber: 'Dr. Halvorsen',
    status: 'DISCONTINUED',
    source: 'PATIENT_REPORTED',
    startedOn: '2023-01-09',
    stoppedOn: '2024-03-22',
    refillsRemaining: null,
  },
];

const TESTINA_VISITS: Visit[] = [
  {
    id: 'vs-t-001',
    encounterId: MOCK_ENCOUNTER_IDS.testinaUnsigned,
    date: MOCK_CLINIC_DAY,
    type: 'Follow-up',
    providerName: 'Dr. Okafor',
    reason: 'Blood pressure review',
    noteState: 'UNSIGNED',
  },
  {
    id: 'vs-t-002',
    encounterId: MOCK_ENCOUNTER_IDS.testinaSigned,
    date: '2026-05-14',
    type: 'Follow-up',
    providerName: 'Dr. Okafor',
    reason: 'Anaemia recheck',
    noteState: 'SIGNED',
  },
  {
    id: 'vs-t-003',
    encounterId: null,
    date: '2026-02-03',
    type: 'Acute visit',
    providerName: 'Dr. Lindqvist',
    reason: 'Migraine, three days',
    noteState: 'SIGNED',
  },
  {
    id: 'vs-t-004',
    encounterId: null,
    date: '2025-11-20',
    type: 'Annual physical',
    providerName: 'Dr. Okafor',
    reason: 'Annual physical',
    noteState: 'SIGNED',
  },
];

const TESTINA_RESULTS: ResultObservation[] = [
  {
    id: 'rs-t-001',
    panel: 'Full blood count',
    analyte: 'Haemoglobin',
    code: '718-7',
    value: 11.2,
    unit: 'g/dL',
    referenceLow: 12,
    referenceHigh: 15.5,
    collectedAt: '2026-08-10T08:05:00.000Z',
    reviewed: false,
  },
  {
    id: 'rs-t-002',
    panel: 'Full blood count',
    analyte: 'Mean cell volume',
    code: '787-2',
    value: 78,
    unit: 'fL',
    referenceLow: 80,
    referenceHigh: 100,
    collectedAt: '2026-08-10T08:05:00.000Z',
    reviewed: false,
  },
  {
    id: 'rs-t-003',
    panel: 'Full blood count',
    analyte: 'White cell count',
    code: '6690-2',
    value: 6.4,
    unit: 'x10^9/L',
    referenceLow: 4,
    referenceHigh: 11,
    collectedAt: '2026-08-10T08:05:00.000Z',
    reviewed: false,
  },
  {
    id: 'rs-t-004',
    panel: 'Iron studies',
    analyte: 'Ferritin',
    code: '2276-4',
    value: 9,
    unit: 'ng/mL',
    referenceLow: 15,
    referenceHigh: 200,
    collectedAt: '2026-08-10T08:05:00.000Z',
    reviewed: false,
  },
  {
    id: 'rs-t-005',
    panel: 'Basic metabolic panel',
    analyte: 'Potassium',
    code: '2823-3',
    value: 4.1,
    unit: 'mmol/L',
    referenceLow: 3.5,
    referenceHigh: 5.1,
    collectedAt: '2026-05-12T08:20:00.000Z',
    reviewed: true,
  },
  {
    id: 'rs-t-006',
    panel: 'Basic metabolic panel',
    analyte: 'Creatinine',
    code: '2160-0',
    value: 0.9,
    unit: 'mg/dL',
    referenceLow: 0.6,
    referenceHigh: 1.1,
    collectedAt: '2026-05-12T08:20:00.000Z',
    reviewed: true,
  },
];

const TESTINA_DOCUMENTS: ChartDocument[] = [
  {
    id: 'dc-t-001',
    name: 'Cardiology letter, Dr. Halvorsen',
    category: 'Correspondence',
    receivedOn: '2026-06-02',
    source: 'Inbound fax',
    expiresOn: null,
  },
  {
    id: 'dc-t-002',
    name: 'Insurance card, front and back',
    category: 'Insurance',
    receivedOn: '2026-01-06',
    source: 'Front desk scan',
    // Inside the expiry warning window on the clinic day, so the front desk can
    // chase a replacement before it lapses.
    expiresOn: '2026-09-30',
  },
  {
    id: 'dc-t-004',
    name: 'Advance directive, 2024',
    category: 'Consents',
    receivedOn: '2024-05-31',
    source: 'Portal upload',
    expiresOn: '2026-05-31',
  },
  {
    id: 'dc-t-003',
    name: 'Consent for treatment',
    category: 'Consents',
    receivedOn: '2026-01-06',
    source: 'Portal upload',
    expiresOn: '2027-01-06',
  },
];

const TESTINA_CARE_TEAM: CareTeamMember[] = [
  {
    id: 'ct-t-001',
    name: 'Dr. Okafor',
    role: 'Family medicine',
    relationship: 'PRIMARY',
    contact: 'Cedar Clinic',
  },
  {
    id: 'ct-t-002',
    name: 'Amara Chen',
    role: 'Medical assistant',
    relationship: 'CARE_TEAM',
    contact: 'Cedar Clinic',
  },
  {
    id: 'ct-t-003',
    name: 'Dr. Halvorsen',
    role: 'Cardiology',
    relationship: 'EXTERNAL',
    contact: 'Birchwood Heart Associates',
  },
];

const TESTINA_CARE_GAPS: CareGap[] = [
  { id: 'cg-t-001', label: 'Cervical screening due', dueOn: '2026-09-30' },
  { id: 'cg-t-002', label: 'Ferritin recheck due', dueOn: '2026-08-28' },
];

/* -------------------------------------------------------------------------- */
/* Marek Oyelaran - chronic care                                               */
/* -------------------------------------------------------------------------- */

const MAREK_CHART: ChartSummary = {
  patientId: PATIENT_IDS.marek,
  allergies: recorded([
    {
      id: 'al-m-001',
      allergen: 'Sulfamethoxazole',
      category: 'DRUG',
      reaction: 'Rash',
      severity: 'MILD',
      notedOn: '2016-03-08',
      source: 'Reconciled from discharge summary',
    },
  ]),
  problems: [
    {
      id: 'pr-m-001',
      name: 'Type 2 diabetes mellitus',
      code: 'E11.9',
      codeSystem: 'ICD-10',
      status: 'CHRONIC',
      onsetOn: '2014-05-21',
      lastAddressedOn: '2026-02-11',
    },
    {
      id: 'pr-m-002',
      name: 'Essential hypertension',
      code: 'I10',
      codeSystem: 'ICD-10',
      status: 'CHRONIC',
      onsetOn: '2012-10-02',
      lastAddressedOn: '2026-02-11',
    },
    {
      id: 'pr-m-003',
      name: 'Diabetic retinopathy screening',
      code: 'E11.319',
      codeSystem: 'ICD-10',
      status: 'ACTIVE',
      onsetOn: '2024-07-11',
      lastAddressedOn: '2025-08-19',
    },
  ],
  medications: [
    {
      id: 'md-m-001',
      drug: 'Metformin 1000 mg tablet',
      sig: 'Take 1 tablet by mouth twice daily with meals',
      prescriber: 'Dr. Okafor',
      status: 'ACTIVE',
      source: 'PRESCRIBED_HERE',
      startedOn: '2014-06-04',
      stoppedOn: null,
      refillsRemaining: 1,
    },
    {
      id: 'md-m-002',
      drug: 'Amlodipine 5 mg tablet',
      sig: 'Take 1 tablet by mouth each morning',
      prescriber: 'Dr. Okafor',
      status: 'ACTIVE',
      source: 'PRESCRIBED_HERE',
      startedOn: '2019-01-15',
      stoppedOn: null,
      refillsRemaining: 3,
    },
    {
      id: 'md-m-003',
      drug: 'Atorvastatin 20 mg tablet',
      sig: 'Take 1 tablet by mouth at bedtime',
      prescriber: 'Dr. Okafor',
      status: 'ACTIVE',
      source: 'RECONCILED',
      startedOn: '2020-09-30',
      stoppedOn: null,
      refillsRemaining: 2,
    },
  ],
  careGaps: [{ id: 'cg-m-001', label: 'Diabetic eye screening overdue', dueOn: '2026-07-11' }],
  visits: [
    {
      id: 'vs-m-001',
      encounterId: null,
      date: MOCK_CLINIC_DAY,
      type: 'Acute visit',
      providerName: 'Dr. Okafor',
      reason: 'Ankle injury',
      // Arrived at 09:40 and not yet seen: there is nothing to document.
      noteState: 'NONE',
    },
    {
      id: 'vs-m-002',
      encounterId: MOCK_ENCOUNTER_IDS.marekSigned,
      date: '2026-02-11',
      type: 'Chronic care',
      providerName: 'Dr. Okafor',
      reason: 'Diabetes review',
      noteState: 'SIGNED',
    },
  ],
  results: [
    {
      id: 'rs-m-001',
      panel: 'Diabetes monitoring',
      analyte: 'Haemoglobin A1c',
      code: '4548-4',
      value: 8.2,
      unit: '%',
      referenceLow: 4,
      referenceHigh: 5.6,
      collectedAt: '2026-08-05T07:40:00.000Z',
      reviewed: true,
    },
    {
      id: 'rs-m-002',
      panel: 'Basic metabolic panel',
      analyte: 'Creatinine',
      code: '2160-0',
      value: 1.3,
      unit: 'mg/dL',
      referenceLow: 0.7,
      referenceHigh: 1.2,
      collectedAt: '2026-08-05T07:40:00.000Z',
      reviewed: true,
    },
    {
      id: 'rs-m-003',
      panel: 'Lipid panel',
      analyte: 'LDL cholesterol',
      code: '13457-7',
      value: 2.4,
      unit: 'mmol/L',
      referenceLow: null,
      referenceHigh: 3,
      collectedAt: '2026-08-05T07:40:00.000Z',
      reviewed: true,
    },
  ],
  documents: [
    {
      id: 'dc-m-001',
      name: 'Retinal screening report 2025',
      category: 'Reports',
      receivedOn: '2025-08-20',
      source: 'Inbound fax',
      expiresOn: null,
    },
  ],
  careTeam: [
    {
      id: 'ct-m-001',
      name: 'Dr. Okafor',
      role: 'Family medicine',
      relationship: 'PRIMARY',
      contact: 'Cedar Clinic',
    },
    {
      id: 'ct-m-002',
      name: 'Priya Raman',
      role: 'Diabetes educator',
      relationship: 'CARE_TEAM',
      contact: 'Cedar Clinic',
    },
  ],
  balanceDue: 142.5,
};

/* -------------------------------------------------------------------------- */
/* Aiko Fernstrom - paediatric                                                 */
/* -------------------------------------------------------------------------- */

const AIKO_CHART: ChartSummary = {
  patientId: PATIENT_IDS.aiko,
  allergies: noKnownAllergies('2026-08-12'),
  problems: [
    {
      id: 'pr-a-001',
      name: 'Mild intermittent asthma',
      code: 'J45.20',
      codeSystem: 'ICD-10',
      status: 'ACTIVE',
      onsetOn: '2024-03-14',
      lastAddressedOn: MOCK_CLINIC_DAY,
    },
  ],
  medications: [
    {
      id: 'md-a-001',
      drug: 'Salbutamol 100 microgram inhaler',
      sig: 'Inhale 2 puffs as needed for wheeze, up to four times daily',
      prescriber: 'Dr. Lindqvist',
      status: 'ACTIVE',
      source: 'PRESCRIBED_HERE',
      startedOn: '2024-03-14',
      stoppedOn: null,
      refillsRemaining: 1,
    },
  ],
  careGaps: [{ id: 'cg-a-001', label: 'School immunisations due', dueOn: '2026-09-01' }],
  visits: [
    {
      id: 'vs-a-001',
      encounterId: MOCK_ENCOUNTER_IDS.aikoDraft,
      date: MOCK_CLINIC_DAY,
      type: 'Well-child visit',
      providerName: 'Dr. Lindqvist',
      reason: 'Seven-year check',
      noteState: 'DRAFT',
    },
  ],
  results: [],
  documents: [],
  careTeam: [
    {
      id: 'ct-a-001',
      name: 'Dr. Lindqvist',
      role: 'Paediatrics',
      relationship: 'PRIMARY',
      contact: 'Cedar Clinic',
    },
  ],
  balanceDue: 0,
};

/* -------------------------------------------------------------------------- */
/* The charts                                                                  */
/* -------------------------------------------------------------------------- */

const TESTINA_CHART: ChartSummary = {
  patientId: PATIENT_IDS.testina,
  allergies: recorded(TESTINA_ALLERGIES),
  problems: TESTINA_PROBLEMS,
  medications: TESTINA_MEDICATIONS,
  careGaps: TESTINA_CARE_GAPS,
  visits: TESTINA_VISITS,
  results: TESTINA_RESULTS,
  documents: TESTINA_DOCUMENTS,
  careTeam: TESTINA_CARE_TEAM,
  balanceDue: 38,
};

/** Nothing recorded yet, and allergies say so explicitly rather than reading as safe. */
export function emptyChart(patientId: string): ChartSummary {
  return {
    patientId,
    allergies: NOT_RECORDED_ALLERGIES,
    problems: [],
    medications: [],
    careGaps: [],
    visits: [],
    results: [],
    documents: [],
    careTeam: [],
    balanceDue: 0,
  };
}

/** A chart whose allergies are an affirmed "no known allergies", with nothing else on it. */
function affirmedEmptyChart(patientId: string): ChartSummary {
  return { ...emptyChart(patientId), allergies: noKnownAllergies('2026-06-18') };
}

export const MOCK_CHARTS: readonly ChartSummary[] = [
  TESTINA_CHART,
  MAREK_CHART,
  AIKO_CHART,
  affirmedEmptyChart(PATIENT_IDS.synthea),
];

/** The chart for a patient, falling back to the honest empty one. */
export function mockChartFor(patientId: string): ChartSummary {
  return MOCK_CHARTS.find((chart) => chart.patientId === patientId) ?? emptyChart(patientId);
}

/* -------------------------------------------------------------------------- */
/* Notes                                                                       */
/* -------------------------------------------------------------------------- */

function section(
  key: NoteSection['key'],
  label: string,
  hint: string,
  text: string,
  emitted: NoteSection['emitted'] = []
): NoteSection {
  return { key, label, hint, text, emitted };
}

const TESTINA_UNSIGNED_NOTE: EncounterNote = {
  id: MOCK_ENCOUNTER_IDS.testinaUnsigned,
  patientId: PATIENT_IDS.testina,
  visitType: 'Follow-up',
  visitDate: MOCK_CLINIC_DAY,
  providerName: 'Dr. Okafor',
  providerCredential: 'MD',
  reason: 'Blood pressure review',
  state: 'UNSIGNED',
  sections: [
    section(
      'subjective',
      'Subjective',
      'What the patient reports, in their words where it matters.',
      'Here for blood pressure review. Taking lisinopril daily, no missed doses in the last month. Reports two migraines since May, both settled with sumatriptan. Still tired most afternoons; started the iron tablets in November and takes them with breakfast and dinner.'
    ),
    section(
      'objective',
      'Objective',
      'Measurements and examination. Vitals flow in from rooming.',
      'BP 128/78 mmHg seated, repeat 126/76 mmHg. Pulse 72 bpm regular. Weight 68.4 kg, BMI 24.1. Conjunctivae pale. Chest clear, heart sounds normal, no oedema.'
    ),
    section(
      'assessment',
      'Assessment',
      'The clinical picture, and the coded problems it maps to.',
      'Hypertension controlled on current dose. Iron deficiency anaemia not yet corrected: haemoglobin 11.2 g/dL and ferritin 9 ng/mL on 10 Aug, both below range. Migraine stable at two per quarter.',
      [
        { id: 'em-t-001', kind: 'PROBLEM', label: 'Iron deficiency anaemia (D50.9)' },
        { id: 'em-t-002', kind: 'PROBLEM', label: 'Essential hypertension (I10)' },
      ]
    ),
    section(
      'plan',
      'Plan',
      'What happens next, and what it writes to the chart.',
      'Continue lisinopril 10 mg daily. Continue ferrous sulfate twice daily with food and recheck full blood count and ferritin in six weeks. Discussed dietary iron. Return sooner if palpitations or breathlessness.',
      [
        { id: 'em-t-003', kind: 'ORDER', label: 'Full blood count, routine' },
        { id: 'em-t-004', kind: 'ORDER', label: 'Ferritin, routine' },
        { id: 'em-t-005', kind: 'FOLLOW_UP', label: 'Follow-up in 6 weeks' },
      ]
    ),
  ],
  signature: null,
  addenda: [],
};

const TESTINA_SIGNED_ADDENDA: Addendum[] = [
  {
    id: 'ad-t-001',
    authorName: 'Dr. Okafor',
    credential: 'MD',
    addedAt: '2026-05-16T14:05:00.000Z',
    text: 'Laboratory called with the ferritin result after signing: 11 ng/mL, below range. Patient telephoned and iron started the same day.',
  },
];

const TESTINA_SIGNED_SECTIONS: NoteSection[] = [
  section(
    'subjective',
    'Subjective',
    'What the patient reports, in their words where it matters.',
    'Reports steady tiredness for about six months, worse in the afternoons. No bleeding noticed. Periods heavy for two to three days each cycle.'
  ),
  section(
    'objective',
    'Objective',
    'Measurements and examination. Vitals flow in from rooming.',
    'BP 124/76 mmHg. Pulse 76 bpm. Conjunctivae pale. Abdomen soft and non-tender.'
  ),
  section(
    'assessment',
    'Assessment',
    'The clinical picture, and the coded problems it maps to.',
    'Iron deficiency anaemia, likely menstrual loss. Hypertension controlled.'
  ),
  section(
    'plan',
    'Plan',
    'What happens next, and what it writes to the chart.',
    'Full blood count and iron studies today. Start ferrous sulfate 325 mg twice daily with food. Review in three months.',
    [{ id: 'em-m-001', kind: 'PRESCRIPTION', label: 'Ferrous sulfate 325 mg, twice daily' }]
  ),
];

const TESTINA_SIGNED_NOTE: EncounterNote = {
  id: MOCK_ENCOUNTER_IDS.testinaSigned,
  patientId: PATIENT_IDS.testina,
  visitType: 'Follow-up',
  visitDate: '2026-05-14',
  providerName: 'Dr. Okafor',
  providerCredential: 'MD',
  reason: 'Anaemia recheck',
  state: 'SIGNED',
  sections: TESTINA_SIGNED_SECTIONS,
  signature: {
    signerName: 'Dr. Okafor',
    credential: 'MD',
    signedAt: '2026-05-14T16:42:00.000Z',
    attestation: ATTESTATION,
    // Computed from this note's own text rather than typed in, because the
    // field is a fingerprint of the text: a hand-written value would describe
    // nothing, and the screen would render it as though it described this.
    fingerprint: contentHash(TESTINA_SIGNED_SECTIONS),
  },
  addenda: TESTINA_SIGNED_ADDENDA,
};

const MAREK_SIGNED_SECTIONS: NoteSection[] = [
  section(
    'subjective',
    'Subjective',
    'What the patient reports, in their words where it matters.',
    'Three-monthly diabetes review. Taking metformin twice daily. Home glucose readings mostly 9 to 11 mmol/L before breakfast. Walking twice a week. No foot ulcers or numbness.'
  ),
  section(
    'objective',
    'Objective',
    'Measurements and examination. Vitals flow in from rooming.',
    'BP 138/84 mmHg. Weight 91.2 kg. Feet examined: pulses present, monofilament intact at all sites. HbA1c 7.9% on 9 Feb, above range.'
  ),
  section(
    'assessment',
    'Assessment',
    'The clinical picture, and the coded problems it maps to.',
    'Type 2 diabetes above target. Hypertension at the upper limit. Eye screening due in July.',
    [{ id: 'em-k-001', kind: 'PROBLEM', label: 'Type 2 diabetes mellitus (E11.9)' }]
  ),
  section(
    'plan',
    'Plan',
    'What happens next, and what it writes to the chart.',
    'Continue metformin. Refer for retinal screening. Repeat HbA1c in three months and review medication then.',
    [
      { id: 'em-k-002', kind: 'ORDER', label: 'Retinal screening referral' },
      { id: 'em-k-003', kind: 'FOLLOW_UP', label: 'Follow-up in 3 months' },
    ]
  ),
];

const MAREK_SIGNED_NOTE: EncounterNote = {
  id: MOCK_ENCOUNTER_IDS.marekSigned,
  patientId: PATIENT_IDS.marek,
  visitType: 'Chronic care',
  visitDate: '2026-02-11',
  providerName: 'Dr. Okafor',
  providerCredential: 'MD',
  reason: 'Diabetes review',
  state: 'SIGNED',
  sections: MAREK_SIGNED_SECTIONS,
  signature: {
    signerName: 'Dr. Okafor',
    credential: 'MD',
    signedAt: '2026-02-11T09:04:00.000Z',
    attestation: ATTESTATION,
    fingerprint: contentHash(MAREK_SIGNED_SECTIONS),
  },
  addenda: [],
};

const AIKO_DRAFT_NOTE: EncounterNote = {
  id: MOCK_ENCOUNTER_IDS.aikoDraft,
  patientId: PATIENT_IDS.aiko,
  visitType: 'Well-child visit',
  visitDate: MOCK_CLINIC_DAY,
  providerName: 'Dr. Lindqvist',
  providerCredential: 'MD',
  reason: 'Seven-year check',
  state: 'DRAFT',
  sections: [
    section(
      'subjective',
      'Subjective',
      'What the patient reports, in their words where it matters.',
      'Seven-year check. Parent reports occasional wheeze with colds, inhaler used twice since March. Eating and sleeping well, doing well at school.'
    ),
    section(
      'objective',
      'Objective',
      'Measurements and examination. Vitals flow in from rooming.',
      'Height 122 cm, weight 23.1 kg. Chest clear, no wheeze today.'
    ),
    section(
      'assessment',
      'Assessment',
      'The clinical picture, and the coded problems it maps to.',
      ''
    ),
    section('plan', 'Plan', 'What happens next, and what it writes to the chart.', ''),
  ],
  signature: null,
  addenda: [],
};

export const MOCK_ENCOUNTER_NOTES: readonly EncounterNote[] = [
  TESTINA_UNSIGNED_NOTE,
  TESTINA_SIGNED_NOTE,
  MAREK_SIGNED_NOTE,
  AIKO_DRAFT_NOTE,
];

export function mockEncounterNote(id: string): EncounterNote | undefined {
  return MOCK_ENCOUNTER_NOTES.find((note) => note.id === id);
}

/* -------------------------------------------------------------------------- */
/* Slash commands                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The command library behind `/` in the note editor.
 *
 * Each one inserts narrative and, where it applies, names what it writes to the
 * chart. That pairing is the point: the clinician types once, and the chart
 * gains a coded order rather than a sentence describing one.
 */
export const MOCK_SLASH_COMMANDS: readonly SlashCommand[] = [
  {
    id: 'hpi',
    label: 'History of present illness',
    group: 'Documentation',
    icon: 'file-text',
    insertText:
      'History of present illness: symptom onset, duration, severity, aggravating and relieving factors.',
    emits: null,
  },
  {
    id: 'ros',
    label: 'Review of systems',
    group: 'Documentation',
    icon: 'list-checks',
    insertText:
      'Review of systems: constitutional, cardiovascular, respiratory and gastrointestinal reviewed and otherwise negative.',
    emits: null,
  },
  {
    id: 'diagnose',
    label: 'Diagnose',
    group: 'Orders',
    icon: 'stethoscope',
    insertText: 'Assessment: essential hypertension, controlled on current therapy.',
    emits: { kind: 'PROBLEM', label: 'Essential hypertension (I10)' },
  },
  {
    id: 'order',
    label: 'Order lab',
    group: 'Orders',
    icon: 'flask-conical',
    insertText: 'Full blood count and ferritin ordered today, routine priority.',
    emits: { kind: 'ORDER', label: 'Full blood count, routine' },
  },
  {
    id: 'prescribe',
    label: 'Prescribe',
    group: 'Orders',
    icon: 'pill',
    insertText: 'Lisinopril 10 mg, take 1 tablet by mouth each morning, 90 days, 2 refills.',
    emits: { kind: 'PRESCRIPTION', label: 'Lisinopril 10 mg, once daily' },
  },
  {
    id: 'followup',
    label: 'Follow-up',
    group: 'Plan',
    icon: 'calendar-plus',
    insertText: 'Return in six weeks, sooner if symptoms change.',
    emits: { kind: 'FOLLOW_UP', label: 'Follow-up in 6 weeks' },
  },
  {
    id: 'refer',
    label: 'Refer',
    group: 'Plan',
    icon: 'share-2',
    insertText: 'Referral to cardiology for further assessment, routine priority.',
    emits: { kind: 'ORDER', label: 'Cardiology referral, routine' },
  },
];
