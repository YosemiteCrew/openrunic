import { ApiError } from '../client';
import type {
  AdminClient,
  ApiKey,
  ApiScope,
  AuditEvent,
  AuditQuery,
  Facility,
  FormDefinition,
  FormFieldType,
  Integration,
  PermissionRow,
  PracticeDashboard,
  SmartApp,
  StaffRole,
  StaffUser,
  StaffUserQuery,
  VisitReport,
  VisitReportQuery,
  VisitReportRow,
  Webhook,
} from '../admin';
import type { ListResponse, ProblemDocument } from '../types';

import { MOCK_CLINIC_DAY, MOCK_FACILITY, MOCK_PROVIDERS } from './fixtures';
import { settle } from './protocol';

/**
 * Cedar Clinic's back office, as fixtures.
 *
 * Same rules as `fixtures.ts`: synthetic by construction, deterministic, no
 * `Date.now()`, no randomness. Identifiers are obviously invented (`OR-` MRNs,
 * `ork_demo_` key prefixes, RFC 1918 source addresses, a 99- tax prefix that no
 * real EIN uses), and nothing here may ever be seeded from a real record.
 *
 * It is written as a client rather than as loose constants so a screen reads
 * admin data exactly the way it reads patients: one contract, four states, and
 * the same swap to a live transport when those routes exist.
 */

function page<T>(rows: readonly T[]): ListResponse<T> {
  return {
    data: [...rows],
    page: { page: 1, pageSize: Math.max(rows.length, 1), total: rows.length, totalPages: 1 },
  };
}

const SECOND_FACILITY_ID = '0192f1a0-0000-7000-8000-00000000f002';
const THIRD_FACILITY_ID = '0192f1a0-0000-7000-8000-00000000f003';

/* -------------------------------------------------------------------------- */
/* Users and roles                                                             */
/* -------------------------------------------------------------------------- */

/** Named so the audit fixtures can point at the same people without indexing. */
const USER_IDS = {
  mbeki: '0192f1a0-0000-7000-8000-00000000u003',
  halvorsen: '0192f1a0-0000-7000-8000-00000000u004',
  ramanathan: '0192f1a0-0000-7000-8000-00000000u005',
  farkas: '0192f1a0-0000-7000-8000-00000000u006',
  oyelowo: '0192f1a0-0000-7000-8000-00000000u007',
  sandoval: '0192f1a0-0000-7000-8000-00000000u008',
  castellanos: '0192f1a0-0000-7000-8000-00000000u009',
} as const;

export const MOCK_STAFF_USERS: readonly StaffUser[] = [
  {
    id: MOCK_PROVIDERS[0].id,
    name: 'Ada Okafor',
    displayName: 'Dr. Okafor',
    email: 'a.okafor@cedar.clinic.invalid',
    roles: ['PROVIDER'],
    facilityIds: [MOCK_FACILITY.id, SECOND_FACILITY_ID],
    isProvider: true,
    npi: '9999999995',
    taxonomy: '207Q00000X Family medicine',
    mfaEnrolled: true,
    status: 'ACTIVE',
    lastActiveAt: '2026-08-12T10:04:00.000Z',
    invitedAt: null,
    deactivatedAt: null,
    exceptions: [],
  },
  {
    id: MOCK_PROVIDERS[1].id,
    name: 'Ingrid Lindqvist',
    displayName: 'Dr. Lindqvist',
    email: 'i.lindqvist@cedar.clinic.invalid',
    roles: ['PROVIDER'],
    facilityIds: [MOCK_FACILITY.id],
    isProvider: true,
    npi: '9999999987',
    taxonomy: '208000000X Paediatrics',
    mfaEnrolled: true,
    status: 'ACTIVE',
    lastActiveAt: '2026-08-12T09:41:00.000Z',
    invitedAt: null,
    deactivatedAt: null,
    exceptions: ['Can export the audit trail'],
  },
  {
    id: USER_IDS.mbeki,
    name: 'Rosa Mbeki',
    displayName: 'Rosa Mbeki',
    email: 'r.mbeki@cedar.clinic.invalid',
    roles: ['FRONT_DESK'],
    facilityIds: [MOCK_FACILITY.id],
    isProvider: false,
    npi: null,
    taxonomy: null,
    mfaEnrolled: true,
    status: 'ACTIVE',
    lastActiveAt: '2026-08-12T10:18:00.000Z',
    invitedAt: null,
    deactivatedAt: null,
    exceptions: [],
  },
  {
    id: USER_IDS.halvorsen,
    name: 'Tomas Halvorsen',
    displayName: 'Tomas Halvorsen',
    email: 't.halvorsen@cedar.clinic.invalid',
    roles: ['MEDICAL_ASSISTANT'],
    facilityIds: [MOCK_FACILITY.id, SECOND_FACILITY_ID],
    isProvider: false,
    npi: null,
    taxonomy: null,
    mfaEnrolled: false,
    status: 'ACTIVE',
    lastActiveAt: '2026-08-12T08:52:00.000Z',
    invitedAt: null,
    deactivatedAt: null,
    exceptions: [],
  },
  {
    id: USER_IDS.ramanathan,
    name: 'Priya Ramanathan',
    displayName: 'Priya Ramanathan',
    email: 'p.ramanathan@cedar.clinic.invalid',
    roles: ['BILLER'],
    facilityIds: [MOCK_FACILITY.id, SECOND_FACILITY_ID],
    isProvider: false,
    npi: null,
    taxonomy: null,
    mfaEnrolled: true,
    status: 'ACTIVE',
    lastActiveAt: '2026-08-12T09:57:00.000Z',
    invitedAt: null,
    deactivatedAt: null,
    exceptions: [],
  },
  {
    id: USER_IDS.farkas,
    name: 'Nils Farkas',
    displayName: 'Nils Farkas',
    email: 'n.farkas@cedar.clinic.invalid',
    roles: ['PRACTICE_ADMIN', 'BILLER'],
    facilityIds: [MOCK_FACILITY.id, SECOND_FACILITY_ID, THIRD_FACILITY_ID],
    isProvider: false,
    npi: null,
    taxonomy: null,
    mfaEnrolled: true,
    status: 'ACTIVE',
    lastActiveAt: '2026-08-12T07:30:00.000Z',
    invitedAt: null,
    deactivatedAt: null,
    exceptions: [],
  },
  {
    id: USER_IDS.oyelowo,
    name: 'Junie Oyelowo',
    displayName: 'Junie Oyelowo',
    email: 'j.oyelowo@cedar.clinic.invalid',
    roles: ['FRONT_DESK'],
    facilityIds: [SECOND_FACILITY_ID],
    isProvider: false,
    npi: null,
    taxonomy: null,
    mfaEnrolled: false,
    status: 'INVITED',
    lastActiveAt: null,
    invitedAt: '2026-08-10T14:12:00.000Z',
    deactivatedAt: null,
    exceptions: [],
  },
  {
    id: USER_IDS.sandoval,
    name: 'Dev Sandoval',
    displayName: 'Dev Sandoval',
    email: 'd.sandoval@cedar.clinic.invalid',
    roles: ['MEDICAL_ASSISTANT'],
    facilityIds: [SECOND_FACILITY_ID],
    isProvider: false,
    npi: null,
    taxonomy: null,
    mfaEnrolled: false,
    status: 'ACTIVE',
    lastActiveAt: '2026-08-11T16:22:00.000Z',
    invitedAt: null,
    deactivatedAt: null,
    exceptions: ['Can view billing at Birchwood Annex'],
  },
  {
    id: USER_IDS.castellanos,
    name: 'Wren Castellanos',
    displayName: 'Wren Castellanos',
    email: 'w.castellanos@cedar.clinic.invalid',
    roles: ['BILLER'],
    facilityIds: [MOCK_FACILITY.id],
    isProvider: false,
    npi: null,
    taxonomy: null,
    mfaEnrolled: true,
    status: 'DEACTIVATED',
    lastActiveAt: '2026-06-28T15:03:00.000Z',
    invitedAt: null,
    deactivatedAt: '2026-07-01T09:00:00.000Z',
    exceptions: [],
  },
];

