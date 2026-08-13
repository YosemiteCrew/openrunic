import type { Appointment, FacilityDto, Patient, UserDto } from '../types';
import type {
  InboxItem,
  Order,
  OrderCatalogEntry,
  OrderPriority,
  OrderStatus,
  OrderWarning,
  PatientProblem,
  ResultReport,
} from '../worklist';

/**
 * The demo clinic, as fixtures.
 *
 * Every value here is synthetic by construction and obviously so: Synthea-style
 * names, `OR-` MRNs, no real-format identifiers, no real addresses. Nothing in
 * this file may ever be seeded from a real record.
 *
 * It is deterministic: fixed ids, a fixed clinic day, no `Date.now()`, no
 * randomness. Two runs of a test render exactly the same screen, and a
 * screenshot diff means a code change rather than a clock tick.
 */

/** The day the fixtures describe. Screens in mock mode treat this as "today". */
export const MOCK_CLINIC_DAY = '2026-08-12';

/** A fixed "now" inside that clinic day, for elapsed timers and current-time rules. */
export const MOCK_NOW = '2026-08-12T10:20:00.000Z';

const CREATED_AT = '2026-01-06T09:00:00.000Z';
const UPDATED_AT = '2026-08-11T16:40:00.000Z';

/* -------------------------------------------------------------------------- */
/* The directory: what `/bff/v0/facilities` and `/bff/v0/users` answer with    */
/* -------------------------------------------------------------------------- */

/**
 * The demo clinic's one site, in the shape `facilityDtoSchema` answers with.
 *
 * These rows are wire shapes rather than convenience objects because a booking
 * names a facility and a provider, and the API checks both against the token's
 * grants and against its own foreign keys before it writes. A screen that
 * invented either id would look right here and be refused there, so the ids a
 * screen books with are read through the client in both modes.
 */
const CEDAR_CLINIC: FacilityDto = {
  id: '0192f1a0-0000-7000-8000-00000000f001',
  name: 'Cedar Clinic',
  code: 'CEDAR',
  npi: '9999999979',
  posCode: '11',
  timezone: 'UTC',
  address: {
    line1: '18 Cedar Row',
    line2: null,
    city: 'Cedar Falls',
    state: 'IA',
    postalCode: '50613',
    country: 'US',
  },
  phone: '+1 555 0142 000',
  active: true,
  createdAt: CREATED_AT,
  updatedAt: UPDATED_AT,
};

/** The facility directory, as one page of the list route. */
export const MOCK_DIRECTORY_FACILITIES: readonly FacilityDto[] = [CEDAR_CLINIC];

const DIRECTORY_USER_DEFAULTS = {
  npi: null,
  taxonomyCode: null,
  locale: 'en-US',
  status: 'ACTIVE',
  lastLoginAt: null,
  createdAt: CREATED_AT,
  updatedAt: UPDATED_AT,
} as const satisfies Partial<UserDto>;

const OKAFOR: UserDto = {
  ...DIRECTORY_USER_DEFAULTS,
  id: '0192f1a0-0000-7000-8000-00000000d001',
  email: 'a.okafor@cedar.clinic.invalid',
  givenName: 'Ada',
  familyName: 'Okafor',
  credential: 'MD',
  npi: '9999999995',
  taxonomyCode: '207Q00000X',
  isProvider: true,
  lastLoginAt: '2026-08-12T10:04:00.000Z',
};

const LINDQVIST: UserDto = {
  ...DIRECTORY_USER_DEFAULTS,
  id: '0192f1a0-0000-7000-8000-00000000d002',
  email: 'i.lindqvist@cedar.clinic.invalid',
  givenName: 'Ingrid',
  familyName: 'Lindqvist',
  credential: 'MD',
  npi: '9999999987',
  taxonomyCode: '208000000X',
  isProvider: true,
  lastLoginAt: '2026-08-12T09:41:00.000Z',
};

/** A front-desk account: in the directory, and never a schedule column. */
const MBEKI: UserDto = {
  ...DIRECTORY_USER_DEFAULTS,
  id: '0192f1a0-0000-7000-8000-00000000u003',
  email: 'r.mbeki@cedar.clinic.invalid',
  givenName: 'Rosa',
  familyName: 'Mbeki',
  credential: null,
  isProvider: false,
  lastLoginAt: '2026-08-12T10:18:00.000Z',
};

/**
 * The staff directory, as one page of the list route.
 *
 * It holds a non-clinician on purpose: `isProvider` is the filter every
 * provider picker sends, and a directory where everyone is a provider would let
 * a screen that forgot the filter pass anyway.
 */
export const MOCK_DIRECTORY_USERS: readonly UserDto[] = [OKAFOR, LINDQVIST, MBEKI];

/**
 * The one facility the rest of the fixtures are written against.
 *
 * Derived from the directory row rather than restated, so a fixture appointment
 * and the facility a screen books into can never drift apart.
 */
export const MOCK_FACILITY = { id: CEDAR_CLINIC.id, name: CEDAR_CLINIC.name };

/**
 * The two clinicians, as the fixture-only screens display them.
 *
 * Separate from {@link MOCK_DIRECTORY_USERS} because it is a different thing:
 * the orders, results and reports screens read aggregates that `apps/api` does
 * not serve yet, and they need a display name and a specialty that no directory
 * row carries. The ids are the directory's, so the two never disagree about who
 * these people are. Screens that write, and screens that can read the
 * directory, use the client instead.
 */
export const MOCK_PROVIDERS = [
  { id: OKAFOR.id, name: 'Dr. Okafor', role: 'Family medicine' },
  { id: LINDQVIST.id, name: 'Dr. Lindqvist', role: 'Paediatrics' },
] as const;

/** Reads a provider name for a fixture id, so a fixture screen is never a UUID. */
export function mockProviderName(providerId: string): string {
  return MOCK_PROVIDERS.find((provider) => provider.id === providerId)?.name ?? 'Unassigned';
}

interface PatientSeed {
  id: string;
  mrn: string;
  given: string;
  family: string;
  preferred?: string;
  birthDate: string;
  sexAtBirth: Patient['sexAtBirth'];
  pronouns?: string;
  phoneMobile?: string;
  email?: string;
  city?: string;
  languageCode?: string;
  sensitivityClass?: Patient['sensitivityClass'];
  portalEnabled?: boolean;
  active?: boolean;
  deceasedAt?: string;
}

const PATIENT_SEEDS: readonly PatientSeed[] = [
  {
    id: '0192f1a0-0000-7000-8000-00000000p001',
    mrn: 'OR-100482',
    given: 'Testina',
    family: 'Patientsson',
    preferred: 'Tess',
    birthDate: '1987-03-14',
    sexAtBirth: 'FEMALE',
    pronouns: 'she/her',
    phoneMobile: '+1 555 0142 118',
    email: 'testina.patientsson@example.invalid',
    city: 'Cedar Falls',
    portalEnabled: true,
  },
  {
    id: '0192f1a0-0000-7000-8000-00000000p002',
    mrn: 'OR-100517',
    given: 'Marek',
    family: 'Oyelaran',
    birthDate: '1962-11-02',
    sexAtBirth: 'MALE',
    pronouns: 'he/him',
    phoneMobile: '+1 555 0142 204',
    city: 'Cedar Falls',
    portalEnabled: true,
  },
  {
    id: '0192f1a0-0000-7000-8000-00000000p003',
    mrn: 'OR-100608',
    given: 'Aiko',
    family: 'Fernstrom',
    birthDate: '2019-06-28',
    sexAtBirth: 'FEMALE',
    pronouns: 'she/her',
    city: 'Birchwood',
    languageCode: 'sv-SE',
  },
  {
    id: '0192f1a0-0000-7000-8000-00000000p004',
    mrn: 'OR-100641',
    given: 'Demo',
    family: 'Rungard',
    birthDate: '1954-01-19',
    sexAtBirth: 'MALE',
    city: 'Cedar Falls',
    sensitivityClass: 'RESTRICTED',
  },
  {
    id: '0192f1a0-0000-7000-8000-00000000p005',
    mrn: 'OR-100702',
    given: 'Synthea',
    family: 'Marwick',
    birthDate: '1996-09-05',
    sexAtBirth: 'FEMALE',
    pronouns: 'they/them',
    portalEnabled: true,
    city: 'Birchwood',
  },
  {
    id: '0192f1a0-0000-7000-8000-00000000p006',
    mrn: 'OR-100744',
    given: 'Bram',
    family: 'Voskuijlen',
    birthDate: '1978-04-23',
    sexAtBirth: 'MALE',
    city: 'Cedar Falls',
  },
  {
    id: '0192f1a0-0000-7000-8000-00000000p007',
    mrn: 'OR-100810',
    given: 'Noor',
    family: 'Haddadin',
    birthDate: '2001-12-11',
    sexAtBirth: 'FEMALE',
    portalEnabled: true,
    city: 'Cedar Falls',
  },
  {
    id: '0192f1a0-0000-7000-8000-00000000p008',
    mrn: 'OR-100866',
    given: 'Ivo',
    family: 'Petrescu',
    birthDate: '1949-07-30',
    sexAtBirth: 'MALE',
    city: 'Birchwood',
  },
  {
    id: '0192f1a0-0000-7000-8000-00000000p009',
    mrn: 'OR-100913',
    given: 'Halla',
    family: 'Gunnarsdottir',
    birthDate: '1990-02-08',
    sexAtBirth: 'FEMALE',
    portalEnabled: true,
    city: 'Cedar Falls',
  },
  {
    id: '0192f1a0-0000-7000-8000-00000000p010',
    mrn: 'OR-100978',
    given: 'Tobias',
    family: 'Ekwueme',
    birthDate: '2014-10-17',
    sexAtBirth: 'MALE',
    city: 'Birchwood',
  },
  {
    id: '0192f1a0-0000-7000-8000-00000000p011',
    mrn: 'OR-101025',
    given: 'Wilma',
    family: 'Ahlgren',
    birthDate: '1937-05-26',
    sexAtBirth: 'FEMALE',
    city: 'Cedar Falls',
    active: false,
    deceasedAt: '2026-04-02T00:00:00.000Z',
  },
  {
    id: '0192f1a0-0000-7000-8000-00000000p012',
    mrn: 'OR-101088',
    given: 'Rafael',
    family: 'Quispe',
    birthDate: '1983-08-01',
    sexAtBirth: 'MALE',
    portalEnabled: true,
    city: 'Cedar Falls',
  },
];

