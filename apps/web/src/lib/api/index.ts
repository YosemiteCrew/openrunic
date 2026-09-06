/**
 * The data layer's public surface. Screens import from `@/lib/api` and nothing
 * deeper, so the transport, the fixtures and the hook shape can all change
 * without touching a screen.
 */
export { api } from './api';
export { ApiError, BFF_BASE_PATH, createHttpClient, requestJson, toSearchParams } from './client';
export type { ApiClientConfig, ApiErrorKind } from './client';
export { API_BASE_URL, API_CONFIG, API_MODE, IS_MOCK_MODE, resolveApiMode } from './config';
export type { ApiMode } from './config';
export {
  createMockClient,
  filterAppointments,
  filterDirectoryUsers,
  filterEncounters,
  filterFacilities,
  filterNotes,
  filterPatients,
} from './mock/client';
export type { MockClientOptions } from './mock/client';
export {
  MOCK_APPOINTMENTS,
  MOCK_CLINIC_DAY,
  MOCK_COVERAGES,
  MOCK_DIRECTORY_FACILITIES,
  MOCK_DIRECTORY_USERS,
  MOCK_FACILITY,
  MOCK_NOW,
  MOCK_PATIENTS,
  MOCK_PROVIDERS,
  MOCK_ROOMS,
  MOCK_STATUS_SINCE,
  mockCoveragesForPatient,
  mockPatientById,
  mockProviderName,
  mockStatusSince,
  mockVerifyEligibility,
} from './mock/fixtures';
export type {
  CoveragePriority,
  EligibilityOutcome,
  MockCoverage,
  MockEligibilityResult,
} from './mock/fixtures';
export {
  queryKey,
  useApiQuery,
  useAppointment,
  useAppointments,
  useMutation,
  usePatient,
  useOwnCapabilities,
  usePatients,
} from './hooks';
export type { AsyncState, AsyncStatus, HookOptions, MutationOutcome, MutationState } from './hooks';
export * from './types';

/* Admin, developer platform and reports, on a fixture-only client.

   Two different reasons, and the difference decides what the work is. Audit
   events, facilities, staff users, roles, form definitions and terminology are
   all served by `apps/api` today; those screens are fixture-backed because
   nothing maps those routes into these view types yet, which is the same gap
   the schedule's directory just closed. API keys, API scopes, integrations,
   webhooks, SMART apps, the permission matrix, the practice dashboard and the
   visit report have no route at all, and the contract below is written the way
   the API will answer when they do. */
export {
  adminApi,
  AUDIT_ACTIONS,
  INTEGRATION_STATUSES,
  PURPOSES_OF_USE,
  STAFF_ROLES,
  STAFF_STATUSES,
  useApiKeys,
  useApiScopes,
  useAdminClientOption,
  useAuditEvents,
  useFacilities,
  useFormDefinitions,
  useFormFieldTypes,
  useIntegrations,
  usePermissionMatrix,
  usePracticeDashboard,
  useSmartApps,
  useStaffUsers,
  useVisitReport,
  useWebhooks,
} from './admin';
export type {
  AdminClient,
  AdminHookOptions,
  AgingBucket,
  ApiKey,
  ApiScope,
  AuditAction,
  AuditEvent,
  AuditQuery,
  ClaimFunnelStage,
  DashboardTile,
  Facility,
  FacilityHours,
  FormDefinition,
  FormField,
  FormFieldType,
  FormSection,
  Integration,
  IntegrationStatus,
  PermissionLevel,
  PermissionRow,
  PracticeDashboard,
  PurposeOfUse,
  SmartApp,
  SmartAppLaunch,
  StaffRole,
  StaffStatus,
  StaffUser,
  StaffUserQuery,
  UnsignedByProvider,
  VisitReport,
  VisitReportQuery,
  VisitReportRow,
  VisitReportTotals,
  Webhook,
  WebhookDelivery,
} from './admin';
export {
  adminMockFailure,
  createAdminMockClient,
  filterAuditEvents,
  filterStaffUsers,
  filterVisitRows,
  MOCK_API_KEYS,
  MOCK_API_SCOPES,
  MOCK_AUDIT_EVENTS,
  MOCK_DASHBOARD,
  MOCK_FACILITIES,
  MOCK_FIELD_TYPES,
  MOCK_FORM_DEFINITIONS,
  MOCK_INTEGRATIONS,
  MOCK_NEW_KEY_DISPLAY,
  MOCK_PERMISSIONS,
  MOCK_SMART_APPS,
  MOCK_STAFF_USERS,
  MOCK_VISIT_ROWS,
  MOCK_WEBHOOKS,
  STAFF_ROLE_LABELS,
  totalsFor,
} from './mock/admin';
export type { AdminMockOptions } from './mock/admin';

