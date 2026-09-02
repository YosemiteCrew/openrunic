/// <reference types="fhir" preserve="true" />

/**
 * The FHIR release Openrunic serializes to at its API boundary (R4).
 * Matches `CapabilityStatement.fhirVersion`.
 */
export const FHIR_VERSION = '4.0.1';

// @types/fhir exposes its types as ambient `fhir4.*` globals rather than
// module exports, so re-export the ones Openrunic's API surface needs as
// proper named module types.
export type CapabilityStatement = fhir4.CapabilityStatement;
export type Patient = fhir4.Patient;
export type Practitioner = fhir4.Practitioner;
export type PractitionerRole = fhir4.PractitionerRole;
export type Organization = fhir4.Organization;
export type Location = fhir4.Location;
export type Coverage = fhir4.Coverage;
export type RelatedPerson = fhir4.RelatedPerson;
export type Procedure = fhir4.Procedure;
export type CareTeam = fhir4.CareTeam;
export type Questionnaire = fhir4.Questionnaire;
export type QuestionnaireResponse = fhir4.QuestionnaireResponse;
export type MedicationDispense = fhir4.MedicationDispense;
export type Appointment = fhir4.Appointment;
export type Encounter = fhir4.Encounter;
export type Condition = fhir4.Condition;
export type MedicationRequest = fhir4.MedicationRequest;
export type MedicationStatement = fhir4.MedicationStatement;
export type AllergyIntolerance = fhir4.AllergyIntolerance;
export type Immunization = fhir4.Immunization;
export type Observation = fhir4.Observation;
export type DiagnosticReport = fhir4.DiagnosticReport;
export type ServiceRequest = fhir4.ServiceRequest;
export type Specimen = fhir4.Specimen;
export type DocumentReference = fhir4.DocumentReference;
export type Task = fhir4.Task;
export type Claim = fhir4.Claim;
export type Consent = fhir4.Consent;
export type Provenance = fhir4.Provenance;
/**
 * A bundle of concrete resources.
 *
 * `@types/fhir` 0.0.44 changed this shape twice over: the parameter gained an
 * `extends Resource` constraint, and its default moved from the `FhirResource`
 * union to the bare `Resource` base. The constraint is repeated here because it
 * has to be, and the default is deliberately kept as the union: a bundle whose
 * entries are typed `Resource` has no `resourceType` to discriminate on, so
 * every read of one becomes a cast at the call site. Keeping the union here
 * means one declaration carries the narrowing instead of every consumer.
 */
export type Bundle<T extends fhir4.Resource = fhir4.FhirResource> = fhir4.Bundle<T>;
export type OperationOutcome = fhir4.OperationOutcome;
export type Reference = fhir4.Reference;
export type FhirResource = fhir4.FhirResource;

// --- Shared building blocks -------------------------------------------------

export {
  fhirReference,
  optionalReference,
  referenceId,
  referenceIds,
  referenceType,
  firstReferenceId,
} from './reference.js';
export { SYSTEMS } from './systems.js';
export type { KnownSystem } from './systems.js';
export {
  UCUM_SYSTEM,
  address,
  annotations,
  base64ToHex,
  codeableConcept,
  codeableConcepts,
  coding,
  compact,
  compactOrUndefined,
  contactPoint,
  hexToBase64,
  humanName,
  identifier,
  isPresentString,
  money,
  period,
  present,
  quantity,
  readAnnotation,
  readCents,
  readCode,
  readCodeDisplay,
  readCodeSystem,
  readCodes,
  readConceptText,
  readContactPoint,
  readIdentifier,
  readIdentifierByType,
  readQuantityUnit,
  readQuantityValue,
  readString,
  setOptional,
  simpleQuantity,
} from './primitives.js';
export { conceptMapping, enumMapping } from './enum-mapping.js';
export type { ConceptMapping, EnumMapping, EnumMappingOptions } from './enum-mapping.js';
export {
  LOCAL_PRIORITY_EXTENSION,
  LOCAL_STATUS_EXTENSION,
  OMB_RACE_ETHNICITY_SYSTEM,
  OPENRUNIC_CODE_SYSTEM_BASE,
  OPENRUNIC_EXTENSION_BASE,
  US_CORE_BIRTHSEX_EXTENSION,
  US_CORE_ETHNICITY_EXTENSION,
  US_CORE_GENDER_IDENTITY_EXTENSION,
  US_CORE_RACE_EXTENSION,
  booleanExtension,
  codeExtension,
  genderIdentityExtension,
  localStatusExtension,
  ombCategoryExtension,
  openrunicCodeSystem,
  openrunicExtension,
  readBooleanExtension,
  readCodeExtension,
  readGenderIdentityCode,
  readGenderIdentitySystem,
  readLocalStatus,
  readOmbCategoryCodes,
  readOmbCategoryText,
  readReferenceExtension,
  readStringExtension,
  referenceExtension,
  stringExtension,
} from './extensions.js';

// --- Bundles, outcomes, search metadata -------------------------------------

