import type { Hono } from 'hono';

import { createMemoryAuditSink, type MemoryAuditSink } from '../audit/memory-sink.js';
import type { Principal, PrincipalResolver } from '../auth/principal.js';
import {
  createStaticPrincipalResolver,
  DEMO_FACILITY_A,
  DEMO_FACILITY_B,
  DEMO_PRINCIPALS,
  DEMO_TENANT_A,
  DEMO_TENANT_B,
} from '../auth/static-resolver.js';
import { createApp, type CreateAppOptions } from '../app.js';
import type { AppEnv } from '../context.js';
import {
  createEmptyDataset,
  createMemoryRepositoryRegistry,
  type MemoryDataset,
} from '../repositories/memory.js';
import type { AppointmentRow, PatientRow } from '../repositories/types.js';

/**
 * Fixtures and harness for the API suite.
 *
 * Synthetic data only, per the repo's hard rule: Testina Patientsson,
 * MRN OR-100482, Dr. Okafor, `.invalid` domains and `+1555` numbers. Nothing
 * here should ever be mistaken for a real person if it leaks into a log or a
 * screenshot.
 */

export { DEMO_FACILITY_A, DEMO_FACILITY_B, DEMO_TENANT_A, DEMO_TENANT_B };

/** Bearer tokens from the static resolver. Public fixtures, not credentials. */
export const TOKENS = {
  clinicianA: 'dev-clinician-a',
  frontDeskA: 'dev-frontdesk-a',
  billerA: 'dev-biller-a',
  clinicianB: 'dev-clinician-b',
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
  purposeOfUse: 'HOPERAT',
};

/**
 * The demo resolver plus the unprivileged principal above. Kept out of
 * `static-resolver.ts` because that table ships with the application, and a
 * fixture that exists only for a denial test does not belong in it.
 */
export function testPrincipalResolver(): PrincipalResolver {
  return createStaticPrincipalResolver(
    new Map([...DEMO_PRINCIPALS, [UNPRIVILEGED_TOKEN, UNPRIVILEGED_PRINCIPAL]])
  );
}

/** Builds the real app over the in-memory store, with a deterministic clock and ids. */
export function createTestApp(options: TestAppOptions = {}): TestApp {
  const dataset = options.dataset ?? createEmptyDataset();
  const sink = createMemoryAuditSink();
  let counter = 500;

  const repositories = createMemoryRepositoryRegistry({
    dataset,
    clock: { now: () => FIXED_NOW },
    nextId: () => testId(++counter),
  });

  const app = createApp({
    principalResolver: testPrincipalResolver(),
    ...options,
    repositories,
    auditSink: sink,
    now: () => FIXED_NOW,
  });

  return { app, dataset, sink };
}

/** Seeds `count` patients into one tenant, named so sort order is predictable. */
export function seedPatients(
  dataset: MemoryDataset,
  count: number,
  tenantId = DEMO_TENANT_A
): void {
  for (let index = 0; index < count; index += 1) {
    dataset.patients.push(
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