/** Sentence-case role names. The enum is the wire value; this is what a human reads. */
export const STAFF_ROLE_LABELS: Record<StaffRole, string> = {
  PRACTICE_ADMIN: 'Practice admin',
  PROVIDER: 'Provider',
  MEDICAL_ASSISTANT: 'Medical assistant',
  FRONT_DESK: 'Front desk',
  BILLER: 'Biller',
  READ_ONLY: 'Read only',
};

function allow(...roles: StaffRole[]): Record<StaffRole, 'ALLOW' | 'DENY'> {
  const row: Record<StaffRole, 'ALLOW' | 'DENY'> = {
    PRACTICE_ADMIN: 'DENY',
    PROVIDER: 'DENY',
    MEDICAL_ASSISTANT: 'DENY',
    FRONT_DESK: 'DENY',
    BILLER: 'DENY',
    READ_ONLY: 'DENY',
  };
  for (const role of roles) row[role] = 'ALLOW';
  return row;
}

export const MOCK_PERMISSIONS: readonly PermissionRow[] = [
  {
    id: 'chart.view',
    capability: 'View charts',
    description: 'Open a patient chart and read notes, results and medications.',
    roles: allow('PRACTICE_ADMIN', 'PROVIDER', 'MEDICAL_ASSISTANT', 'FRONT_DESK', 'READ_ONLY'),
  },
  {
    id: 'chart.edit',
    capability: 'Edit charts',
    description: 'Record vitals, problems, allergies and history.',
    roles: allow('PROVIDER', 'MEDICAL_ASSISTANT'),
  },
  {
    id: 'note.sign',
    capability: 'Sign notes',
    description: 'Sign and lock a visit note, and file addenda.',
    roles: allow('PROVIDER'),
  },
  {
    id: 'order.prescribe',
    capability: 'Prescribe',
    description: 'Sign prescriptions and transmit them to a pharmacy.',
    roles: allow('PROVIDER'),
  },
  {
    id: 'schedule.manage',
    capability: 'Manage the schedule',
    description: 'Book, move and cancel appointments, and check patients in.',
    roles: allow('PRACTICE_ADMIN', 'FRONT_DESK', 'MEDICAL_ASSISTANT'),
  },
  {
    id: 'billing.work',
    capability: 'Work claims and payments',
    description: 'Capture charges, submit claims, post remittances and take payments.',
    roles: allow('PRACTICE_ADMIN', 'BILLER'),
  },
  {
    id: 'admin.configure',
    capability: 'Configure the practice',
    description: 'Change users, facilities, forms, lists and settings.',
    roles: allow('PRACTICE_ADMIN'),
  },
  {
    id: 'audit.export',
    capability: 'Export the audit trail',
    description: 'Run a date-ranged export of the PHI access stream.',
    roles: allow('PRACTICE_ADMIN'),
  },
];

/* -------------------------------------------------------------------------- */
/* Facilities                                                                  */
/* -------------------------------------------------------------------------- */

const WEEKDAY_HOURS = [
  { day: 'Monday', opens: '08:00', closes: '17:00' },
  { day: 'Tuesday', opens: '08:00', closes: '17:00' },
  { day: 'Wednesday', opens: '08:00', closes: '17:00' },
  { day: 'Thursday', opens: '08:00', closes: '19:00' },
  { day: 'Friday', opens: '08:00', closes: '15:00' },
  { day: 'Saturday', opens: '09:00', closes: '12:00' },
  { day: 'Sunday', opens: null, closes: null },
];

export const MOCK_FACILITIES: readonly Facility[] = [
  {
    id: MOCK_FACILITY.id,
    name: MOCK_FACILITY.name,
    status: 'ACTIVE',
    isPrimary: true,
    posCode: '11',
    posLabel: 'Office',
    npi: '9999999979',
    taxId: '99-0000001',
    phone: '+1 555 0142 000',
    addressLine: '18 Cedar Row',
    city: 'Cedar Falls',
    state: 'IA',
    postalCode: '50613',
    hours: WEEKDAY_HOURS,
    rooms: ['Room 1', 'Room 2', 'Room 3', 'Room 4', 'Procedure room'],
    providerCount: 2,
    weeklyBookableMinutes: 2820,
  },
  {
    id: SECOND_FACILITY_ID,
    name: 'Birchwood Annex',
    status: 'ACTIVE',
    isPrimary: false,
    posCode: '11',
    posLabel: 'Office',
    npi: '9999999961',
    taxId: '99-0000001',
    phone: '+1 555 0142 060',
    addressLine: '4 Birchwood Lane',
    city: 'Birchwood',
    state: 'IA',
    postalCode: '50622',
    hours: [
      { day: 'Monday', opens: '09:00', closes: '16:00' },
      { day: 'Tuesday', opens: null, closes: null },
      { day: 'Wednesday', opens: '09:00', closes: '16:00' },
      { day: 'Thursday', opens: null, closes: null },
      { day: 'Friday', opens: '09:00', closes: '13:00' },
      { day: 'Saturday', opens: null, closes: null },
      { day: 'Sunday', opens: null, closes: null },
    ],
    rooms: ['Annex A', 'Annex B'],
    providerCount: 1,
    weeklyBookableMinutes: 1080,
  },
  {
    id: THIRD_FACILITY_ID,
    name: 'Rune Street Rooms',
    status: 'INACTIVE',
    isPrimary: false,
    posCode: '02',
    posLabel: 'Telehealth',
    npi: '9999999953',
    taxId: '99-0000001',
    phone: '+1 555 0142 090',
    addressLine: '2 Rune Street',
    city: 'Cedar Falls',
    state: 'IA',
    postalCode: '50613',
    hours: WEEKDAY_HOURS.map((entry) => ({ ...entry, opens: null, closes: null })),
    rooms: [],
    providerCount: 0,
    weeklyBookableMinutes: 0,
  },
];

/* -------------------------------------------------------------------------- */
/* Form builder                                                                */
/* -------------------------------------------------------------------------- */