function toPatient(seed: PatientSeed): Patient {
  return {
    id: seed.id,
    mrn: seed.mrn,
    primaryFacilityId: MOCK_FACILITY.id,
    name: {
      given: seed.given,
      middle: null,
      family: seed.family,
      prefix: null,
      suffix: null,
      preferred: seed.preferred ?? null,
    },
    birthDate: seed.birthDate,
    deceasedAt: seed.deceasedAt ?? null,
    sexAtBirth: seed.sexAtBirth,
    genderIdentityCode: null,
    pronouns: seed.pronouns ?? null,
    raceCodes: [],
    ethnicityCodes: [],
    languageCode: seed.languageCode ?? 'en-US',
    maritalStatusCode: null,
    telecom: {
      email: seed.email ?? null,
      phoneMobile: seed.phoneMobile ?? null,
      phoneHome: null,
    },
    address: {
      line1: null,
      line2: null,
      city: seed.city ?? null,
      state: null,
      postalCode: null,
      country: 'US',
    },
    sensitivityClass: seed.sensitivityClass ?? 'NORMAL',
    portalEnabled: seed.portalEnabled ?? false,
    active: seed.active ?? true,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
  };
}

/**
 * The twelve patients in the order they are seeded above, which is the order
 * every other fixture in the app counts in: `AppointmentSeed.patientIndex` here,
 * and the MRNs the billing and chart fixtures hard-code.
 *
 * Kept separate from `MOCK_PATIENTS` on purpose. `MOCK_PATIENTS` is sorted, and
 * indexing a *sorted* array with a seed-order index is how every appointment in
 * this file silently ended up on the wrong patient - a deceased woman was
 * checked in for a blood-pressure review and a 43-year-old was booked for school
 * vaccines. Index this one; read the sorted one.
 */
const PATIENTS_IN_SEED_ORDER: readonly Patient[] = PATIENT_SEEDS.map(toPatient);

/** Twelve patients, ordered by family name, as the API's default sort returns them. */
export const MOCK_PATIENTS: readonly Patient[] = [...PATIENTS_IN_SEED_ORDER].sort((a, b) =>
  a.name.family.localeCompare(b.name.family, 'en')
);

interface AppointmentSeed {
  id: string;
  /** Index into `PATIENT_SEEDS` (declaration order), never into sorted `MOCK_PATIENTS`. */
  patientIndex: number;
  providerIndex: 0 | 1;
  /** `HH:MM` on the clinic day, UTC. */
  at: string;
  durationMinutes: number;
  status: Appointment['status'];
  typeCode: string;
  typeDisplay: string;
  room?: string;
  reasonText?: string;
  checkedInAt?: string;
  createdVia?: Appointment['createdVia'];
  cancelReason?: string;
}

const APPOINTMENT_SEEDS: readonly AppointmentSeed[] = [
  {
    id: '0192f1a0-0000-7000-8000-00000000a001',
    patientIndex: 0,
    providerIndex: 0,
    at: '08:00',
    durationMinutes: 20,
    status: 'FULFILLED',
    typeCode: 'FOLLOWUP',
    typeDisplay: 'Follow-up',
    room: 'Room 2',
    reasonText: 'Blood pressure review',
    checkedInAt: '2026-08-12T07:52:00.000Z',
  },
  {
    id: '0192f1a0-0000-7000-8000-00000000a002',
    patientIndex: 1,
    providerIndex: 0,
    at: '08:20',
    durationMinutes: 20,
    status: 'CHECKED_OUT',
    typeCode: 'CHRONIC',
    typeDisplay: 'Chronic care',
    room: 'Room 2',
    reasonText: 'Diabetes review',
    checkedInAt: '2026-08-12T08:14:00.000Z',
  },
  {
    id: '0192f1a0-0000-7000-8000-00000000a003',
    patientIndex: 2,
    providerIndex: 1,
    at: '08:40',
    durationMinutes: 30,
    status: 'FULFILLED',
    typeCode: 'WELLCHILD',
    typeDisplay: 'Well-child visit',
    room: 'Room 4',
    reasonText: 'Seven-year check',
    checkedInAt: '2026-08-12T08:31:00.000Z',
  },
  {
    id: '0192f1a0-0000-7000-8000-00000000a004',
    patientIndex: 3,
    providerIndex: 0,
    at: '09:00',
    durationMinutes: 20,
    status: 'IN_PROGRESS',
    typeCode: 'ACUTE',
    typeDisplay: 'Acute visit',
    room: 'Room 1',
    reasonText: 'Cough, four days',
    checkedInAt: '2026-08-12T08:57:00.000Z',
  },
  {
    id: '0192f1a0-0000-7000-8000-00000000a005',
    patientIndex: 4,
    providerIndex: 0,
    at: '09:20',
    durationMinutes: 20,
    status: 'ROOMED',
    typeCode: 'FOLLOWUP',
    typeDisplay: 'Follow-up',
    room: 'Room 3',
    reasonText: 'Medication review',
    checkedInAt: '2026-08-12T09:11:00.000Z',
  },
  {
    id: '0192f1a0-0000-7000-8000-00000000a006',
    patientIndex: 5,
    providerIndex: 1,
    at: '09:30',
    durationMinutes: 30,
    status: 'CHECKED_IN',
    typeCode: 'PHYSICAL',
    typeDisplay: 'Annual physical',
    reasonText: 'Annual physical',
    checkedInAt: '2026-08-12T09:26:00.000Z',
  },
  {
    id: '0192f1a0-0000-7000-8000-00000000a007',
    patientIndex: 6,
    providerIndex: 0,
    at: '09:40',
    durationMinutes: 20,
    status: 'ARRIVED',
    typeCode: 'ACUTE',
    typeDisplay: 'Acute visit',
    reasonText: 'Ankle injury',
    checkedInAt: '2026-08-12T09:38:00.000Z',
  },
  {
    id: '0192f1a0-0000-7000-8000-00000000a008',
    patientIndex: 7,
    providerIndex: 0,
    at: '10:00',
    durationMinutes: 20,
    status: 'NOSHOW',
    typeCode: 'FOLLOWUP',
    typeDisplay: 'Follow-up',
    reasonText: 'Post-discharge review',
  },
  {
    id: '0192f1a0-0000-7000-8000-00000000a009',
    patientIndex: 8,
    providerIndex: 1,
    at: '10:20',
    durationMinutes: 20,
    status: 'BOOKED',
    typeCode: 'FOLLOWUP',
    typeDisplay: 'Follow-up',
    reasonText: 'Thyroid results',
  },
  {
    id: '0192f1a0-0000-7000-8000-00000000a010',
    patientIndex: 9,
    providerIndex: 1,
    at: '10:40',
    durationMinutes: 30,
    status: 'BOOKED',
    typeCode: 'IMMUNISATION',
    typeDisplay: 'Immunisation',
    reasonText: 'School vaccines',
  },
  {
    id: '0192f1a0-0000-7000-8000-00000000a011',
    patientIndex: 11,
    providerIndex: 0,
    at: '11:00',
    durationMinutes: 20,
    status: 'BOOKED',
    typeCode: 'ACUTE',
    typeDisplay: 'Acute visit',
    reasonText: 'Rash on forearm',
    createdVia: 'PORTAL',
  },
  {
    id: '0192f1a0-0000-7000-8000-00000000a012',
    patientIndex: 0,
    providerIndex: 0,
    at: '11:20',
    durationMinutes: 20,
    status: 'CANCELLED',
    typeCode: 'FOLLOWUP',
    typeDisplay: 'Follow-up',
    cancelReason: 'Patient rescheduled by phone',
  },
  {
    id: '0192f1a0-0000-7000-8000-00000000a013',
    patientIndex: 4,
    providerIndex: 1,
    at: '13:00',
    durationMinutes: 40,
    status: 'BOOKED',
    typeCode: 'PROCEDURE',
    typeDisplay: 'Minor procedure',
    reasonText: 'Skin lesion removal',
  },
  {
    id: '0192f1a0-0000-7000-8000-00000000a014',
    patientIndex: 5,
    providerIndex: 0,
    at: '13:40',
    durationMinutes: 20,
    status: 'BOOKED',
    typeCode: 'TELEHEALTH',
    typeDisplay: 'Telehealth',
    reasonText: 'Results discussion',
    createdVia: 'PORTAL',
  },
  {
    id: '0192f1a0-0000-7000-8000-00000000a015',
    patientIndex: 6,
    providerIndex: 0,
    at: '14:00',
    durationMinutes: 20,
    status: 'BOOKED',
    typeCode: 'FOLLOWUP',
    typeDisplay: 'Follow-up',
    reasonText: 'Wound check',
  },
  {
    id: '0192f1a0-0000-7000-8000-00000000a016',
    patientIndex: 8,
    providerIndex: 1,
    at: '14:30',
    durationMinutes: 30,
    status: 'BOOKED',
    typeCode: 'CHRONIC',
    typeDisplay: 'Chronic care',
    reasonText: 'Asthma review',
  },
];

