import { linkAuditEvent } from '../audit.js';
import { promoteSubmission } from '../forms.js';
import type { PromotionManifest } from '../forms.js';
import type { Prisma } from '../generated/prisma/client.js';
import { createUuidv7 } from '../uuid.js';

/**
 * A synthetic demo practice, built as plain rows with no database involved.
 *
 * Every identity in here is invented. The names are deliberately, obviously
 * fake ("Testina Patientsson", "Placeholder Mutual Health"), the identifiers
 * are in reserved or non-routable ranges, and no value is derived from a real
 * person, a real payer or a real clinic. That is a hard rule for this
 * repository, not a convention: see CLAUDE.md.
 *
 * The clinical codes are the one thing that is not invented, and only where
 * the vocabulary is free to redistribute: the LOINC, ICD-10-CM, CVX and RxNorm
 * codes below are real, so the demo shows a clinician something they recognise,
 * and `THIRD-PARTY-NOTICES.md` at the repository root carries the attribution
 * each of them requires. The procedure codes are invented, because that
 * vocabulary is not free to redistribute; the comment on `PROCEDURE_SYSTEM`
 * says why at length.
 *
 * The build is fully deterministic. There is no `Math.random`, no `Date.now`
 * and no faker: ids come from a UUIDv7 generator wired to a fixed clock and a
 * fixed byte source, and every clinical value is derived from the patient's
 * index. Running it twice produces byte-identical rows, which is what lets the
 * demo environment, the performance harness and the E2E suite all assert
 * against the same fixtures.
 */

/** The demo week is anchored on a Monday so the schedule looks like a real one. */
const DEFAULT_TODAY = new Date('2026-08-17T00:00:00.000Z');
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export interface DemoPracticeOptions {
  /** Instant the demo week is anchored on. Defaults to Monday 17 August 2026. */
  today?: Date;
  /** Number of synthetic patients. Defaults to 20. */
  patientCount?: number;
}

export interface DemoPractice {
  organisation: Prisma.OrganisationCreateManyInput;
  facilities: Prisma.FacilityCreateManyInput[];
  users: Prisma.UserCreateManyInput[];
  userFacilities: Prisma.UserFacilityCreateManyInput[];
  roles: Prisma.RoleCreateManyInput[];
  permissions: Prisma.PermissionCreateManyInput[];
  rolePermissions: Prisma.RolePermissionCreateManyInput[];
  roleAssignments: Prisma.RoleAssignmentCreateManyInput[];
  terminologyCodes: Prisma.TerminologyCodeCreateManyInput[];
  payers: Prisma.PayerCreateManyInput[];
  patients: Prisma.PatientCreateManyInput[];
  patientIdentifiers: Prisma.PatientIdentifierCreateManyInput[];
  relatedPersons: Prisma.RelatedPersonCreateManyInput[];
  coverages: Prisma.CoverageCreateManyInput[];
  consentGrants: Prisma.ConsentGrantCreateManyInput[];
  appointments: Prisma.AppointmentCreateManyInput[];
  appointmentStatusHistory: Prisma.AppointmentStatusHistoryCreateManyInput[];
  encounters: Prisma.EncounterCreateManyInput[];
  clinicalNotes: Prisma.ClinicalNoteCreateManyInput[];
  noteAddenda: Prisma.NoteAddendumCreateManyInput[];
  conditions: Prisma.ConditionCreateManyInput[];
  allergies: Prisma.AllergyIntoleranceCreateManyInput[];
  medicationStatements: Prisma.MedicationStatementCreateManyInput[];
  medicationRequests: Prisma.MedicationRequestCreateManyInput[];
  immunizations: Prisma.ImmunizationCreateManyInput[];
  observations: Prisma.ObservationCreateManyInput[];
  serviceRequests: Prisma.ServiceRequestCreateManyInput[];
  specimens: Prisma.SpecimenCreateManyInput[];
  diagnosticReports: Prisma.DiagnosticReportCreateManyInput[];
  resultObservations: Prisma.ResultObservationCreateManyInput[];
  documents: Prisma.DocumentCreateManyInput[];
  tasks: Prisma.TaskCreateManyInput[];
  messageThreads: Prisma.MessageThreadCreateManyInput[];
  messages: Prisma.MessageCreateManyInput[];
  formDefinitions: Prisma.FormDefinitionCreateManyInput[];
  formSubmissions: Prisma.FormSubmissionCreateManyInput[];
  formPromotedValues: Prisma.FormPromotedValueCreateManyInput[];
  chargeItems: Prisma.ChargeItemCreateManyInput[];
  claims: Prisma.ClaimCreateManyInput[];
  claimLines: Prisma.ClaimLineCreateManyInput[];
  claimStatusHistory: Prisma.ClaimStatusHistoryCreateManyInput[];
  remittances: Prisma.RemittanceCreateManyInput[];
  remittanceLines: Prisma.RemittanceLineCreateManyInput[];
  payments: Prisma.PaymentCreateManyInput[];
  paymentAllocations: Prisma.PaymentAllocationCreateManyInput[];
  statements: Prisma.StatementCreateManyInput[];
  auditEvents: Prisma.AuditEventCreateManyInput[];
}

// ---------------------------------------------------------------------------
// Fixed catalogues. Codes are real code-system identifiers so the demo is
// clinically coherent, but no code content is vendored: display text here is a
// convenience cache, exactly as it is for a real tenant that has not loaded a
// licensed terminology.
// ---------------------------------------------------------------------------

const PATIENT_NAMES: readonly (readonly [string, string, string, 'FEMALE' | 'MALE'])[] = [
  ['Testina', 'Patientsson', '1991-04-17', 'FEMALE'],
  ['Exampla', 'Testperson', '1978-11-02', 'FEMALE'],
  ['Placeholder', 'Nullsson', '1965-06-23', 'MALE'],
  ['Demonstra', 'Fixtureby', '2004-01-09', 'FEMALE'],
  ['Sampleton', 'Mockford', '1952-09-30', 'MALE'],
  ['Fictitia', 'Notreal', '1988-03-14', 'FEMALE'],
  ['Dummonde', 'Stubbins', '1996-12-05', 'MALE'],
  ['Syntheta', 'Fakeley', '1971-07-19', 'FEMALE'],
  ['Prototypo', 'Sandboxer', '2010-02-28', 'MALE'],
  ['Simula', 'Testarossa', '1983-05-11', 'FEMALE'],
  ['Lorem', 'Ipsumsen', '1959-10-08', 'MALE'],
  ['Quinta', 'Examplebury', '2000-08-21', 'FEMALE'],
  ['Mockingham', 'Placeholme', '1974-04-03', 'MALE'],
  ['Trialla', 'Rehearsby', '1993-01-26', 'FEMALE'],
  ['Stubbert', 'Cassidental', '1961-11-15', 'MALE'],
  ['Verifia', 'Assertson', '2015-06-07', 'FEMALE'],
  ['Regressa', 'Suiteman', '1986-09-12', 'FEMALE'],
  ['Fixturo', 'Seedwell', '1969-03-29', 'MALE'],
  ['Anonyma', 'Redactor', '1998-12-18', 'FEMALE'],
  ['Canonica', 'Baselineby', '1955-05-24', 'MALE'],
];