export const MOCK_FIELD_TYPES: readonly FormFieldType[] = [
  { id: 'short-text', label: 'Short text', icon: 'type', hint: 'One line, up to 120 characters' },
  { id: 'long-text', label: 'Long text', icon: 'align-left', hint: 'Paragraph answer' },
  { id: 'number', label: 'Number', icon: 'hash', hint: 'Numeric, can be graphed' },
  { id: 'date', label: 'Date', icon: 'calendar', hint: 'Calendar date, no time' },
  { id: 'time', label: 'Time', icon: 'clock', hint: 'Clock time in the facility zone' },
  { id: 'single-select', label: 'Single select', icon: 'list', hint: 'One answer from a list' },
  { id: 'multi-select', label: 'Multi select', icon: 'list-checks', hint: 'Any number of answers' },
  { id: 'yes-no', label: 'Yes or no', icon: 'toggle-left', hint: 'Two-state answer' },
  { id: 'checkbox', label: 'Checkbox', icon: 'square-check', hint: 'Single opt-in' },
  { id: 'coded-lookup', label: 'Coded lookup', icon: 'search', hint: 'ICD-10, SNOMED or RxNorm' },
  {
    id: 'vitals-block',
    label: 'Vitals block',
    icon: 'heart-pulse',
    hint: 'Height, weight, BP, BMI',
  },
  { id: 'scale', label: 'Scale', icon: 'sliders-horizontal', hint: '0 to 10 rating' },
  { id: 'signature', label: 'Signature', icon: 'pen-line', hint: 'E-sign block with attestation' },
  { id: 'file-upload', label: 'File upload', icon: 'paperclip', hint: 'Photo or document' },
  { id: 'section-heading', label: 'Section heading', icon: 'heading', hint: 'Splits the form' },
];

const INTAKE_FIELDS = [
  {
    id: 'fld-reason',
    sectionId: 'sec-visit',
    label: 'Reason for your visit today',
    type: 'long-text',
    required: true,
    portalVisible: true,
    graphable: false,
    writeOnce: false,
    helpText: 'Tell us what you would like help with.',
    options: [],
    condition: null,
  },
  {
    id: 'fld-pain',
    sectionId: 'sec-visit',
    label: 'Pain right now',
    type: 'scale',
    required: false,
    portalVisible: true,
    graphable: true,
    writeOnce: false,
    helpText: '0 is no pain, 10 is the worst pain you can imagine.',
    options: [],
    condition: null,
  },
  {
    id: 'fld-smoker',
    sectionId: 'sec-social',
    label: 'Do you smoke?',
    type: 'yes-no',
    required: true,
    portalVisible: true,
    graphable: false,
    writeOnce: false,
    helpText: null,
    options: [],
    condition: null,
  },
  {
    id: 'fld-smoker-amount',
    sectionId: 'sec-social',
    label: 'Cigarettes a day',
    type: 'number',
    required: true,
    portalVisible: true,
    graphable: true,
    writeOnce: false,
    helpText: null,
    options: [],
    condition: 'Show when Do you smoke? is Yes',
  },
  {
    id: 'fld-alcohol',
    sectionId: 'sec-social',
    label: 'Drinks a week',
    type: 'number',
    required: false,
    portalVisible: true,
    graphable: true,
    writeOnce: false,
    helpText: null,
    options: [],
    condition: null,
  },
  {
    id: 'fld-birth-country',
    sectionId: 'sec-social',
    label: 'Country of birth',
    type: 'short-text',
    required: false,
    portalVisible: true,
    graphable: false,
    writeOnce: true,
    helpText: 'We ask once and keep it.',
    options: [],
    condition: null,
  },
  {
    id: 'fld-interpreter',
    sectionId: 'sec-access',
    label: 'Do you need an interpreter?',
    type: 'single-select',
    required: true,
    portalVisible: true,
    graphable: false,
    writeOnce: false,
    helpText: null,
    options: ['No', 'Yes, spoken', 'Yes, sign language'],
    condition: null,
  },
  {
    id: 'fld-transport',
    sectionId: 'sec-access',
    label: 'Anything making it hard to get here?',
    type: 'multi-select',
    required: false,
    portalVisible: true,
    graphable: false,
    writeOnce: false,
    helpText: null,
    options: ['Transport', 'Cost', 'Time off work', 'Childcare', 'Nothing'],
    condition: null,
  },
  {
    id: 'fld-consent',
    sectionId: 'sec-access',
    label: 'Consent to treat',
    type: 'signature',
    required: true,
    portalVisible: true,
    graphable: false,
    writeOnce: false,
    helpText: 'Signed once a year.',
    options: [],
    condition: null,
  },
  {
    id: 'fld-vitals',
    sectionId: 'sec-rooming',
    label: 'Rooming vitals',
    type: 'vitals-block',
    required: false,
    portalVisible: false,
    graphable: true,
    writeOnce: false,
    helpText: null,
    options: [],
    condition: null,
  },
];

export const MOCK_FORM_DEFINITIONS: readonly FormDefinition[] = [
  {
    id: 'form-intake',
    name: 'Adult intake',
    purpose: 'PORTAL_INTAKE',
    version: 3,
    status: 'PUBLISHED',
    publishedAt: '2026-06-02T11:20:00.000Z',
    updatedAt: '2026-08-11T15:05:00.000Z',
    updatedBy: 'Nils Farkas',
    hasUnpublishedChanges: true,
    responseCount: 412,
    sections: [
      { id: 'sec-visit', title: 'About today' },
      { id: 'sec-social', title: 'Lifestyle' },
      { id: 'sec-access', title: 'Getting care' },
      { id: 'sec-rooming', title: 'Rooming (staff only)' },
    ],
    fields: INTAKE_FIELDS,
  },
  {
    id: 'form-phq9',
    name: 'PHQ-9',
    purpose: 'ENCOUNTER',
    version: 1,
    status: 'PUBLISHED',
    publishedAt: '2026-02-17T09:00:00.000Z',
    updatedAt: '2026-02-17T09:00:00.000Z',
    updatedBy: 'Ada Okafor',
    hasUnpublishedChanges: false,
    responseCount: 168,
    sections: [{ id: 'sec-phq', title: 'Over the last two weeks' }],
    fields: [
      {
        id: 'fld-phq-1',
        sectionId: 'sec-phq',
        label: 'Little interest or pleasure in doing things',
        type: 'single-select',
        required: true,
        portalVisible: true,
        graphable: true,
        writeOnce: false,
        helpText: null,
        options: ['Not at all', 'Several days', 'More than half the days', 'Nearly every day'],
        condition: null,
      },
      {
        id: 'fld-phq-total',
        sectionId: 'sec-phq',
        label: 'Total score',
        type: 'number',
        required: false,
        portalVisible: false,
        graphable: true,
        writeOnce: false,
        helpText: 'Calculated from the nine answers.',
        options: [],
        condition: null,
      },
    ],
  },
  {
    id: 'form-referral',
    name: 'Referral request',
    purpose: 'REFERRAL',
    version: 2,
    status: 'PUBLISHED',
    publishedAt: '2026-04-30T13:45:00.000Z',
    updatedAt: '2026-04-30T13:45:00.000Z',
    updatedBy: 'Nils Farkas',
    hasUnpublishedChanges: false,
    responseCount: 57,
    sections: [{ id: 'sec-referral', title: 'Referral' }],
    fields: [
      {
        id: 'fld-referral-to',
        sectionId: 'sec-referral',
        label: 'Refer to',
        type: 'short-text',
        required: true,
        portalVisible: false,
        graphable: false,
        writeOnce: false,
        helpText: null,
        options: [],
        condition: null,
      },
      {
        id: 'fld-referral-reason',
        sectionId: 'sec-referral',
        label: 'Reason',
        type: 'long-text',
        required: true,
        portalVisible: false,
        graphable: false,
        writeOnce: false,
        helpText: null,
        options: [],
        condition: null,
      },
    ],
  },
  {
    id: 'form-sports',
    name: 'Sports physical',
    purpose: 'ENCOUNTER',
    version: 1,
    status: 'DRAFT',
    publishedAt: null,
    updatedAt: '2026-08-05T10:10:00.000Z',
    updatedBy: 'Ingrid Lindqvist',
    hasUnpublishedChanges: true,
    responseCount: 0,
    sections: [{ id: 'sec-sports', title: 'Clearance' }],
    fields: [
      {
        id: 'fld-sport',
        sectionId: 'sec-sports',
        label: 'Sport',
        type: 'short-text',
        required: true,
        portalVisible: true,
        graphable: false,
        writeOnce: false,
        helpText: null,
        options: [],
        condition: null,
      },
    ],
  },
];

