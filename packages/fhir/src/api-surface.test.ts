import { describe, expect, it } from 'vitest';

import {
  COMMON_SEARCH_PARAMS,
  SEARCH_SUPPORT,
  SUPPORTED_RESOURCE_TYPES,
  bundleResources,
  capabilityStatementResources,
  conflict,
  exception,
  findSearchParam,
  forbidden,
  hasError,
  invalid,
  isSupportedResourceType,
  isSupportedSearchParam,
  loginRequired,
  mustSupportParams,
  notFound,
  notSupported,
  operationOutcome,
  required,
  searchSupportFor,
  searchsetBundle,
  toFhirPatient,
  transactionBundle,
  unsupportedSearchParameter,
} from './index.js';
import type { FhirResource } from './index.js';
import { expectValidFhirJson } from './test-support/round-trip.js';

const patient = toFhirPatient({
  id: 'pat-1',
  familyName: 'Patientsson',
  givenNames: ['Testina'],
  mrn: 'OR-100482',
});
const practitioner: FhirResource = {
  resourceType: 'Practitioner',
  id: 'u-1',
  name: [{ family: 'Okafor', given: ['Adaeze'] }],
};

describe('searchset bundle', () => {
  it('states a total even when nothing matched, and emits no empty entry array', () => {
    const bundle = searchsetBundle([]);
    expect(bundle).toStrictEqual({ resourceType: 'Bundle', type: 'searchset', total: 0 });
    expectValidFhirJson(bundle, 'Bundle');
  });

  it('marks matches and includes differently', () => {
    const bundle = searchsetBundle([patient], {
      includes: [practitioner],
      baseUrl: 'https://example.invalid/fhir/R4',
      selfLink: 'https://example.invalid/fhir/R4/Patient?name=Patientsson',
      total: 1,
    });
    expect(bundle.entry?.[0]).toStrictEqual({
      fullUrl: 'https://example.invalid/fhir/R4/Patient/pat-1',
      resource: patient,
      search: { mode: 'match' },
    });
    expect(bundle.entry?.[1]?.search).toStrictEqual({ mode: 'include' });
    expect(bundle.link).toStrictEqual([
      { relation: 'self', url: 'https://example.invalid/fhir/R4/Patient?name=Patientsson' },
    ]);
  });

  it('trims a trailing slash from the base URL', () => {
    const bundle = searchsetBundle([patient], { baseUrl: 'https://example.invalid/fhir/R4/' });
    expect(bundle.entry?.[0]?.fullUrl).toBe('https://example.invalid/fhir/R4/Patient/pat-1');
  });

  it('omits fullUrl when there is no base URL or no id', () => {
    const anonymous: FhirResource = { resourceType: 'Patient' };
    expect(searchsetBundle([patient]).entry?.[0]).not.toHaveProperty('fullUrl');
    expect(
      searchsetBundle([anonymous], { baseUrl: 'https://example.invalid' }).entry?.[0]
    ).not.toHaveProperty('fullUrl');
  });

  it('carries paging links and a timestamp when the server supplies them', () => {
    const bundle = searchsetBundle([patient], {
      id: 'search-1',
      total: 40,
      timestamp: '2026-08-13T19:00:00.000Z',
      nextLink: 'https://example.invalid/fhir/R4/Patient?page=2',
      previousLink: 'https://example.invalid/fhir/R4/Patient?page=0',
    });
    expect(bundle.id).toBe('search-1');
    expect(bundle.total).toBe(40);
    expect(bundle.link?.map((entry) => entry.relation)).toStrictEqual(['next', 'previous']);
  });

  it('reads its resources back, by mode when asked', () => {
    const bundle = searchsetBundle([patient], { includes: [practitioner] });
    expect(bundleResources(bundle)).toStrictEqual([patient, practitioner]);
    expect(bundleResources(bundle, 'match')).toStrictEqual([patient]);
    expect(bundleResources(bundle, 'include')).toStrictEqual([practitioner]);
    expect(bundleResources({ resourceType: 'Bundle', type: 'searchset' })).toStrictEqual([]);
  });
});

