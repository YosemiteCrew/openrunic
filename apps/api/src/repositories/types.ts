import type {
  ADMINISTRATIVE_GENDERS,
  APPOINTMENT_CREATED_VIA,
  APPOINTMENT_STATUSES,
  AppointmentCreateInput,
  PatientCreateInput,
  PatientUpdateInput,
  SENSITIVITY_CLASSES,
} from '@openrunic/database';

import type { AuditCollector } from '../audit/collector.js';

/**
 * Data access, behind an interface.
 *
 * Handlers depend on these interfaces and never on Prisma. Two implementations
 * exist: `./memory.ts`, which the entire test suite runs against, and
 * `./prisma.ts`, which runs in production. That split is what lets the API's
 * behaviour - pagination, search, tenant isolation, audit emission - be proved
 * without a database, while the Prisma adapter is proved separately against a
 * fake that satisfies the same narrow port as the real client.
 *
 * Note what is *not* on these interfaces: a tenant id. Repositories are bound
 * to one organisation at construction by {@link RepositoryRegistry.forRequest},
 * so a handler holding one cannot ask it about another tenant. Cross-tenant
 * access is not a check that a handler can forget; it is a parameter a handler
 * cannot supply.
 */

export type AdministrativeGender = (typeof ADMINISTRATIVE_GENDERS)[number];
export type SensitivityClass = (typeof SENSITIVITY_CLASSES)[number];
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];
export type AppointmentCreatedVia = (typeof APPOINTMENT_CREATED_VIA)[number];

/** The stored patient, as the API reads it. Mirrors the Prisma `Patient` columns. */
export interface PatientRow {
  id: string;
  tenantId: string;
  mrn: string;
  primaryFacilityId: string | null;
  givenName: string;
  middleName: string | null;
  familyName: string;
  prefix: string | null;
  suffix: string | null;
  preferredName: string | null;
  birthDate: Date;
  deceasedAt: Date | null;
  sexAtBirth: AdministrativeGender;
  genderIdentityCode: string | null;
  pronouns: string | null;
  raceCodes: string[];
  ethnicityCodes: string[];
  languageCode: string;
  maritalStatusCode: string | null;
  email: string | null;
  phoneMobile: string | null;
  phoneHome: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string;
  sensitivityClass: SensitivityClass;
  portalEnabled: boolean;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** The stored appointment, as the API reads it. Mirrors the Prisma `Appointment` columns. */
export interface AppointmentRow {
  id: string;
  tenantId: string;
  facilityId: string;
  patientId: string | null;
  providerId: string;
  typeCode: string;
  typeDisplay: string;
  status: AppointmentStatus;
  start: Date;
  end: Date;
  durationMinutes: number;
  room: string | null;
  reasonText: string | null;
  recurrenceGroupId: string | null;
  createdVia: AppointmentCreatedVia;
  cancelReason: string | null;
  checkedInAt: Date | null;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** One page of results plus the count needed to render a pager. */
export interface Page<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}

export type SortOrder = 'asc' | 'desc';

export interface PatientListQuery {
  page: number;
  pageSize: number;
  /** Exact logical id. Backs the FHIR `_id` search parameter. */
  id?: string;
  /** Free text matched against family name, given name and MRN. */
  q?: string;
  mrn?: string;
  sexAtBirth?: AdministrativeGender;
  family?: string;
  given?: string;
  /** Exact date of birth, midnight UTC. */
  birthDate?: Date;
  active?: boolean;
  sort: 'familyName' | 'birthDate' | 'createdAt';
  order: SortOrder;
}

export interface AppointmentListQuery {
  page: number;
  pageSize: number;
  facilityId?: string;
  providerId?: string;
  patientId?: string;
  status?: AppointmentStatus;
  /** Inclusive lower bound on `start`. */
  from?: Date;
  /** Exclusive upper bound on `start`. */
  to?: Date;
  sort: 'start' | 'createdAt';
  order: SortOrder;
}

/** Fields an appointment update may change. Reschedules keep the same row. */
export interface AppointmentUpdateInput {
  status?: AppointmentStatus;
  start?: Date;
  end?: Date;
  durationMinutes?: number;
  room?: string;
  reasonText?: string;
  cancelReason?: string;
  providerId?: string;
  typeCode?: string;
  typeDisplay?: string;
}

export interface PatientRepository {
  list(query: PatientListQuery): Promise<Page<PatientRow>>;
  findById(id: string): Promise<PatientRow | null>;
  findByMrn(mrn: string): Promise<PatientRow | null>;
  create(input: PatientCreateInput): Promise<PatientRow>;
  /** Resolves to `null` when the id belongs to no patient *in this tenant*. */
  update(id: string, input: PatientUpdateInput): Promise<PatientRow | null>;
}

export interface AppointmentRepository {
  list(query: AppointmentListQuery): Promise<Page<AppointmentRow>>;
  findById(id: string): Promise<AppointmentRow | null>;
  create(input: AppointmentCreateInput): Promise<AppointmentRow>;
  update(id: string, input: AppointmentUpdateInput): Promise<AppointmentRow | null>;
}

/** Every repository, already bound to one tenant and one audit collector. */
export interface Repositories {
  readonly tenantId: string;
  readonly patients: PatientRepository;
  readonly appointments: AppointmentRepository;
}

/** What the tenant-scope middleware supplies to obtain request-bound repositories. */
export interface RequestScope {
  tenantId: string;
  audit: AuditCollector;
}

export interface RepositoryRegistry {
  forRequest(scope: RequestScope): Repositories;
}