/* -------------------------------------------------------------------------- */
/* Audit                                                                       */
/* -------------------------------------------------------------------------- */

/** A short, obviously synthetic digest. Real chains carry 64 hex characters. */
function digest(sequence: number): string {
  return `sha256:${(sequence * 2654435761).toString(16).padStart(12, '0')}demo`;
}

/* Actors and patients are keyed rather than indexed: a `Record` over a key union
   is total, so a seed can never point at a row that is not there. */
type AuditActorKey = 'okafor' | 'lindqvist' | 'mbeki' | 'halvorsen' | 'ramanathan' | 'farkas';

type AuditPatientKey = 'patientsson' | 'testperson' | 'fixtureby' | 'nullsson';

interface AuditSeed {
  sequence: number;
  at: string;
  actor: AuditActorKey;
  action: AuditEvent['action'];
  targetType: string;
  targetLabel: string;
  patient?: AuditPatientKey;
  purposeOfUse: AuditEvent['purposeOfUse'];
  breakglassReason?: string;
  detail?: Array<{ label: string; value: string }>;
}

const AUDIT_ACTORS: Record<AuditActorKey, { id: string; name: string; role: StaffRole }> = {
  okafor: { id: MOCK_PROVIDERS[0].id, name: 'Ada Okafor', role: 'PROVIDER' },
  lindqvist: { id: MOCK_PROVIDERS[1].id, name: 'Ingrid Lindqvist', role: 'PROVIDER' },
  mbeki: { id: USER_IDS.mbeki, name: 'Rosa Mbeki', role: 'FRONT_DESK' },
  halvorsen: { id: USER_IDS.halvorsen, name: 'Tomas Halvorsen', role: 'MEDICAL_ASSISTANT' },
  ramanathan: { id: USER_IDS.ramanathan, name: 'Priya Ramanathan', role: 'BILLER' },
  farkas: { id: USER_IDS.farkas, name: 'Nils Farkas', role: 'PRACTICE_ADMIN' },
};

/**
 * Which workstation each demo actor signed in from.
 *
 * Every seeded event used to carry one identical address, which quietly broke
 * the screen it feeds: "who opened this chart, and from where" is a question
 * the audit viewer exists to answer, and a constant answers it "everyone, the
 * same place". The address is assembled from the practice's private subnet and
 * a per-actor host number so the demo trail shows a plausible spread.
 */
const CLINIC_SUBNET = '10.4.2';
const ACTOR_WORKSTATION: Record<AuditActorKey, number> = {
  okafor: 19,
  lindqvist: 23,
  mbeki: 31,
  halvorsen: 44,
  ramanathan: 57,
  farkas: 62,
};

const AUDIT_PATIENTS: Record<AuditPatientKey, { id: string; mrn: string; name: string }> = {
  patientsson: {
    id: '0192f1a0-0000-7000-8000-00000000p001',
    mrn: 'OR-100482',
    name: 'Testina Patientsson',
  },
  testperson: {
    id: '0192f1a0-0000-7000-8000-00000000p002',
    mrn: 'OR-100517',
    name: 'Exampla Testperson',
  },
  fixtureby: {
    id: '0192f1a0-0000-7000-8000-00000000p003',
    mrn: 'OR-100608',
    name: 'Demonstra Fixtureby',
  },
  nullsson: {
    id: '0192f1a0-0000-7000-8000-00000000p004',
    mrn: 'OR-100641',
    name: 'Placeholder Nullsson',
  },
};

const AUDIT_SEEDS: readonly AuditSeed[] = [
  {
    sequence: 48211,
    at: '2026-08-12T10:18:42.000Z',
    actor: 'mbeki',
    action: 'PATIENT_READ',
    targetType: 'Patient',
    targetLabel: 'Chart summary',
    patient: 'patientsson',
    purposeOfUse: 'TREATMENT',
    detail: [{ label: 'Screen', value: 'Chart home' }],
  },
  {
    sequence: 48210,
    at: '2026-08-12T10:12:07.000Z',
    actor: 'okafor',
    action: 'NOTE_SIGN',
    targetType: 'DocumentReference',
    targetLabel: 'Acute visit note, 12 Aug 2026',
    patient: 'nullsson',
    purposeOfUse: 'TREATMENT',
    detail: [
      { label: 'Signature', value: 'Ada Okafor, MD' },
      { label: 'Locked', value: 'Yes, addenda remain possible' },
    ],
  },
  {
    sequence: 48209,
    at: '2026-08-12T09:58:30.000Z',
    actor: 'ramanathan',
    action: 'CLAIM_SUBMIT',
    targetType: 'Claim',
    targetLabel: 'CLM-2026-0774 to Northwind Health',
    patient: 'testperson',
    purposeOfUse: 'PAYMENT',
    detail: [{ label: 'Batch', value: '12 claims, $4,318.00' }],
  },
  {
    sequence: 48208,
    at: '2026-08-12T09:44:11.000Z',
    actor: 'lindqvist',
    action: 'BREAKGLASS_READ',
    targetType: 'Patient',
    targetLabel: 'Restricted chart opened outside care team',
    patient: 'nullsson',
    purposeOfUse: 'BREAKGLASS',
    breakglassReason: 'Covering for Dr. Okafor; patient called with chest pain.',
    detail: [{ label: 'Reviewed by', value: 'Pending compliance review' }],
  },
  {
    sequence: 48207,
    at: '2026-08-12T09:31:55.000Z',
    actor: 'halvorsen',
    action: 'PATIENT_UPDATE',
    targetType: 'Patient',
    targetLabel: 'Allergy added: penicillin, severe',
    patient: 'fixtureby',
    purposeOfUse: 'TREATMENT',
    detail: [{ label: 'Field', value: 'AllergyIntolerance' }],
  },
  {
    sequence: 48206,
    at: '2026-08-12T09:05:19.000Z',
    actor: 'farkas',
    action: 'SETTING_UPDATE',
    targetType: 'Setting',
    targetLabel: 'Scheduling / default visit length',
    purposeOfUse: 'OPERATIONS',
    detail: [
      { label: 'From', value: '15 minutes' },
      { label: 'To', value: '20 minutes' },
    ],
  },
  {
    sequence: 48205,
    at: '2026-08-12T08:47:02.000Z',
    actor: 'okafor',
    action: 'ORDER_SIGN',
    targetType: 'ServiceRequest',
    targetLabel: 'HbA1c, routine',
    patient: 'testperson',
    purposeOfUse: 'TREATMENT',
  },
  {
    sequence: 48204,
    at: '2026-08-12T08:22:41.000Z',
    actor: 'farkas',
    action: 'EXPORT_RUN',
    targetType: 'AuditExport',
    targetLabel: 'Audit export, 1 Jul to 31 Jul 2026',
    purposeOfUse: 'OPERATIONS',
    detail: [{ label: 'Rows', value: '18,442' }],
  },
  {
    sequence: 48203,
    at: '2026-08-12T08:01:08.000Z',
    actor: 'mbeki',
    action: 'LOGIN_SUCCESS',
    targetType: 'Session',
    targetLabel: 'Password and TOTP',
    purposeOfUse: 'SYSTEM',
  },
  {
    sequence: 48202,
    at: '2026-08-12T07:59:36.000Z',
    actor: 'mbeki',
    action: 'LOGIN_FAILURE',
    targetType: 'Session',
    targetLabel: 'Wrong one-time code',
    purposeOfUse: 'SYSTEM',
    detail: [{ label: 'Attempt', value: '1 of 5' }],
  },
  {
    sequence: 48201,
    at: '2026-08-11T17:40:22.000Z',
    actor: 'ramanathan',
    action: 'PATIENT_READ',
    targetType: 'Patient',
    targetLabel: 'Ledger and statement history',
    patient: 'patientsson',
    purposeOfUse: 'PAYMENT',
  },
  {
    sequence: 48200,
    at: '2026-08-11T16:55:14.000Z',
    actor: 'lindqvist',
    action: 'NOTE_SIGN',
    targetType: 'DocumentReference',
    targetLabel: 'Well-child visit note, 11 Aug 2026',
    patient: 'fixtureby',
    purposeOfUse: 'TREATMENT',
  },
];

