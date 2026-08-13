/**
 * The FHIR conformance registry.
 *
 * Everything the CapabilityStatement claims is generated from this list, and
 * the search handlers validate against the same list. ADR-0002's rule is that
 * `metadata` can never drift from reality; the way to guarantee that is to give
 * both the endpoint and the implementation one source, and then to test that a
 * parameter advertised here is actually accepted (`fhir.test.ts`).
 */

export type SearchParamType = 'string' | 'token' | 'date' | 'number';

export interface SearchParamCapability {
  name: string;
  type: SearchParamType;
  documentation: string;
}

export type FhirInteraction = 'read' | 'search-type' | 'create';

export interface FhirResourceCapability {
  type: string;
  /** US Core profile the resource is served against, when one applies. */
  profile?: string;
  interactions: readonly FhirInteraction[];
  searchParams: readonly SearchParamCapability[];
}

/** Result-set control parameters, accepted on every search. */
export const COMMON_SEARCH_PARAMS: readonly SearchParamCapability[] = [
  { name: '_count', type: 'number', documentation: 'Page size, 1 to 100.' },
  { name: '_offset', type: 'number', documentation: 'Zero-based offset into the result set.' },
];

export const FHIR_RESOURCES: readonly FhirResourceCapability[] = [
  {
    type: 'Patient',
    profile: 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-patient',
    interactions: ['read', 'search-type', 'create'],
    searchParams: [
      { name: '_id', type: 'token', documentation: 'Logical id of the patient.' },
      {
        name: 'identifier',
        type: 'token',
        documentation:
          'Medical record number. Accepts a bare value or `system|value`; the MRN system is `https://openrunic.org/fhir/sid/mrn`.',
      },
      { name: 'family', type: 'string', documentation: 'Family name, prefix match.' },
      { name: 'given', type: 'string', documentation: 'Given name, prefix match.' },
      {
        name: 'name',
        type: 'string',
        documentation: 'Any part of the name, substring match over given and family.',
      },
      { name: 'birthdate', type: 'date', documentation: 'Date of birth, `YYYY-MM-DD`, equality.' },
      { name: 'gender', type: 'token', documentation: 'Administrative gender.' },
      { name: 'active', type: 'token', documentation: '`true` or `false`.' },
    ],
  },
];

/** Every search parameter accepted for a resource, control parameters included. */
export function acceptedSearchParams(resourceType: string): ReadonlySet<string> {
  const resource = FHIR_RESOURCES.find((candidate) => candidate.type === resourceType);
  const names = [
    ...(resource?.searchParams ?? []).map((param) => param.name),
    ...COMMON_SEARCH_PARAMS.map((param) => param.name),
  ];
  return new Set(names);
}
