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

/* -------------------------------------------------------------------------- */
/* Write bodies                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Mirrors `patientCreateInput` in `@openrunic/database`.
 *
 * Flat rather than nested, unlike {@link Patient}: the API reads registration
 * as columns and answers it as an aggregate, and the difference is real rather
 * than an oversight. A screen builds this shape; it never posts a `Patient`
 * back.
 */
export interface PatientCreateBody {
  /** Assigned by the practice, unique per organisation. */
  mrn: string;
  primaryFacilityId?: string;
  givenName: string;
  middleName?: string;
  familyName: string;
  prefix?: string;
  suffix?: string;
  preferredName?: string;
  /** `YYYY-MM-DD`. */
  birthDate: string;
  deceasedAt?: string;
  sexAtBirth?: AdministrativeGender;
  genderIdentityCode?: string;
  pronouns?: string;
  raceCodes?: string[];
  ethnicityCodes?: string[];
  /** BCP 47 tag. */
  languageCode?: string;
  maritalStatusCode?: string;
  email?: string;
  phoneMobile?: string;
  phoneHome?: string;
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  sensitivityClass?: SensitivityClass;
  portalEnabled?: boolean;
  active?: boolean;
}

/** Mirrors `patientUpdateInput`: every field optional, and `mrn` not reassignable. */
export type PatientUpdateBody = Partial<Omit<PatientCreateBody, 'mrn'>>;

/** Mirrors `appointmentCreateInput`. */
export interface AppointmentCreateBody {
  facilityId: string;
  patientId?: string;
  providerId: string;
  typeCode: string;
  typeDisplay: string;
  status?: AppointmentStatus;
  /** ISO instant with offset. */
  start: string;
  end: string;
  durationMinutes: number;
  room?: string;
  reasonText?: string;
  recurrenceGroupId?: string;
  createdVia?: AppointmentCreatedVia;
}

/**
 * Mirrors `appointmentUpdateSchema`.
 *
 * Narrower than the create body by design: `facilityId` and `patientId` are
 * absent because moving either is a cancel and a rebook, which the status
 * history has to show. The API rejects a patch that changes nothing, and it
 * rejects a cancellation with no reason.
 */
export interface AppointmentUpdateBody {
  status?: AppointmentStatus;
  start?: string;
  end?: string;
  durationMinutes?: number;
  room?: string;
  reasonText?: string;
  cancelReason?: string;
  providerId?: string;
  typeCode?: string;
  typeDisplay?: string;
}

/* -------------------------------------------------------------------------- */
/* Clinical wire shapes                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The aggregates below carry a `Dto` suffix and the ones above do not, and the
 * difference is deliberate. `Patient` and `Appointment` are the only shapes the
 * screens read directly off the wire. Everything here is the API's own record
 * of a clinical or financial fact, which several screens still render through a
 * view type of their own; the suffix is what stops the two being confused at an
 * import site.
 */

/** Mirrors `ENCOUNTER_STATUSES`. */
export type EncounterStatus =
  'PLANNED' | 'IN_PROGRESS' | 'ON_HOLD' | 'COMPLETED' | 'CANCELLED' | 'ENTERED_IN_ERROR';

/** Mirrors `ENCOUNTER_CLASSES`. */
export type EncounterClass =
  'AMBULATORY' | 'EMERGENCY' | 'HOME_HEALTH' | 'INPATIENT' | 'OBSERVATION' | 'VIRTUAL';