export const MOCK_AUDIT_EVENTS: readonly AuditEvent[] = AUDIT_SEEDS.map((seed) => {
  const actor = AUDIT_ACTORS[seed.actor];
  const patient = seed.patient === undefined ? null : AUDIT_PATIENTS[seed.patient];
  return {
    id: `audit-${seed.sequence}`,
    sequence: seed.sequence,
    occurredAt: seed.at,
    actorId: actor.id,
    actorName: actor.name,
    actorRole: actor.role,
    action: seed.action,
    targetType: seed.targetType,
    targetLabel: seed.targetLabel,
    patientId: patient?.id ?? null,
    patientMrn: patient?.mrn ?? null,
    patientName: patient?.name ?? null,
    purposeOfUse: seed.purposeOfUse,
    breakglass: seed.breakglassReason !== undefined,
    breakglassReason: seed.breakglassReason ?? null,
    sourceIp: `${CLINIC_SUBNET}.${ACTOR_WORKSTATION[seed.actor]}`,
    requestId: `req-${seed.sequence}-demo`,
    hash: digest(seed.sequence),
    previousHash: digest(seed.sequence - 1),
    chainVerified: true,
    detail: seed.detail ?? [],
  };
});

/* -------------------------------------------------------------------------- */
/* Integrations                                                                */
/* -------------------------------------------------------------------------- */

export const MOCK_INTEGRATIONS: readonly Integration[] = [
  {
    id: 'int-erx',
    seam: 'erx',
    name: 'Prescribing',
    description: 'Sends prescriptions to pharmacies and carries interaction checks.',
    adapter: 'Runic eRx mock network',
    adapterVersion: '0.4.1',
    status: 'DEMO',
    lastActivityAt: '2026-08-12T09:12:00.000Z',
    lastGoodAt: '2026-08-12T09:12:00.000Z',
    failureDetail: null,
    secretRef: 'secret://erx/demo-key',
    webhookVerified: true,
    activityLog: [
      {
        at: '2026-08-12T09:12:00.000Z',
        summary: 'Prescription accepted by mock pharmacy',
        ok: true,
      },
      {
        at: '2026-08-12T08:40:00.000Z',
        summary: 'Interaction check returned 2 warnings',
        ok: true,
      },
    ],
  },
  {
    id: 'int-clearinghouse',
    seam: 'clearinghouse',
    name: 'Claims clearinghouse',
    description: 'Submits 837P claims and ingests 999, 277 and 835 responses.',
    adapter: 'Northwind Clearing',
    adapterVersion: '2.9.0',
    status: 'CONNECTED',
    lastActivityAt: '2026-08-12T09:58:00.000Z',
    lastGoodAt: '2026-08-12T09:58:00.000Z',
    failureDetail: null,
    secretRef: 'secret://clearinghouse/api-token',
    webhookVerified: true,
    activityLog: [
      { at: '2026-08-12T09:58:00.000Z', summary: 'Batch of 12 claims accepted', ok: true },
      { at: '2026-08-12T06:02:00.000Z', summary: 'Remittance 835 received, $6,140.22', ok: true },
    ],
  },
  {
    id: 'int-labs',
    seam: 'labs',
    name: 'Laboratory network',
    description: 'Transmits orders and receives results into the sign-off queue.',
    adapter: 'Cedar Valley Labs',
    adapterVersion: '1.6.3',
    status: 'ERROR',
    lastActivityAt: '2026-08-12T07:41:00.000Z',
    lastGoodAt: '2026-08-11T18:22:00.000Z',
    failureDetail:
      'The lab refused the connection credentials. Orders placed since 07:41 are queued and will send once the credentials are replaced.',
    secretRef: 'secret://labs/service-account',
    webhookVerified: false,
    activityLog: [
      { at: '2026-08-12T07:41:00.000Z', summary: 'Authentication rejected (401)', ok: false },
      { at: '2026-08-11T18:22:00.000Z', summary: '14 results received', ok: true },
    ],
  },
  {
    id: 'int-payments',
    seam: 'payments',
    name: 'Card payments',
    description: 'Takes copays at the desk and payments from the portal.',
    adapter: 'Runic Payments mock gateway',
    adapterVersion: '0.9.0',
    status: 'DEMO',
    lastActivityAt: '2026-08-12T10:02:00.000Z',
    lastGoodAt: '2026-08-12T10:02:00.000Z',
    failureDetail: null,
    secretRef: 'secret://payments/demo-key',
    webhookVerified: true,
    activityLog: [
      { at: '2026-08-12T10:02:00.000Z', summary: 'Copay of $30.00 captured', ok: true },
    ],
  },
  {
    id: 'int-fax',
    seam: 'fax',
    name: 'Fax',
    description: 'Sends referrals and receives inbound documents for filing.',
    adapter: null,
    adapterVersion: null,
    status: 'NOT_CONNECTED',
    lastActivityAt: null,
    lastGoodAt: null,
    failureDetail: null,
    secretRef: null,
    webhookVerified: false,
    activityLog: [],
  },
  {
    id: 'int-sms',
    seam: 'sms',
    name: 'Text messages',
    description: 'Appointment reminders and text-to-pay links.',
    adapter: 'Runic SMS mock',
    adapterVersion: '0.3.2',
    status: 'DEMO',
    lastActivityAt: '2026-08-12T06:30:00.000Z',
    lastGoodAt: '2026-08-12T06:30:00.000Z',
    failureDetail: null,
    secretRef: 'secret://sms/demo-key',
    webhookVerified: true,
    activityLog: [
      { at: '2026-08-12T06:30:00.000Z', summary: '18 reminders sent for today', ok: true },
    ],
  },
  {
    id: 'int-address',
    seam: 'address-verify',
    name: 'Address verification',
    description: 'Checks patient addresses as they are typed at registration.',
    adapter: 'USPS mock',
    adapterVersion: '1.1.0',
    status: 'CONNECTED',
    lastActivityAt: '2026-08-12T09:22:00.000Z',
    lastGoodAt: '2026-08-12T09:22:00.000Z',
    failureDetail: null,
    secretRef: 'secret://address-verify/api-key',
    webhookVerified: false,
    activityLog: [
      { at: '2026-08-12T09:22:00.000Z', summary: 'Address standardised for 1 patient', ok: true },
    ],
  },
  {
    id: 'int-video',
    seam: 'video',
    name: 'Video visits',
    description: 'Hosts telehealth rooms and passwordless patient join links.',
    adapter: 'Runic Video mock room',
    adapterVersion: '0.2.0',
    status: 'DEMO',
    lastActivityAt: '2026-08-11T14:05:00.000Z',
    lastGoodAt: '2026-08-11T14:05:00.000Z',
    failureDetail: null,
    secretRef: 'secret://video/demo-key',
    webhookVerified: false,
    activityLog: [{ at: '2026-08-11T14:05:00.000Z', summary: 'Room opened for 1 visit', ok: true }],
  },
];