function instant(clockTime: string, offsetMinutes = 0): string {
  const base = new Date(`${MOCK_CLINIC_DAY}T${clockTime}:00.000Z`);
  return new Date(base.getTime() + offsetMinutes * 60_000).toISOString();
}

function toAppointment(seed: AppointmentSeed): Appointment {
  const patient = PATIENTS_IN_SEED_ORDER[seed.patientIndex % PATIENTS_IN_SEED_ORDER.length];
  const provider = MOCK_PROVIDERS[seed.providerIndex];
  return {
    id: seed.id,
    facilityId: MOCK_FACILITY.id,
    patientId: patient?.id ?? null,
    providerId: provider?.id ?? MOCK_PROVIDERS[0].id,
    type: { code: seed.typeCode, display: seed.typeDisplay },
    status: seed.status,
    start: instant(seed.at),
    end: instant(seed.at, seed.durationMinutes),
    durationMinutes: seed.durationMinutes,
    room: seed.room ?? null,
    reasonText: seed.reasonText ?? null,
    recurrenceGroupId: null,
    createdVia: seed.createdVia ?? 'STAFF',
    cancelReason: seed.cancelReason ?? null,
    checkedInAt: seed.checkedInAt ?? null,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
  };
}

/** Sixteen appointments across two providers, sorted by start, as the API returns them. */
export const MOCK_APPOINTMENTS: readonly Appointment[] = APPOINTMENT_SEEDS.map(toAppointment).sort(
  (a, b) => a.start.localeCompare(b.start)
);

/** Convenience lookup for screens that render a patient name beside an appointment. */
export function mockPatientById(patientId: string | null): Patient | undefined {
  if (!patientId) return undefined;
  return MOCK_PATIENTS.find((patient) => patient.id === patientId);
}

/* -------------------------------------------------------------------------- */
/* Front desk additions: rooms, flow-board timers, coverage                    */
/* -------------------------------------------------------------------------- */

/**
 * Everything below is fixture-only, for two different reasons worth keeping
 * apart.
 *
 * Rooms and flow-status history have no route at all: `apps/api` serves no
 * segment for either, and `facilityDtoSchema` carries no room list. Coverage
 * does have one, `/bff/v0/coverage`, and the fixture stays only because these
 * view types are not mapped onto it yet, which is a change of its own.
 *
 * Either way the shapes live here rather than in `types.ts`, which mirrors real
 * wire schemas only. When each is wired, delete the fixture and read it from
 * the client, exactly as the schedule now reads its facility and its
 * clinicians.
 */

/** The rooms a front desk can assign on the flow board. Admin-configured in reality. */
export const MOCK_ROOMS = ['Room 1', 'Room 2', 'Room 3', 'Room 4', 'Telehealth'] as const;

/**
 * When each appointment entered the status it is currently in.
 *
 * The flow board needs two clocks per patient: how long they have been in this
 * status, and how long they have been in the building. `checkedInAt` on the
 * appointment gives the second; this gives the first. Values are chosen so the
 * board shows one delayed patient, one in the caution band and the rest calm,
 * which is what an honest clinic day looks like at 10:20.
 */
export const MOCK_STATUS_SINCE: Readonly<Record<string, string>> = {
  '0192f1a0-0000-7000-8000-00000000a001': '2026-08-12T08:32:00.000Z',
  '0192f1a0-0000-7000-8000-00000000a002': '2026-08-12T09:48:00.000Z',
  '0192f1a0-0000-7000-8000-00000000a003': '2026-08-12T09:14:00.000Z',
  '0192f1a0-0000-7000-8000-00000000a004': '2026-08-12T10:06:00.000Z',
  '0192f1a0-0000-7000-8000-00000000a005': '2026-08-12T10:11:00.000Z',
  '0192f1a0-0000-7000-8000-00000000a006': '2026-08-12T09:26:00.000Z',
  '0192f1a0-0000-7000-8000-00000000a007': '2026-08-12T10:04:00.000Z',
};

/** Falls back to the arrival time, so a card always has a clock to show. */
export function mockStatusSince(appointment: Appointment): string | null {
  return MOCK_STATUS_SINCE[appointment.id] ?? appointment.checkedInAt;
}

export type CoveragePriority = 'PRIMARY' | 'SECONDARY' | 'TERTIARY';

/**
 * What the eligibility adapter answered. `UNAVAILABLE` is a partner outage, not
 * our failure, and the screen has to say so differently: reads keep working
 * when a write path is down.
 */
export type EligibilityOutcome = 'ACTIVE' | 'INACTIVE' | 'NOT_FOUND' | 'UNAVAILABLE';

export interface MockCoverage {
  id: string;
  patientId: string;
  priority: CoveragePriority;
  payerName: string;
  planName: string;
  /** Synthetic by construction: no real payer member-id format. */
  memberId: string;
  groupNumber: string | null;
  subscriberName: string;
  /** "Self", "Spouse", "Parent". */
  subscriberRelationship: string;
  /** `YYYY-MM-DD`. */
  effectiveFrom: string;
  effectiveTo: string | null;
  /** Major units, in the practice's currency. Null when the plan has no copay. */
  copayAmount: number | null;
  assignmentOfBenefits: boolean;
  /** ISO instant of the last eligibility answer, or null when never checked. */
  lastVerifiedAt: string | null;
  lastOutcome: EligibilityOutcome | null;
}

export interface MockEligibilityResult {
  coverageId: string;
  outcome: EligibilityOutcome;
  /** ISO instant the answer arrived. */
  checkedAt: string;
  copayAmount: number | null;
  deductibleRemaining: number | null;
  /** One sentence: what the payer said, or what to do when they said nothing. */
  detail: string;
}

