/**
 * The wire shapes of `apps/api`, hand-written rather than generated.
 *
 * Every type here mirrors a Zod schema in `apps/api/src/schemas`, named in the
 * comment above it. They are hand-written on purpose: `apps/web` must not
 * import `@openrunic/database` (Prisma client, server-only) or `apps/api`
 * (Node runtime, `.js` ESM specifiers) to render a page. When a route's schema
 * changes, change the matching interface here in the same pull request.
 *
 * The one rule for screen agents: never restate one of these shapes locally.
 * Import the type.
 */

/** Mirrors `APPOINTMENT_STATUSES` in `@openrunic/database`. */
export const APPOINTMENT_STATUSES = [
  'PROPOSED',
  'PENDING',
  'BOOKED',
  'ARRIVED',
  'CHECKED_IN',
  'ROOMED',
  'IN_PROGRESS',
  'CHECKED_OUT',
  'FULFILLED',
  'CANCELLED',
  'NOSHOW',
  'ENTERED_IN_ERROR',
] as const;

export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

/** Mirrors `APPOINTMENT_CREATED_VIA`. */
export const APPOINTMENT_CREATED_VIA = ['STAFF', 'PORTAL', 'WAITLIST', 'RECALL', 'IMPORT'] as const;

export type AppointmentCreatedVia = (typeof APPOINTMENT_CREATED_VIA)[number];

/** Mirrors `ADMINISTRATIVE_GENDERS`. */
export const ADMINISTRATIVE_GENDERS = ['FEMALE', 'MALE', 'OTHER', 'UNKNOWN'] as const;

export type AdministrativeGender = (typeof ADMINISTRATIVE_GENDERS)[number];

/** Mirrors `SENSITIVITY_CLASSES`. */
export const SENSITIVITY_CLASSES = ['NORMAL', 'RESTRICTED', 'VERY_RESTRICTED'] as const;

export type SensitivityClass = (typeof SENSITIVITY_CLASSES)[number];

/** Mirrors `patientDtoSchema.name`. */
export interface PatientName {
  given: string;
  middle: string | null;
  family: string;
  prefix: string | null;
  suffix: string | null;
  preferred: string | null;
}

export interface PatientTelecom {
  email: string | null;
  phoneMobile: string | null;
  phoneHome: string | null;
}

export interface PatientAddress {
  line1: string | null;
  line2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string;
}

/** Mirrors `patientDtoSchema` in `apps/api/src/schemas/patients.ts`. */
export interface Patient {
  id: string;
  mrn: string;
  primaryFacilityId: string | null;
  name: PatientName;
  /** `YYYY-MM-DD`. A date of birth has no time and no timezone. */
  birthDate: string;
  deceasedAt: string | null;
  sexAtBirth: AdministrativeGender;
  genderIdentityCode: string | null;
  pronouns: string | null;
  raceCodes: string[];
  ethnicityCodes: string[];
  languageCode: string;
  maritalStatusCode: string | null;
  telecom: PatientTelecom;
  address: PatientAddress;
  sensitivityClass: SensitivityClass;
  portalEnabled: boolean;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Mirrors `appointmentDtoSchema` in `apps/api/src/schemas/appointments.ts`. */
export interface Appointment {
  id: string;
  facilityId: string;
  patientId: string | null;
  providerId: string;
  type: { code: string; display: string };
  status: AppointmentStatus;
  /** ISO instant. */
  start: string;
  /** ISO instant. */
  end: string;
  durationMinutes: number;
  room: string | null;
  reasonText: string | null;
  recurrenceGroupId: string | null;
  createdVia: AppointmentCreatedVia;
  cancelReason: string | null;
  checkedInAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Mirrors `pageMetaSchema`. Every list response carries one. */
export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  /** Never zero: an empty search still has one (empty) page to render. */
  totalPages: number;
}

/** Mirrors `listResponseSchema(item)`. */
export interface ListResponse<T> {
  data: T[];
  page: PageMeta;
}

/** Mirrors `problemDocumentSchema` (RFC 9457 plus `requestId` and `errors`). */
export interface ProblemDocument {
  /** `https://openrunic.org/problems/<kind>`. Branch on this, never on `title`. */
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  requestId: string;
  errors?: Array<{ path: string; message: string }>;
}

/** Query fields shared by every list endpoint. */
export interface PaginationQuery {
  page?: number;
  pageSize?: number;
}

/** Mirrors `patientListQuerySchema`. The API rejects unknown keys with a 400. */
export interface PatientListQuery extends PaginationQuery {
  /** Free text over family, given, preferred name and MRN. */
  q?: string;
  mrn?: string;
  /** Case-insensitive prefix match, per the FHIR `string` search semantic. */
  family?: string;
  given?: string;
  /** `YYYY-MM-DD`. */
  birthDate?: string;
  active?: boolean;
  sort?: 'familyName' | 'birthDate' | 'createdAt';
  order?: 'asc' | 'desc';
}

/** Mirrors `appointmentListQuerySchema`. */
export interface AppointmentListQuery extends PaginationQuery {
  facilityId?: string;
  providerId?: string;
  patientId?: string;
  status?: AppointmentStatus;
  /** Inclusive lower bound on `start`, as an ISO instant with offset. */
  from?: string;
  /** Exclusive upper bound, so one day is `[00:00, next 00:00)`. */
  to?: string;
  sort?: 'start' | 'createdAt';
  order?: 'asc' | 'desc';
}

/**
 * The read surface every screen shares. The live client and the mock client
 * both satisfy it, which is what makes mock mode a transport swap rather than a
 * second code path through the screens.
 */
export interface ApiClient {
  readonly mode: 'live' | 'mock';
  patients: {
    list: (query?: PatientListQuery, signal?: AbortSignal) => Promise<ListResponse<Patient>>;
    get: (id: string, signal?: AbortSignal) => Promise<Patient>;
  };
  appointments: {
    list: (
      query?: AppointmentListQuery,
      signal?: AbortSignal
    ) => Promise<ListResponse<Appointment>>;
    get: (id: string, signal?: AbortSignal) => Promise<Appointment>;
  };
}