/* -------------------------------------------------------------------------- */
/* Developer platform                                                          */
/* -------------------------------------------------------------------------- */

export const MOCK_API_SCOPES: readonly ApiScope[] = [
  { id: 'system/Patient.rs', description: 'Read patient demographics for the whole practice.' },
  { id: 'system/Appointment.rs', description: 'Read appointments and their status.' },
  { id: 'system/Observation.rs', description: 'Read vitals and laboratory results.' },
  { id: 'system/DocumentReference.rs', description: 'Read signed notes and documents.' },
  { id: 'system/Claim.rs', description: 'Read claims and their lifecycle events.' },
  {
    id: 'user/Appointment.cruds',
    description: 'Book and change appointments as the signed-in user.',
  },
  { id: 'patient/*.rs', description: 'Read everything in the record of the launching patient.' },
];

/**
 * The one-time key string the developer console shows after "Create key".
 *
 * It lives with the other fixtures rather than in the screen because the real
 * value is generated server-side and displayed once: a placeholder sitting in a
 * component file is a placeholder somebody eventually swaps for a live one.
 */
export const MOCK_NEW_KEY_DISPLAY = 'ork_demo_new_key_shown_once_0000';

export const MOCK_API_KEYS: readonly ApiKey[] = [
  {
    id: 'key-reporting',
    label: 'Nightly reporting export',
    prefix: 'ork_demo_7c2f',
    scopes: ['system/Patient.rs', 'system/Appointment.rs', 'system/Claim.rs'],
    createdAt: '2026-03-18T09:00:00.000Z',
    createdBy: 'Nils Farkas',
    lastUsedAt: '2026-08-12T02:00:00.000Z',
    status: 'ACTIVE',
    revokedAt: null,
  },
  {
    id: 'key-registry',
    label: 'Immunisation registry submitter',
    prefix: 'ork_demo_41ab',
    scopes: ['system/Observation.rs'],
    createdAt: '2026-05-02T13:30:00.000Z',
    createdBy: 'Nils Farkas',
    lastUsedAt: '2026-05-09T11:14:00.000Z',
    status: 'ACTIVE',
    revokedAt: null,
  },
  {
    id: 'key-old-billing',
    label: 'Old billing bridge',
    prefix: 'ork_demo_9d10',
    scopes: ['system/Claim.rs'],
    createdAt: '2025-11-11T08:00:00.000Z',
    createdBy: 'Wren Castellanos',
    lastUsedAt: '2026-06-27T19:41:00.000Z',
    status: 'REVOKED',
    revokedAt: '2026-07-01T09:04:00.000Z',
  },
];

export const MOCK_SMART_APPS: readonly SmartApp[] = [
  {
    id: 'app-riskscope',
    name: 'RiskScope',
    clientId: 'demo-riskscope',
    launchType: 'EHR',
    redirectUris: ['https://riskscope.example.invalid/callback'],
    scopes: ['launch', 'patient/*.rs', 'openid', 'fhirUser'],
    status: 'APPROVED',
    lastLaunchAt: '2026-08-12T09:20:00.000Z',
    launches: [
      {
        id: 'launch-1',
        at: '2026-08-12T09:20:00.000Z',
        outcome: 'SUCCESS',
        detail: 'Launched from the chart with patient context.',
        patientContext: 'OR-100482',
      },
      {
        id: 'launch-2',
        at: '2026-08-11T15:02:00.000Z',
        outcome: 'FAILURE',
        detail:
          'The app asked for a scope it is not granted (system/Claim.rs). Add the scope here, or remove it from the app request.',
        patientContext: 'OR-100517',
      },
    ],
  },
  {
    id: 'app-familyview',
    name: 'FamilyView',
    clientId: 'demo-familyview',
    launchType: 'STANDALONE',
    redirectUris: ['https://familyview.example.invalid/oauth'],
    scopes: ['patient/*.rs', 'offline_access', 'openid'],
    status: 'PENDING',
    lastLaunchAt: null,
    launches: [],
  },
];

export const MOCK_WEBHOOKS: readonly Webhook[] = [
  {
    id: 'hook-appointments',
    event: 'Appointment',
    criteria: 'Appointment?status=booked,cancelled',
    endpoint: 'https://ops.example.invalid/hooks/appointments',
    status: 'ACTIVE',
    secretRef: 'secret://webhooks/appointments',
    failureRate: 0,
    createdAt: '2026-04-04T10:00:00.000Z',
    deliveries: [
      {
        id: 'del-1',
        at: '2026-08-12T10:02:11.000Z',
        event: 'Appointment.booked',
        responseCode: 200,
        latencyMs: 142,
        attempt: 1,
        outcome: 'DELIVERED',
      },
      {
        id: 'del-2',
        at: '2026-08-12T09:31:04.000Z',
        event: 'Appointment.cancelled',
        responseCode: 200,
        latencyMs: 118,
        attempt: 1,
        outcome: 'DELIVERED',
      },
    ],
  },
  {
    id: 'hook-results',
    event: 'Observation',
    criteria: 'Observation?category=laboratory',
    endpoint: 'https://labs.example.invalid/hooks/results',
    status: 'FAILING',
    secretRef: 'secret://webhooks/results',
    failureRate: 0.62,
    createdAt: '2026-02-20T08:30:00.000Z',
    deliveries: [
      {
        id: 'del-3',
        at: '2026-08-12T08:12:44.000Z',
        event: 'Observation.created',
        responseCode: 503,
        latencyMs: 30_012,
        attempt: 3,
        outcome: 'FAILED',
      },
      {
        id: 'del-4',
        at: '2026-08-12T07:58:02.000Z',
        event: 'Observation.created',
        responseCode: null,
        latencyMs: null,
        attempt: 2,
        outcome: 'RETRYING',
      },
      {
        id: 'del-5',
        at: '2026-08-11T18:24:19.000Z',
        event: 'Observation.created',
        responseCode: 200,
        latencyMs: 233,
        attempt: 1,
        outcome: 'DELIVERED',
      },
    ],
  },
  {
    id: 'hook-claims',
    event: 'Claim',
    // `active` rather than `denied`: FHIR R4 has no code for a denied claim, and
    // `Claim.status=active` is the code every denied claim carries. The hook
    // subscribes to that and sorts denials out at its own end.
    criteria: 'Claim?status=active',
    endpoint: 'https://rcm.example.invalid/hooks/denials',
    status: 'PAUSED',
    secretRef: 'secret://webhooks/denials',
    failureRate: 0.04,
    createdAt: '2026-06-15T12:00:00.000Z',
    deliveries: [
      {
        id: 'del-6',
        at: '2026-08-09T11:40:00.000Z',
        event: 'Claim.denied',
        responseCode: 200,
        latencyMs: 189,
        attempt: 1,
        outcome: 'DELIVERED',
      },
    ],
  },
];

