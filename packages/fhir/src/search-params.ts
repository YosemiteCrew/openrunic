/// <reference types="fhir" preserve="true" />

import { compact, present } from './primitives.js';

/**
 * The search surface, as typed metadata.
 *
 * ADR-0002 accepts a deliberately small search surface: parameters are
 * implemented one at a time against relational columns rather than inherited
 * from a FHIR-native store. That only stays honest if the list of what is
 * implemented is data the API layer can consume - to route a query, to reject
 * an unimplemented parameter with an OperationOutcome instead of ignoring it,
 * and to generate the CapabilityStatement so `/metadata` cannot drift from what
 * the server actually does.
 *
 * `mustSupport` marks the parameters US Core requires for the profile; the rest
 * are Openrunic conveniences that a consumer may use but may not rely on.
 */

/** The resource types Openrunic serves at the FHIR boundary. */
export type SupportedResourceType =
  | 'Patient'
  | 'Practitioner'
  | 'PractitionerRole'
  | 'Organization'
  | 'Location'
  | 'Coverage'
  | 'Appointment'
  | 'Encounter'
  | 'Condition'
  | 'MedicationRequest'
  | 'MedicationStatement'
  | 'AllergyIntolerance'
  | 'Immunization'
  | 'Observation'
  | 'DiagnosticReport'
  | 'ServiceRequest'
  | 'Specimen'
  | 'DocumentReference'
  | 'Task'
  | 'Claim'
  | 'Consent'
  | 'Provenance';

/** FHIR search parameter types. */
export type SearchParamType =
  'number' | 'date' | 'string' | 'token' | 'reference' | 'composite' | 'quantity' | 'uri';

/** Prefixes a date or number parameter accepts. */
export type SearchComparator = 'eq' | 'ne' | 'gt' | 'lt' | 'ge' | 'le';

/** Modifiers a parameter accepts, e.g. `name:exact`. */
export type SearchModifier = 'exact' | 'contains' | 'missing' | 'not' | 'identifier';

/** One implemented search parameter. */
export interface SearchParamDefinition {
  readonly name: string;
  readonly type: SearchParamType;
  /** What the parameter matches, in one line. */
  readonly documentation: string;
  /** True when US Core requires the server to support it. */
  readonly mustSupport: boolean;
  readonly comparators?: readonly SearchComparator[];
  readonly modifiers?: readonly SearchModifier[];
  /** Target resource types, for reference parameters. */
  readonly targets?: readonly SupportedResourceType[];
}

/** Interactions implemented for a resource type. */
export type Interaction = 'read' | 'vread' | 'search-type' | 'create' | 'update' | 'patch';

/** Everything the API layer needs to know about one resource type. */
export interface ResourceSearchSupport {
  readonly resourceType: SupportedResourceType;
  /** US Core profile canonical URL, when the resource is profiled. */
  readonly profile?: string;
  readonly interactions: readonly Interaction[];
  readonly searchParams: readonly SearchParamDefinition[];
  /** `_include` targets implemented for this resource. */
  readonly includes?: readonly string[];
}

const DATE_COMPARATORS: readonly SearchComparator[] = ['eq', 'ne', 'gt', 'lt', 'ge', 'le'];
const STRING_MODIFIERS: readonly SearchModifier[] = ['exact', 'contains'];

const US_CORE = 'http://hl7.org/fhir/us/core/StructureDefinition/';

/**
 * Parameters every resource type accepts. `_id` and `_lastUpdated` are the two
 * the Bulk Data and incremental-sync flows depend on.
 */
export const COMMON_SEARCH_PARAMS: readonly SearchParamDefinition[] = [
  {
    name: '_id',
    type: 'token',
    documentation: 'Logical id of the resource.',
    mustSupport: true,
  },
  {
    name: '_lastUpdated',
    type: 'date',
    documentation: 'When the resource last changed.',
    mustSupport: false,
    comparators: DATE_COMPARATORS,
  },
];

function patientParam(
  targets: readonly SupportedResourceType[] = ['Patient']
): SearchParamDefinition {
  return {
    name: 'patient',
    type: 'reference',
    documentation: 'The patient the record is about.',
    mustSupport: true,
    targets,
  };
}

function statusParam(documentation: string, mustSupport = true): SearchParamDefinition {
  return { name: 'status', type: 'token', documentation, mustSupport };
}

function dateParam(name: string, documentation: string, mustSupport = true): SearchParamDefinition {
  return { name, type: 'date', documentation, mustSupport, comparators: DATE_COMPARATORS };
}

function codeParam(documentation: string, mustSupport = true): SearchParamDefinition {
  return { name: 'code', type: 'token', documentation, mustSupport };
}