const COVERAGE_SEEDS: readonly MockCoverage[] = [
  {
    id: '0192f1a0-0000-7000-8000-00000000c001',
    patientId: '0192f1a0-0000-7000-8000-00000000p001',
    priority: 'PRIMARY',
    payerName: 'Cedar Health Plan',
    planName: 'Cedar Choice PPO',
    memberId: 'ZZ-4471-08',
    groupNumber: 'GRP-2210',
    subscriberName: 'Testina Patientsson',
    subscriberRelationship: 'Self',
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    copayAmount: 25,
    assignmentOfBenefits: true,
    lastVerifiedAt: '2026-08-09T08:05:00.000Z',
    lastOutcome: 'ACTIVE',
  },
  {
    id: '0192f1a0-0000-7000-8000-00000000c002',
    patientId: '0192f1a0-0000-7000-8000-00000000p001',
    priority: 'SECONDARY',
    payerName: 'Northwind Supplemental',
    planName: 'Northwind Gap Cover',
    memberId: 'ZZ-9930-21',
    groupNumber: null,
    subscriberName: 'Testina Patientsson',
    subscriberRelationship: 'Self',
    effectiveFrom: '2024-04-01',
    effectiveTo: '2026-06-30',
    copayAmount: null,
    assignmentOfBenefits: false,
    lastVerifiedAt: '2026-07-02T10:41:00.000Z',
    lastOutcome: 'INACTIVE',
  },
  {
    id: '0192f1a0-0000-7000-8000-00000000c003',
    patientId: '0192f1a0-0000-7000-8000-00000000p002',
    priority: 'PRIMARY',
    payerName: 'Prairie State Assistance',
    planName: 'Prairie Managed Care',
    memberId: 'ZZ-1188-46',
    groupNumber: 'GRP-0041',
    subscriberName: 'Marek Oyelaran',
    subscriberRelationship: 'Self',
    effectiveFrom: '2025-09-01',
    effectiveTo: null,
    copayAmount: 0,
    assignmentOfBenefits: true,
    lastVerifiedAt: null,
    lastOutcome: null,
  },
  {
    id: '0192f1a0-0000-7000-8000-00000000c004',
    patientId: '0192f1a0-0000-7000-8000-00000000p003',
    priority: 'PRIMARY',
    payerName: 'Cedar Health Plan',
    planName: 'Cedar Family HMO',
    memberId: 'ZZ-5502-73',
    groupNumber: 'GRP-2210',
    subscriberName: 'Ingrid Fernstrom',
    subscriberRelationship: 'Parent',
    effectiveFrom: '2019-07-01',
    effectiveTo: null,
    copayAmount: 15,
    assignmentOfBenefits: true,
    lastVerifiedAt: '2026-08-11T14:22:00.000Z',
    lastOutcome: 'ACTIVE',
  },
  {
    id: '0192f1a0-0000-7000-8000-00000000c005',
    patientId: '0192f1a0-0000-7000-8000-00000000p004',
    priority: 'PRIMARY',
    payerName: 'Federal Senior Programme',
    planName: 'Senior Part B equivalent',
    memberId: 'ZZ-7741-90',
    groupNumber: null,
    subscriberName: 'Demo Rungard',
    subscriberRelationship: 'Self',
    effectiveFrom: '2019-02-01',
    effectiveTo: null,
    copayAmount: 20,
    assignmentOfBenefits: true,
    lastVerifiedAt: '2026-08-09T09:12:00.000Z',
    lastOutcome: 'ACTIVE',
  },
];

export const MOCK_COVERAGES: readonly MockCoverage[] = COVERAGE_SEEDS;

const PRIORITY_ORDER: Record<CoveragePriority, number> = {
  PRIMARY: 0,
  SECONDARY: 1,
  TERTIARY: 2,
};

/** Coverage for one patient, already in the priority order the cards stack in. */
export function mockCoveragesForPatient(patientId: string): MockCoverage[] {
  return MOCK_COVERAGES.filter((coverage) => coverage.patientId === patientId).sort(
    (a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]
  );
}

/**
 * The answer the adapter gives for each coverage. Deterministic, and chosen to
 * cover every outcome the screen has to render: an active plan, a terminated
 * one, a member the payer cannot find, and a payer that did not answer at all.
 */
const ELIGIBILITY_SEEDS: Readonly<Record<string, MockEligibilityResult>> = {
  '0192f1a0-0000-7000-8000-00000000c001': {
    coverageId: '0192f1a0-0000-7000-8000-00000000c001',
    outcome: 'ACTIVE',
    checkedAt: MOCK_NOW,
    copayAmount: 25,
    deductibleRemaining: 340,
    detail: 'Cedar Health Plan confirmed active coverage for today.',
  },
  '0192f1a0-0000-7000-8000-00000000c002': {
    coverageId: '0192f1a0-0000-7000-8000-00000000c002',
    outcome: 'INACTIVE',
    checkedAt: MOCK_NOW,
    copayAmount: null,
    deductibleRemaining: null,
    detail: 'Northwind Supplemental reports this plan terminated on 30 Jun 2026.',
  },
  '0192f1a0-0000-7000-8000-00000000c003': {
    coverageId: '0192f1a0-0000-7000-8000-00000000c003',
    outcome: 'NOT_FOUND',
    checkedAt: MOCK_NOW,
    copayAmount: null,
    deductibleRemaining: null,
    detail: 'Prairie State Assistance has no member matching this id and date of birth.',
  },
  '0192f1a0-0000-7000-8000-00000000c004': {
    coverageId: '0192f1a0-0000-7000-8000-00000000c004',
    outcome: 'ACTIVE',
    checkedAt: MOCK_NOW,
    copayAmount: 15,
    deductibleRemaining: 0,
    detail: 'Cedar Health Plan confirmed active coverage for today.',
  },
  '0192f1a0-0000-7000-8000-00000000c005': {
    coverageId: '0192f1a0-0000-7000-8000-00000000c005',
    outcome: 'UNAVAILABLE',
    checkedAt: MOCK_NOW,
    copayAmount: null,
    deductibleRemaining: null,
    detail: 'The eligibility service did not respond. The request is queued.',
  },
};

/** Instant in tests so nothing waits; visible in a browser so the checking state shows. */
const ELIGIBILITY_LATENCY_MS = process.env.NODE_ENV === 'test' ? 0 : 700;

/**
 * One eligibility check. It resolves rather than rejects for every outcome
 * including the outage, because "the payer did not answer" is an answer the
 * screen renders, not an error that replaces the screen.
 */
export function mockVerifyEligibility(coverageId: string): Promise<MockEligibilityResult> {
  const result: MockEligibilityResult = ELIGIBILITY_SEEDS[coverageId] ?? {
    coverageId,
    outcome: 'NOT_FOUND',
    checkedAt: MOCK_NOW,
    copayAmount: null,
    deductibleRemaining: null,
    detail: 'The payer has no member matching this id and date of birth.',
  };
  if (ELIGIBILITY_LATENCY_MS === 0) return Promise.resolve(result);
  return new Promise((resolve) => setTimeout(() => resolve(result), ELIGIBILITY_LATENCY_MS));
}

/* -------------------------------------------------------------------------- */
/* Orders, results and the typed inbox                                         */
/*                                                                             */
/* Appended by the orders-and-results screens. `apps/api` serves orders and     */
/* results but nothing maps them into the worklist view types yet, and the      */
/* inbox is a composition it has no segment for, so the fixtures below are the  */
/* only source those screens have today. The types live in `../worklist`,       */
/* which is where they move to `types.ts` once that mapping is written.         */
/*                                                                             */
/* Synthetic by construction, deterministic by construction: every instant is   */
/* written against MOCK_CLINIC_DAY and MOCK_NOW, and nothing reads the clock.   */
/* -------------------------------------------------------------------------- */

/** Patient ids by first name, so a fixture row never carries a bare UUID. */
const PATIENT_ID = {
  testina: '0192f1a0-0000-7000-8000-00000000p001',
  marek: '0192f1a0-0000-7000-8000-00000000p002',
  aiko: '0192f1a0-0000-7000-8000-00000000p003',
  demo: '0192f1a0-0000-7000-8000-00000000p004',
  synthea: '0192f1a0-0000-7000-8000-00000000p005',
  bram: '0192f1a0-0000-7000-8000-00000000p006',
  noor: '0192f1a0-0000-7000-8000-00000000p007',
  ivo: '0192f1a0-0000-7000-8000-00000000p008',
  halla: '0192f1a0-0000-7000-8000-00000000p009',
  tobias: '0192f1a0-0000-7000-8000-00000000p010',
  rafael: '0192f1a0-0000-7000-8000-00000000p012',
} as const;

const PROVIDER_ID = {
  okafor: MOCK_PROVIDERS[0].id,
  lindqvist: MOCK_PROVIDERS[1].id,
} as const;

/** The destinations a signed order can go to. Chosen, never typed. */
export const MOCK_ORDER_DESTINATIONS = [
  'Cedar Reference Lab',
  'Cedar Clinic, in-house',
  'Birchwood Imaging',
] as const;

/**
 * The active problem list per patient, ICD-10 coded.
 *
 * Two screens read it: the composer ranks the catalogue against it, and the
 * justify picker offers it as the diagnoses an order can be linked to.
 */
