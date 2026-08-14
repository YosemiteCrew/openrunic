'use client';

import { useMemo } from 'react';

import { queryKey, useApiQuery } from './hooks';
import type { AsyncState } from './hooks';
import { createAdminMockClient } from './mock/admin';
import type { ListResponse } from './types';

/**
 * The admin, developer-platform and reports read surface.
 *
 * Half of what this file describes is already served. Audit events, facilities,
 * staff users, roles, form definitions and terminology all have routes in
 * `apps/api`; those screens are fixture-backed because nothing maps those
 * payloads into the view types here yet. API keys, API scopes, integrations,
 * webhooks, SMART apps, the permission matrix, the practice dashboard and the
 * visit report have no route at all.
 *
 * Either way the shapes here are written the way the API answers rather than
 * the way a screen happens to want them: list responses carry a `page`, ids are
 * opaque strings, instants are ISO, and nothing is pre-formatted. When a live
 * client is written, it slots in beside the mock one and no screen changes.
 *
 * Screens import from `@/lib/api` and never from here directly.
 */

/* -------------------------------------------------------------------------- */
/* Users and roles (AD-01)                                                     */
/* -------------------------------------------------------------------------- */

/** Named role bundles. Policy is enforced at the data layer; this is its label. */
export const STAFF_ROLES = [
  'PRACTICE_ADMIN',
  'PROVIDER',
  'MEDICAL_ASSISTANT',
  'FRONT_DESK',
  'BILLER',
  'READ_ONLY',
] as const;

export type StaffRole = (typeof STAFF_ROLES)[number];

/** Deactivated is a state, never a deletion: an actor in the audit trail must resolve. */
export const STAFF_STATUSES = ['ACTIVE', 'INVITED', 'DEACTIVATED'] as const;

export type StaffStatus = (typeof STAFF_STATUSES)[number];

export interface StaffUser {
  id: string;
  /** Legal name, as it signs a note. */
  name: string;
  /** How the practice refers to them: "Dr. Okafor". */
  displayName: string;
  email: string;
  roles: StaffRole[];
  facilityIds: string[];
  isProvider: boolean;
  /** Provider identifiers. Null for non-clinical staff. */
  npi: string | null;
  taxonomy: string | null;
  mfaEnrolled: boolean;
  status: StaffStatus;
  lastActiveAt: string | null;
  invitedAt: string | null;
  deactivatedAt: string | null;
  /**
   * Per-user grants beyond the role bundle. Always rendered as exceptions, never
   * folded into the role: an admin must be able to see why one account differs.
   */
  exceptions: string[];
}

export interface StaffUserQuery {
  q?: string;
  role?: StaffRole;
  status?: StaffStatus;
  facilityId?: string;
}

export type PermissionLevel = 'ALLOW' | 'DENY';

/** One row of the role editor's matrix: a capability against every role. */
export interface PermissionRow {
  id: string;
  capability: string;
  /** One plain sentence. The role summary is assembled from these. */
  description: string;
  roles: Record<StaffRole, PermissionLevel>;
}

/* -------------------------------------------------------------------------- */
/* Facilities (AD-02)                                                          */
/* -------------------------------------------------------------------------- */

export interface FacilityHours {
  /** "Monday". Rendered as written; the slot engine reads the times. */
  day: string;
  /** `HH:MM`, or null when the facility is closed that day. */
  opens: string | null;
  closes: string | null;
}

export interface Facility {
  id: string;
  name: string;
  status: 'ACTIVE' | 'INACTIVE';
  isPrimary: boolean;
  /** CMS place-of-service code, with its label: billing reads the code. */
  posCode: string;
  posLabel: string;
  npi: string;
  taxId: string;
  phone: string;
  addressLine: string;
  city: string;
  state: string;
  postalCode: string;
  hours: FacilityHours[];
  rooms: string[];
  providerCount: number;
  /** Bookable minutes a week, derived from the hours grid by the slot engine. */
  weeklyBookableMinutes: number;
}

/* -------------------------------------------------------------------------- */
/* Form builder (AD-03)                                                        */
/* -------------------------------------------------------------------------- */

/** The palette. One entry per field type the form engine can render. */
export interface FormFieldType {
  id: string;
  label: string;
  /** Lucide slug. */
  icon: string;
  hint: string;
}

export interface FormSection {
  id: string;
  title: string;
}

export interface FormField {
  id: string;
  sectionId: string;
  label: string;
  /** Matches a {@link FormFieldType} id. */
  type: string;
  required: boolean;
  /** Shown to the patient in the portal. */
  portalVisible: boolean;
  /** Plottable on a flowsheet or growth chart. */
  graphable: boolean;
  /** Answerable once; later visits read it rather than re-asking. */
  writeOnce: boolean;
  helpText: string | null;
  options: string[];
  /** "Show when Smoker equals Yes". Null when the field is always shown. */
  condition: string | null;
}