function categoryParam(documentation: string, mustSupport = true): SearchParamDefinition {
  return { name: 'category', type: 'token', documentation, mustSupport };
}

const READ_ONLY: readonly Interaction[] = ['read', 'vread', 'search-type'];
const WRITABLE: readonly Interaction[] = ['read', 'vread', 'search-type', 'create', 'update'];

/** The implemented search surface, keyed by resource type. */
export const SEARCH_SUPPORT: Readonly<Record<SupportedResourceType, ResourceSearchSupport>> = {
  Patient: {
    resourceType: 'Patient',
    profile: `${US_CORE}us-core-patient`,
    interactions: WRITABLE,
    searchParams: [
      {
        name: 'identifier',
        type: 'token',
        documentation: 'Any patient identifier, including the MRN.',
        mustSupport: true,
      },
      {
        name: 'name',
        type: 'string',
        documentation: 'Any part of the patient name.',
        mustSupport: true,
        modifiers: STRING_MODIFIERS,
      },
      {
        name: 'family',
        type: 'string',
        documentation: 'Family name.',
        mustSupport: true,
        modifiers: STRING_MODIFIERS,
      },
      {
        name: 'given',
        type: 'string',
        documentation: 'Given name.',
        mustSupport: true,
        modifiers: STRING_MODIFIERS,
      },
      dateParam('birthdate', 'Date of birth.'),
      { name: 'gender', type: 'token', documentation: 'Administrative gender.', mustSupport: true },
      {
        name: 'death-date',
        type: 'date',
        documentation: 'Date of death.',
        mustSupport: false,
        comparators: DATE_COMPARATORS,
      },
    ],
  },
  Practitioner: {
    resourceType: 'Practitioner',
    profile: `${US_CORE}us-core-practitioner`,
    interactions: WRITABLE,
    searchParams: [
      {
        name: 'identifier',
        type: 'token',
        documentation: 'NPI, DEA or any other practitioner identifier.',
        mustSupport: true,
      },
      {
        name: 'name',
        type: 'string',
        documentation: 'Any part of the practitioner name.',
        mustSupport: true,
        modifiers: STRING_MODIFIERS,
      },
    ],
  },
  PractitionerRole: {
    resourceType: 'PractitionerRole',
    profile: `${US_CORE}us-core-practitionerrole`,
    interactions: READ_ONLY,
    searchParams: [
      {
        name: 'practitioner',
        type: 'reference',
        documentation: 'The clinician holding the role.',
        mustSupport: true,
        targets: ['Practitioner'],
      },
      // `specialty` is not here, and US Core marks it must-support.
      //
      // The taxonomy code lives on the user rather than on the role grant, so
      // filtering by it is a join the repository layer cannot express - it has
      // no set-based read, so "the grants held by every clinician with this
      // code" cannot be asked as one query. See #88 and #94.
      //
      // Declaring it and answering it partially is the failure this whole file
      // exists to avoid: a client that filters on an ignored parameter receives
      // the whole practice and believes it received a slice. An absence is
      // visible in the CapabilityStatement; a filter that half works is not.
      // The projection still emits the code, so a client can filter what it
      // receives - it simply cannot ask the server to.
    ],
    includes: ['PractitionerRole:practitioner', 'PractitionerRole:location'],
  },
  Organization: {
    resourceType: 'Organization',
    profile: `${US_CORE}us-core-organization`,
    interactions: READ_ONLY,
    searchParams: [
      {
        name: 'name',
        type: 'string',
        documentation: 'Organisation name.',
        mustSupport: true,
        modifiers: STRING_MODIFIERS,
      },
      {
        name: 'address',
        type: 'string',
        documentation: 'Any part of the address.',
        mustSupport: true,
        modifiers: STRING_MODIFIERS,
      },
      {
        name: 'identifier',
        type: 'token',
        documentation: 'NPI or X12 payer id.',
        mustSupport: true,
      },
    ],
  },
  Location: {
    resourceType: 'Location',
    profile: `${US_CORE}us-core-location`,
    interactions: READ_ONLY,
    searchParams: [
      {
        name: 'name',
        type: 'string',
        documentation: 'Facility name.',
        mustSupport: true,
        modifiers: STRING_MODIFIERS,
      },
      {
        name: 'address',
        type: 'string',
        documentation: 'Any part of the address.',
        mustSupport: true,
        modifiers: STRING_MODIFIERS,
      },
    ],
  },
  Coverage: {
    resourceType: 'Coverage',
    profile: `${US_CORE}us-core-coverage`,
    interactions: WRITABLE,
    searchParams: [patientParam(), statusParam('Coverage status.', false)],
  },
  Appointment: {
    resourceType: 'Appointment',
    interactions: WRITABLE,
    searchParams: [
      patientParam(),
      dateParam('date', 'Appointment start.'),
      statusParam('Appointment status.'),
      {
        name: 'practitioner',
        type: 'reference',
        documentation: 'The provider the slot belongs to.',
        mustSupport: false,
        targets: ['Practitioner'],
      },
      {
        name: 'location',
        type: 'reference',
        documentation: 'The facility the appointment is at.',
        mustSupport: false,
        targets: ['Location'],
      },
    ],
  },
  Encounter: {
    resourceType: 'Encounter',
    profile: `${US_CORE}us-core-encounter`,
    interactions: WRITABLE,
    searchParams: [
      patientParam(),
      dateParam('date', 'Encounter period.'),
      statusParam('Encounter status.'),
      { name: 'class', type: 'token', documentation: 'Encounter class.', mustSupport: true },
      {
        name: 'identifier',
        type: 'token',
        documentation: 'Encounter identifier.',
        mustSupport: false,
      },
    ],
  },
  Condition: {
    resourceType: 'Condition',
    profile: `${US_CORE}us-core-condition-problems-health-concerns`,
    interactions: WRITABLE,
    searchParams: [
      patientParam(),
      categoryParam('Problem list, encounter diagnosis, surgery or dental.'),
      codeParam('ICD-10-CM or SNOMED CT code.'),
      {
        name: 'clinical-status',
        type: 'token',
        documentation: 'Active, inactive, resolved and the rest.',
        mustSupport: true,
      },
      dateParam('onset-date', 'Onset date.', false),
    ],
  },
  MedicationRequest: {
    resourceType: 'MedicationRequest',
    profile: `${US_CORE}us-core-medicationrequest`,
    interactions: WRITABLE,
    searchParams: [
      patientParam(),
      statusParam('Prescription status.'),
      { name: 'intent', type: 'token', documentation: 'Order intent.', mustSupport: true },
      dateParam('authoredon', 'When the prescription was written.', false),
      {
        name: 'encounter',
        type: 'reference',
        documentation: 'The visit it was written at.',
        mustSupport: false,
        targets: ['Encounter'],
      },
    ],
  },
  MedicationStatement: {
    resourceType: 'MedicationStatement',
    interactions: WRITABLE,
    searchParams: [patientParam(), statusParam('Statement status.')],
  },
  AllergyIntolerance: {
    resourceType: 'AllergyIntolerance',
    profile: `${US_CORE}us-core-allergyintolerance`,
    interactions: WRITABLE,
    searchParams: [
      patientParam(),
      {
        name: 'clinical-status',
        type: 'token',
        documentation: 'Active, inactive or resolved.',
        mustSupport: true,
      },
    ],
  },
  Immunization: {
    resourceType: 'Immunization',
    profile: `${US_CORE}us-core-immunization`,
    interactions: WRITABLE,
    searchParams: [
      patientParam(),
      dateParam('date', 'When the dose was administered.'),
      statusParam('Immunization status.'),
    ],
  },
  Observation: {
    resourceType: 'Observation',
    profile: `${US_CORE}us-core-observation-lab`,
    interactions: WRITABLE,
    searchParams: [
      patientParam(),
      categoryParam('Vital signs, laboratory, SDOH, survey and the rest.'),
      codeParam('LOINC code.'),
      dateParam('date', 'Clinically effective instant.'),
      statusParam('Observation status.', false),
    ],
  },
  DiagnosticReport: {
    resourceType: 'DiagnosticReport',
    profile: `${US_CORE}us-core-diagnosticreport-lab`,
    interactions: WRITABLE,
    searchParams: [
      patientParam(),
      categoryParam('Lab, imaging or one of the local categories.'),
      codeParam('LOINC panel code.'),
      dateParam('date', 'Report effective instant.'),
      statusParam('Report status.', false),
    ],
    includes: ['DiagnosticReport:result'],
  },
  ServiceRequest: {
    resourceType: 'ServiceRequest',
    profile: `${US_CORE}us-core-servicerequest`,
    interactions: WRITABLE,
    searchParams: [
      patientParam(),
      categoryParam('Lab, imaging, procedure, referral or therapy.'),
      codeParam('Orderable code from the compendium.'),
      dateParam('authored', 'When the order was placed.'),
      statusParam('Order status.'),
    ],
  },
  Specimen: {
    resourceType: 'Specimen',
    profile: `${US_CORE}us-core-specimen`,
    interactions: READ_ONLY,
    searchParams: [
      patientParam(),
      {
        name: 'accession',
        type: 'token',
        documentation: "The lab's accession number.",
        mustSupport: false,
      },
    ],
  },
  DocumentReference: {
    resourceType: 'DocumentReference',
    profile: `${US_CORE}us-core-documentreference`,
    interactions: WRITABLE,
    searchParams: [
      patientParam(),
      categoryParam('Document category.'),
      { name: 'type', type: 'token', documentation: 'LOINC document type.', mustSupport: true },
      dateParam('date', 'When the document was received.'),
      statusParam('Document status.'),
    ],
  },
  Task: {
    resourceType: 'Task',
    interactions: WRITABLE,
    searchParams: [
      patientParam(),
      statusParam('Task status.'),
      codeParam('Inbox stream: result, message, refill, cosign and the rest.'),
      {
        name: 'owner',
        type: 'reference',
        documentation: 'Assignee, a practitioner or a team pool.',
        mustSupport: false,
        targets: ['Practitioner'],
      },
      dateParam('period', 'Due date.', false),
    ],
  },
  Claim: {
    resourceType: 'Claim',
    interactions: WRITABLE,
    searchParams: [
      patientParam(),
      statusParam('Claim status.'),
      dateParam('created', 'When the claim was created.', false),
      {
        name: 'insurer',
        type: 'reference',
        documentation: 'The payer the claim went to.',
        mustSupport: false,
        targets: ['Organization'],
      },
    ],
  },
  Consent: {
    resourceType: 'Consent',
    interactions: WRITABLE,
    searchParams: [
      patientParam(),
      statusParam('Consent status.'),
      categoryParam('Consent scope.'),
      dateParam('period', 'Effective period.', false),
    ],
  },
  Provenance: {
    resourceType: 'Provenance',
    profile: `${US_CORE}us-core-provenance`,
    interactions: READ_ONLY,
    searchParams: [
      {
        name: 'target',
        type: 'reference',
        documentation: 'The record the provenance is about.',
        mustSupport: true,
      },
      dateParam('recorded', 'When the action was recorded.', false),
      {
        name: 'agent',
        type: 'reference',
        documentation: 'Who acted.',
        mustSupport: false,
        targets: ['Practitioner'],
      },
    ],
  },
};

