import type * as Prisma from './generated/prisma/enums.js';

/**
 * The schema's closed value sets, as plain literal tuples.
 *
 * These exist so the Zod input schemas in `./schemas` can be imported and run
 * without a generated Prisma client - tests and the API's request validation
 * must not depend on `prisma generate` having happened. The `EnumParityProof`
 * block at the bottom of this file is a compile-time proof that every tuple
 * still matches the enum it mirrors, so a value added to `schema.prisma`
 * without being added here fails `type-check` rather than failing silently at
 * runtime. It is a type-only construct and erases completely.
 */

export const ORGANISATION_MODES = ['SAAS', 'SELF_HOST'] as const;
export const ORGANISATION_STATUSES = ['ACTIVE', 'SUSPENDED', 'ARCHIVED'] as const;
export const USER_STATUSES = ['INVITED', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED'] as const;
export const SENSITIVITY_CLASSES = ['NORMAL', 'RESTRICTED', 'VERY_RESTRICTED'] as const;
export const ADMINISTRATIVE_GENDERS = ['FEMALE', 'MALE', 'OTHER', 'UNKNOWN'] as const;
export const IDENTIFIER_USES = ['USUAL', 'OFFICIAL', 'TEMP', 'SECONDARY', 'OLD'] as const;
export const COVERAGE_RANKS = ['PRIMARY', 'SECONDARY', 'TERTIARY'] as const;
export const COVERAGE_STATUSES = ['DRAFT', 'ACTIVE', 'CANCELLED', 'ENTERED_IN_ERROR'] as const;

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
export const APPOINTMENT_CREATED_VIA = ['STAFF', 'PORTAL', 'WAITLIST', 'RECALL', 'IMPORT'] as const;

export const ENCOUNTER_CLASSES = ['AMBULATORY', 'VIRTUAL', 'HOME', 'FIELD', 'EMERGENCY'] as const;
export const ENCOUNTER_STATUSES = [
  'PLANNED',
  'IN_PROGRESS',
  'ON_HOLD',
  'COMPLETED',
  'CANCELLED',
  'ENTERED_IN_ERROR',
] as const;

export const NOTE_STATES = [
  'DRAFT',
  'AI_DRAFT_REVIEW',
  'UNSIGNED',
  'SIGNED',
  'AMENDED',
  'ENTERED_IN_ERROR',
] as const;

export const CONDITION_CATEGORIES = [
  'PROBLEM_LIST_ITEM',
  'ENCOUNTER_DIAGNOSIS',
  'SURGERY',
  'DENTAL',
] as const;
export const CONDITION_CLINICAL_STATUSES = [
  'ACTIVE',
  'RECURRENCE',
  'RELAPSE',
  'INACTIVE',
  'REMISSION',
  'RESOLVED',
] as const;
export const CONDITION_VERIFICATION_STATUSES = [
  'UNCONFIRMED',
  'PROVISIONAL',
  'DIFFERENTIAL',
  'CONFIRMED',
  'REFUTED',
  'ENTERED_IN_ERROR',
] as const;

export const MEDICATION_STATEMENT_STATUSES = [
  'ACTIVE',
  'COMPLETED',
  'ENTERED_IN_ERROR',
  'INTENDED',
  'STOPPED',
  'ON_HOLD',
  'NOT_TAKEN',
  'UNKNOWN',
] as const;
export const MEDICATION_SOURCES = ['REPORTED', 'PRESCRIBED', 'RECONCILED', 'IMPORTED'] as const;
export const MEDICATION_REQUEST_STATUSES = [
  'DRAFT',
  'PENDED',
  'SIGNED',
  'TRANSMITTED',
  'ACTIVE',
  'ON_HOLD',
  'CANCELLED',
  'COMPLETED',
  'STOPPED',
  'ERROR',
] as const;
export const MEDICATION_REQUEST_INTENTS = [
  'PROPOSAL',
  'PLAN',
  'ORDER',
  'ORIGINAL_ORDER',
  'REFILL',
] as const;

export const ALLERGY_TYPES = ['ALLERGY', 'INTOLERANCE'] as const;
export const ALLERGY_CATEGORIES = ['FOOD', 'MEDICATION', 'ENVIRONMENT', 'BIOLOGIC'] as const;
export const ALLERGY_CRITICALITIES = ['LOW', 'HIGH', 'UNABLE_TO_ASSESS'] as const;
export const ALLERGY_CLINICAL_STATUSES = ['ACTIVE', 'INACTIVE', 'RESOLVED'] as const;
export const REACTION_SEVERITIES = ['MILD', 'MODERATE', 'SEVERE'] as const;
export const IMMUNIZATION_STATUSES = ['COMPLETED', 'NOT_DONE', 'ENTERED_IN_ERROR'] as const;

export const REFERRAL_STATUSES = [
  'DRAFT',
  'SENT',
  'ACCEPTED',
  'DECLINED',
  'SCHEDULED',
  'SEEN',
  'COMPLETED',
  'CANCELLED',
  'ENTERED_IN_ERROR',
] as const;
export const REFERRAL_PRIORITIES = ['ROUTINE', 'URGENT', 'ASAP'] as const;

export const OBSERVATION_CATEGORIES = [
  'VITAL_SIGNS',
  'LABORATORY',
  'IMAGING',
  'SOCIAL_HISTORY',
  'SDOH',
  'SURVEY',
  'EXAM',
  'PROCEDURE',
  'THERAPY',
  'ACTIVITY',
] as const;
export const OBSERVATION_STATUSES = [
  'REGISTERED',
  'PRELIMINARY',
  'FINAL',
  'AMENDED',
  'CORRECTED',
  'CANCELLED',
  'ENTERED_IN_ERROR',
] as const;
export const ABNORMAL_FLAGS = ['NORMAL', 'ABNORMAL', 'CRITICAL'] as const;

export const ORDER_PRIORITIES = ['ROUTINE', 'URGENT', 'ASAP', 'STAT'] as const;
export const SERVICE_REQUEST_CATEGORIES = [
  'LAB',
  'IMAGING',
  'PROCEDURE',
  'REFERRAL',
  'THERAPY',
] as const;
export const SERVICE_REQUEST_STATUSES = [
  'DRAFT',
  'PENDED',
  'SIGNED',
  'TRANSMITTED',
  'IN_PROGRESS',
  'RESULTED',
  'COMPLETED',
  'CANCELLED',
  'ENTERED_IN_ERROR',
] as const;
export const SERVICE_REQUEST_INTENTS = [
  'PROPOSAL',
  'PLAN',
  'ORDER',
  'ORIGINAL_ORDER',
  'REFLEX_ORDER',
] as const;
export const SPECIMEN_STATUSES = [
  'AVAILABLE',
  'UNAVAILABLE',
  'UNSATISFACTORY',
  'ENTERED_IN_ERROR',
] as const;
export const DIAGNOSTIC_REPORT_STATUSES = [
  'REGISTERED',
  'PARTIAL',
  'PRELIMINARY',
  'FINAL',
  'AMENDED',
  'CORRECTED',
  'APPENDED',
  'CANCELLED',
  'ENTERED_IN_ERROR',
] as const;

export const DOCUMENT_SOURCES = [
  'UPLOAD',
  'SCAN',
  'FAX',
  'GENERATED',
  'PORTAL',
  'INTERFACE',
] as const;
export const DOCUMENT_STATUSES = ['INBOX', 'FILED', 'SUPERSEDED', 'ENTERED_IN_ERROR'] as const;

export const TASK_TYPES = [
  'RESULT',
  'MESSAGE',
  'REFILL',
  'COSIGN',
  'DOCUMENT',
  'FAX',
  'PRIOR_AUTH',
  'CLAIM_EXCEPTION',
  'GENERAL',
] as const;
export const TASK_STATUSES = [
  'OPEN',
  'IN_PROGRESS',
  'ON_HOLD',
  'DONE',
  'CANCELLED',
  'EXPIRED',
] as const;
export const TASK_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
export const TASK_ASSIGNEE_TYPES = ['USER', 'TEAM'] as const;
export const TASK_SLA_STATES = ['OK', 'AGING', 'BREACH'] as const;

export const THREAD_KINDS = ['PATIENT', 'STAFF', 'CARE_TEAM'] as const;
export const MESSAGE_SENDER_TYPES = ['USER', 'PATIENT', 'RELATED_PERSON', 'SYSTEM'] as const;

export const CHARGE_ITEM_STATUSES = ['OPEN', 'BILLED', 'VOIDED'] as const;
export const CLAIM_STATUSES = [
  'DRAFT',
  'SCRUBBED',
  'SUBMITTED',
  'ACKNOWLEDGED',
  'REJECTED',
  'DENIED',
  'PAID',
  'PARTIAL',
  'REBILLED',
  'VOID',
] as const;
export const CLAIM_FREQUENCIES = ['ORIGINAL', 'REPLACEMENT', 'VOID'] as const;
export const PAYMENT_SOURCES = ['PATIENT', 'PAYER_ERA', 'ADAPTER', 'ADJUSTMENT'] as const;
export const PAYMENT_METHODS = ['CASH', 'CHECK', 'CARD', 'ACH', 'EFT', 'OTHER'] as const;
export const PAYMENT_STATUSES = ['PENDING', 'POSTED', 'FAILED', 'REFUNDED', 'VOIDED'] as const;
export const REMITTANCE_STATUSES = ['RECEIVED', 'PARSED', 'POSTED', 'EXCEPTIONS'] as const;
export const STATEMENT_STATUSES = ['DRAFT', 'GENERATED', 'SENT', 'PAID', 'VOID'] as const;
export const STATEMENT_DELIVERIES = ['PRINT', 'EMAIL', 'SMS', 'PORTAL'] as const;

export const FORM_STATUSES = ['DRAFT', 'PUBLISHED', 'RETIRED'] as const;
export const FORM_BINDINGS = ['PATIENT', 'ENCOUNTER', 'PORTAL', 'REFERRAL'] as const;
export const FORM_SUBMISSION_STATUSES = [
  'IN_PROGRESS',
  'COMPLETED',
  'SIGNED',
  'AMENDED',
  'ENTERED_IN_ERROR',
] as const;
export const FORM_COMPLETED_BY_TYPES = ['USER', 'PATIENT', 'RELATED_PERSON', 'SYSTEM'] as const;

export const CONSENT_STATUSES = ['PROPOSED', 'ACTIVE', 'REJECTED', 'REVOKED', 'EXPIRED'] as const;
export const CONSENT_SCOPES = [
  'TREATMENT',
  'PORTAL_ACCESS',
  'INFORMATION_SHARING',
  'RESEARCH',
  'COMMUNICATION',
  'FINANCIAL',
] as const;

/**
 * Compile-time proof that each tuple above is exactly its Prisma enum.
 *
 * `Tuple extends readonly Enum[]` rejects a tuple that has gained a value the
 * schema does not have. `AssertMirrors` rejects a tuple that is missing one:
 * `Mirrors` resolves to the missing member's literal name, which then fails the
 * `extends 'ok'` constraint with that name in the error message. Both
 * directions are checked, and the whole block erases at compile time.
 */
type Mirrors<Enum extends string, Tuple extends readonly Enum[]> = [
  Exclude<Enum, Tuple[number]>,
] extends [never]
  ? 'ok'
  : Exclude<Enum, Tuple[number]>;

type AssertMirrors<Enum extends string, Tuple extends readonly Enum[]> =
  Mirrors<Enum, Tuple> extends 'ok' ? 'ok' : Mirrors<Enum, Tuple>;

type AssertOk<T extends 'ok'> = T;

/** Exported so it is not dead code; referencing it is enough to check it. */
export type EnumParityProof = [
  AssertOk<AssertMirrors<Prisma.OrganisationMode, typeof ORGANISATION_MODES>>,
  AssertOk<AssertMirrors<Prisma.OrganisationStatus, typeof ORGANISATION_STATUSES>>,
  AssertOk<AssertMirrors<Prisma.UserStatus, typeof USER_STATUSES>>,
  AssertOk<AssertMirrors<Prisma.SensitivityClass, typeof SENSITIVITY_CLASSES>>,
  AssertOk<AssertMirrors<Prisma.AdministrativeGender, typeof ADMINISTRATIVE_GENDERS>>,
  AssertOk<AssertMirrors<Prisma.IdentifierUse, typeof IDENTIFIER_USES>>,
  AssertOk<AssertMirrors<Prisma.CoverageRank, typeof COVERAGE_RANKS>>,
  AssertOk<AssertMirrors<Prisma.CoverageStatus, typeof COVERAGE_STATUSES>>,
  AssertOk<AssertMirrors<Prisma.AppointmentStatus, typeof APPOINTMENT_STATUSES>>,
  AssertOk<AssertMirrors<Prisma.AppointmentCreatedVia, typeof APPOINTMENT_CREATED_VIA>>,
  AssertOk<AssertMirrors<Prisma.EncounterClass, typeof ENCOUNTER_CLASSES>>,
  AssertOk<AssertMirrors<Prisma.EncounterStatus, typeof ENCOUNTER_STATUSES>>,
  AssertOk<AssertMirrors<Prisma.NoteState, typeof NOTE_STATES>>,
  AssertOk<AssertMirrors<Prisma.ConditionCategory, typeof CONDITION_CATEGORIES>>,
  AssertOk<AssertMirrors<Prisma.ConditionClinicalStatus, typeof CONDITION_CLINICAL_STATUSES>>,
  AssertOk<
    AssertMirrors<Prisma.ConditionVerificationStatus, typeof CONDITION_VERIFICATION_STATUSES>
  >,
  AssertOk<AssertMirrors<Prisma.MedicationStatementStatus, typeof MEDICATION_STATEMENT_STATUSES>>,
  AssertOk<AssertMirrors<Prisma.MedicationSource, typeof MEDICATION_SOURCES>>,
  AssertOk<AssertMirrors<Prisma.MedicationRequestStatus, typeof MEDICATION_REQUEST_STATUSES>>,
  AssertOk<AssertMirrors<Prisma.MedicationRequestIntent, typeof MEDICATION_REQUEST_INTENTS>>,
  AssertOk<AssertMirrors<Prisma.AllergyType, typeof ALLERGY_TYPES>>,
  AssertOk<AssertMirrors<Prisma.AllergyCategory, typeof ALLERGY_CATEGORIES>>,
  AssertOk<AssertMirrors<Prisma.AllergyCriticality, typeof ALLERGY_CRITICALITIES>>,
  AssertOk<AssertMirrors<Prisma.AllergyClinicalStatus, typeof ALLERGY_CLINICAL_STATUSES>>,
  AssertOk<AssertMirrors<Prisma.ReactionSeverity, typeof REACTION_SEVERITIES>>,
  AssertOk<AssertMirrors<Prisma.ImmunizationStatus, typeof IMMUNIZATION_STATUSES>>,
  AssertOk<AssertMirrors<Prisma.ReferralStatus, typeof REFERRAL_STATUSES>>,
  AssertOk<AssertMirrors<Prisma.ReferralPriority, typeof REFERRAL_PRIORITIES>>,
  AssertOk<AssertMirrors<Prisma.ObservationCategory, typeof OBSERVATION_CATEGORIES>>,
  AssertOk<AssertMirrors<Prisma.ObservationStatus, typeof OBSERVATION_STATUSES>>,
  AssertOk<AssertMirrors<Prisma.AbnormalFlag, typeof ABNORMAL_FLAGS>>,
  AssertOk<AssertMirrors<Prisma.OrderPriority, typeof ORDER_PRIORITIES>>,
  AssertOk<AssertMirrors<Prisma.ServiceRequestCategory, typeof SERVICE_REQUEST_CATEGORIES>>,
  AssertOk<AssertMirrors<Prisma.ServiceRequestStatus, typeof SERVICE_REQUEST_STATUSES>>,
  AssertOk<AssertMirrors<Prisma.ServiceRequestIntent, typeof SERVICE_REQUEST_INTENTS>>,
  AssertOk<AssertMirrors<Prisma.SpecimenStatus, typeof SPECIMEN_STATUSES>>,
  AssertOk<AssertMirrors<Prisma.DiagnosticReportStatus, typeof DIAGNOSTIC_REPORT_STATUSES>>,
  AssertOk<AssertMirrors<Prisma.DocumentSource, typeof DOCUMENT_SOURCES>>,
  AssertOk<AssertMirrors<Prisma.DocumentStatus, typeof DOCUMENT_STATUSES>>,
  AssertOk<AssertMirrors<Prisma.TaskType, typeof TASK_TYPES>>,
  AssertOk<AssertMirrors<Prisma.TaskStatus, typeof TASK_STATUSES>>,
  AssertOk<AssertMirrors<Prisma.TaskPriority, typeof TASK_PRIORITIES>>,
  AssertOk<AssertMirrors<Prisma.TaskAssigneeType, typeof TASK_ASSIGNEE_TYPES>>,
  AssertOk<AssertMirrors<Prisma.TaskSlaState, typeof TASK_SLA_STATES>>,
  AssertOk<AssertMirrors<Prisma.ThreadKind, typeof THREAD_KINDS>>,
  AssertOk<AssertMirrors<Prisma.MessageSenderType, typeof MESSAGE_SENDER_TYPES>>,
  AssertOk<AssertMirrors<Prisma.ChargeItemStatus, typeof CHARGE_ITEM_STATUSES>>,
  AssertOk<AssertMirrors<Prisma.ClaimStatus, typeof CLAIM_STATUSES>>,
  AssertOk<AssertMirrors<Prisma.ClaimFrequency, typeof CLAIM_FREQUENCIES>>,
  AssertOk<AssertMirrors<Prisma.PaymentSource, typeof PAYMENT_SOURCES>>,
  AssertOk<AssertMirrors<Prisma.PaymentMethod, typeof PAYMENT_METHODS>>,
  AssertOk<AssertMirrors<Prisma.PaymentStatus, typeof PAYMENT_STATUSES>>,
  AssertOk<AssertMirrors<Prisma.RemittanceStatus, typeof REMITTANCE_STATUSES>>,
  AssertOk<AssertMirrors<Prisma.StatementStatus, typeof STATEMENT_STATUSES>>,
  AssertOk<AssertMirrors<Prisma.StatementDelivery, typeof STATEMENT_DELIVERIES>>,
  AssertOk<AssertMirrors<Prisma.FormStatus, typeof FORM_STATUSES>>,
  AssertOk<AssertMirrors<Prisma.FormBinding, typeof FORM_BINDINGS>>,
  AssertOk<AssertMirrors<Prisma.FormSubmissionStatus, typeof FORM_SUBMISSION_STATUSES>>,
  AssertOk<AssertMirrors<Prisma.FormCompletedByType, typeof FORM_COMPLETED_BY_TYPES>>,
  AssertOk<AssertMirrors<Prisma.ConsentStatus, typeof CONSENT_STATUSES>>,
  AssertOk<AssertMirrors<Prisma.ConsentScope, typeof CONSENT_SCOPES>>,
];
