import type { Hono } from 'hono';

import { createApp, type CreateAppOptions } from '../app.js';
import { createAuditChainStore, type AuditChainStore } from '../audit/chain-store.js';
import { createMemoryAuditSink, type MemoryAuditSink } from '../audit/memory-sink.js';
import type { Principal, PrincipalResolver } from '../auth/principal.js';
import {
  createStaticPrincipalResolver,
  DEMO_FACILITY_A,
  DEMO_FACILITY_B,
  DEMO_PORTAL_PATIENT,
  DEMO_PRINCIPALS,
  DEMO_TENANT_A,
  DEMO_TENANT_B,
} from '../auth/static-resolver.js';
import type { AppEnv } from '../context.js';
import {
  createEmptyDataset,
  createMemoryRepositoryRegistry,
  type MemoryDataset,
} from '../repositories/memory.js';
import type { PrismaModelName, ScopedRow } from '../repositories/rows.js';
import type { AppointmentRow, PatientRow } from '../repositories/types.js';

/**
 * Fixtures and harness for the API suite.
 *
 * Synthetic data only, per the repo's hard rule: Testina Patientsson,
 * MRN OR-100482, Dr. Okafor, `.invalid` domains and `+1555` numbers. Nothing
 * here should ever be mistaken for a real person if it leaks into a log or a
 * screenshot.
 */

export { DEMO_FACILITY_A, DEMO_FACILITY_B, DEMO_PORTAL_PATIENT, DEMO_TENANT_A, DEMO_TENANT_B };

/** Bearer tokens from the static resolver. Public fixtures, not credentials. */
export const TOKENS = {
  clinicianA: 'dev-clinician-a',
  frontDeskA: 'dev-frontdesk-a',
  billerA: 'dev-biller-a',
  clinicianB: 'dev-clinician-b',
  /** A portal login, pinned to one chart by its launch context. */
  portalA: 'dev-portal-a',
  adminA: 'test-admin-a',
  /** A second administrator in the same organisation as `adminA`. */
  secondAdminA: 'test-second-admin-a',
  /** An administrator in the other organisation. */
  adminB: 'test-admin-b',
  /** Every permission, and a token pinned to one chart all the same. */
  compartmentAdminA: 'test-compartment-admin-a',
  /** Every permission, and a token authorised for Patients only. */
  patientScopeAdminA: 'test-patient-scope-admin-a',
  /** Holds every permission but no SMART scope at all. */
  noScopeA: 'test-no-scope-a',
  /** Holds a patient scope with no launch context to honour it. */
  danglingPatientScopeA: 'test-dangling-patient-scope-a',
} as const;

/** A valid, stable UUIDv7-shaped id. */
export function testId(n: number): string {
  return `01890000-0000-7000-8000-${String(n).padStart(12, '0')}`;
}

export const FIXED_NOW = new Date('2026-08-13T09:00:00.000Z');

export function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

export function jsonBearer(token: string): Record<string, string> {
  return { ...bearer(token), 'content-type': 'application/json' };
}

/** Storage columns every fixture row carries, so a spec's own columns are all a test writes. */
export function storageColumns(
  id: string,
  tenantId = DEMO_TENANT_A
): {
  id: string;
  tenantId: string;
  createdAt: Date;
  updatedAt: Date;
} {
  return { id, tenantId, createdAt: FIXED_NOW, updatedAt: FIXED_NOW };
}

/** Puts rows straight into a table, bypassing the API. */
export function seed<M extends PrismaModelName>(
  dataset: MemoryDataset,
  model: M,
  ...rows: ScopedRow<M>[]
): void {
  dataset.table(model).push(...rows);
}