export const MOCK_PATIENT_PROBLEMS: Readonly<Record<string, PatientProblem[]>> = {
  [PATIENT_ID.testina]: [
    { code: 'E11.9', display: 'Type 2 diabetes', onset: '2021-04-09' },
    { code: 'I10', display: 'High blood pressure', onset: '2019-11-22' },
  ],
  [PATIENT_ID.marek]: [
    { code: 'E11.22', display: 'Type 2 diabetes with kidney disease', onset: '2016-02-18' },
    { code: 'N18.30', display: 'Chronic kidney disease, stage 3', onset: '2023-09-01' },
  ],
  [PATIENT_ID.aiko]: [{ code: 'J45.20', display: 'Mild intermittent asthma', onset: '2024-05-30' }],
  [PATIENT_ID.bram]: [{ code: 'E78.5', display: 'Raised blood lipids', onset: '2022-01-14' }],
  [PATIENT_ID.noor]: [{ code: 'D50.9', display: 'Iron deficiency anaemia', onset: '2026-05-19' }],
  [PATIENT_ID.halla]: [{ code: 'E03.9', display: 'Underactive thyroid', onset: '2024-10-02' }],
  [PATIENT_ID.demo]: [{ code: 'J20.9', display: 'Acute bronchitis', onset: '2026-08-09' }],
};

/**
 * The orderable catalogue.
 *
 * Small on purpose: a practice orders the same twenty things, and the screen is
 * built around that fact rather than around a searchable universe.
 */
export const MOCK_ORDER_CATALOG: readonly OrderCatalogEntry[] = [
  {
    code: 'LAB-HBA1C',
    name: 'HbA1c',
    category: 'LAB',
    specimen: 'Blood, EDTA',
    destination: 'Cedar Reference Lab',
    favourite: true,
    problemCodes: ['E11.9', 'E11.22'],
    keywords: ['a1c', 'glycated haemoglobin', 'diabetes'],
    turnaround: 'Next working day',
  },
  {
    code: 'LAB-BMP',
    name: 'Basic metabolic panel',
    category: 'LAB',
    specimen: 'Blood, serum',
    destination: 'Cedar Reference Lab',
    favourite: true,
    problemCodes: ['I10', 'N18.30'],
    keywords: ['bmp', 'electrolytes', 'sodium', 'potassium'],
    turnaround: 'Same day',
  },
  {
    code: 'LAB-CMP',
    name: 'Comprehensive metabolic panel',
    category: 'LAB',
    specimen: 'Blood, serum',
    destination: 'Cedar Reference Lab',
    favourite: false,
    problemCodes: ['N18.30', 'E11.22'],
    keywords: ['cmp', 'liver', 'electrolytes'],
    turnaround: 'Same day',
  },
  {
    code: 'LAB-LIPID',
    name: 'Lipid panel',
    category: 'LAB',
    specimen: 'Blood, serum',
    destination: 'Cedar Reference Lab',
    favourite: true,
    problemCodes: ['E78.5', 'I10'],
    keywords: ['cholesterol', 'ldl', 'hdl', 'triglycerides'],
    turnaround: 'Next working day',
  },
  {
    code: 'LAB-CBC',
    name: 'Full blood count with differential',
    category: 'LAB',
    specimen: 'Blood, EDTA',
    destination: 'Cedar Reference Lab',
    favourite: true,
    problemCodes: ['D50.9'],
    keywords: ['cbc', 'fbc', 'haemoglobin', 'white cells'],
    turnaround: 'Same day',
  },
  {
    code: 'LAB-TSH',
    name: 'Thyroid panel',
    category: 'LAB',
    specimen: 'Blood, serum',
    destination: 'Cedar Reference Lab',
    favourite: false,
    problemCodes: ['E03.9'],
    keywords: ['tsh', 'thyroid', 'free t4'],
    turnaround: 'Next working day',
  },
  {
    code: 'LAB-CREAT',
    name: 'Creatinine',
    category: 'LAB',
    specimen: 'Blood, serum',
    destination: 'Cedar Reference Lab',
    favourite: false,
    problemCodes: ['N18.30', 'E11.22'],
    keywords: ['kidney', 'renal', 'egfr'],
    turnaround: 'Same day',
  },
  {
    code: 'LAB-FERRITIN',
    name: 'Ferritin',
    category: 'LAB',
    specimen: 'Blood, serum',
    destination: 'Cedar Reference Lab',
    favourite: false,
    problemCodes: ['D50.9'],
    keywords: ['iron', 'anaemia'],
    turnaround: 'Next working day',
  },
  {
    code: 'LAB-URINE',
    name: 'Urinalysis',
    category: 'LAB',
    specimen: 'Urine, random',
    destination: 'Cedar Clinic, in-house',
    favourite: false,
    problemCodes: ['E11.9', 'N18.30'],
    keywords: ['urine', 'dipstick', 'protein'],
    turnaround: 'Same visit',
  },
  {
    code: 'LAB-INR',
    name: 'INR',
    category: 'LAB',
    specimen: 'Blood, citrate',
    destination: 'Cedar Clinic, in-house',
    favourite: false,
    problemCodes: [],
    keywords: ['clotting', 'warfarin', 'prothrombin'],
    turnaround: 'Same visit',
  },
  {
    code: 'IMG-CXR',
    name: 'Chest X-ray, two views',
    category: 'IMAGING',
    specimen: null,
    destination: 'Birchwood Imaging',
    favourite: true,
    problemCodes: ['J45.20', 'J20.9'],
    keywords: ['cxr', 'chest', 'radiograph'],
    turnaround: 'Same day',
  },
  {
    code: 'IMG-ANKLE',
    name: 'Ankle X-ray, three views',
    category: 'IMAGING',
    specimen: null,
    destination: 'Birchwood Imaging',
    favourite: false,
    problemCodes: [],
    keywords: ['ankle', 'fracture', 'radiograph'],
    turnaround: 'Same day',
  },
  {
    code: 'IMG-CT-ABDO',
    name: 'CT abdomen with contrast',
    category: 'IMAGING',
    specimen: null,
    destination: 'Birchwood Imaging',
    favourite: false,
    problemCodes: [],
    keywords: ['ct', 'abdomen', 'contrast'],
    turnaround: 'Two working days',
  },
  {
    code: 'IMG-THYROID-US',
    name: 'Thyroid ultrasound',
    category: 'IMAGING',
    specimen: null,
    destination: 'Birchwood Imaging',
    favourite: false,
    problemCodes: ['E03.9'],
    keywords: ['ultrasound', 'thyroid', 'neck'],
    turnaround: 'Three working days',
  },
  {
    code: 'PRC-ECG',
    name: 'ECG, 12-lead',
    category: 'PROCEDURE',
    specimen: null,
    destination: 'Cedar Clinic, in-house',
    favourite: true,
    problemCodes: ['I10'],
    keywords: ['ecg', 'ekg', 'heart tracing'],
    turnaround: 'Same visit',
  },
  {
    code: 'PRC-SPIRO',
    name: 'Spirometry',
    category: 'PROCEDURE',
    specimen: null,
    destination: 'Cedar Clinic, in-house',
    favourite: false,
    problemCodes: ['J45.20'],
    keywords: ['lung function', 'asthma', 'peak flow'],
    turnaround: 'Same visit',
  },
];

/**
 * The tiered checks the composer runs (guidelines C10).
 *
 * Three tiers and no more: INFO is a line, CAUTION is a caramel-wash banner that
 * asks to be read, CRITICAL blocks signing until a reason is chosen. Alert
 * fatigue is what killed CPOE elsewhere, so this table stays short by design.
 */
export const MOCK_ORDER_WARNINGS: readonly OrderWarning[] = [
  {
    id: 'warn-lipid-recent',
    orderCode: 'LAB-LIPID',
    patientId: PATIENT_ID.testina,
    tier: 'INFO',
    title: 'Last lipid panel was in range',
    detail: 'The 14 Feb 2026 panel was in range. The next one is due from 14 Feb 2027.',
  },
  {
    id: 'warn-creatinine-repeat',
    orderCode: 'LAB-CREAT',
    patientId: PATIENT_ID.testina,
    tier: 'CAUTION',
    title: 'Creatinine resulted three days ago',
    detail:
      'A creatinine resulted 9 Aug 2026 at 74 umol/L, in range. A repeat inside seven days rarely changes management.',
  },
  {
    id: 'warn-hba1c-duplicate',
    orderCode: 'LAB-HBA1C',
    patientId: PATIENT_ID.testina,
    tier: 'CRITICAL',
    title: 'HbA1c ordered 10 Aug is still in progress',
    detail:
      'Cedar Reference Lab has the first specimen. A duplicate inside 30 days is not payable and delays the result.',
    overrideReasons: [
      'The first specimen was rejected by the lab',
      'Clinical change since the first order',
      'Patient is travelling and needs the result today',
    ],
  },
  {
    id: 'warn-contrast-kidney',
    orderCode: 'IMG-CT-ABDO',
    patientId: PATIENT_ID.marek,
    tier: 'CRITICAL',
    title: 'Contrast study with reduced kidney function',
    detail:
      'eGFR was 38 mL/min on 12 Aug 2026. Iodinated contrast carries a real risk of further decline.',
    overrideReasons: [
      'Nephrology has cleared the study',
      'Hydration protocol is in place',
      'Benefit outweighs the risk, discussed with the patient',
    ],
  },
  {
    id: 'warn-ecg-slot',
    orderCode: 'PRC-ECG',
    patientId: null,
    tier: 'CAUTION',
    title: 'ECG slots run until 16:00',
    detail: 'An ECG ordered after 16:00 is performed on the next working day.',
  },
  {
    id: 'warn-imaging-release',
    orderCode: 'IMG-CXR',
    patientId: null,
    tier: 'INFO',
    title: 'Imaging releases to the portal after review',
    detail: 'The patient sees the report once a clinician has signed it off.',
  },
  {
    id: 'warn-tsh-trend',
    orderCode: 'LAB-TSH',
    patientId: PATIENT_ID.halla,
    tier: 'INFO',
    title: 'TSH is being tracked',
    detail: 'The 2 Jul 2026 TSH was 8.4 mIU/L, above range.',
  },
];