/** Mirrors `encounterDtoSchema` in `apps/api/src/schemas/clinical.ts`. */
export interface EncounterDto {
  id: string;
  facilityId: string;
  patientId: string;
  providerId: string;
  appointmentId: string | null;
  class: EncounterClass;
  status: EncounterStatus;
  reasonCode: string | null;
  reasonText: string | null;
  startedAt: string;
  endedAt: string | null;
  signedAt: string | null;
  signedById: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Mirrors `NOTE_STATES`.
 *
 * Not the same vocabulary as the chart's own `NoteState`, which carries `NONE`
 * for a visit that never had a note and `COSIGN_PENDING` for one waiting on a
 * second signature. This is what the API stores; that is what the note screens
 * render.
 */
export type ClinicalNoteState =
  'DRAFT' | 'AI_DRAFT_REVIEW' | 'UNSIGNED' | 'SIGNED' | 'AMENDED' | 'ENTERED_IN_ERROR';

/** A block in the note document. Its shape is owned by the editor, not by storage. */
export type NoteBlockJson = Record<string, unknown>;

/** Mirrors `noteDtoSchema`. */
export interface ClinicalNoteDto {
  id: string;
  patientId: string;
  encounterId: string;
  authorId: string;
  title: string;
  blocks: NoteBlockJson[];
  state: ClinicalNoteState;
  cosignerId: string | null;
  cosignedAt: string | null;
  signedAt: string | null;
  signedById: string | null;
  lockedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Mirrors `clinicalNoteInput`. */
export interface ClinicalNoteCreateBody {
  patientId: string;
  encounterId: string;
  authorId: string;
  title: string;
  blocks: NoteBlockJson[];
  state?: ClinicalNoteState;
  cosignerId?: string;
}

/** Mirrors `notePatchSchema`. The API rejects a patch that changes nothing. */
export interface ClinicalNotePatchBody {
  title?: string;
  blocks?: NoteBlockJson[];
  state?: ClinicalNoteState;
  cosignerId?: string;
}

/** Mirrors `noteAddendumDtoSchema`. */
export interface NoteAddendumDto {
  id: string;
  noteId: string;
  authorId: string;
  blocks: NoteBlockJson[];
  reason: string | null;
  signedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Mirrors `noteAddendumBodySchema`: the addendum input minus the id in the path. */
export interface NoteAddendumBody {
  authorId: string;
  blocks: NoteBlockJson[];
  reason?: string;
}

/** Mirrors `noteListQuerySchema`. */
export interface NoteListQuery extends PaginationQuery {
  patientId?: string;
  encounterId?: string;
  authorId?: string;
  state?: ClinicalNoteState;
  sort?: 'createdAt' | 'signedAt';
  order?: 'asc' | 'desc';
}

/** Mirrors `encounterListQuerySchema`. */
export interface EncounterListQuery extends PaginationQuery {
  patientId?: string;
  facilityId?: string;
  providerId?: string;
  status?: EncounterStatus;
  from?: string;
  to?: string;
  sort?: 'startedAt' | 'createdAt';
  order?: 'asc' | 'desc';
}

/* -------------------------------------------------------------------------- */
/* Orders, results and tasks                                                   */
/* -------------------------------------------------------------------------- */

/** Mirrors `SERVICE_REQUEST_STATUSES`. Wider than the order ledger's own view type. */
export type ServiceRequestStatus =
  | 'DRAFT'
  | 'PENDED'
  | 'SIGNED'
  | 'TRANSMITTED'
  | 'IN_PROGRESS'
  | 'RESULTED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'ENTERED_IN_ERROR';

/** Mirrors `SERVICE_REQUEST_CATEGORIES`. */
export type ServiceRequestCategory = 'LAB' | 'IMAGING' | 'PROCEDURE' | 'REFERRAL' | 'THERAPY';

/** Mirrors `SERVICE_REQUEST_INTENTS`. */
export type ServiceRequestIntent =
  'PROPOSAL' | 'PLAN' | 'ORDER' | 'ORIGINAL_ORDER' | 'REFLEX_ORDER';

/** Mirrors `ORDER_PRIORITIES` in `@openrunic/database`. */
export type ServiceRequestPriority = 'ROUTINE' | 'URGENT' | 'ASAP' | 'STAT';

/** Mirrors `serviceRequestDtoSchema`. */
export interface ServiceRequestDto {
  id: string;
  patientId: string;
  encounterId: string | null;
  orderedById: string;
  category: ServiceRequestCategory;
  status: ServiceRequestStatus;
  intent: ServiceRequestIntent;
  priority: ServiceRequestPriority;
  code: string;
  codeSystem: string;
  display: string;
  specimenTypeCode: string | null;
  reasonCodes: string[];
  aoeAnswers: Record<string, unknown> | null;
  note: string | null;
  requisitionNumber: string | null;
  performingLabName: string | null;
  /** Opaque reference from the labs adapter. Never PHI, and never client-set. */
  labRef: string | null;
  requestedAt: string;
  scheduledFor: string | null;
  transmittedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Mirrors `DIAGNOSTIC_REPORT_STATUSES`. */
export type DiagnosticReportStatus =
  | 'REGISTERED'
  | 'PARTIAL'
  | 'PRELIMINARY'
  | 'FINAL'
  | 'AMENDED'
  | 'CORRECTED'
  | 'APPENDED'
  | 'CANCELLED'
  | 'ENTERED_IN_ERROR';

/** Mirrors `ABNORMAL_FLAGS`. */
export type AbnormalFlag = 'NORMAL' | 'ABNORMAL' | 'CRITICAL';

/** Mirrors `diagnosticReportDtoSchema`. */
export interface DiagnosticReportDto {
  id: string;
  patientId: string;
  encounterId: string | null;
  serviceRequestId: string | null;
  specimenId: string | null;
  status: DiagnosticReportStatus;
  category: ServiceRequestCategory;
  code: string;
  codeSystem: string;
  display: string;
  performingLabName: string | null;
  abnormalFlag: AbnormalFlag;
  narrative: string | null;
  rawStorageKey: string | null;
  effectiveAt: string | null;
  issuedAt: string;
  reviewedById: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Mirrors `TASK_STATUSES`. */
export type TaskWorkStatus = 'OPEN' | 'IN_PROGRESS' | 'ON_HOLD' | 'DONE' | 'CANCELLED' | 'EXPIRED';

/** Mirrors `TASK_TYPES`. */
export type TaskKind =
  | 'RESULT'
  | 'MESSAGE'
  | 'REFILL'
  | 'COSIGN'
  | 'DOCUMENT'
  | 'FAX'
  | 'PRIOR_AUTH'
  | 'CLAIM_EXCEPTION'
  | 'GENERAL';

/** Mirrors `taskDtoSchema`. */
export interface TaskDto {
  id: string;
  type: TaskKind;
  status: TaskWorkStatus;
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  patientId: string | null;
  encounterId: string | null;
  subjectType: string | null;
  subjectId: string | null;
  title: string;
  description: string | null;
  assigneeType: 'USER' | 'TEAM';
  assigneeUserId: string | null;
  assigneeTeamKey: string | null;
  dueAt: string | null;
  slaState: 'OK' | 'AGING' | 'BREACH';
  expiresAt: string | null;
  sourceEventId: string | null;
  completedAt: string | null;
  completedById: string | null;
  outcome: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Mirrors `taskCompleteSchema`. */
export interface TaskCompleteBody {
  outcome?: string;
}

/* -------------------------------------------------------------------------- */
/* The revenue cycle                                                           */
/* -------------------------------------------------------------------------- */

/** Mirrors `CLAIM_STATUSES` in `@openrunic/database`. */
export type ClaimDtoStatus =
  | 'DRAFT'
  | 'SCRUBBED'
  | 'SUBMITTED'
  | 'ACKNOWLEDGED'
  | 'REJECTED'
  | 'DENIED'
  | 'PAID'
  | 'PARTIAL'
  | 'REBILLED'
  | 'VOID';

/** Mirrors `claimDtoSchema`. Money is in minor units, as the API stores it. */
export interface ClaimDto {
  id: string;
  patientId: string;
  encounterId: string;
  coverageId: string;
  payerId: string;
  status: ClaimDtoStatus;
  frequency: 'ORIGINAL' | 'REPLACEMENT' | 'VOID';
  diagnosisCodes: string[];
  totals: {
    chargedCents: number;
    paidCents: number;
    adjustedCents: number;
    patientResponsibilityCents: number;
  };
  secondaryOfId: string | null;
  priorClaimId: string | null;
  controlNumbers: Record<string, unknown> | null;
  snapshot: Record<string, unknown> | null;
  statusReason: string | null;
  submittedAt: string | null;
  acknowledgedAt: string | null;
  adjudicatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Mirrors `claimTransitionSchema`: the optional colour on a scrub or a submit. */
export interface ClaimTransitionBody {
  statusReason?: string;
  detail?: Record<string, unknown>;
}

/** Mirrors `claimStatusChangeBodySchema`. `claimId` is dropped: the path already said which. */
export interface ClaimStatusChangeBody {
  status: ClaimDtoStatus;
  source: 'ACK_999' | 'STATUS_277' | 'REMIT_835' | 'MANUAL';
  occurredAt?: string;
  detail?: Record<string, unknown>;
  statusReason?: string;
}

/** Mirrors `PAYMENT_METHODS` in `@openrunic/database`. */
export type PaymentDtoMethod = 'CASH' | 'CHECK' | 'CARD' | 'ACH' | 'EFT' | 'OTHER';

/** Mirrors `paymentDtoSchema`. */
export interface PaymentDto {
  id: string;
  patientId: string | null;
  payerId: string | null;
  remittanceId: string | null;
  source: 'PATIENT' | 'PAYER_ERA' | 'ADAPTER' | 'ADJUSTMENT';
  method: PaymentDtoMethod;
  status: 'PENDING' | 'POSTED' | 'FAILED' | 'REFUNDED' | 'VOIDED';
  amountCents: number;
  currency: string;
  reference: string | null;
  /** The payments adapter's opaque reference. Never an instrument detail. */
  adapterRef: string | null;
  receivedAt: string;
  postedAt: string | null;
  postedById: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Mirrors `paymentTransitionSchema`. */
export interface PaymentTransitionBody {
  note?: string;
}

/** Mirrors `remittanceDtoSchema`. */
export interface RemittanceDto {
  id: string;
  payerId: string;
  status: 'RECEIVED' | 'PARSED' | 'POSTED' | 'EXCEPTIONS';
  checkOrEftNumber: string | null;
  totalPaidCents: number;
  receivedAt: string;
  paidAt: string | null;
  rawStorageKey: string | null;
  parsed: Record<string, unknown> | null;
  /** Lines parsing could not match. Each one is somebody's work. */
  exceptionCount: number;
  postedAt: string | null;
  postedById: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Mirrors `remittanceParseResultSchema`. */
export interface RemittanceParseResult {
  remittance: RemittanceDto;
  lineCount: number;
  matchedCount: number;
  exceptionCount: number;
}

/** Mirrors `remittancePostSchema`. An advice is usually settled by EFT. */
export interface RemittancePostBody {
  method?: PaymentDtoMethod;
}

/** Mirrors `remittancePostResultSchema`. */
export interface RemittancePostResult {
  remittance: RemittanceDto;
  payment: PaymentDto;
  allocationCount: number;
  allocatedCents: number;
  /** Lines that could not be applied. Posting says so rather than hiding it. */
  skippedLineCount: number;
}

/** Mirrors `STATEMENT_DELIVERIES`. */
export type StatementDelivery = 'PRINT' | 'EMAIL' | 'SMS' | 'PORTAL';

/**
 * Mirrors `statementDtoSchema`.
 *
 * `payLinkSet` rather than the token itself: the token is a single-use bearer
 * credential for a payment page, so a list of statements carrying tokens would
 * be a list of ways to pay other people's bills.
 */
export interface StatementDto {
  id: string;
  patientId: string;
  status: 'DRAFT' | 'GENERATED' | 'SENT' | 'PAID' | 'VOID';
  balanceCents: number;
  dunningCycle: number;
  periodStart: string | null;
  periodEnd: string | null;
  generatedAt: string;
  deliveredVia: StatementDelivery | null;
  deliveredAt: string | null;
  pdfStorageKey: string | null;
  payLinkSet: boolean;
  payLinkExpiresAt: string | null;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Mirrors `statementGenerateSchema`. */
export interface StatementGenerateBody {
  balanceCents?: number;
  pdfStorageKey?: string;
}

/** Mirrors `statementSendSchema`. A pay link must expire. */
export interface StatementSendBody {
  deliveredVia: StatementDelivery;
  payLinkToken?: string;
  payLinkExpiresAt?: string;
}

/* -------------------------------------------------------------------------- */
/* Forms                                                                       */
/* -------------------------------------------------------------------------- */

/** Mirrors `formDefinitionDtoSchema`. */
export interface FormDefinitionDto {
  id: string;
  key: string;
  version: number;
  status: 'DRAFT' | 'PUBLISHED' | 'RETIRED';
  title: string;
  description: string | null;
  bindTo: 'PATIENT' | 'ENCOUNTER' | 'PORTAL' | 'REFERRAL';
  definition: Record<string, unknown>;
  /** Publish-time artefacts: validator, render tree, print layout, mapping. */
  compiled: Record<string, unknown> | null;
  promotionManifest: Record<string, unknown> | null;
  publishedAt: string | null;
  publishedById: string | null;
  retiredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Mirrors `formDefinitionPublishInput`.
 *
 * `formDefinitionId` is restated in the body even though the path names it,
 * because the API refuses a mismatch: publishing is the one write where a
 * client that has drifted from what it thinks it is looking at must be stopped
 * rather than obeyed.
 */
export interface FormDefinitionPublishBody {
  formDefinitionId: string;
  compiled: Record<string, unknown>;
  publishedAt?: string;
  promotionManifest?: Record<string, unknown>;
}

/* -------------------------------------------------------------------------- */
/* The client                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The read and write surface every screen shares. The live client and the mock
 * client both satisfy it, which is what makes mock mode a transport swap rather
 * than a second code path through the screens.
 *
 * A method exists here only when `apps/api` serves it. Nothing is declared
 * ahead of the route: a contract that promises more than the server does is how
 * a screen ends up reporting a save that never happened.
 */
export interface ApiClient {
  readonly mode: 'live' | 'mock';
  patients: {
    list: (query?: PatientListQuery, signal?: AbortSignal) => Promise<ListResponse<Patient>>;
    get: (id: string, signal?: AbortSignal) => Promise<Patient>;
    create: (body: PatientCreateBody, signal?: AbortSignal) => Promise<Patient>;
    update: (id: string, body: PatientUpdateBody, signal?: AbortSignal) => Promise<Patient>;
  };
  appointments: {
    list: (
      query?: AppointmentListQuery,
      signal?: AbortSignal
    ) => Promise<ListResponse<Appointment>>;
    get: (id: string, signal?: AbortSignal) => Promise<Appointment>;
    create: (body: AppointmentCreateBody, signal?: AbortSignal) => Promise<Appointment>;
    update: (id: string, body: AppointmentUpdateBody, signal?: AbortSignal) => Promise<Appointment>;
  };
  encounters: {
    list: (query?: EncounterListQuery, signal?: AbortSignal) => Promise<ListResponse<EncounterDto>>;
    get: (id: string, signal?: AbortSignal) => Promise<EncounterDto>;
    sign: (id: string, signal?: AbortSignal) => Promise<EncounterDto>;
  };
  notes: {
    list: (query?: NoteListQuery, signal?: AbortSignal) => Promise<ListResponse<ClinicalNoteDto>>;
    get: (id: string, signal?: AbortSignal) => Promise<ClinicalNoteDto>;
    create: (body: ClinicalNoteCreateBody, signal?: AbortSignal) => Promise<ClinicalNoteDto>;
    update: (
      id: string,
      body: ClinicalNotePatchBody,
      signal?: AbortSignal
    ) => Promise<ClinicalNoteDto>;
    sign: (id: string, signal?: AbortSignal) => Promise<ClinicalNoteDto>;
    listAddenda: (
      noteId: string,
      query?: PaginationQuery,
      signal?: AbortSignal
    ) => Promise<ListResponse<NoteAddendumDto>>;
    addAddendum: (
      noteId: string,
      body: NoteAddendumBody,
      signal?: AbortSignal
    ) => Promise<NoteAddendumDto>;
  };
  orders: {
    sign: (id: string, signal?: AbortSignal) => Promise<ServiceRequestDto>;
    transmit: (id: string, signal?: AbortSignal) => Promise<ServiceRequestDto>;
    cancel: (id: string, signal?: AbortSignal) => Promise<ServiceRequestDto>;
  };
  results: {
    review: (id: string, signal?: AbortSignal) => Promise<DiagnosticReportDto>;
  };
  tasks: {
    complete: (id: string, body?: TaskCompleteBody, signal?: AbortSignal) => Promise<TaskDto>;
  };
  claims: {
    scrub: (id: string, body?: ClaimTransitionBody, signal?: AbortSignal) => Promise<ClaimDto>;
    submit: (id: string, body?: ClaimTransitionBody, signal?: AbortSignal) => Promise<ClaimDto>;
    status: (id: string, body: ClaimStatusChangeBody, signal?: AbortSignal) => Promise<ClaimDto>;
  };
  payments: {
    post: (id: string, body?: PaymentTransitionBody, signal?: AbortSignal) => Promise<PaymentDto>;
  };
  remittances: {
    parse: (id: string, signal?: AbortSignal) => Promise<RemittanceParseResult>;
    post: (
      id: string,
      body?: RemittancePostBody,
      signal?: AbortSignal
    ) => Promise<RemittancePostResult>;
  };
  statements: {
    generate: (
      id: string,
      body?: StatementGenerateBody,
      signal?: AbortSignal
    ) => Promise<StatementDto>;
    send: (id: string, body: StatementSendBody, signal?: AbortSignal) => Promise<StatementDto>;
  };
  forms: {
    publish: (
      id: string,
      body: FormDefinitionPublishBody,
      signal?: AbortSignal
    ) => Promise<FormDefinitionDto>;
  };
}