export function makePatientRow(overrides: Partial<PatientRow> = {}): PatientRow {
  return {
    id: testId(1),
    tenantId: DEMO_TENANT_A,
    mrn: 'OR-100482',
    primaryFacilityId: DEMO_FACILITY_A,
    givenName: 'Testina',
    middleName: null,
    familyName: 'Patientsson',
    prefix: null,
    suffix: null,
    preferredName: null,
    birthDate: new Date('1994-03-02T00:00:00.000Z'),
    deceasedAt: null,
    sexAtBirth: 'FEMALE',
    genderIdentityCode: null,
    pronouns: null,
    raceCodes: [],
    ethnicityCodes: [],
    languageCode: 'en',
    maritalStatusCode: null,
    email: null,
    phoneMobile: null,
    phoneHome: null,
    addressLine1: null,
    addressLine2: null,
    city: null,
    state: null,
    postalCode: null,
    country: 'US',
    sensitivityClass: 'NORMAL',
    portalEnabled: false,
    active: true,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...overrides,
  };
}

export function makeAppointmentRow(overrides: Partial<AppointmentRow> = {}): AppointmentRow {
  return {
    id: testId(101),
    tenantId: DEMO_TENANT_A,
    facilityId: DEMO_FACILITY_A,
    patientId: testId(1),
    providerId: testId(900),
    typeCode: 'OFFICE-30',
    typeDisplay: 'Office visit, 30 minutes',
    status: 'BOOKED',
    start: new Date('2026-08-14T15:00:00.000Z'),
    end: new Date('2026-08-14T15:30:00.000Z'),
    durationMinutes: 30,
    room: null,
    reasonText: null,
    recurrenceGroupId: null,
    recurrenceRule: null,
    createdVia: 'STAFF',
    cancelReason: null,
    checkedInAt: null,
    createdById: null,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...overrides,
  };
}

export interface TestApp {
  app: Hono<AppEnv>;
  dataset: MemoryDataset;
  sink: MemoryAuditSink;
  /** The chain the sink appends to, and the one `/bff/v0/audit` reads. */
  auditStore: AuditChainStore;
}

export interface TestAppOptions extends Omit<CreateAppOptions, 'repositories' | 'auditSink'> {
  dataset?: MemoryDataset;
}

/**
 * A principal whose roles resolve to no permissions at all. Every route should
 * refuse it, which is the only way to test a denial on a route that all of the
 * seeded roles happen to be allowed to reach.
 */
export const UNPRIVILEGED_TOKEN = 'test-unprivileged';

export const UNPRIVILEGED_PRINCIPAL: Principal = {
  subject: testId(950),
  tenantId: DEMO_TENANT_A,
  actorType: 'user',
  displayName: 'Role Was Renamed',
  roles: ['a-role-that-grants-nothing'],
  facilityIds: [DEMO_FACILITY_A],
  scopes: [],
  purposeOfUse: 'HOPERAT',
};

/** Holds every permission and every facility, for the administrative routes. */
export const ADMIN_PRINCIPAL: Principal = {
  subject: testId(951),
  tenantId: DEMO_TENANT_A,
  actorType: 'user',
  displayName: 'Practice Administrator',
  roles: ['admin'],
  facilityIds: [DEMO_FACILITY_A],
  scopes: ['user/*.read', 'user/*.write'],
  purposeOfUse: 'HOPERAT',
};

/**
 * An otherwise-privileged staff principal whose token carries no SMART scope.
 * The internal API does not consult scopes, so it must still work; the FHIR
 * boundary does, so it must not.
 */
export const NO_SCOPE_PRINCIPAL: Principal = {
  ...ADMIN_PRINCIPAL,
  subject: testId(952),
  scopes: [],
};

/**
 * A token asking for a patient compartment without saying which one. There is
 * no safe reading of that, so the boundary refuses it rather than widening it
 * to the organisation.
 */
export const DANGLING_PATIENT_SCOPE_PRINCIPAL: Principal = {
  ...ADMIN_PRINCIPAL,
  subject: testId(953),
  scopes: ['patient/*.read'],
};

/**
 * A second administrator in the same organisation.
 *
 * Exists so a test can ask what one privileged principal may do with something
 * another one produced. Same tenant, same role, different subject: everything a
 * tenant check would let through.
 */