interface OrderSeed {
  id: string;
  patientId: string;
  code: string;
  status: OrderStatus;
  priority: OrderPriority;
  placedAt: string;
  lastEventAt: string;
  providerId: string;
  diagnosisCode: string | null;
  diagnosisDisplay: string | null;
  resultId?: string;
  cancelReason?: string;
}

const ORDER_SEEDS: readonly OrderSeed[] = [
  {
    id: '0192f1a0-0000-7000-8000-00000000o001',
    patientId: PATIENT_ID.testina,
    code: 'LAB-HBA1C',
    status: 'IN_PROGRESS',
    priority: 'ROUTINE',
    placedAt: '2026-08-10T09:12:00.000Z',
    lastEventAt: '2026-08-10T09:41:00.000Z',
    providerId: PROVIDER_ID.okafor,
    diagnosisCode: 'E11.9',
    diagnosisDisplay: 'Type 2 diabetes',
  },
  {
    id: '0192f1a0-0000-7000-8000-00000000o002',
    patientId: PATIENT_ID.marek,
    code: 'LAB-CMP',
    status: 'RESULTED',
    priority: 'URGENT',
    placedAt: '2026-08-12T07:02:00.000Z',
    lastEventAt: '2026-08-12T09:40:00.000Z',
    providerId: PROVIDER_ID.okafor,
    diagnosisCode: 'N18.30',
    diagnosisDisplay: 'Chronic kidney disease, stage 3',
    resultId: '0192f1a0-0000-7000-8000-00000000r001',
  },
  {
    id: '0192f1a0-0000-7000-8000-00000000o003',
    patientId: PATIENT_ID.testina,
    code: 'LAB-LIPID',
    status: 'RESULTED',
    priority: 'ROUTINE',
    placedAt: '2026-08-05T08:30:00.000Z',
    lastEventAt: '2026-08-06T11:15:00.000Z',
    providerId: PROVIDER_ID.okafor,
    diagnosisCode: 'I10',
    diagnosisDisplay: 'High blood pressure',
    resultId: '0192f1a0-0000-7000-8000-00000000r002',
  },
  {
    id: '0192f1a0-0000-7000-8000-00000000o004',
    patientId: PATIENT_ID.halla,
    code: 'LAB-TSH',
    status: 'RESULTED',
    priority: 'ROUTINE',
    placedAt: '2026-08-07T10:05:00.000Z',
    lastEventAt: '2026-08-08T13:20:00.000Z',
    providerId: PROVIDER_ID.lindqvist,
    diagnosisCode: 'E03.9',
    diagnosisDisplay: 'Underactive thyroid',
    resultId: '0192f1a0-0000-7000-8000-00000000r003',
  },
  {
    id: '0192f1a0-0000-7000-8000-00000000o005',
    patientId: PATIENT_ID.noor,
    code: 'LAB-CBC',
    status: 'RESULTED',
    priority: 'ROUTINE',
    placedAt: '2026-08-08T09:45:00.000Z',
    lastEventAt: '2026-08-11T08:05:00.000Z',
    providerId: PROVIDER_ID.okafor,
    diagnosisCode: 'D50.9',
    diagnosisDisplay: 'Iron deficiency anaemia',
    resultId: '0192f1a0-0000-7000-8000-00000000r004',
  },
  {
    id: '0192f1a0-0000-7000-8000-00000000o006',
    patientId: PATIENT_ID.bram,
    code: 'LAB-BMP',
    status: 'RESULTED',
    priority: 'ROUTINE',
    placedAt: '2026-08-11T08:15:00.000Z',
    lastEventAt: '2026-08-11T15:40:00.000Z',
    providerId: PROVIDER_ID.okafor,
    diagnosisCode: 'E78.5',
    diagnosisDisplay: 'Raised blood lipids',
    resultId: '0192f1a0-0000-7000-8000-00000000r005',
  },
  {
    id: '0192f1a0-0000-7000-8000-00000000o007',
    patientId: PATIENT_ID.synthea,
    code: 'LAB-URINE',
    status: 'RESULTED',
    priority: 'ROUTINE',
    placedAt: '2026-08-11T11:20:00.000Z',
    lastEventAt: '2026-08-11T12:05:00.000Z',
    providerId: PROVIDER_ID.lindqvist,
    diagnosisCode: null,
    diagnosisDisplay: null,
    resultId: '0192f1a0-0000-7000-8000-00000000r006',
  },
  {
    id: '0192f1a0-0000-7000-8000-00000000o008',
    patientId: PATIENT_ID.aiko,
    code: 'IMG-CXR',
    status: 'RESULTED',
    priority: 'ROUTINE',
    placedAt: '2026-08-06T14:10:00.000Z',
    lastEventAt: '2026-08-07T09:30:00.000Z',
    providerId: PROVIDER_ID.lindqvist,
    diagnosisCode: 'J45.20',
    diagnosisDisplay: 'Mild intermittent asthma',
    resultId: '0192f1a0-0000-7000-8000-00000000r007',
  },
  {
    id: '0192f1a0-0000-7000-8000-00000000o009',
    patientId: PATIENT_ID.rafael,
    code: 'PRC-ECG',
    status: 'RESULTED',
    priority: 'ROUTINE',
    placedAt: '2026-08-04T15:00:00.000Z',
    lastEventAt: '2026-08-04T15:25:00.000Z',
    providerId: PROVIDER_ID.okafor,
    diagnosisCode: null,
    diagnosisDisplay: null,
    resultId: '0192f1a0-0000-7000-8000-00000000r008',
  },
  {
    id: '0192f1a0-0000-7000-8000-00000000o010',
    patientId: PATIENT_ID.ivo,
    code: 'IMG-ANKLE',
    status: 'TRANSMITTED',
    priority: 'URGENT',
    placedAt: '2026-08-10T11:05:00.000Z',
    lastEventAt: '2026-08-10T11:06:00.000Z',
    providerId: PROVIDER_ID.okafor,
    diagnosisCode: null,
    diagnosisDisplay: null,
  },
  {
    id: '0192f1a0-0000-7000-8000-00000000o011',
    patientId: PATIENT_ID.demo,
    code: 'LAB-CREAT',
    status: 'PENDED',
    priority: 'ROUTINE',
    placedAt: '2026-08-12T09:05:00.000Z',
    lastEventAt: '2026-08-12T09:05:00.000Z',
    providerId: PROVIDER_ID.okafor,
    diagnosisCode: 'J20.9',
    diagnosisDisplay: 'Acute bronchitis',
  },
  {
    id: '0192f1a0-0000-7000-8000-00000000o012',
    patientId: PATIENT_ID.tobias,
    code: 'IMG-CXR',
    status: 'CANCELLED',
    priority: 'ROUTINE',
    placedAt: '2026-08-09T13:40:00.000Z',
    lastEventAt: '2026-08-09T13:52:00.000Z',
    providerId: PROVIDER_ID.lindqvist,
    diagnosisCode: null,
    diagnosisDisplay: null,
    cancelReason: 'Ordered on the wrong patient',
  },
  {
    id: '0192f1a0-0000-7000-8000-00000000o013',
    patientId: PATIENT_ID.testina,
    code: 'PRC-SPIRO',
    status: 'SIGNED',
    priority: 'ROUTINE',
    placedAt: '2026-08-12T10:05:00.000Z',
    lastEventAt: '2026-08-12T10:06:00.000Z',
    providerId: PROVIDER_ID.okafor,
    diagnosisCode: 'E11.9',
    diagnosisDisplay: 'Type 2 diabetes',
  },
];

function catalogEntry(code: string): OrderCatalogEntry {
  const entry = MOCK_ORDER_CATALOG.find((candidate) => candidate.code === code);
  if (!entry) throw new Error(`Fixture order code ${code} is not in the catalogue.`);
  return entry;
}