/* -------------------------------------------------------------------------- */
/* Reports                                                                     */
/* -------------------------------------------------------------------------- */

export const MOCK_DASHBOARD: PracticeDashboard = {
  asOf: '2026-08-12T10:20:00.000Z',
  tiles: [
    {
      id: 'visits-today',
      label: 'Visits today',
      value: 16,
      unit: 'booked',
      detail: '7 seen, 2 in rooms, 1 no-show',
      state: 'success',
      stateLabel: 'On plan',
      href: '/schedule',
      series: [14, 15, 13, 17, 16, 12, 16],
    },
    {
      id: 'unsigned-notes',
      label: 'Unsigned notes',
      value: 7,
      unit: 'notes',
      detail: 'Oldest is 4 days old',
      state: 'danger',
      stateLabel: 'Above threshold',
      href: '/inbox',
      series: [3, 4, 4, 6, 5, 6, 7],
    },
    {
      id: 'results-awaiting',
      label: 'Results awaiting review',
      value: 12,
      unit: 'results',
      detail: '2 flagged abnormal',
      state: 'neutral',
      stateLabel: 'Within target',
      href: '/results',
      series: [9, 11, 8, 10, 13, 11, 12],
    },
    {
      id: 'claims-attention',
      label: 'Claims needing attention',
      value: 5,
      unit: 'claims',
      detail: '3 denied, 2 failed to scrub',
      state: 'danger',
      stateLabel: 'Above threshold',
      href: '/billing',
      series: [2, 3, 3, 4, 4, 5, 5],
    },
    {
      id: 'ar-total',
      label: 'Accounts receivable',
      value: 48_216.4,
      unit: '$',
      detail: '$9,104.20 is patient responsibility',
      state: 'neutral',
      stateLabel: 'Within target',
      href: '/billing',
      series: [51_400, 50_820, 49_960, 49_100, 48_740, 48_500, 48_216],
    },
  ],
  funnel: [
    { id: 'captured', label: 'Captured', count: 74 },
    { id: 'scrubbed', label: 'Scrubbed', count: 68 },
    { id: 'submitted', label: 'Submitted', count: 61 },
    { id: 'acknowledged', label: 'Acknowledged', count: 58 },
    { id: 'paid', label: 'Paid', count: 44 },
    { id: 'denied', label: 'Denied', count: 3 },
  ],
  aging: [
    { id: '0-30', label: '0 to 30 days', payerAmount: 21_480.0, patientAmount: 3_120.4 },
    { id: '31-60', label: '31 to 60 days', payerAmount: 11_260.0, patientAmount: 2_480.0 },
    { id: '61-90', label: '61 to 90 days', payerAmount: 4_920.0, patientAmount: 1_664.0 },
    { id: '90-plus', label: 'Over 90 days', payerAmount: 1_452.0, patientAmount: 1_839.8 },
  ],
  unsignedByProvider: [
    {
      providerId: MOCK_PROVIDERS[0].id,
      providerName: MOCK_PROVIDERS[0].name,
      unsigned: 5,
      oldestDays: 4,
    },
    {
      providerId: MOCK_PROVIDERS[1].id,
      providerName: MOCK_PROVIDERS[1].name,
      unsigned: 2,
      oldestDays: 1,
    },
  ],
};

interface VisitRowSeed {
  date: string;
  time: string;
  patient: string;
  mrn: string;
  providerIndex: 0 | 1;
  visitType: string;
  status: string;
  durationMinutes: number;
  chargeAmount: number;
  claimState: string;
  facility?: string;
}

const VISIT_ROW_SEEDS: readonly VisitRowSeed[] = [
  {
    date: MOCK_CLINIC_DAY,
    time: '08:00',
    patient: 'Testina Patientsson',
    mrn: 'OR-100482',
    providerIndex: 0,
    visitType: 'Follow-up',
    status: 'FULFILLED',
    durationMinutes: 20,
    chargeAmount: 118.0,
    claimState: 'Submitted',
  },
  {
    date: MOCK_CLINIC_DAY,
    time: '08:20',
    patient: 'Exampla Testperson',
    mrn: 'OR-100517',
    providerIndex: 0,
    visitType: 'Chronic care',
    status: 'CHECKED_OUT',
    durationMinutes: 20,
    chargeAmount: 164.0,
    claimState: 'Scrubbed',
  },
  {
    date: MOCK_CLINIC_DAY,
    time: '08:40',
    patient: 'Demonstra Fixtureby',
    mrn: 'OR-100608',
    providerIndex: 1,
    visitType: 'Well-child visit',
    status: 'FULFILLED',
    durationMinutes: 30,
    chargeAmount: 212.0,
    claimState: 'Submitted',
  },
  {
    date: MOCK_CLINIC_DAY,
    time: '09:00',
    patient: 'Placeholder Nullsson',
    mrn: 'OR-100641',
    providerIndex: 0,
    visitType: 'Acute visit',
    status: 'IN_PROGRESS',
    durationMinutes: 20,
    chargeAmount: 96.0,
    claimState: 'Captured',
  },
  {
    date: MOCK_CLINIC_DAY,
    time: '09:20',
    patient: 'Syntheta Fakeley',
    mrn: 'OR-100702',
    providerIndex: 0,
    visitType: 'Follow-up',
    status: 'ROOMED',
    durationMinutes: 20,
    chargeAmount: 0,
    claimState: 'Not captured',
  },
  {
    date: MOCK_CLINIC_DAY,
    time: '09:30',
    patient: 'Sampleton Mockford',
    mrn: 'OR-100744',
    providerIndex: 1,
    visitType: 'Annual physical',
    status: 'CHECKED_IN',
    durationMinutes: 30,
    chargeAmount: 0,
    claimState: 'Not captured',
    facility: 'Birchwood Annex',
  },
  {
    date: '2026-08-11',
    time: '10:40',
    patient: 'Fictitia Notreal',
    mrn: 'OR-100810',
    providerIndex: 0,
    visitType: 'Acute visit',
    status: 'FULFILLED',
    durationMinutes: 20,
    chargeAmount: 104.0,
    claimState: 'Paid',
  },
  {
    date: '2026-08-11',
    time: '11:20',
    patient: 'Dummonde Stubbins',
    mrn: 'OR-100866',
    providerIndex: 1,
    visitType: 'Chronic care',
    status: 'FULFILLED',
    durationMinutes: 20,
    chargeAmount: 158.0,
    claimState: 'Denied',
  },
  {
    date: '2026-08-11',
    time: '14:00',
    patient: 'Prototypo Sandboxer',
    mrn: 'OR-100913',
    providerIndex: 0,
    visitType: 'Telehealth',
    status: 'FULFILLED',
    durationMinutes: 15,
    chargeAmount: 78.0,
    claimState: 'Paid',
    facility: 'Rune Street Rooms',
  },
  {
    date: '2026-08-10',
    time: '09:10',
    patient: 'Simula Testarossa',
    mrn: 'OR-100978',
    providerIndex: 1,
    visitType: 'Immunisation',
    status: 'FULFILLED',
    durationMinutes: 20,
    chargeAmount: 142.0,
    claimState: 'Paid',
  },
  {
    date: '2026-08-10',
    time: '13:30',
    patient: 'Quinta Examplebury',
    mrn: 'OR-101088',
    providerIndex: 0,
    visitType: 'Minor procedure',
    status: 'FULFILLED',
    durationMinutes: 40,
    chargeAmount: 386.0,
    claimState: 'Acknowledged',
  },
  {
    date: '2026-08-10',
    time: '15:00',
    patient: 'Testina Patientsson',
    mrn: 'OR-100482',
    providerIndex: 0,
    visitType: 'Follow-up',
    status: 'NOSHOW',
    durationMinutes: 20,
    chargeAmount: 0,
    claimState: 'Not captured',
  },
];

