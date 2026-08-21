import type {
  ADMINISTRATIVE_GENDERS,
  APPOINTMENT_CREATED_VIA,
  IMAGING_STUDY_STATUSES,
  APPOINTMENT_STATUSES,
  SENSITIVITY_CLASSES,
} from '@openrunic/database';

import type { AuditQueryRepository } from './audit-query.js';
import type { Collection, CollectionSpec } from './collection.js';
import type { RequestScope } from './registry.js';
import type { ScopedRow } from './rows.js';
import type { COLLECTION_SPECS } from './specs/index.js';

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
 *
 * The set of repositories is derived from the spec map rather than listed
 * again here, so adding an aggregate to `specs/` is the whole of adding it to
 * the API's data layer.
 */

export type AdministrativeGender = (typeof ADMINISTRATIVE_GENDERS)[number];
export type SensitivityClass = (typeof SENSITIVITY_CLASSES)[number];
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];
export type AppointmentCreatedVia = (typeof APPOINTMENT_CREATED_VIA)[number];
export type ImagingStudyStatus = (typeof IMAGING_STUDY_STATUSES)[number];

export type { Page, SortOrder, BaseQuery } from './collection.js';
export type { RequestScope } from './registry.js';
export type { ScopedRow } from './rows.js';
export type { AuditEventRow, AuditQuery, AuditQueryRepository } from './audit-query.js';
export type {
  AppointmentListQuery,
  AppointmentUpdateInput,
  PatientListQuery,
} from './specs/core.js';

/** The stored patient, as the API reads it. */
export type PatientRow = ScopedRow<'Patient'>;
/** The stored appointment, as the API reads it. */
export type AppointmentRow = ScopedRow<'Appointment'>;

type CollectionOf<S> =
  S extends CollectionSpec<infer M, infer TCreate, infer TPatch, infer TQuery>
    ? Collection<ScopedRow<M>, TCreate, TPatch, TQuery>
    : never;

export type CollectionKey = keyof typeof COLLECTION_SPECS;

/** Every repository, already bound to one tenant, one compartment and one collector. */
export type Repositories = {
  readonly tenantId: string;
  /** The audit log: readable, never writable through the API. */
  readonly audit: AuditQueryRepository;
} & {
  readonly [K in CollectionKey]: CollectionOf<(typeof COLLECTION_SPECS)[K]>;
};

export interface RepositoryRegistry {
  forRequest(scope: RequestScope): Repositories;
}