/** Thirteen orders across the practice, newest first, as the ledger reads them. */
export const MOCK_ORDERS: readonly Order[] = ORDER_SEEDS.map((seed): Order => {
  const entry = catalogEntry(seed.code);
  return {
    id: seed.id,
    patientId: seed.patientId,
    code: entry.code,
    name: entry.name,
    category: entry.category,
    status: seed.status,
    priority: seed.priority,
    placedAt: seed.placedAt,
    lastEventAt: seed.lastEventAt,
    providerId: seed.providerId,
    destination: entry.destination,
    specimen: entry.specimen,
    diagnosisCode: seed.diagnosisCode,
    diagnosisDisplay: seed.diagnosisDisplay,
    resultId: seed.resultId ?? null,
    cancelReason: seed.cancelReason ?? null,
  };
}).sort((a, b) => b.placedAt.localeCompare(a.placedAt));

/**
 * Eight reports, abnormal-heavy on purpose: a results queue that is all normal
 * teaches nothing about the screen that has to triage it.
 */
export const MOCK_RESULTS: readonly ResultReport[] = [
  {
    id: '0192f1a0-0000-7000-8000-00000000r001',
    orderId: '0192f1a0-0000-7000-8000-00000000o002',
    patientId: PATIENT_ID.marek,
    panel: 'Comprehensive metabolic panel',
    category: 'LAB',
    collectedAt: '2026-08-12T07:05:00.000Z',
    reportedAt: '2026-08-12T09:40:00.000Z',
    flag: 'CRITICAL',
    status: 'UNREVIEWED',
    performer: 'Cedar Reference Lab',
    orderedBy: PROVIDER_ID.okafor,
    assignedTo: 'ME',
    narrative: null,
    analytes: [
      {
        code: '2823-3',
        label: 'Potassium',
        value: 6.2,
        unit: 'mmol/L',
        low: 3.5,
        high: 5.1,
        decimals: 1,
        previous: [
          { at: '2026-06-14T08:10:00.000Z', value: 5.4 },
          { at: '2026-03-11T08:30:00.000Z', value: 5 },
        ],
      },
      {
        code: '2160-0',
        label: 'Creatinine',
        value: 168,
        unit: 'umol/L',
        low: 60,
        high: 110,
        previous: [
          { at: '2026-06-14T08:10:00.000Z', value: 141 },
          { at: '2026-03-11T08:30:00.000Z', value: 132 },
        ],
      },
      { code: '2951-2', label: 'Sodium', value: 138, unit: 'mmol/L', low: 135, high: 145 },
      { code: '48642-3', label: 'eGFR', value: 38, unit: 'mL/min/1.73m2', low: 60 },
      {
        code: '2345-7',
        label: 'Glucose',
        value: 9.8,
        unit: 'mmol/L',
        low: 4,
        high: 7.8,
        decimals: 1,
      },
    ],
  },
  {
    id: '0192f1a0-0000-7000-8000-00000000r002',
    orderId: '0192f1a0-0000-7000-8000-00000000o003',
    patientId: PATIENT_ID.testina,
    panel: 'Lipid panel',
    category: 'LAB',
    collectedAt: '2026-08-05T08:44:00.000Z',
    reportedAt: '2026-08-06T11:15:00.000Z',
    flag: 'ABNORMAL',
    status: 'UNREVIEWED',
    performer: 'Cedar Reference Lab',
    orderedBy: PROVIDER_ID.okafor,
    assignedTo: 'ME',
    narrative: null,
    analytes: [
      {
        code: '13457-7',
        label: 'LDL cholesterol',
        value: 4.4,
        unit: 'mmol/L',
        high: 3,
        decimals: 1,
        previous: [
          { at: '2026-02-14T09:00:00.000Z', value: 3.6 },
          { at: '2025-08-19T09:20:00.000Z', value: 3.4 },
        ],
      },
      { code: '2085-9', label: 'HDL cholesterol', value: 1.2, unit: 'mmol/L', low: 1, decimals: 1 },
      {
        code: '2093-3',
        label: 'Total cholesterol',
        value: 6.4,
        unit: 'mmol/L',
        high: 5,
        decimals: 1,
      },
      {
        code: '2571-8',
        label: 'Triglycerides',
        value: 1.8,
        unit: 'mmol/L',
        high: 1.7,
        decimals: 1,
      },
    ],
  },
  {
    id: '0192f1a0-0000-7000-8000-00000000r003',
    orderId: '0192f1a0-0000-7000-8000-00000000o004',
    patientId: PATIENT_ID.halla,
    panel: 'Thyroid panel',
    category: 'LAB',
    collectedAt: '2026-08-07T10:22:00.000Z',
    reportedAt: '2026-08-08T13:20:00.000Z',
    flag: 'ABNORMAL',
    status: 'UNREVIEWED',
    performer: 'Cedar Reference Lab',
    orderedBy: PROVIDER_ID.lindqvist,
    assignedTo: 'TEAM',
    narrative: null,
    analytes: [
      {
        code: '3016-3',
        label: 'TSH',
        value: 8.4,
        unit: 'mIU/L',
        low: 0.4,
        high: 4,
        decimals: 1,
        previous: [
          { at: '2026-07-02T09:15:00.000Z', value: 6.1 },
          { at: '2026-01-29T09:05:00.000Z', value: 4.8 },
        ],
      },
      {
        code: '3024-7',
        label: 'Free T4',
        value: 11.2,
        unit: 'pmol/L',
        low: 9,
        high: 19,
        decimals: 1,
      },
    ],
  },
  {
    id: '0192f1a0-0000-7000-8000-00000000r004',
    orderId: '0192f1a0-0000-7000-8000-00000000o005',
    patientId: PATIENT_ID.noor,
    panel: 'Full blood count with differential',
    category: 'LAB',
    collectedAt: '2026-08-08T10:02:00.000Z',
    reportedAt: '2026-08-11T08:05:00.000Z',
    flag: 'ABNORMAL',
    status: 'UNREVIEWED',
    performer: 'Cedar Reference Lab',
    orderedBy: PROVIDER_ID.okafor,
    assignedTo: 'ME',
    narrative: null,
    analytes: [
      {
        code: '718-7',
        label: 'Haemoglobin',
        value: 96,
        unit: 'g/L',
        low: 120,
        high: 155,
        previous: [
          { at: '2026-05-19T09:40:00.000Z', value: 104 },
          { at: '2025-11-04T09:10:00.000Z', value: 118 },
        ],
      },
      { code: '2276-4', label: 'Ferritin', value: 8, unit: 'ug/L', low: 15, high: 200 },
      { code: '787-2', label: 'Mean cell volume', value: 74, unit: 'fL', low: 80, high: 100 },
      {
        code: '6690-2',
        label: 'White cell count',
        value: 6.4,
        unit: '10^9/L',
        low: 4,
        high: 11,
        decimals: 1,
      },
    ],
  },
  {
    id: '0192f1a0-0000-7000-8000-00000000r005',
    orderId: '0192f1a0-0000-7000-8000-00000000o006',
    patientId: PATIENT_ID.bram,
    panel: 'Basic metabolic panel',
    category: 'LAB',
    collectedAt: '2026-08-11T08:31:00.000Z',
    reportedAt: '2026-08-11T15:40:00.000Z',
    flag: 'NORMAL',
    status: 'UNREVIEWED',
    performer: 'Cedar Reference Lab',
    orderedBy: PROVIDER_ID.okafor,
    assignedTo: 'ME',
    narrative: null,
    analytes: [
      { code: '2951-2', label: 'Sodium', value: 140, unit: 'mmol/L', low: 135, high: 145 },
      {
        code: '2823-3',
        label: 'Potassium',
        value: 4.2,
        unit: 'mmol/L',
        low: 3.5,
        high: 5.1,
        decimals: 1,
      },
      { code: '2160-0', label: 'Creatinine', value: 88, unit: 'umol/L', low: 60, high: 110 },
      {
        code: '2345-7',
        label: 'Glucose',
        value: 5.4,
        unit: 'mmol/L',
        low: 4,
        high: 7.8,
        decimals: 1,
      },
    ],
  },
  {
    id: '0192f1a0-0000-7000-8000-00000000r006',
    orderId: '0192f1a0-0000-7000-8000-00000000o007',
    patientId: PATIENT_ID.synthea,
    panel: 'Urinalysis',
    category: 'LAB',
    collectedAt: '2026-08-11T11:26:00.000Z',
    reportedAt: '2026-08-11T12:05:00.000Z',
    flag: 'NORMAL',
    status: 'UNREVIEWED',
    performer: 'Cedar Clinic, in-house',
    orderedBy: PROVIDER_ID.lindqvist,
    assignedTo: 'TEAM',
    narrative: null,
    analytes: [
      { code: '5803-2', label: 'pH', value: 6, unit: 'pH', low: 4.5, high: 8, decimals: 1 },
      {
        code: '5811-5',
        label: 'Specific gravity',
        value: 1.015,
        unit: '',
        low: 1.005,
        high: 1.03,
        decimals: 3,
      },
      { code: '5792-7', label: 'Glucose, urine', value: 0, unit: 'mmol/L', high: 0.8, decimals: 1 },
    ],
  },
  {
    id: '0192f1a0-0000-7000-8000-00000000r007',
    orderId: '0192f1a0-0000-7000-8000-00000000o008',
    patientId: PATIENT_ID.aiko,
    panel: 'Chest X-ray, two views',
    category: 'IMAGING',
    collectedAt: '2026-08-06T15:02:00.000Z',
    reportedAt: '2026-08-07T09:30:00.000Z',
    flag: 'NORMAL',
    status: 'UNREVIEWED',
    performer: 'Birchwood Imaging',
    orderedBy: PROVIDER_ID.lindqvist,
    assignedTo: 'ME',
    analytes: [],
    narrative:
      'Impression: clear lung fields with no focal consolidation. Heart size is within normal limits for age. No pleural effusion.',
  },
  {
    id: '0192f1a0-0000-7000-8000-00000000r008',
    orderId: '0192f1a0-0000-7000-8000-00000000o009',
    patientId: PATIENT_ID.rafael,
    panel: 'ECG, 12-lead',
    category: 'PROCEDURE',
    collectedAt: '2026-08-04T15:10:00.000Z',
    reportedAt: '2026-08-04T15:25:00.000Z',
    flag: 'NORMAL',
    status: 'SIGNED',
    performer: 'Cedar Clinic, in-house',
    orderedBy: PROVIDER_ID.okafor,
    assignedTo: 'ME',
    analytes: [],
    narrative: 'Impression: sinus rhythm at 68 beats per minute. No acute changes.',
  },
];