export interface FormDefinition {
  id: string;
  name: string;
  purpose: 'DEMOGRAPHICS' | 'ENCOUNTER' | 'PORTAL_INTAKE' | 'REFERRAL';
  version: number;
  status: 'DRAFT' | 'PUBLISHED';
  publishedAt: string | null;
  updatedAt: string;
  updatedBy: string;
  /**
   * A published version is immutable, so an edit opens the next draft. This is
   * what the new-version banner is about.
   */
  hasUnpublishedChanges: boolean;
  responseCount: number;
  sections: FormSection[];
  fields: FormField[];
}

/* -------------------------------------------------------------------------- */
/* Audit (AD-06)                                                               */
/* -------------------------------------------------------------------------- */

export const AUDIT_ACTIONS = [
  'PATIENT_READ',
  'PATIENT_UPDATE',
  'NOTE_SIGN',
  'ORDER_SIGN',
  'CLAIM_SUBMIT',
  'SETTING_UPDATE',
  'EXPORT_RUN',
  'LOGIN_SUCCESS',
  'LOGIN_FAILURE',
  'BREAKGLASS_READ',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const PURPOSES_OF_USE = [
  'TREATMENT',
  'PAYMENT',
  'OPERATIONS',
  'BREAKGLASS',
  'SYSTEM',
] as const;

export type PurposeOfUse = (typeof PURPOSES_OF_USE)[number];

export interface AuditEvent {
  id: string;
  /** Position in the append-only chain. Gaps are integrity failures. */
  sequence: number;
  occurredAt: string;
  actorId: string;
  actorName: string;
  actorRole: StaffRole;
  action: AuditAction;
  targetType: string;
  targetLabel: string;
  /** Chart context: which patient the event touched, when it touched one. */
  patientId: string | null;
  patientMrn: string | null;
  patientName: string | null;
  purposeOfUse: PurposeOfUse;
  breakglass: boolean;
  /** Mandatory whenever `breakglass` is true. */
  breakglassReason: string | null;
  sourceIp: string;
  requestId: string;
  /** SHA-256 over the event plus `previousHash`. Rendered, never edited. */
  hash: string;
  previousHash: string;
  chainVerified: boolean;
  /** Extra fields for the detail drawer, already flattened for display. */
  detail: Array<{ label: string; value: string }>;
}

export interface AuditQuery {
  actorId?: string;
  action?: AuditAction;
  purposeOfUse?: PurposeOfUse;
  patientMrn?: string;
  breakglassOnly?: boolean;
  /** ISO date, inclusive. */
  from?: string;
  /** ISO date, inclusive. */
  to?: string;
}

/* -------------------------------------------------------------------------- */
/* Integrations (AD-07)                                                        */
/* -------------------------------------------------------------------------- */

export const INTEGRATION_STATUSES = ['CONNECTED', 'DEMO', 'ERROR', 'NOT_CONNECTED'] as const;

export type IntegrationStatus = (typeof INTEGRATION_STATUSES)[number];

export interface Integration {
  id: string;
  /** The seam name in the codebase: `erx`, `clearinghouse`, `labs`. */
  seam: string;
  name: string;
  description: string;
  adapter: string | null;
  adapterVersion: string | null;
  status: IntegrationStatus;
  lastActivityAt: string | null;
  /** The last time this seam worked. The thing an admin needs during an outage. */
  lastGoodAt: string | null;
  /** Plain language, never a stack trace. Null unless the status is ERROR. */
  failureDetail: string | null;
  /** A pointer into the secret store. A credential value never reaches a screen. */
  secretRef: string | null;
  webhookVerified: boolean;
  activityLog: Array<{ at: string; summary: string; ok: boolean }>;
}

/* -------------------------------------------------------------------------- */
/* Developer platform (DV-01 to DV-03)                                         */
/* -------------------------------------------------------------------------- */

export interface ApiScope {
  id: string;
  /** What the scope allows, in one sentence a non-developer can check. */
  description: string;
}

export interface ApiKey {
  id: string;
  label: string;
  /** The visible prefix. The secret itself is shown once, at creation, and never stored. */
  prefix: string;
  scopes: string[];
  createdAt: string;
  createdBy: string;
  lastUsedAt: string | null;
  status: 'ACTIVE' | 'REVOKED';
  revokedAt: string | null;
}

export interface SmartAppLaunch {
  id: string;
  at: string;
  outcome: 'SUCCESS' | 'FAILURE';
  /** The OAuth error translated into a sentence. */
  detail: string;
  patientContext: string | null;
}

export interface SmartApp {
  id: string;
  name: string;
  clientId: string;
  launchType: 'EHR' | 'STANDALONE';
  redirectUris: string[];
  scopes: string[];
  status: 'APPROVED' | 'PENDING';
  lastLaunchAt: string | null;
  launches: SmartAppLaunch[];
}

export interface WebhookDelivery {
  id: string;
  at: string;
  event: string;
  responseCode: number | null;
  latencyMs: number | null;
  attempt: number;
  outcome: 'DELIVERED' | 'FAILED' | 'RETRYING';
}

export interface Webhook {
  id: string;
  event: string;
  criteria: string;
  endpoint: string;
  status: 'ACTIVE' | 'PAUSED' | 'FAILING';
  secretRef: string;
  /** 0 to 1 over the last 100 deliveries. */
  failureRate: number;
  createdAt: string;
  deliveries: WebhookDelivery[];
}

/* -------------------------------------------------------------------------- */
/* Reports (RP-01, RP-02)                                                      */
/* -------------------------------------------------------------------------- */

export interface DashboardTile {
  id: string;
  label: string;
  value: number;
  /** "visits", "notes", "$". Never a bare number on a clinical or money surface. */
  unit: string | null;
  /** One line of context under the number. */
  detail: string;
  state: 'success' | 'neutral' | 'danger';
  /** "Within target", "Above threshold". Rendered: the tint is never the signal. */
  stateLabel: string;
  /** Where the number's workbench lives. Every tile clicks through. */
  href: string;
  /** Last seven days, oldest first. Drawn as a sparkline. */
  series: number[];
}

export interface ClaimFunnelStage {
  id: string;
  label: string;
  count: number;
}

export interface AgingBucket {
  id: string;
  label: string;
  payerAmount: number;
  patientAmount: number;
}

export interface UnsignedByProvider {
  providerId: string;
  providerName: string;
  unsigned: number;
  oldestDays: number;
}

export interface PracticeDashboard {
  asOf: string;
  tiles: DashboardTile[];
  funnel: ClaimFunnelStage[];
  aging: AgingBucket[];
  unsignedByProvider: UnsignedByProvider[];
}

export interface VisitReportRow {
  id: string;
  /** `YYYY-MM-DD`. */
  date: string;
  time: string;
  patientName: string;
  patientMrn: string;
  providerId: string;
  providerName: string;
  facilityName: string;
  visitType: string;
  status: string;
  durationMinutes: number;
  chargeAmount: number;
  claimState: string;
}

export interface VisitReportTotals {
  visits: number;
  minutes: number;
  charges: number;
}

export interface VisitReport {
  rows: VisitReportRow[];
  /** Pinned totals row. Computed server-side over the whole filtered set. */
  totals: VisitReportTotals;
}

export interface VisitReportQuery {
  from?: string;
  to?: string;
  providerId?: string;
  status?: string;
  visitType?: string;
}

/* -------------------------------------------------------------------------- */
/* The client contract                                                         */
/* -------------------------------------------------------------------------- */

export interface AdminClient {
  readonly mode: 'live' | 'mock';
  users: {
    list: (query?: StaffUserQuery, signal?: AbortSignal) => Promise<ListResponse<StaffUser>>;
    permissions: (signal?: AbortSignal) => Promise<PermissionRow[]>;
  };
  facilities: {
    list: (signal?: AbortSignal) => Promise<ListResponse<Facility>>;
  };
  forms: {
    list: (signal?: AbortSignal) => Promise<ListResponse<FormDefinition>>;
    fieldTypes: (signal?: AbortSignal) => Promise<FormFieldType[]>;
  };
  audit: {
    list: (query?: AuditQuery, signal?: AbortSignal) => Promise<ListResponse<AuditEvent>>;
  };
  integrations: {
    list: (signal?: AbortSignal) => Promise<ListResponse<Integration>>;
  };
  developer: {
    keys: (signal?: AbortSignal) => Promise<ListResponse<ApiKey>>;
    scopes: (signal?: AbortSignal) => Promise<ApiScope[]>;
    apps: (signal?: AbortSignal) => Promise<ListResponse<SmartApp>>;
    webhooks: (signal?: AbortSignal) => Promise<ListResponse<Webhook>>;
  };
  reports: {
    dashboard: (signal?: AbortSignal) => Promise<PracticeDashboard>;
    visits: (query?: VisitReportQuery, signal?: AbortSignal) => Promise<VisitReport>;
  };
}

/**
 * The admin client every screen reads through.
 *
 * Mock-only for now, and deliberately so: no live implementation of this
 * interface exists, and half of what it promises has no route to read from at
 * all. A client that pretended otherwise would 404 on the missing half while
 * looking fine on the rest. When one is written this becomes the same mode
 * switch `api` already makes.
 */
export const adminApi: AdminClient = createAdminMockClient();

export interface AdminHookOptions {
  /** Injectable for tests: fixtures with a forced empty or failing collection. */
  client?: AdminClient;
  enabled?: boolean;
}

/**
 * The one line every admin screen writes to accept an injected client.
 *
 * Screens take an optional `client` prop so a test can render them against
 * empty or failing fixtures without a network, a database or a module mock.
 * This keeps that plumbing to a single call and one stable object.
 */
export function useAdminClientOption(client?: AdminClient): AdminHookOptions {
  return useMemo(() => ({ client }), [client]);
}

/* -------------------------------------------------------------------------- */
/* Hooks                                                                       */
/* -------------------------------------------------------------------------- */

export function useStaffUsers(
  query: StaffUserQuery = {},
  options: AdminHookOptions = {}
): AsyncState<ListResponse<StaffUser>> {
  const client = options.client ?? adminApi;
  return useApiQuery(
    queryKey('admin.users.list', { ...query }),
    (signal) => client.users.list(query, signal),
    { enabled: options.enabled }
  );
}

export function usePermissionMatrix(options: AdminHookOptions = {}): AsyncState<PermissionRow[]> {
  const client = options.client ?? adminApi;
  return useApiQuery(queryKey('admin.users.permissions'), (signal) =>
    client.users.permissions(signal)
  );
}

export function useFacilities(options: AdminHookOptions = {}): AsyncState<ListResponse<Facility>> {
  const client = options.client ?? adminApi;
  return useApiQuery(queryKey('admin.facilities.list'), (signal) => client.facilities.list(signal));
}

export function useFormDefinitions(
  options: AdminHookOptions = {}
): AsyncState<ListResponse<FormDefinition>> {
  const client = options.client ?? adminApi;
  return useApiQuery(queryKey('admin.forms.list'), (signal) => client.forms.list(signal));
}

export function useFormFieldTypes(options: AdminHookOptions = {}): AsyncState<FormFieldType[]> {
  const client = options.client ?? adminApi;
  return useApiQuery(queryKey('admin.forms.fieldTypes'), (signal) =>
    client.forms.fieldTypes(signal)
  );
}

export function useAuditEvents(
  query: AuditQuery = {},
  options: AdminHookOptions = {}
): AsyncState<ListResponse<AuditEvent>> {
  const client = options.client ?? adminApi;
  return useApiQuery(
    queryKey('admin.audit.list', { ...query }),
    (signal) => client.audit.list(query, signal),
    { enabled: options.enabled }
  );
}

export function useIntegrations(
  options: AdminHookOptions = {}
): AsyncState<ListResponse<Integration>> {
  const client = options.client ?? adminApi;
  return useApiQuery(queryKey('admin.integrations.list'), (signal) =>
    client.integrations.list(signal)
  );
}

export function useApiKeys(options: AdminHookOptions = {}): AsyncState<ListResponse<ApiKey>> {
  const client = options.client ?? adminApi;
  return useApiQuery(queryKey('admin.developer.keys'), (signal) => client.developer.keys(signal));
}

export function useApiScopes(options: AdminHookOptions = {}): AsyncState<ApiScope[]> {
  const client = options.client ?? adminApi;
  return useApiQuery(queryKey('admin.developer.scopes'), (signal) =>
    client.developer.scopes(signal)
  );
}

export function useSmartApps(options: AdminHookOptions = {}): AsyncState<ListResponse<SmartApp>> {
  const client = options.client ?? adminApi;
  return useApiQuery(queryKey('admin.developer.apps'), (signal) => client.developer.apps(signal));
}

export function useWebhooks(options: AdminHookOptions = {}): AsyncState<ListResponse<Webhook>> {
  const client = options.client ?? adminApi;
  return useApiQuery(queryKey('admin.developer.webhooks'), (signal) =>
    client.developer.webhooks(signal)
  );
}

export function usePracticeDashboard(
  options: AdminHookOptions = {}
): AsyncState<PracticeDashboard> {
  const client = options.client ?? adminApi;
  return useApiQuery(queryKey('reports.dashboard'), (signal) => client.reports.dashboard(signal));
}

export function useVisitReport(
  query: VisitReportQuery = {},
  options: AdminHookOptions = {}
): AsyncState<VisitReport> {
  const client = options.client ?? adminApi;
  return useApiQuery(
    queryKey('reports.visits', { ...query }),
    (signal) => client.reports.visits(query, signal),
    { enabled: options.enabled }
  );
}