export { bundleResources, searchsetBundle, transactionBundle } from './bundle.js';
export type { SearchsetOptions, TransactionEntry, TransactionMethod } from './bundle.js';
export {
  conflict,
  exception,
  forbidden,
  hasError,
  invalid,
  loginRequired,
  notFound,
  notSupported,
  operationOutcome,
  required,
  unsupportedSearchParameter,
} from './operation-outcome.js';
export type { IssueCode, IssueSeverity, OutcomeIssue } from './operation-outcome.js';
export {
  COMMON_SEARCH_PARAMS,
  SEARCH_SUPPORT,
  SUPPORTED_RESOURCE_TYPES,
  capabilityStatementResources,
  findSearchParam,
  isSupportedResourceType,
  isSupportedSearchParam,
  mustSupportParams,
  searchSupportFor,
} from './search-params.js';
export type {
  Interaction,
  ResourceSearchSupport,
  SearchComparator,
  SearchModifier,
  SearchParamDefinition,
  SearchParamType,
  SupportedResourceType,
} from './search-params.js';

// --- Resource mappers -------------------------------------------------------

export { IDENTIFIER_TYPE_SYSTEM, MRN_SYSTEM, fromFhirPatient, toFhirPatient } from './patient.js';
export { PATIENT_DROPPED_FIELDS } from './patient.js';
export type { DomainIdentifierUse, DomainPatient, DomainPatientIdentifier } from './patient.js';

export {
  PRACTITIONER_DROPPED_FIELDS,
  PRACTITIONER_ROLE_DROPPED_FIELDS,
  PRACTITIONER_ROLE_SYSTEM,
  fromFhirPractitioner,
  fromFhirPractitionerRole,
  toFhirPractitioner,
  toFhirPractitionerRole,
} from './practitioner.js';
export type { DomainPractitioner, DomainPractitionerRole } from './practitioner.js';

export {
  CLAIM_FILING_SYSTEM,
  FACILITY_CODE_SYSTEM,
  LOCATION_DROPPED_FIELDS,
  ORGANIZATION_DROPPED_FIELDS,
  X12_PAYER_SYSTEM,
  fromFhirLocation,
  fromFhirOrganization,
  toFhirLocation,
  toFhirOrganization,
} from './organization.js';
export type { DomainLocation, DomainOrganization } from './organization.js';

export {
  fromFhirRelatedPerson,
  PORTAL_PROXY_EXTENSION,
  toFhirRelatedPerson,
} from './related-person.js';
export type { DomainRelatedPerson } from './related-person.js';
export {
  DISPENSE_LOT_EXTENSION,
  fromFhirMedicationDispense,
  toFhirMedicationDispense,
} from './medication-dispense.js';
export type { DomainMedicationDispense } from './medication-dispense.js';
export { fromFhirProcedure, toFhirProcedure } from './procedure.js';
export type { DomainProcedure, DomainProcedureStatus } from './procedure.js';
export { COVERAGE_DROPPED_FIELDS, fromFhirCoverage, toFhirCoverage } from './coverage.js';
export type { DomainCoverage, DomainCoverageRank, DomainCoverageStatus } from './coverage.js';

export {
  APPOINTMENT_DROPPED_FIELDS,
  APPOINTMENT_STATUS,
  APPOINTMENT_TYPE_SYSTEM,
  fromFhirAppointment,
  toFhirAppointment,
} from './appointment.js';
export type { DomainAppointment, DomainAppointmentStatus } from './appointment.js';

export { ENCOUNTER_DROPPED_FIELDS, fromFhirEncounter, toFhirEncounter } from './encounter.js';
export type { DomainEncounter, DomainEncounterClass, DomainEncounterStatus } from './encounter.js';

export {
  CONDITION_CATEGORY_SYSTEM,
  CONDITION_DROPPED_FIELDS,
  fromFhirCondition,
  toFhirCondition,
} from './condition.js';
export type {
  DomainCondition,
  DomainConditionCategory,
  DomainConditionClinicalStatus,
  DomainConditionVerificationStatus,
} from './condition.js';

export {
  MEDICATION_REQUEST_DROPPED_FIELDS,
  MEDICATION_REQUEST_STATUS,
  fromFhirMedicationRequest,
  toFhirMedicationRequest,
} from './medication-request.js';
export type {
  DomainMedicationRequest,
  DomainMedicationRequestIntent,
  DomainMedicationRequestStatus,
} from './medication-request.js';

export {
  MEDICATION_SOURCE_EXTENSION,
  MEDICATION_STATEMENT_DROPPED_FIELDS,
  fromFhirMedicationStatement,
  toFhirMedicationStatement,
} from './medication-statement.js';
export type {
  DomainMedicationSource,
  DomainMedicationStatement,
  DomainMedicationStatementStatus,
} from './medication-statement.js';

export {
  ALLERGY_INTOLERANCE_DROPPED_FIELDS,
  fromFhirAllergyIntolerance,
  toFhirAllergyIntolerance,
} from './allergy-intolerance.js';
export type {
  DomainAllergyCategory,
  DomainAllergyClinicalStatus,
  DomainAllergyCriticality,
  DomainAllergyIntolerance,
  DomainAllergyType,
  DomainReactionSeverity,
} from './allergy-intolerance.js';

