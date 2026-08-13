/**
 * Canonical code system URIs used by the mappers.
 *
 * Openrunic vendors no terminology content (ICD-10-CM, CPT, LOINC, SNOMED CT
 * and RxNorm all carry their own licences), so these are identifiers only: the
 * strings that tell a consumer which code system a stored code belongs to.
 * Display text is resolved from the deployment's own terminology cache.
 */
export const SYSTEMS = {
  loinc: 'http://loinc.org',
  snomed: 'http://snomed.info/sct',
  icd10cm: 'http://hl7.org/fhir/sid/icd-10-cm',
  cpt: 'http://www.ama-assn.org/go/cpt',
  hcpcs: 'http://terminology.hl7.org/CodeSystem/HCPCS-all-x-codes',
  rxnorm: 'http://www.nlm.nih.gov/research/umls/rxnorm',
  ndc: 'http://hl7.org/fhir/sid/ndc',
  cvx: 'http://hl7.org/fhir/sid/cvx',
  mvx: 'http://terminology.hl7.org/CodeSystem/v2-0227',
  npi: 'http://hl7.org/fhir/sid/us-npi',
  dea: 'urn:oid:2.16.840.1.113883.4.814',
  ssn: 'http://hl7.org/fhir/sid/us-ssn',
  nucc: 'http://nucc.org/provider-taxonomy',
  ncpdp: 'http://terminology.hl7.org/NamingSystem/NCPDPProviderIdentificationNumber',
  identifierType: 'http://terminology.hl7.org/CodeSystem/v2-0203',
  actCode: 'http://terminology.hl7.org/CodeSystem/v3-ActCode',
  actReason: 'http://terminology.hl7.org/CodeSystem/v3-ActReason',
  actSite: 'http://terminology.hl7.org/CodeSystem/v3-ActSite',
  routeOfAdministration: 'http://terminology.hl7.org/CodeSystem/v3-RouteOfAdministration',
  confidentiality: 'http://terminology.hl7.org/CodeSystem/v3-Confidentiality',
  roleCode: 'http://terminology.hl7.org/CodeSystem/v3-RoleCode',
  subscriberRelationship: 'http://terminology.hl7.org/CodeSystem/subscriber-relationship',
  coverageCopayType: 'http://terminology.hl7.org/CodeSystem/coverage-copay-type',
  observationCategory: 'http://terminology.hl7.org/CodeSystem/observation-category',
  observationInterpretation: 'http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation',
  conditionCategory: 'http://terminology.hl7.org/CodeSystem/condition-category',
  conditionClinical: 'http://terminology.hl7.org/CodeSystem/condition-clinical',
  conditionVerStatus: 'http://terminology.hl7.org/CodeSystem/condition-ver-status',
  allergyClinical: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical',
  diagnosticServiceSection: 'http://terminology.hl7.org/CodeSystem/v2-0074',
  claimType: 'http://terminology.hl7.org/CodeSystem/claim-type',
  processPriority: 'http://terminology.hl7.org/CodeSystem/processpriority',
  organizationType: 'http://terminology.hl7.org/CodeSystem/organization-type',
  placeOfService:
    'https://www.cms.gov/Medicare/Coding/place-of-service-codes/Place_of_Service_Code_Set',
  consentScope: 'http://terminology.hl7.org/CodeSystem/consentscope',
  consentCategory: 'http://terminology.hl7.org/CodeSystem/v3-ActCode',
  provenanceParticipantType: 'http://terminology.hl7.org/CodeSystem/provenance-participant-type',
  bcp47: 'urn:ietf:bcp:47',
  usCoreCategory: 'http://hl7.org/fhir/us/core/CodeSystem/us-core-category',
} as const;

/** A canonical system URI known to the mappers. */
export type KnownSystem = (typeof SYSTEMS)[keyof typeof SYSTEMS];