export const SECOND_ADMIN_PRINCIPAL: Principal = {
  ...ADMIN_PRINCIPAL,
  subject: testId(954),
  displayName: 'Second Administrator',
};

/** An administrator in the other organisation, for cross-tenant refusals. */
export const ADMIN_B_PRINCIPAL: Principal = {
  ...ADMIN_PRINCIPAL,
  subject: testId(955),
  tenantId: DEMO_TENANT_B,
  facilityIds: [DEMO_FACILITY_B],
  displayName: 'Other Practice Administrator',
};

/**
 * An administrator whose token is nonetheless pinned to one chart.
 *
 * Not a configuration the seeded roles produce - it is what a tenant that forks
 * them could produce - and it is the only way to test a compartment refusal
 * separately from the permission that usually fires first.
 */
export const COMPARTMENT_ADMIN_PRINCIPAL: Principal = {
  ...ADMIN_PRINCIPAL,
  subject: testId(956),
  compartmentPatientId: DEMO_PORTAL_PATIENT,
};

/** Every permission, but a token authorised to ask about Patients and nothing else. */
export const PATIENT_SCOPE_ADMIN_PRINCIPAL: Principal = {
  ...ADMIN_PRINCIPAL,
  subject: testId(957),
  scopes: ['user/Patient.read'],
};

/**
 * The demo resolver plus the fixtures above. Kept out of `static-resolver.ts`
 * because that table ships with the application, and a principal that exists
 * only for a denial test does not belong in it.
 */
export function testPrincipalResolver(): PrincipalResolver {
  return createStaticPrincipalResolver(
    new Map([
      ...DEMO_PRINCIPALS,
      [UNPRIVILEGED_TOKEN, UNPRIVILEGED_PRINCIPAL],
      [TOKENS.adminA, ADMIN_PRINCIPAL],
      [TOKENS.secondAdminA, SECOND_ADMIN_PRINCIPAL],
      [TOKENS.adminB, ADMIN_B_PRINCIPAL],
      [TOKENS.compartmentAdminA, COMPARTMENT_ADMIN_PRINCIPAL],
      [TOKENS.patientScopeAdminA, PATIENT_SCOPE_ADMIN_PRINCIPAL],
      [TOKENS.noScopeA, NO_SCOPE_PRINCIPAL],
      [TOKENS.danglingPatientScopeA, DANGLING_PATIENT_SCOPE_PRINCIPAL],
    ])
  );
}

/** Builds the real app over the in-memory store, with a deterministic clock and ids. */
export function createTestApp(options: TestAppOptions = {}): TestApp {
  const dataset = options.dataset ?? createEmptyDataset();
  const auditStore = createAuditChainStore();
  const sink = createMemoryAuditSink({ store: auditStore, now: () => FIXED_NOW });
  let counter = 500;

  const repositories = createMemoryRepositoryRegistry({
    dataset,
    clock: { now: () => FIXED_NOW },
    nextId: () => testId((counter += 1)),
    auditStore,
  });

  const app = createApp({
    principalResolver: testPrincipalResolver(),
    ...options,
    repositories,
    auditSink: sink,
    now: () => FIXED_NOW,
  });

  return { app, dataset, sink, auditStore };
}

/** Seeds `count` patients into one tenant, named so sort order is predictable. */
export function seedPatients(
  dataset: MemoryDataset,
  count: number,
  tenantId = DEMO_TENANT_A
): void {
  for (let index = 0; index < count; index += 1) {
    seed(
      dataset,
      'Patient',
      makePatientRow({
        id: testId(index + 1),
        tenantId,
        mrn: `OR-1004${String(index).padStart(2, '0')}`,
        familyName: `Testperson${String.fromCharCode(65 + (index % 26))}`,
        givenName: `Given${String(index).padStart(2, '0')}`,
      })
    );
  }
}