describe('transaction bundle', () => {
  it('builds one request per entry and omits absent conditional headers', () => {
    const bundle = transactionBundle([
      {
        method: 'POST',
        url: 'Patient',
        resource: patient,
        fullUrl: 'urn:uuid:0d1a',
        ifNoneExist: 'identifier=OR-100482',
      },
      { method: 'DELETE', url: 'Patient/pat-2' },
    ]);
    expect(bundle.type).toBe('transaction');
    expect(bundle.entry?.[0]).toStrictEqual({
      fullUrl: 'urn:uuid:0d1a',
      resource: patient,
      request: { method: 'POST', url: 'Patient', ifNoneExist: 'identifier=OR-100482' },
    });
    expect(bundle.entry?.[1]).toStrictEqual({
      request: { method: 'DELETE', url: 'Patient/pat-2' },
    });
    expectValidFhirJson(bundle, 'Bundle');
  });

  it('carries the optimistic-locking headers when they are set', () => {
    const bundle = transactionBundle([
      {
        method: 'PUT',
        url: 'Patient/pat-1',
        resource: patient,
        ifMatch: 'W/"3"',
        ifNoneMatch: '*',
        ifModifiedSince: '2026-08-13T19:00:00.000Z',
      },
    ]);
    expect(bundle.entry?.[0]?.request).toStrictEqual({
      method: 'PUT',
      url: 'Patient/pat-1',
      ifMatch: 'W/"3"',
      ifNoneMatch: '*',
      ifModifiedSince: '2026-08-13T19:00:00.000Z',
    });
  });
});

describe('operation outcome', () => {
  it('builds an issue list with coded detail', () => {
    const outcome = operationOutcome([
      {
        severity: 'warning',
        code: 'business-rule',
        diagnostics: 'Charge has no diagnosis pointer.',
        expression: ['Claim.item[0].diagnosisSequence', ''],
        detailsCode: 'justify-missing',
        detailsSystem: 'https://openrunic.org/fhir/CodeSystem/claim-scrub',
        detailsText: 'Justify link missing',
      },
    ]);
    expect(outcome.issue[0]).toStrictEqual({
      severity: 'warning',
      code: 'business-rule',
      details: {
        coding: [
          {
            system: 'https://openrunic.org/fhir/CodeSystem/claim-scrub',
            code: 'justify-missing',
          },
        ],
        text: 'Justify link missing',
      },
      diagnostics: 'Charge has no diagnosis pointer.',
      expression: ['Claim.item[0].diagnosisSequence'],
    });
    expectValidFhirJson(outcome, 'OperationOutcome');
  });

  it('never emits an outcome without an issue', () => {
    expect(operationOutcome([]).issue).toStrictEqual([
      { severity: 'error', code: 'processing', diagnostics: 'Unspecified processing error.' },
    ]);
  });

  it('builds the standard issue codes', () => {
    expect(notFound('Patient', 'pat-9').issue[0]).toStrictEqual({
      severity: 'error',
      code: 'not-found',
      diagnostics: 'Patient/pat-9 was not found.',
    });
    expect(notFound('Patient').issue[0]?.diagnostics).toBe('Patient was not found.');
    expect(invalid('Malformed date.').issue[0]?.code).toBe('invalid');
    expect(invalid('Bad', ['Patient.birthDate']).issue[0]?.expression).toStrictEqual([
      'Patient.birthDate',
    ]);
    expect(required('Patient.identifier').issue[0]).toStrictEqual({
      severity: 'error',
      code: 'required',
      diagnostics: 'Patient.identifier is required.',
      expression: ['Patient.identifier'],
    });
    expect(forbidden('Sensitivity clearance required.').issue[0]?.code).toBe('forbidden');
    expect(loginRequired().issue[0]?.code).toBe('login');
    expect(notSupported('Chaining is not implemented.').issue[0]?.code).toBe('not-supported');
    expect(conflict('Version mismatch.').issue[0]?.code).toBe('conflict');
    expect(exception().issue[0]?.severity).toBe('fatal');
  });

  it('rejects an unimplemented search parameter by name', () => {
    expect(unsupportedSearchParameter('Observation', 'value-quantity').issue[0]).toStrictEqual({
      severity: 'error',
      code: 'not-supported',
      diagnostics: "Search parameter 'value-quantity' is not supported for Observation.",
    });
  });

  it('reports whether an outcome carries an error', () => {
    expect(hasError(notFound('Patient'))).toBe(true);
    expect(hasError(operationOutcome([{ severity: 'information', code: 'informational' }]))).toBe(
      false
    );
    expect(hasError({ resourceType: 'OperationOutcome', issue: [] })).toBe(false);
  });
});