/** Every resource type served at the boundary, in declaration order. */
export const SUPPORTED_RESOURCE_TYPES = Object.keys(SEARCH_SUPPORT) as SupportedResourceType[];

/** Type guard for a resource type Openrunic serves. */
export function isSupportedResourceType(value: string): value is SupportedResourceType {
  return Object.prototype.hasOwnProperty.call(SEARCH_SUPPORT, value);
}

/** The search support for a resource type, or `undefined` when it is not served. */
export function searchSupportFor(resourceType: string): ResourceSearchSupport | undefined {
  return isSupportedResourceType(resourceType) ? SEARCH_SUPPORT[resourceType] : undefined;
}

/**
 * Finds a search parameter, including the common ones. Returns `undefined` for
 * anything unimplemented, which the API turns into an OperationOutcome rather
 * than ignoring.
 */
export function findSearchParam(
  resourceType: string,
  name: string
): SearchParamDefinition | undefined {
  const support = searchSupportFor(resourceType);
  if (support === undefined) {
    return undefined;
  }
  return (
    support.searchParams.find((param) => param.name === name) ??
    COMMON_SEARCH_PARAMS.find((param) => param.name === name)
  );
}

/** True when the parameter is implemented for that resource type. */
export function isSupportedSearchParam(resourceType: string, name: string): boolean {
  return findSearchParam(resourceType, name) !== undefined;
}

/** The US Core must-support parameters for a resource type. */
export function mustSupportParams(resourceType: string): readonly SearchParamDefinition[] {
  const support = searchSupportFor(resourceType);
  return (support?.searchParams ?? []).filter((param) => param.mustSupport);
}

/**
 * Builds `CapabilityStatement.rest[0].resource` from this registry, so the
 * `/metadata` endpoint reports exactly what is implemented and cannot drift
 * from it.
 */
export function capabilityStatementResources(): fhir4.CapabilityStatementRestResource[] {
  return SUPPORTED_RESOURCE_TYPES.map((resourceType) => {
    const support = SEARCH_SUPPORT[resourceType];
    return compact<fhir4.CapabilityStatementRestResource>({
      type: resourceType,
      supportedProfile: present([support.profile]),
      interaction: support.interactions.map((code) => ({ code })),
      searchParam: [...support.searchParams, ...COMMON_SEARCH_PARAMS].map((param) =>
        compact<fhir4.CapabilityStatementRestResourceSearchParam>({
          name: param.name,
          type: param.type,
          documentation: param.documentation,
        })
      ),
      searchInclude: support.includes ? [...support.includes] : undefined,
    });
  });
}