/**
 * Eleven inbox items across the five streams.
 *
 * Every row carries a due time, because an item without an SLA is an item
 * nobody owns. Two are already overdue and two are due inside the hour: an
 * inbox fixture where everything is comfortable would hide the state that
 * matters.
 */
export const MOCK_INBOX_ITEMS: readonly InboxItem[] = [
  {
    id: '0192f1a0-0000-7000-8000-00000000i001',
    stream: 'RESULTS',
    patientId: PATIENT_ID.marek,
    summary: 'Critical potassium on a metabolic panel',
    detail: 'Potassium 6.2 mmol/L, above range. Reported 09:40 today by Cedar Reference Lab.',
    receivedAt: '2026-08-12T09:41:00.000Z',
    dueAt: '2026-08-12T11:00:00.000Z',
    assignedTo: 'ME',
    unread: true,
    actionLabel: 'Review result',
    doneLabel: 'Result opened',
    href: '/results',
  },
  {
    id: '0192f1a0-0000-7000-8000-00000000i002',
    stream: 'RESULTS',
    patientId: PATIENT_ID.noor,
    summary: 'Full blood count back, haemoglobin below range',
    detail: 'Haemoglobin 96 g/L and ferritin 8 ug/L, both below range.',
    receivedAt: '2026-08-11T08:06:00.000Z',
    dueAt: '2026-08-13T09:00:00.000Z',
    assignedTo: 'ME',
    unread: true,
    actionLabel: 'Review result',
    doneLabel: 'Result opened',
    href: '/results',
  },
  {
    id: '0192f1a0-0000-7000-8000-00000000i003',
    stream: 'RESULTS',
    patientId: PATIENT_ID.halla,
    summary: 'Thyroid panel back, TSH above range',
    detail: 'TSH 8.4 mIU/L against a range of 0.4 to 4.0 mIU/L.',
    receivedAt: '2026-08-08T13:21:00.000Z',
    dueAt: '2026-08-13T12:00:00.000Z',
    assignedTo: 'TEAM',
    unread: false,
    actionLabel: 'Review result',
    doneLabel: 'Result opened',
    href: '/results',
  },
  {
    id: '0192f1a0-0000-7000-8000-00000000i004',
    stream: 'MESSAGES',
    patientId: PATIENT_ID.synthea,
    summary: 'Asks whether to finish the antibiotic course',
    detail: 'Portal message, sent 08:40 today. Two days of the course remain.',
    receivedAt: '2026-08-12T08:40:00.000Z',
    dueAt: '2026-08-12T17:00:00.000Z',
    assignedTo: 'ME',
    unread: true,
    actionLabel: 'Reply',
    doneLabel: 'Reply sent',
    href: null,
  },
  {
    id: '0192f1a0-0000-7000-8000-00000000i005',
    stream: 'MESSAGES',
    patientId: PATIENT_ID.rafael,
    summary: 'Asks to move the Thursday appointment',
    detail: 'Portal message, sent yesterday evening. Front desk can take this one.',
    receivedAt: '2026-08-11T21:05:00.000Z',
    dueAt: '2026-08-13T17:00:00.000Z',
    assignedTo: 'TEAM',
    unread: false,
    actionLabel: 'Reply',
    doneLabel: 'Reply sent',
    href: null,
  },
  {
    id: '0192f1a0-0000-7000-8000-00000000i006',
    stream: 'REFILLS',
    patientId: PATIENT_ID.bram,
    summary: 'Atorvastatin 20 mg, three refills requested',
    detail: 'Last dispensed 14 Jul 2026. Lipids reviewed 11 Aug 2026.',
    receivedAt: '2026-08-11T18:02:00.000Z',
    dueAt: '2026-08-13T09:00:00.000Z',
    assignedTo: 'TEAM',
    unread: false,
    actionLabel: 'Approve refill',
    doneLabel: 'Refill approved',
    href: null,
  },
  {
    id: '0192f1a0-0000-7000-8000-00000000i007',
    stream: 'REFILLS',
    patientId: PATIENT_ID.halla,
    summary: 'Levothyroxine 75 mcg, portal request',
    detail: 'TSH from 8 Aug 2026 is above range, so the dose may need review first.',
    receivedAt: '2026-08-10T20:14:00.000Z',
    dueAt: '2026-08-11T17:00:00.000Z',
    assignedTo: 'ME',
    unread: true,
    actionLabel: 'Approve refill',
    doneLabel: 'Refill approved',
    href: null,
  },
  {
    id: '0192f1a0-0000-7000-8000-00000000i008',
    stream: 'COSIGN',
    patientId: PATIENT_ID.aiko,
    summary: 'Well-child visit note, 8 Aug, Dr. Lindqvist',
    detail: 'Attestation only. Nothing in the note has changed since it was signed.',
    receivedAt: '2026-08-08T16:40:00.000Z',
    dueAt: '2026-08-15T17:00:00.000Z',
    assignedTo: 'ME',
    unread: false,
    actionLabel: 'Cosign note',
    doneLabel: 'Note cosigned',
    href: null,
  },
  {
    id: '0192f1a0-0000-7000-8000-00000000i009',
    stream: 'COSIGN',
    patientId: PATIENT_ID.demo,
    summary: 'Acute visit note, 9 Aug, awaiting cosign',
    detail: 'Three days in the queue. The visit is otherwise closed.',
    receivedAt: '2026-08-09T17:30:00.000Z',
    dueAt: '2026-08-11T17:00:00.000Z',
    assignedTo: 'ME',
    unread: true,
    actionLabel: 'Cosign note',
    doneLabel: 'Note cosigned',
    href: null,
  },
  {
    id: '0192f1a0-0000-7000-8000-00000000i010',
    stream: 'TASKS',
    patientId: PATIENT_ID.ivo,
    summary: 'Chase Birchwood Imaging for the ankle X-ray',
    detail: 'Transmitted 10 Aug at 11:06 and still unacknowledged.',
    receivedAt: '2026-08-12T08:00:00.000Z',
    dueAt: '2026-08-12T12:00:00.000Z',
    assignedTo: 'TEAM',
    unread: false,
    actionLabel: 'Mark done',
    doneLabel: 'Task closed',
    href: '/orders',
  },
  {
    id: '0192f1a0-0000-7000-8000-00000000i011',
    stream: 'TASKS',
    patientId: null,
    summary: 'Physiotherapy prior authorisation expires on 20 Aug',
    detail: 'Practice-wide task. Renew before the first appointment of next week.',
    receivedAt: '2026-08-12T07:30:00.000Z',
    dueAt: '2026-08-14T17:00:00.000Z',
    assignedTo: 'TEAM',
    unread: false,
    actionLabel: 'Mark done',
    doneLabel: 'Task closed',
    href: null,
  },
];

/** The report a ledger row links to, or undefined when nothing has come back. */
export function mockResultById(resultId: string | null): ResultReport | undefined {
  if (!resultId) return undefined;
  return MOCK_RESULTS.find((report) => report.id === resultId);
}