describe('search parameter registry', () => {
  it('covers every resource type the package maps', () => {
    expect(SUPPORTED_RESOURCE_TYPES).toHaveLength(27);
    expect(SUPPORTED_RESOURCE_TYPES).toContain('Patient');
    expect(SUPPORTED_RESOURCE_TYPES).toContain('RelatedPerson');
    expect(SUPPORTED_RESOURCE_TYPES).toContain('Procedure');
    expect(SUPPORTED_RESOURCE_TYPES).toContain('QuestionnaireResponse');
    expect(SUPPORTED_RESOURCE_TYPES).toContain('MedicationDispense');
    expect(SUPPORTED_RESOURCE_TYPES).toContain('Provenance');
    for (const resourceType of SUPPORTED_RESOURCE_TYPES) {
      expect(SEARCH_SUPPORT[resourceType].resourceType).toBe(resourceType);
      expect(SEARCH_SUPPORT[resourceType].searchParams.length).toBeGreaterThan(0);
      expect(SEARCH_SUPPORT[resourceType].interactions).toContain('read');
    }
  });

  it('gives every clinical resource a patient parameter', () => {
    for (const resourceType of ['Condition', 'Observation', 'Immunization', 'Task'] as const) {
      expect(isSupportedSearchParam(resourceType, 'patient')).toBe(true);
    }
  });

  it('answers for the common parameters on every type', () => {
    expect(findSearchParam('Patient', '_id')?.type).toBe('token');
    expect(findSearchParam('Claim', '_lastUpdated')?.comparators).toContain('ge');
    expect(COMMON_SEARCH_PARAMS.map((param) => param.name)).toStrictEqual(['_id', '_lastUpdated']);
  });

  it('refuses parameters and resource types it does not implement', () => {
    expect(isSupportedResourceType('Patient')).toBe(true);
    expect(isSupportedResourceType('CarePlan')).toBe(false);
    expect(searchSupportFor('CarePlan')).toBeUndefined();
    expect(findSearchParam('CarePlan', 'patient')).toBeUndefined();
    expect(isSupportedSearchParam('Patient', 'organization')).toBe(false);
  });

  it('lists the US Core must-support parameters separately', () => {
    expect(mustSupportParams('Patient').map((param) => param.name)).toStrictEqual([
      'identifier',
      'name',
      'family',
      'given',
      'birthdate',
      'gender',
    ]);
    expect(mustSupportParams('CarePlan')).toStrictEqual([]);
  });

  it('generates CapabilityStatement resources that cannot drift from the registry', () => {
    const resources = capabilityStatementResources();
    expect(resources).toHaveLength(SUPPORTED_RESOURCE_TYPES.length);

    const patientEntry = resources.find((entry) => entry.type === 'Patient');
    expect(patientEntry?.supportedProfile).toStrictEqual([
      'http://hl7.org/fhir/us/core/StructureDefinition/us-core-patient',
    ]);
    expect(patientEntry?.interaction).toStrictEqual([
      { code: 'read' },
      { code: 'vread' },
      { code: 'search-type' },
      { code: 'create' },
      { code: 'update' },
    ]);
    expect(patientEntry?.searchParam?.map((param) => param.name)).toContain('_lastUpdated');

    const appointmentEntry = resources.find((entry) => entry.type === 'Appointment');
    expect(appointmentEntry).not.toHaveProperty('supportedProfile');

    const reportEntry = resources.find((entry) => entry.type === 'DiagnosticReport');
    expect(reportEntry?.searchInclude).toStrictEqual(['DiagnosticReport:result']);
  });
});