/* Orders, results and the typed inbox, on a fixture-only client.

   `/bff/v0/orders` and `/bff/v0/results` are both served, transitions included,
   and the `orders` and `results` methods on {@link ApiClient} already reach
   them; what is missing is the mapping from those payloads into the worklist
   view types below. The inbox is the one thing here with no route of its own:
   it is a composition across results, messages and tasks that the API does not
   assemble. */
export {
  ASSIGNMENTS,
  createWorklistClient,
  filterInbox,
  filterOrders,
  filterResults,
  INBOX_STREAMS,
  isBulkSignable,
  ORDER_CATEGORIES,
  ORDER_PRIORITIES,
  ORDER_STATUSES,
  patientProblems,
  rankCatalog,
  RESULT_FLAGS,
  RESULT_STATUSES,
  slaState,
  useInbox,
  useOrders,
  useResults,
  WARNING_TIERS,
  warningsFor,
  worklist,
} from './worklist';
export type {
  Assignment,
  InboxItem,
  InboxListQuery,
  InboxStream,
  Order,
  OrderCatalogEntry,
  OrderCategory,
  OrderListQuery,
  OrderPriority,
  OrderStatus,
  OrderWarning,
  PatientProblem,
  PriorValue,
  ResultAnalyte,
  ResultFlag,
  ResultListQuery,
  ResultReport,
  ResultStatus,
  SlaState,
  WarningTier,
  WorklistClient,
  WorklistData,
  WorklistHookOptions,
} from './worklist';
export {
  MOCK_INBOX_ITEMS,
  MOCK_ORDER_CATALOG,
  MOCK_ORDER_DESTINATIONS,
  MOCK_ORDER_WARNINGS,
  MOCK_ORDERS,
  MOCK_PATIENT_PROBLEMS,
  MOCK_RESULTS,
  mockResultById,
} from './mock/fixtures';

/* Billing and the revenue cycle, on a fixture-only client.

   Claims, payments, remittances, statements, charges and coverage are all
   served by `apps/api`, and the transitions these screens drive - scrub,
   submit, post, generate, send - are on {@link ApiClient} already. Again the
   gap is the mapping into the view types below rather than a missing route.
   The fee sheet and the payer directory are the exceptions: neither has a
   segment, and the shapes here are written the way the API will answer. */
export {
  AGEING_BUCKETS,
  billing,
  CLAIM_STATUSES,
  createBillingClient,
  DUNNING_STAGES,
  FEE_SHEET_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  REMITTANCE_LINE_STATES,
  REMITTANCE_STATUSES,
  useClaims,
  useFeeSheets,
  usePayments,
  useRemittances,
  useStatements,
} from './billing';
export type {
  AgeingBucket,
  BillingClient,
  BillingData,
  BillingHookOptions,
  BillingPatientRef,
  ChargeDiagnosis,
  ChargeLine,
  Claim,
  ClaimEvent,
  ClaimListQuery,
  ClaimScrubError,
  ClaimServiceLine,
  ClaimStatus,
  DunningStage,
  FeeSheet,
  FeeSheetListQuery,
  FeeSheetStatus,
  PayerRef,
  Payment,
  PaymentAllocation,
  PaymentListQuery,
  PaymentMethodKind,
  PaymentMethodRef,
  PaymentPlan,
  PaymentStatus,
  ProcedureCode,
  Remittance,
  RemittanceLine,
  RemittanceLineState,
  RemittanceListQuery,
  RemittanceStatus,
  StatementAccount,
  StatementLine,
  StatementListQuery,
} from './billing';
export {
  filterClaims,
  filterFeeSheets,
  filterPayments,
  filterRemittances,
  filterStatements,
  MOCK_CLAIMS,
  MOCK_FEE_SHEETS,
  MOCK_PAYERS,
  MOCK_PAYMENTS,
  MOCK_PROCEDURE_CATALOG,
  MOCK_PROCEDURE_PANELS,
  MOCK_REMITTANCES,
  MOCK_STATEMENT_ACCOUNTS,
} from './mock/billing';