const CONDITIONS: readonly (readonly [string, string, string])[] = [
  ['J45.909', 'Unspecified asthma, uncomplicated', '195967001'],
  ['E11.9', 'Type 2 diabetes mellitus without complications', '44054006'],
  ['I10', 'Essential (primary) hypertension', '59621000'],
  ['M54.50', 'Low back pain, unspecified', '279039007'],
  ['F41.1', 'Generalized anxiety disorder', '21897009'],
  ['K21.9', 'Gastro-oesophageal reflux disease without oesophagitis', '235595009'],
];

const MEDICATIONS: readonly (readonly [string, string, string, number, string])[] = [
  [
    '745679',
    'Albuterol 90 mcg/actuation inhaler',
    'Inhale 2 puffs every 6 hours as needed',
    1,
    'inhaler',
  ],
  [
    '860975',
    'Metformin 500 mg oral tablet',
    'Take 1 tablet by mouth twice daily with food',
    60,
    'tablet',
  ],
  ['197361', 'Lisinopril 10 mg oral tablet', 'Take 1 tablet by mouth once daily', 30, 'tablet'],
  [
    '310965',
    'Ibuprofen 600 mg oral tablet',
    'Take 1 tablet by mouth every 8 hours as needed',
    30,
    'tablet',
  ],
];

const ALLERGIES: readonly (readonly [
  string,
  string,
  string,
  'LOW' | 'HIGH',
  'MILD' | 'MODERATE' | 'SEVERE',
])[] = [
  ['7980', 'Penicillin G', '271807003', 'HIGH', 'SEVERE'],
  ['1191', 'Aspirin', '247472004', 'LOW', 'MILD'],
  ['5640', 'Ibuprofen', '41291007', 'HIGH', 'MODERATE'],
];

const VACCINES: readonly (readonly [string, string])[] = [
  ['150', 'Influenza, injectable, quadrivalent'],
  ['213', 'SARS-COV-2 vaccine, unspecified'],
];

/**
 * LOINC code, display, UCUM unit, base value, per-patient step.
 *
 * These, and the panels below, are real LOINC codes with their published names.
 * That is deliberate and it is allowed: LOINC may be redistributed provided the
 * copyright notice travels with it, which is why `THIRD-PARTY-NOTICES.md` at
 * the repository root carries the Regenstrief notice and names this file. If
 * you add a LOINC code here, check that notice still describes what ships.
 */
const VITALS: readonly (readonly [string, string, string, number, number])[] = [
  ['8867-4', 'Heart rate', '/min', 68, 1],
  ['8480-6', 'Systolic blood pressure', 'mm[Hg]', 112, 2],
  ['8462-4', 'Diastolic blood pressure', 'mm[Hg]', 68, 1],
  ['29463-7', 'Body weight', 'kg', 62, 3],
];

const LAB_PANELS: readonly {
  code: string;
  display: string;
  results: readonly (readonly [string, string, string, number, number, number])[];
}[] = [
  {
    code: '58410-2',
    display: 'CBC panel - blood by automated count',
    results: [
      ['718-7', 'Haemoglobin [Mass/volume] in Blood', 'g/dL', 13.4, 12, 16],
      ['789-8', 'Erythrocytes [#/volume] in Blood', '10*6/uL', 4.6, 4.2, 5.4],
    ],
  },
  {
    code: '24323-8',
    display: 'Comprehensive metabolic panel - serum or plasma',
    results: [
      ['2345-7', 'Glucose [Mass/volume] in Serum or Plasma', 'mg/dL', 92, 70, 99],
      ['2160-0', 'Creatinine [Mass/volume] in Serum or Plasma', 'mg/dL', 0.9, 0.6, 1.2],
    ],
  },
];

/**
 * The demo's procedure vocabulary, invented from end to end.
 *
 * These codes are not a real procedure code set and must never be replaced by
 * one. The published procedure code sets a clinic bills against are licensed
 * content: the publisher charges for the descriptors and controls who may
 * redistribute them. This seed ships in every self-hosted deployment of an
 * AGPL project, so committing real descriptors here would redistribute
 * somebody else's licensed vocabulary to everybody who clones the repository,
 * and would contradict what `packages/terminology/README.md` promises about
 * this repository. An earlier revision of this file did exactly that; it was
 * removed on purpose, so please do not helpfully put it back.
 *
 * The URI is under `example.invalid`, a domain the IETF reserved so that it can
 * never resolve, which is the same convention
 * `packages/terminology/src/test-support/fixture.ts` uses for the same reason.
 * A deployment that holds a licence for a real procedure set loads its own
 * release through `@openrunic/terminology`; that is what the package is for.
 *
 * Only the values are invented. The shape is untouched and is the part the
 * demo and the tests read: one coded procedure on the charge, the same code on
 * the claim line, and the same code again on the remittance line, so a
 * reconciliation still matches the way it would in a real practice.
 */
const PROCEDURE_SYSTEM = 'http://example.invalid/fs/demo-procedures';

/** The visit every demo encounter is billed as. */
const OFFICE_VISIT_CODE = 'DEMO-VISIT-3';
const OFFICE_VISIT_DISPLAY = 'Demo established-patient office visit';

/** The draw that pays for the demo lab panels. */
const BLOOD_DRAW_CODE = 'DEMO-DRAW-1';
const BLOOD_DRAW_DISPLAY = 'Demo blood draw';

const LOINC_SYSTEM = 'http://loinc.org';
const ICD10_SYSTEM = 'http://hl7.org/fhir/sid/icd-10-cm';
const RXNORM_SYSTEM = 'http://www.nlm.nih.gov/research/umls/rxnorm';
const SNOMED_SYSTEM = 'http://snomed.info/sct';

/** The intake form's promoted fields; the demo's proof that promotion works. */
const INTAKE_MANIFEST: PromotionManifest = {
  definitionKey: 'intake-vitals',
  definitionVersion: 1,
  fields: [
    { fieldKey: 'painScore', type: 'number' },
    { fieldKey: 'smokingStatus', type: 'code', codeSystem: SNOMED_SYSTEM },
    { fieldKey: 'exerciseMinutesPerWeek', type: 'number' },
  ],
};

// ---------------------------------------------------------------------------