export {
  IMMUNIZATION_DROPPED_FIELDS,
  fromFhirImmunization,
  toFhirImmunization,
} from './immunization.js';
export type { DomainImmunization, DomainImmunizationStatus } from './immunization.js';

export {
  ABNORMAL_FLAG_EXTENSION,
  DIAGNOSTIC_REPORT_EXTENSION,
  OBSERVATION_DROPPED_FIELDS,
  OBSERVATION_STATUS,
  RESULT_OBSERVATION_DROPPED_FIELDS,
  fromFhirObservation,
  fromFhirResultObservation,
  readAbnormalFlag,
  toFhirObservation,
  toFhirResultObservation,
} from './observation.js';
export type {
  DomainAbnormalFlag,
  DomainObservation,
  DomainObservationCategory,
  DomainObservationStatus,
  DomainResultObservation,
} from './observation.js';

export {
  DIAGNOSTIC_REPORT_DROPPED_FIELDS,
  REPORT_CATEGORY_SYSTEM,
  fromFhirDiagnosticReport,
  toFhirDiagnosticReport,
} from './diagnostic-report.js';
export type { DomainDiagnosticReport, DomainDiagnosticReportStatus } from './diagnostic-report.js';

export {
  ORDER_PRIORITY,
  REQUISITION_SYSTEM,
  SERVICE_CATEGORY_SYSTEM,
  SERVICE_REQUEST_CATEGORY,
  SERVICE_REQUEST_DROPPED_FIELDS,
  SERVICE_REQUEST_STATUS,
  SPECIMEN_TYPE_EXTENSION,
  fromFhirServiceRequest,
  toFhirServiceRequest,
} from './service-request.js';
export type {
  DomainOrderPriority,
  DomainServiceCategory,
  DomainServiceRequest,
  DomainServiceRequestIntent,
  DomainServiceRequestStatus,
} from './service-request.js';

export {
  ACCESSION_SYSTEM,
  SPECIMEN_DROPPED_FIELDS,
  fromFhirSpecimen,
  toFhirSpecimen,
} from './specimen.js';
export type { DomainSpecimen, DomainSpecimenStatus } from './specimen.js';

export {
  DOCUMENT_REFERENCE_DROPPED_FIELDS,
  DOCUMENT_SOURCE_EXTENSION,
  DOCUMENT_SOURCE_SYSTEM,
  DOCUMENT_STATUS,
  fromFhirDocumentReference,
  toFhirDocumentReference,
} from './document-reference.js';
export type {
  DomainDocument,
  DomainDocumentSource,
  DomainDocumentStatus,
  DomainSensitivityClass,
} from './document-reference.js';

export {
  TASK_DROPPED_FIELDS,
  TASK_PRIORITY,
  TASK_STATUS,
  TASK_TYPE_SYSTEM,
  TEAM_SYSTEM,
  fromFhirTask,
  toFhirTask,
} from './task.js';
export type {
  DomainTask,
  DomainTaskAssigneeType,
  DomainTaskPriority,
  DomainTaskStatus,
  DomainTaskType,
} from './task.js';

export {
  CLAIM_DROPPED_FIELDS,
  CLAIM_FREQUENCY_EXTENSION,
  CLAIM_FREQUENCY_SYSTEM,
  CLAIM_STATUS,
  fromFhirClaim,
  toFhirClaim,
} from './claim.js';
export type {
  DomainClaim,
  DomainClaimFrequency,
  DomainClaimLine,
  DomainClaimStatus,
} from './claim.js';

export {
  CONSENT_DROPPED_FIELDS,
  CONSENT_SCOPE_SYSTEM,
  CONSENT_STATUS,
  fromFhirConsent,
  toFhirConsent,
} from './consent.js';
export type { DomainConsentGrant, DomainConsentScope, DomainConsentStatus } from './consent.js';

export {
  ACTOR_SYSTEM,
  ACTOR_TYPE_SYSTEM,
  AUDIT_ACTION_SYSTEM,
  AUDIT_OUTCOME_EXTENSION,
  BREAKGLASS_EXTENSION,
  PROVENANCE_DROPPED_FIELDS,
  fromFhirProvenance,
  toFhirProvenance,
} from './provenance.js';
export type { DomainProvenance } from './provenance.js';

export {
  fromFhirImagingStudy,
  IMAGING_STUDY_DROPPED_FIELDS,
  toFhirImagingStudy,
  type DomainImagingStudy,
  type DomainImagingStudyStatus,
} from './imaging-study.js';
export { CARE_TEAM_STATUS, fromFhirCareTeam, toFhirCareTeam } from './care-team.js';
export type {
  DomainCareTeam,
  DomainCareTeamMemberType,
  DomainCareTeamParticipant,
  DomainCareTeamStatus,
} from './care-team.js';
export type CarePlan = fhir4.CarePlan;
export {
  CARE_PLAN_INTENT,
  CARE_PLAN_STATUS,
  fromFhirCarePlan,
  toFhirCarePlan,
} from './care-plan.js';
export type { DomainCarePlan, DomainCarePlanIntent, DomainCarePlanStatus } from './care-plan.js';