export const MOCK_VISIT_ROWS: readonly VisitReportRow[] = VISIT_ROW_SEEDS.map((seed, index) => ({
  id: `visit-row-${index + 1}`,
  date: seed.date,
  time: seed.time,
  patientName: seed.patient,
  patientMrn: seed.mrn,
  providerId: MOCK_PROVIDERS[seed.providerIndex].id,
  providerName: MOCK_PROVIDERS[seed.providerIndex].name,
  facilityName: seed.facility ?? MOCK_FACILITY.name,
  visitType: seed.visitType,
  status: seed.status,
  durationMinutes: seed.durationMinutes,
  chargeAmount: seed.chargeAmount,
  claimState: seed.claimState,
}));

/* -------------------------------------------------------------------------- */
/* Filtering                                                                   */
/* -------------------------------------------------------------------------- */

export function filterStaffUsers(
  users: readonly StaffUser[],
  query: StaffUserQuery = {}
): StaffUser[] {
  const needle = query.q?.trim().toLowerCase() ?? '';
  return users.filter((user) => {
    if (
      needle &&
      !`${user.name} ${user.displayName} ${user.email}`.toLowerCase().includes(needle)
    ) {
      return false;
    }
    if (query.role && !user.roles.includes(query.role)) return false;
    if (query.status && user.status !== query.status) return false;
    if (query.facilityId && !user.facilityIds.includes(query.facilityId)) return false;
    return true;
  });
}

export function filterAuditEvents(
  events: readonly AuditEvent[],
  query: AuditQuery = {}
): AuditEvent[] {
  const mrn = query.patientMrn?.trim().toUpperCase() ?? '';
  return events.filter((event) => {
    if (query.actorId && event.actorId !== query.actorId) return false;
    if (query.action && event.action !== query.action) return false;
    if (query.purposeOfUse && event.purposeOfUse !== query.purposeOfUse) return false;
    if (query.breakglassOnly && !event.breakglass) return false;
    if (mrn) {
      // Bound to a typed local so the substring test reads as one: this is
      // String.prototype.includes over the recorded MRN, not a list scan.
      const recordedMrn: string = event.patientMrn ?? '';
      if (!recordedMrn.includes(mrn)) return false;
    }
    if (query.from && event.occurredAt.slice(0, 10) < query.from) return false;
    if (query.to && event.occurredAt.slice(0, 10) > query.to) return false;
    return true;
  });
}

export function filterVisitRows(
  rows: readonly VisitReportRow[],
  query: VisitReportQuery = {}
): VisitReportRow[] {
  return rows.filter((row) => {
    if (query.from && row.date < query.from) return false;
    if (query.to && row.date > query.to) return false;
    if (query.providerId && row.providerId !== query.providerId) return false;
    if (query.status && row.status !== query.status) return false;
    if (query.visitType && row.visitType !== query.visitType) return false;
    return true;
  });
}

/** Totals are computed over the filtered set, the way a server would compute them. */
export function totalsFor(rows: readonly VisitReportRow[]): VisitReport['totals'] {
  return rows.reduce(
    (totals, row) => ({
      visits: totals.visits + 1,
      minutes: totals.minutes + row.durationMinutes,
      charges: Number((totals.charges + row.chargeAmount).toFixed(2)),
    }),
    { visits: 0, minutes: 0, charges: 0 }
  );
}

/* -------------------------------------------------------------------------- */
/* The client                                                                  */
/* -------------------------------------------------------------------------- */

export interface AdminMockOptions {
  /** Every collection answers with no rows. For exercising empty states. */
  empty?: boolean;
  /** Every read rejects with this error. For exercising the error state. */
  failure?: ApiError;
}

/** The failure a test gets by default: a server error, which is retryable. */
export function adminMockFailure(status = 500): ApiError {
  const problem: ProblemDocument = {
    type: 'https://openrunic.org/problems/server-error',
    title: 'The server could not answer',
    status,
    detail: 'The demo client was asked to fail.',
    instance: '/bff/v0/admin',
    requestId: 'mock-request',
  };
  return new ApiError(problem.detail, { kind: 'http', status, problem });
}

export function createAdminMockClient(options: AdminMockOptions = {}): AdminClient {
  const rows = <T>(values: readonly T[]): Promise<ListResponse<T>> => {
    if (options.failure) return Promise.reject(options.failure);
    return settle(page(options.empty ? [] : values));
  };

  const value = <T>(payload: T, emptyPayload: T): Promise<T> => {
    if (options.failure) return Promise.reject(options.failure);
    return settle(options.empty ? emptyPayload : payload);
  };

  return {
    mode: 'mock',
    users: {
      list: (query) => rows(filterStaffUsers(MOCK_STAFF_USERS, query)),
      permissions: () => value<PermissionRow[]>([...MOCK_PERMISSIONS], []),
    },
    facilities: {
      list: () => rows(MOCK_FACILITIES),
    },
    forms: {
      list: () => rows(MOCK_FORM_DEFINITIONS),
      fieldTypes: () => value<FormFieldType[]>([...MOCK_FIELD_TYPES], []),
    },
    audit: {
      list: (query) => rows(filterAuditEvents(MOCK_AUDIT_EVENTS, query)),
    },
    integrations: {
      list: () => rows(MOCK_INTEGRATIONS),
    },
    developer: {
      keys: () => rows(MOCK_API_KEYS),
      scopes: () => value<ApiScope[]>([...MOCK_API_SCOPES], []),
      apps: () => rows(MOCK_SMART_APPS),
      webhooks: () => rows(MOCK_WEBHOOKS),
    },
    reports: {
      dashboard: () =>
        value<PracticeDashboard>(MOCK_DASHBOARD, {
          asOf: MOCK_DASHBOARD.asOf,
          tiles: [],
          funnel: [],
          aging: [],
          unsignedByProvider: [],
        }),
      visits: (query) => {
        const filtered = filterVisitRows(MOCK_VISIT_ROWS, query);
        return value<VisitReport>(
          { rows: filtered, totals: totalsFor(filtered) },
          { rows: [], totals: { visits: 0, minutes: 0, charges: 0 } }
        );
      },
    },
  };
}