/** Cycles a catalogue by index, so every patient's data is a pure function of their position. */
function pick<T>(catalogue: readonly T[], index: number): T {
  const entry = catalogue[index % catalogue.length];
  if (entry === undefined) {
    throw new Error('buildDemoPractice: catalogue is empty');
  }
  return entry;
}

function isoDate(value: Date): Date {
  return new Date(`${value.toISOString().slice(0, 10)}T00:00:00.000Z`);
}

/**
 * Builds the whole practice in memory.
 *
 * Pure: no clock, no randomness, no IO. `seedDemoPractice` is the only part
 * that touches a database, which keeps this function testable and keeps the
 * fixtures usable by consumers that just want realistic objects.
 */
export function buildDemoPractice(options: DemoPracticeOptions = {}): DemoPractice {
  const today = options.today ?? DEFAULT_TODAY;
  const patientCount = Math.min(options.patientCount ?? 20, PATIENT_NAMES.length);

  // A fixed clock and a fixed byte source: same ids on every run, and they
  // still sort in creation order because they are real UUIDv7 values.
  let clock = today.getTime() - 30 * DAY;
  const nextId = createUuidv7({
    now: () => {
      clock += 1;
      return clock;
    },
    randomBytes: (size) =>
      Uint8Array.from({ length: size }, (_unused, index) => (index * 37 + 11) % 256),
  });

  const organisationId = nextId();
  const tenantId = organisationId;
  const createdAt = new Date(today.getTime() - 30 * DAY);

  const organisation: Prisma.OrganisationCreateManyInput = {
    id: organisationId,
    slug: 'runic-demo-practice',
    name: 'Runic Demo Family Practice',
    mode: 'SELF_HOST',
    status: 'ACTIVE',
    timezone: 'America/Los_Angeles',
    flags: { demoData: true },
    createdAt,
  };

  // --- Facilities ---------------------------------------------------------

  const mainId = nextId();
  const annexId = nextId();
  const facilities: Prisma.FacilityCreateManyInput[] = [
    {
      id: mainId,
      tenantId,
      name: 'Springfield Main Clinic',
      code: 'SPR',
      npi: '1999999984',
      posCode: '11',
      timezone: 'America/Los_Angeles',
      addressLine1: '100 Example Parkway',
      city: 'Springfield',
      state: 'OR',
      postalCode: '97477',
      phone: '+15550100100',
      createdAt,
    },
    {
      id: annexId,
      tenantId,
      name: 'Riverbend Annex',
      code: 'RIV',
      npi: '1999999976',
      posCode: '11',
      timezone: 'America/Los_Angeles',
      addressLine1: '22 Placeholder Road',
      city: 'Riverbend',
      state: 'OR',
      postalCode: '97401',
      phone: '+15550100200',
      createdAt,
    },
  ];
  const facilityIds = [mainId, annexId] as const;

  // --- Users --------------------------------------------------------------

  const okaforId = nextId();
  const testbergId = nextId();
  const nursemanId = nextId();
  const frontDeskId = nextId();
  const billerId = nextId();

  const users: Prisma.UserCreateManyInput[] = [
    {
      id: okaforId,
      tenantId,
      email: 'a.okafor@demo.invalid',
      givenName: 'Adaeze',
      familyName: 'Okafor',
      credential: 'MD',
      npi: '1999999968',
      taxonomyCode: '207Q00000X',
      isProvider: true,
      status: 'ACTIVE',
      createdAt,
    },
    {
      id: testbergId,
      tenantId,
      email: 'b.testberg@demo.invalid',
      givenName: 'Bjorn',
      familyName: 'Testberg',
      credential: 'MD',
      npi: '1999999950',
      taxonomyCode: '207R00000X',
      isProvider: true,
      status: 'ACTIVE',
      createdAt,
    },
    {
      id: nursemanId,
      tenantId,
      email: 'p.nurseman@demo.invalid',
      givenName: 'Practika',
      familyName: 'Nurseman',
      credential: 'NP',
      npi: '1999999943',
      taxonomyCode: '363L00000X',
      isProvider: true,
      status: 'ACTIVE',
      createdAt,
    },
    {
      id: frontDeskId,
      tenantId,
      email: 'f.deskly@demo.invalid',
      givenName: 'Fronta',
      familyName: 'Deskly',
      isProvider: false,
      status: 'ACTIVE',
      createdAt,
    },
    {
      id: billerId,
      tenantId,
      email: 'r.claimsworth@demo.invalid',
      givenName: 'Reva',
      familyName: 'Claimsworth',
      isProvider: false,
      status: 'ACTIVE',
      createdAt,
    },
  ];
  const providerIds = [okaforId, testbergId, nursemanId] as const;

  const userFacilities: Prisma.UserFacilityCreateManyInput[] = users.flatMap((user, index) =>
    facilityIds.map((facilityId, facilityIndex) => ({
      id: nextId(),
      tenantId,
      userId: String(user.id),
      facilityId,
      isPrimary: facilityIndex === index % facilityIds.length,
      createdAt,
    }))
  );

  // --- Roles and permissions ---------------------------------------------

  const permissionKeys = [
    'patient.read',
    'patient.write',
    'encounter.write',
    'note.sign',
    'order.place',
    'result.review',
    'claim.submit',
    'payment.post',
    'admin.manage',
  ] as const;

  const permissions: Prisma.PermissionCreateManyInput[] = permissionKeys.map((key) => ({
    id: nextId(),
    tenantId,
    key,
    description: `Permission to ${key.replace('.', ' ')}`,
    createdAt,
  }));

  const roleDefinitions = [
    { key: 'provider', name: 'Provider', grants: permissionKeys.slice(0, 6) },
    { key: 'front-desk', name: 'Front desk', grants: permissionKeys.slice(0, 2) },
    { key: 'biller', name: 'Biller', grants: ['patient.read', 'claim.submit', 'payment.post'] },
    { key: 'administrator', name: 'Administrator', grants: permissionKeys },
  ] as const;

  const roles: Prisma.RoleCreateManyInput[] = roleDefinitions.map((role) => ({
    id: nextId(),
    tenantId,
    key: role.key,
    name: role.name,
    isSystem: true,
    createdAt,
  }));

  const roleIdByKey = new Map(
    roleDefinitions.map((role, index) => [role.key, String(roles[index]?.id)])
  );
  const permissionIdByKey = new Map(
    permissionKeys.map((key, index) => [key, String(permissions[index]?.id)])
  );

  const rolePermissions: Prisma.RolePermissionCreateManyInput[] = roleDefinitions.flatMap((role) =>
    role.grants.map((grant) => ({
      id: nextId(),
      tenantId,
      roleId: roleIdByKey.get(role.key) ?? '',
      permissionId: permissionIdByKey.get(grant) ?? '',
      createdAt,
    }))
  );

  const roleAssignments: Prisma.RoleAssignmentCreateManyInput[] = [
    ...providerIds.map((userId) => ({
      id: nextId(),
      tenantId,
      userId,
      roleId: roleIdByKey.get('provider') ?? '',
      createdAt,
    })),
    {
      id: nextId(),
      tenantId,
      userId: frontDeskId,
      roleId: roleIdByKey.get('front-desk') ?? '',
      createdAt,
    },
    {
      id: nextId(),
      tenantId,
      userId: billerId,
      roleId: roleIdByKey.get('biller') ?? '',
      createdAt,
    },
    {
      id: nextId(),
      tenantId,
      userId: okaforId,
      roleId: roleIdByKey.get('administrator') ?? '',
      createdAt,
    },
  ];

  // --- Terminology --------------------------------------------------------

  const terminologyCodes: Prisma.TerminologyCodeCreateManyInput[] = [
    ...CONDITIONS.map(([code, display]) => ({
      id: nextId(),
      tenantId,
      system: ICD10_SYSTEM,
      code,
      display,
      createdAt,
    })),
    ...VITALS.map(([code, display]) => ({
      id: nextId(),
      tenantId,
      system: LOINC_SYSTEM,
      code,
      display,
      createdAt,
    })),
    ...LAB_PANELS.map((panel) => ({
      id: nextId(),
      tenantId,
      system: LOINC_SYSTEM,
      code: panel.code,
      display: panel.display,
      createdAt,
    })),
    ...MEDICATIONS.map(([code, display]) => ({
      id: nextId(),
      tenantId,
      system: RXNORM_SYSTEM,
      code,
      display,
      createdAt,
    })),
    {
      id: nextId(),
      tenantId,
      system: PROCEDURE_SYSTEM,
      code: OFFICE_VISIT_CODE,
      display: OFFICE_VISIT_DISPLAY,
      createdAt,
    },
    {
      id: nextId(),
      tenantId,
      system: PROCEDURE_SYSTEM,
      code: BLOOD_DRAW_CODE,
      display: BLOOD_DRAW_DISPLAY,
      createdAt,
    },
  ];

  // --- Payers -------------------------------------------------------------

  const mutualId = nextId();
  const medicaidId = nextId();
  const payers: Prisma.PayerCreateManyInput[] = [
    {
      id: mutualId,
      tenantId,
      name: 'Placeholder Mutual Health',
      x12PayerId: 'PMH01',
      claimFilingCode: 'CI',
      addressLine1: 'PO Box 1000',
      city: 'Springfield',
      state: 'OR',
      postalCode: '97477',
      createdAt,
    },
    {
      id: medicaidId,
      tenantId,
      name: 'Example State Medicaid',
      x12PayerId: 'ESM99',
      claimFilingCode: 'MC',
      addressLine1: 'PO Box 2000',
      city: 'Salem',
      state: 'OR',
      postalCode: '97301',
      createdAt,
    },
  ];
  const payerIds = [mutualId, medicaidId] as const;

  // --- Form engine --------------------------------------------------------

  const intakeFormId = nextId();
  const formDefinitions: Prisma.FormDefinitionCreateManyInput[] = [
    {
      id: intakeFormId,
      tenantId,
      key: 'intake-vitals',
      version: 1,
      status: 'PUBLISHED',
      title: 'Visit intake',
      description: 'Pain, tobacco use and activity, captured by the patient before the visit.',
      bindTo: 'PORTAL',
      definition: {
        fields: [
          { key: 'painScore', type: 'number', label: 'Pain today (0-10)', min: 0, max: 10 },
          {
            key: 'smokingStatus',
            type: 'code',
            label: 'Tobacco use',
            valueSet: [
              { code: '266919005', display: 'Never smoked tobacco' },
              { code: '77176002', display: 'Current smoker' },
              { code: '8517006', display: 'Former smoker' },
            ],
          },
          { key: 'exerciseMinutesPerWeek', type: 'number', label: 'Minutes of exercise per week' },
        ],
      },
      compiled: {
        generator: 'seed',
        note: 'Compiled artefacts are produced by the form compiler.',
      },
      promotionManifest: {
        definitionKey: INTAKE_MANIFEST.definitionKey,
        definitionVersion: INTAKE_MANIFEST.definitionVersion,
        fields: INTAKE_MANIFEST.fields.map((field) => ({ ...field })),
      },
      publishedAt: createdAt,
      publishedById: okaforId,
      createdAt,
    },
  ];

  // --- Per-patient clinical record ---------------------------------------

  const patients: Prisma.PatientCreateManyInput[] = [];
  const patientIdentifiers: Prisma.PatientIdentifierCreateManyInput[] = [];
  const relatedPersons: Prisma.RelatedPersonCreateManyInput[] = [];
  const coverages: Prisma.CoverageCreateManyInput[] = [];
  const consentGrants: Prisma.ConsentGrantCreateManyInput[] = [];
  const appointments: Prisma.AppointmentCreateManyInput[] = [];
  const appointmentStatusHistory: Prisma.AppointmentStatusHistoryCreateManyInput[] = [];
  const encounters: Prisma.EncounterCreateManyInput[] = [];
  const clinicalNotes: Prisma.ClinicalNoteCreateManyInput[] = [];
  const noteAddenda: Prisma.NoteAddendumCreateManyInput[] = [];
  const conditions: Prisma.ConditionCreateManyInput[] = [];
  const allergies: Prisma.AllergyIntoleranceCreateManyInput[] = [];
  const medicationStatements: Prisma.MedicationStatementCreateManyInput[] = [];
  const medicationRequests: Prisma.MedicationRequestCreateManyInput[] = [];
  const immunizations: Prisma.ImmunizationCreateManyInput[] = [];
  const observations: Prisma.ObservationCreateManyInput[] = [];
  const serviceRequests: Prisma.ServiceRequestCreateManyInput[] = [];
  const specimens: Prisma.SpecimenCreateManyInput[] = [];
  const diagnosticReports: Prisma.DiagnosticReportCreateManyInput[] = [];
  const resultObservations: Prisma.ResultObservationCreateManyInput[] = [];
  const documents: Prisma.DocumentCreateManyInput[] = [];
  const tasks: Prisma.TaskCreateManyInput[] = [];
  const messageThreads: Prisma.MessageThreadCreateManyInput[] = [];
  const messages: Prisma.MessageCreateManyInput[] = [];
  const formSubmissions: Prisma.FormSubmissionCreateManyInput[] = [];
  const formPromotedValues: Prisma.FormPromotedValueCreateManyInput[] = [];
  const chargeItems: Prisma.ChargeItemCreateManyInput[] = [];
  const claims: Prisma.ClaimCreateManyInput[] = [];
  const claimLines: Prisma.ClaimLineCreateManyInput[] = [];
  const claimStatusHistory: Prisma.ClaimStatusHistoryCreateManyInput[] = [];
  const remittances: Prisma.RemittanceCreateManyInput[] = [];
  const remittanceLines: Prisma.RemittanceLineCreateManyInput[] = [];
  const payments: Prisma.PaymentCreateManyInput[] = [];
  const paymentAllocations: Prisma.PaymentAllocationCreateManyInput[] = [];
  const statements: Prisma.StatementCreateManyInput[] = [];

  /** Events accumulated as rows are built, then chained in one pass at the end. */
  const auditDrafts: {
    occurredAt: Date;
    actorId: string;
    action: string;
    targetType: string;
    targetId: string;
    patientId?: string;
  }[] = [];

  for (let index = 0; index < patientCount; index += 1) {
    const [givenName, familyName, birthDate, sexAtBirth] = pick(PATIENT_NAMES, index);
    const patientId = nextId();
    const facilityId = facilityIds[index % facilityIds.length] ?? mainId;
    const providerId = providerIds[index % providerIds.length] ?? okaforId;
    const mrn = `OR-${100_482 + index}`;

    patients.push({
      id: patientId,
      tenantId,
      mrn,
      primaryFacilityId: facilityId,
      givenName,
      familyName,
      birthDate: new Date(`${birthDate}T00:00:00.000Z`),
      sexAtBirth,
      languageCode: index % 7 === 0 ? 'es' : 'en',
      email: `${givenName.toLowerCase()}.${familyName.toLowerCase()}@example.invalid`,
      phoneMobile: `+1555${String(100_482 + index).padStart(7, '0')}`,
      addressLine1: `${index + 1} Fixture Lane`,
      city: index % 2 === 0 ? 'Springfield' : 'Riverbend',
      state: 'OR',
      postalCode: index % 2 === 0 ? '97477' : '97401',
      portalEnabled: index % 3 !== 2,
      createdAt,
    });

    patientIdentifiers.push({
      id: nextId(),
      tenantId,
      patientId,
      use: 'SECONDARY',
      system: 'urn:openrunic:demo:legacy-mrn',
      value: `LEGACY-${9_000 + index}`,
      typeCode: 'MR',
      createdAt,
    });

    // Minors get a guardian; everyone else gets an emergency contact.
    const birthYear = Number(birthDate.slice(0, 4));
    const isMinor = today.getUTCFullYear() - birthYear < 18;
    relatedPersons.push({
      id: nextId(),
      tenantId,
      patientId,
      relationshipCode: isMinor ? 'MTH' : 'C',
      givenName: isMinor ? 'Guardia' : 'Emergensia',
      familyName,
      phone: `+1555${String(200_482 + index).padStart(7, '0')}`,
      isGuardian: isMinor,
      isEmergencyContact: true,
      isPortalProxy: isMinor,
      createdAt,
    });

    // Two patients in twenty are self-pay, which the billing screens need. The
    // index is even so those two also land in the seen-already half below, and
    // therefore actually reach the statement branch.
    const isSelfPay = index % 10 === 8;
    let coverageId: string | undefined;
    if (!isSelfPay) {
      coverageId = nextId();
      coverages.push({
        id: coverageId,
        tenantId,
        patientId,
        payerId: payerIds[index % payerIds.length] ?? mutualId,
        rank: 'PRIMARY',
        status: 'ACTIVE',
        memberId: `MEM${String(4_471_102 + index)}`,
        groupNumber: 'GRP-0001',
        planName: index % 2 === 0 ? 'Placeholder PPO Standard' : 'Example Medicaid Managed',
        subscriberRelationshipCode: 'self',
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        copayCents: index % 2 === 0 ? 2_500 : 0,
        createdAt,
      });
    }

    consentGrants.push({
      id: nextId(),
      tenantId,
      patientId,
      scope: 'TREATMENT',
      status: 'ACTIVE',
      effectiveFrom: createdAt,
      recordedById: frontDeskId,
      createdAt,
    });

    // --- Problems, allergies, medications, immunisations -------------------

    const conditionCount = 1 + (index % 2);
    for (let offset = 0; offset < conditionCount; offset += 1) {
      const [code, display, snomed] = pick(CONDITIONS, index + offset);
      conditions.push({
        id: nextId(),
        tenantId,
        patientId,
        category: 'PROBLEM_LIST_ITEM',
        code,
        codeSystem: ICD10_SYSTEM,
        display,
        snomedCode: snomed,
        clinicalStatus: 'ACTIVE',
        verificationStatus: 'CONFIRMED',
        onsetDate: isoDate(new Date(today.getTime() - (400 + index * 11) * DAY)),
        recordedAt: createdAt,
        recordedById: providerId,
        createdAt,
      });
    }

    if (index % 3 === 0) {
      const [substanceCode, substanceDisplay, reactionCode, criticality, severity] = pick(
        ALLERGIES,
        index / 3
      );
      allergies.push({
        id: nextId(),
        tenantId,
        patientId,
        type: 'ALLERGY',
        category: 'MEDICATION',
        criticality,
        clinicalStatus: 'ACTIVE',
        substanceCode,
        substanceCodeSystem: RXNORM_SYSTEM,
        substanceDisplay,
        reactionCodes: [reactionCode],
        severity,
        recordedAt: createdAt,
        recordedById: providerId,
        createdAt,
      });
    }

    const [rxnormCode, medDisplay, sigText, quantity, quantityUnit] = pick(MEDICATIONS, index);
    medicationStatements.push({
      id: nextId(),
      tenantId,
      patientId,
      rxnormCode,
      display: medDisplay,
      sigText,
      status: 'ACTIVE',
      source: 'REPORTED',
      reportedAt: createdAt,
      createdAt,
    });

    if (index % 2 === 0) {
      const [vaccineCode, vaccineDisplay] = pick(VACCINES, index / 2);
      immunizations.push({
        id: nextId(),
        tenantId,
        patientId,
        status: 'COMPLETED',
        cvxCode: vaccineCode,
        display: vaccineDisplay,
        lotNumber: `LOT-${1_000 + index}`,
        doseQuantity: 0.5,
        doseUnit: 'mL',
        administeredAt: new Date(today.getTime() - (60 + index) * DAY),
        administeredById: nursemanId,
        createdAt,
      });
    }

    // --- Appointment, encounter, note --------------------------------------

    // Half the panel has already been seen; the rest fills the coming week, so
    // the schedule, the Flow Board and the chart all have something to show.
    const isPast = index % 2 === 0;
    const dayOffset = isPast ? -(1 + (index % 5)) : 1 + (index % 5);
    const startHour = 9 + (index % 7);
    const start = new Date(today.getTime() + dayOffset * DAY + startHour * HOUR);
    const durationMinutes = 20;
    const end = new Date(start.getTime() + durationMinutes * MINUTE);

    const appointmentId = nextId();
    appointments.push({
      id: appointmentId,
      tenantId,
      facilityId,
      patientId,
      providerId,
      typeCode: 'OV-20',
      typeDisplay: 'Office visit, 20 minutes',
      status: isPast ? 'FULFILLED' : 'BOOKED',
      start,
      end,
      durationMinutes,
      room: `Exam ${1 + (index % 4)}`,
      reasonText: pick(CONDITIONS, index)[1],
      createdVia: index % 5 === 0 ? 'PORTAL' : 'STAFF',
      checkedInAt: isPast ? new Date(start.getTime() - 8 * MINUTE) : null,
      createdById: frontDeskId,
      createdAt,
    });

    const historyStatuses = isPast
      ? ([
          'BOOKED',
          'ARRIVED',
          'CHECKED_IN',
          'ROOMED',
          'IN_PROGRESS',
          'CHECKED_OUT',
          'FULFILLED',
        ] as const)
      : (['BOOKED'] as const);
    historyStatuses.forEach((status, step) => {
      appointmentStatusHistory.push({
        id: nextId(),
        tenantId,
        appointmentId,
        status,
        occurredAt: new Date(start.getTime() + (step - 1) * 6 * MINUTE),
        byUserId: step === 0 ? frontDeskId : providerId,
        room: `Exam ${1 + (index % 4)}`,
        createdAt,
      });
    });

    if (!isPast) {
      // A future appointment has no chart activity yet, which is the point.
      continue;
    }

    const encounterId = nextId();
    encounters.push({
      id: encounterId,
      tenantId,
      facilityId,
      patientId,
      providerId,
      appointmentId,
      class: 'AMBULATORY',
      status: 'COMPLETED',
      reasonText: pick(CONDITIONS, index)[1],
      startedAt: start,
      endedAt: end,
      signedAt: new Date(end.getTime() + 2 * HOUR),
      signedById: providerId,
      createdAt: start,
    });

    auditDrafts.push({
      occurredAt: start,
      actorId: providerId,
      action: 'encounter.created',
      targetType: 'Encounter',
      targetId: encounterId,
      patientId,
    });

    const noteId = nextId();
    clinicalNotes.push({
      id: noteId,
      tenantId,
      patientId,
      encounterId,
      authorId: providerId,
      title: 'Office visit note',
      blocks: [
        { type: 'heading', text: 'Subjective' },
        { type: 'paragraph', text: `Follow-up for ${pick(CONDITIONS, index)[1].toLowerCase()}.` },
        { type: 'heading', text: 'Objective' },
        { type: 'vitals-ref', encounterId },
        { type: 'heading', text: 'Assessment and plan' },
        { type: 'paragraph', text: 'Stable. Continue current therapy and review in three months.' },
      ],
      state: 'SIGNED',
      signedAt: new Date(end.getTime() + 2 * HOUR),
      signedById: providerId,
      lockedAt: new Date(end.getTime() + 2 * HOUR),
      createdAt: start,
    });

    // One note in the demo carries an addendum, so the amend path has data.
    if (index === 0) {
      noteAddenda.push({
        id: nextId(),
        tenantId,
        noteId,
        authorId: providerId,
        blocks: [{ type: 'paragraph', text: 'Corrected inhaler technique documented.' }],
        reason: 'Correction',
        signedAt: new Date(end.getTime() + 26 * HOUR),
        createdAt: new Date(end.getTime() + 26 * HOUR),
      });
    }

    // --- Vitals -------------------------------------------------------------

    VITALS.forEach(([loincCode, display, unit, base, step]) => {
      observations.push({
        id: nextId(),
        tenantId,
        patientId,
        encounterId,
        category: 'VITAL_SIGNS',
        status: 'FINAL',
        loincCode,
        code: loincCode,
        codeSystem: LOINC_SYSTEM,
        display,
        valueNumber: base + (index % 9) * step,
        unit,
        effectiveAt: new Date(start.getTime() + 4 * MINUTE),
        performerId: nursemanId,
        createdAt: start,
      });
    });

    // --- Portal intake form, with promotion --------------------------------

    if (index % 2 === 0) {
      const submissionId = nextId();
      const submissionValues = {
        painScore: index % 8,
        smokingStatus: index % 4 === 0 ? '266919005' : '8517006',
        exerciseMinutesPerWeek: 60 + (index % 5) * 30,
      };
      const effectiveAt = new Date(start.getTime() - 30 * MINUTE);
      formSubmissions.push({
        id: submissionId,
        tenantId,
        formDefinitionId: intakeFormId,
        patientId,
        encounterId,
        status: 'COMPLETED',
        values: submissionValues,
        completedByType: 'PATIENT',
        completedAt: effectiveAt,
        effectiveAt,
        createdAt: effectiveAt,
      });

      for (const row of promoteSubmission(
        INTAKE_MANIFEST,
        {
          id: submissionId,
          tenantId,
          formDefinitionId: intakeFormId,
          patientId,
          effectiveAt,
          values: submissionValues,
        },
        { generateId: nextId }
      )) {
        formPromotedValues.push({ ...row, createdAt: effectiveAt });
      }
    }

    // --- Prescription -------------------------------------------------------

    medicationRequests.push({
      id: nextId(),
      tenantId,
      patientId,
      encounterId,
      prescriberId: providerId,
      rxnormCode,
      display: medDisplay,
      sig: { text: sigText },
      sigText,
      quantity,
      quantityUnit,
      refills: index % 4,
      daysSupply: 30,
      status: 'TRANSMITTED',
      intent: 'ORDER',
      pharmacyName: 'Example Community Pharmacy',
      writtenAt: end,
      transmittedAt: new Date(end.getTime() + 5 * MINUTE),
      createdAt: end,
    });

    // --- Lab order, specimen, report, results ------------------------------

    if (index % 3 === 0) {
      const panel = pick(LAB_PANELS, index / 3);
      const orderId = nextId();
      const specimenId = nextId();
      const reportId = nextId();
      const collectedAt = new Date(end.getTime() + 20 * MINUTE);
      const issuedAt = new Date(end.getTime() + 20 * HOUR);
      // Every third ordering patient gets an abnormal result, so the sign-off
      // queue and the abnormal-flag styling both have something to render.
      const abnormal = index % 9 === 0;

      serviceRequests.push({
        id: orderId,
        tenantId,
        patientId,
        encounterId,
        orderedById: providerId,
        category: 'LAB',
        status: 'RESULTED',
        intent: 'ORDER',
        priority: abnormal ? 'URGENT' : 'ROUTINE',
        code: panel.code,
        codeSystem: LOINC_SYSTEM,
        display: panel.display,
        specimenTypeCode: '119297000',
        reasonCodes: [pick(CONDITIONS, index)[0]],
        requisitionNumber: `REQ-${10_000 + index}`,
        performingLabName: 'Example Reference Laboratory',
        requestedAt: end,
        transmittedAt: new Date(end.getTime() + 10 * MINUTE),
        createdAt: end,
      });

      specimens.push({
        id: specimenId,
        tenantId,
        patientId,
        serviceRequestId: orderId,
        status: 'AVAILABLE',
        accessionNumber: `ACC-${20_000 + index}`,
        typeCode: '119297000',
        typeDisplay: 'Blood specimen',
        collectedAt,
        collectedById: nursemanId,
        receivedAt: new Date(collectedAt.getTime() + 3 * HOUR),
        containerType: 'EDTA tube',
        volumeValue: 4,
        volumeUnit: 'mL',
        createdAt: collectedAt,
      });

      diagnosticReports.push({
        id: reportId,
        tenantId,
        patientId,
        encounterId,
        serviceRequestId: orderId,
        specimenId,
        status: 'FINAL',
        category: 'LAB',
        code: panel.code,
        codeSystem: LOINC_SYSTEM,
        display: panel.display,
        performingLabName: 'Example Reference Laboratory',
        abnormalFlag: abnormal ? 'ABNORMAL' : 'NORMAL',
        effectiveAt: collectedAt,
        issuedAt,
        // Abnormal results are left unreviewed so the inbox has real work in it.
        reviewedById: abnormal ? null : providerId,
        reviewedAt: abnormal ? null : new Date(issuedAt.getTime() + 2 * HOUR),
        createdAt: issuedAt,
      });

      panel.results.forEach(([code, display, unit, value, low, high], resultIndex) => {
        const observedValue = abnormal && resultIndex === 0 ? low - 1 : value;
        resultObservations.push({
          id: nextId(),
          tenantId,
          diagnosticReportId: reportId,
          patientId,
          status: 'FINAL',
          sequence: resultIndex + 1,
          loincCode: code,
          code,
          codeSystem: LOINC_SYSTEM,
          display,
          valueNumber: observedValue,
          unit,
          referenceLow: low,
          referenceHigh: high,
          interpretationCode: observedValue < low ? 'L' : observedValue > high ? 'H' : 'N',
          abnormalFlag: observedValue < low || observedValue > high ? 'ABNORMAL' : 'NORMAL',
          effectiveAt: collectedAt,
          createdAt: issuedAt,
        });
      });

      documents.push({
        id: nextId(),
        tenantId,
        patientId,
        encounterId,
        category: '11502-2',
        title: `${panel.display} report`,
        storageKey: `tenants/${organisation.slug}/documents/report-${index}.pdf`,
        contentType: 'application/pdf',
        sha256: String(index).padStart(64, '0'),
        byteSize: 18_000 + index * 37,
        source: 'INTERFACE',
        status: 'FILED',
        receivedAt: issuedAt,
        filedAt: issuedAt,
        createdAt: issuedAt,
      });

      if (abnormal) {
        tasks.push({
          id: nextId(),
          tenantId,
          type: 'RESULT',
          status: 'OPEN',
          priority: 'HIGH',
          patientId,
          encounterId,
          subjectType: 'DiagnosticReport',
          subjectId: reportId,
          title: `Review abnormal ${panel.display}`,
          assigneeType: 'USER',
          assigneeUserId: providerId,
          dueAt: new Date(issuedAt.getTime() + 24 * HOUR),
          slaState: 'OK',
          sourceEventId: `seed:result-finalized:${reportId}`,
          createdAt: issuedAt,
        });
      }
    }

    // --- Charges, claim, payment -------------------------------------------

    const chargeId = nextId();
    const serviceDate = isoDate(start);
    const chargeCents = 14_500;
    chargeItems.push({
      id: chargeId,
      tenantId,
      facilityId,
      encounterId,
      patientId,
      code: OFFICE_VISIT_CODE,
      codeSystem: PROCEDURE_SYSTEM,
      display: OFFICE_VISIT_DISPLAY,
      modifiers: [],
      units: 1,
      unitPriceCents: chargeCents,
      totalPriceCents: chargeCents,
      diagnosisPointers: [1],
      renderingProviderId: providerId,
      placeOfServiceCode: '11',
      serviceDate,
      status: coverageId ? 'BILLED' : 'OPEN',
      createdAt: end,
    });

    if (!coverageId) {
      // Self-pay: no claim, a statement instead.
      statements.push({
        id: nextId(),
        tenantId,
        patientId,
        status: 'SENT',
        balanceCents: chargeCents,
        dunningCycle: 1,
        periodStart: serviceDate,
        periodEnd: serviceDate,
        generatedAt: new Date(end.getTime() + 3 * DAY),
        deliveredVia: 'EMAIL',
        deliveredAt: new Date(end.getTime() + 3 * DAY),
        createdAt: new Date(end.getTime() + 3 * DAY),
      });
      continue;
    }

    const claimId = nextId();
    const submittedAt = new Date(end.getTime() + DAY);
    // The two most recent billed encounters stay in flight so the A/R board is
    // not uniformly green.
    const isPaid = index % 4 !== 2;
    const allowedCents = 11_000;

    claims.push({
      id: claimId,
      tenantId,
      patientId,
      encounterId,
      coverageId,
      payerId: payerIds[index % payerIds.length] ?? mutualId,
      status: isPaid ? 'PAID' : 'SUBMITTED',
      frequency: 'ORIGINAL',
      diagnosisCodes: [pick(CONDITIONS, index)[0]],
      totalChargedCents: chargeCents,
      totalPaidCents: isPaid ? allowedCents : 0,
      totalAdjustedCents: isPaid ? chargeCents - allowedCents : 0,
      patientResponsibilityCents: isPaid ? 0 : chargeCents,
      controlNumbers: { st: `000${index + 1}`, payerClaim: isPaid ? `PMH-${index + 1}` : null },
      snapshot: { note: 'As-built 837P payload is produced by the X12 encoder.' },
      submittedAt,
      acknowledgedAt: new Date(submittedAt.getTime() + 2 * HOUR),
      adjudicatedAt: isPaid ? new Date(submittedAt.getTime() + 9 * DAY) : null,
      createdAt: end,
    });

    const claimLineId = nextId();
    claimLines.push({
      id: claimLineId,
      tenantId,
      claimId,
      chargeItemId: chargeId,
      sequence: 1,
      code: OFFICE_VISIT_CODE,
      codeSystem: PROCEDURE_SYSTEM,
      modifiers: [],
      units: 1,
      chargedCents: chargeCents,
      allowedCents: isPaid ? allowedCents : null,
      paidCents: isPaid ? allowedCents : 0,
      adjustedCents: isPaid ? chargeCents - allowedCents : 0,
      diagnosisPointers: [1],
      serviceDateFrom: serviceDate,
      createdAt: end,
    });

    const transitions: readonly (readonly [
      'DRAFT' | 'SCRUBBED' | 'SUBMITTED' | 'ACKNOWLEDGED' | 'PAID',
      string,
      number,
    ])[] = isPaid
      ? ([
          ['DRAFT', 'system', 0],
          ['SCRUBBED', 'system', 1],
          ['SUBMITTED', 'user', 2],
          ['ACKNOWLEDGED', '999', 3],
          ['PAID', '835', 4],
        ] as const)
      : ([
          ['DRAFT', 'system', 0],
          ['SCRUBBED', 'system', 1],
          ['SUBMITTED', 'user', 2],
        ] as const);

    for (const [status, source, step] of transitions) {
      claimStatusHistory.push({
        id: nextId(),
        tenantId,
        claimId,
        status,
        occurredAt: new Date(submittedAt.getTime() + step * HOUR),
        source,
        byUserId: source === 'user' ? billerId : null,
        createdAt: new Date(submittedAt.getTime() + step * HOUR),
      });
    }

    auditDrafts.push({
      occurredAt: submittedAt,
      actorId: billerId,
      action: 'claim.submitted',
      targetType: 'Claim',
      targetId: claimId,
      patientId,
    });

    if (isPaid) {
      const remittanceId = nextId();
      const paidAt = new Date(submittedAt.getTime() + 9 * DAY);
      remittances.push({
        id: remittanceId,
        tenantId,
        payerId: payerIds[index % payerIds.length] ?? mutualId,
        status: 'POSTED',
        checkOrEftNumber: `EFT-${30_000 + index}`,
        totalPaidCents: allowedCents,
        receivedAt: paidAt,
        paidAt,
        postedAt: paidAt,
        postedById: billerId,
        createdAt: paidAt,
      });

      remittanceLines.push({
        id: nextId(),
        tenantId,
        remittanceId,
        claimId,
        claimLineId,
        sequence: 1,
        payerControlNumber: `PMH-${index + 1}`,
        code: OFFICE_VISIT_CODE,
        chargedCents: chargeCents,
        allowedCents,
        paidCents: allowedCents,
        patientResponsibilityCents: 0,
        adjustmentGroupCode: 'CO',
        adjustmentReasonCode: '45',
        remarkCodes: [],
        serviceDateFrom: serviceDate,
        matched: true,
        createdAt: paidAt,
      });

      const paymentId = nextId();
      payments.push({
        id: paymentId,
        tenantId,
        payerId: payerIds[index % payerIds.length] ?? mutualId,
        remittanceId,
        source: 'PAYER_ERA',
        method: 'EFT',
        status: 'POSTED',
        amountCents: allowedCents,
        reference: `EFT-${30_000 + index}`,
        receivedAt: paidAt,
        postedAt: paidAt,
        postedById: billerId,
        createdAt: paidAt,
      });

      paymentAllocations.push(
        {
          id: nextId(),
          tenantId,
          paymentId,
          patientId,
          claimId,
          claimLineId,
          chargeItemId: chargeId,
          amountCents: allowedCents,
          appliedAt: paidAt,
          createdAt: paidAt,
        },
        {
          id: nextId(),
          tenantId,
          paymentId,
          patientId,
          claimId,
          claimLineId,
          chargeItemId: chargeId,
          amountCents: chargeCents - allowedCents,
          adjustmentGroupCode: 'CO',
          adjustmentReasonCode: '45',
          appliedAt: paidAt,
          note: 'Contractual adjustment',
          createdAt: paidAt,
        }
      );
    }
  }

  // --- One portal message thread, so the inbox has a message stream ---------

  const firstPatient = patients[0];
  if (firstPatient) {
    const threadId = nextId();
    const sentAt = new Date(today.getTime() - 2 * DAY + 10 * HOUR);
    messageThreads.push({
      id: threadId,
      tenantId,
      kind: 'PATIENT',
      patientId: String(firstPatient.id),
      subject: 'Question about inhaler technique',
      lastMessageAt: sentAt,
      createdAt: sentAt,
    });
    messages.push({
      id: nextId(),
      tenantId,
      threadId,
      senderType: 'PATIENT',
      senderPatientId: String(firstPatient.id),
      body: 'Should I keep using the spacer with the new inhaler?',
      sentAt,
      createdAt: sentAt,
    });
    tasks.push({
      id: nextId(),
      tenantId,
      type: 'MESSAGE',
      status: 'OPEN',
      priority: 'NORMAL',
      patientId: String(firstPatient.id),
      subjectType: 'MessageThread',
      subjectId: threadId,
      title: 'Reply: question about inhaler technique',
      assigneeType: 'TEAM',
      assigneeTeamKey: 'nursing',
      dueAt: new Date(sentAt.getTime() + 2 * DAY),
      slaState: 'AGING',
      sourceEventId: `seed:message-received:${threadId}`,
      createdAt: sentAt,
    });
  }

  // --- Audit chain ---------------------------------------------------------

  auditDrafts.unshift({
    occurredAt: createdAt,
    actorId: okaforId,
    action: 'organisation.created',
    targetType: 'Organisation',
    targetId: organisationId,
  });
  auditDrafts.sort((left, right) => left.occurredAt.getTime() - right.occurredAt.getTime());

  const auditEvents: Prisma.AuditEventCreateManyInput[] = [];
  let tail: { seq: bigint; hash: string } | null = null;
  for (const draft of auditDrafts) {
    const event = {
      tenantId,
      occurredAt: draft.occurredAt,
      actorType: 'user',
      actorId: draft.actorId,
      action: draft.action,
      targetType: draft.targetType,
      targetId: draft.targetId,
      patientId: draft.patientId ?? null,
      purposeOfUse: 'TREAT',
    };
    const link = linkAuditEvent(event, tail);
    auditEvents.push({ id: nextId(), ...event, ...link, createdAt: draft.occurredAt });
    tail = { seq: link.seq, hash: link.hash };
  }

  return {
    organisation,
    facilities,
    users,
    userFacilities,
    roles,
    permissions,
    rolePermissions,
    roleAssignments,
    terminologyCodes,
    payers,
    patients,
    patientIdentifiers,
    relatedPersons,
    coverages,
    consentGrants,
    appointments,
    appointmentStatusHistory,
    encounters,
    clinicalNotes,
    noteAddenda,
    conditions,
    allergies,
    medicationStatements,
    medicationRequests,
    immunizations,
    observations,
    serviceRequests,
    specimens,
    diagnosticReports,
    resultObservations,
    documents,
    tasks,
    messageThreads,
    messages,
    formDefinitions,
    formSubmissions,
    formPromotedValues,
    chargeItems,
    claims,
    claimLines,
    claimStatusHistory,
    remittances,
    remittanceLines,
    payments,
    paymentAllocations,
    statements,
    auditEvents,
  };
}
