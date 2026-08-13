import {
  DOCUMENT_STATUS,
  MEDICATION_REQUEST_STATUS,
  OBSERVATION_STATUS,
  SERVICE_REQUEST_STATUS,
  TASK_STATUS,
  type EnumMapping,
} from '@openrunic/fhir';

import { ApiError } from '../errors.js';

import {
  dateWindow,
  parseDateOnly,
  referenceId,
  tokenValue,
  type DateWindow,
  type FhirPaging,
  type SearchParams,
} from './params.js';
import { pageOf } from './params.js';
import { fromFhirGender, patientRowToFhir } from './patient.js';
import {
  allergyResource,
  appointmentResource,
  conditionResource,
  coverageResource,
  diagnosticReportResource,
  documentReferenceResource,
  encounterResource,
  immunizationResource,
  locationResource,
  medicationRequestResource,
  medicationStatementResource,
  observationResource,
  practitionerResource,
  serviceRequestResource,
  specimenResource,
  taskResource,
} from './projections.js';
import { defineFhirResource, type FhirResourceModule } from './resource-module.js';

/**
 * The resources this server serves, and exactly which parameters it implements.
 *
 * Two rules govern what appears here, and both are about not over-claiming.
 *
 * A parameter is advertised only when the repository behind it can actually
 * answer it. The alternative - advertising the full US Core must-support list
 * and quietly ignoring half of it - is the failure this boundary is built to
 * avoid, because a client that filters on an ignored parameter receives the
 * whole practice and believes it received a slice.
 *
 * A coded parameter is advertised only when the domain enum and the FHIR value
 * set agree one-for-one. Several of the workflow enums are deliberately wider
 * than FHIR's - the schedule needs a state for "roomed" and R4 has no code for
 * it - and `packages/fhir` derives that loss rather than asserting it. Where a
 * mapping loses information, searching by the FHIR code would silently match
 * one of the states it collapses and miss the others, so the parameter is left
 * out and the loss is visible in the CapabilityStatement as an absence rather
 * than hidden behind a filter that half works.
 */

const CHART_SORT = { order: 'desc' } as const;

/** Advertises `status` only when the FHIR value set covers every domain state. */
function losslessStatus<D extends string, F extends string>(mapping: EnumMapping<D, F>): string[] {
  return mapping.lossyValues.length === 0 ? ['status'] : [];
}

/** Reads a status token, refusing a code the mapping does not round-trip. */
function statusToken<D extends string>(
  mapping: EnumMapping<D, string>,
  raw: string,
  param: string
): D {
  const code = tokenValue(raw);
  const domain = mapping.fromFhir(code);
  if (mapping.toFhir(domain) !== code) {
    throw ApiError.malformed(`${param} is not a status this server recognises.`, {
      issues: [{ path: param, message: 'not a value from the resource status value set' }],
    });
  }
  return domain;
}

/** Spreads a date parameter's window onto a query's `from` and `to`. */
function window(raw: string | undefined, param: string): DateWindow {
  return raw === undefined ? {} : dateWindow(raw, param);
}

/** Spreads a reference parameter onto a query's id filter. */
function patientFilter(raw: string | undefined): { patientId?: string } {
  return raw === undefined ? {} : { patientId: referenceId(raw, 'Patient', 'patient') };
}

const patientModule = defineFhirResource({
  type: 'Patient',
  interactions: ['read', 'search-type', 'create'],
  params: ['_id', 'identifier', 'name', 'family', 'given', 'birthdate', 'gender'],
  permission: 'patient.read',
  collection: (repositories) => repositories.patients,
  toQuery: (query: SearchParams, paging: FhirPaging) => {
    const gender =
      query.gender === undefined ? undefined : fromFhirGender(tokenValue(query.gender));
    if (query.gender !== undefined && gender === undefined) {
      throw ApiError.malformed('gender must be one of male, female, other, unknown.', {
        issues: [{ path: 'gender', message: 'not an administrative gender' }],
      });
    }
    return {
      ...pageOf(paging),
      ...(query._id === undefined ? {} : { id: query._id }),
      // `identifier` is a token: `system|value` or a bare value. The value half
      // is the MRN, the only identifier this search is implemented against.
      ...(query.identifier === undefined ? {} : { mrn: tokenValue(query.identifier) }),
      ...(gender === undefined ? {} : { sexAtBirth: gender }),
      ...(query.family === undefined ? {} : { family: query.family }),
      ...(query.given === undefined ? {} : { given: query.given }),
      ...(query.name === undefined ? {} : { q: query.name }),
      ...(query.birthdate === undefined
        ? {}
        : { birthDate: parseDateOnly(query.birthdate, 'birthdate') }),
      sort: 'familyName' as const,
      order: 'asc' as const,
    };
  },
  toResource: patientRowToFhir,
});

const practitionerModule = defineFhirResource({
  type: 'Practitioner',
  interactions: ['read', 'search-type'],
  params: ['name'],
  permission: 'user.read',
  collection: (repositories) => repositories.users,
  toQuery: (query: SearchParams, paging: FhirPaging) => ({
    ...pageOf(paging),
    ...(query.name === undefined ? {} : { q: query.name }),
    sort: 'familyName' as const,
    order: 'asc' as const,
  }),
  toResource: practitionerResource,
});

const locationModule = defineFhirResource({
  type: 'Location',
  interactions: ['read', 'search-type'],
  params: ['name'],
  permission: 'facility.read',
  collection: (repositories) => repositories.facilities,
  toQuery: (query: SearchParams, paging: FhirPaging) => ({
    ...pageOf(paging),
    ...(query.name === undefined ? {} : { q: query.name }),
    sort: 'name' as const,
    order: 'asc' as const,
  }),
  toResource: locationResource,
});

const coverageModule = defineFhirResource({
  type: 'Coverage',
  interactions: ['read', 'search-type'],
  params: ['patient'],
  permission: 'coverage.read',
  collection: (repositories) => repositories.coverages,
  toQuery: (query: SearchParams, paging: FhirPaging) => ({
    ...pageOf(paging),
    ...patientFilter(query.patient),
    sort: 'rank' as const,
    order: 'asc' as const,
  }),
  toResource: coverageResource,
});

const appointmentModule = defineFhirResource({
  type: 'Appointment',
  interactions: ['read', 'search-type'],
  params: ['_id', 'patient', 'date', 'practitioner', 'location'],
  permission: 'appointment.read',
  collection: (repositories) => repositories.appointments,
  toQuery: (query: SearchParams, paging: FhirPaging) => ({
    ...pageOf(paging),
    ...(query._id === undefined ? {} : { id: query._id }),
    ...patientFilter(query.patient),
    ...(query.practitioner === undefined
      ? {}
      : { providerId: referenceId(query.practitioner, 'Practitioner', 'practitioner') }),
    ...(query.location === undefined
      ? {}
      : { facilityId: referenceId(query.location, 'Location', 'location') }),
    ...window(query.date, 'date'),
    sort: 'start' as const,
    order: 'asc' as const,
  }),
  toResource: appointmentResource,
});

const encounterModule = defineFhirResource({
  type: 'Encounter',
  interactions: ['read', 'search-type'],
  params: ['patient', 'date'],
  permission: 'encounter.read',
  collection: (repositories) => repositories.encounters,
  toQuery: (query: SearchParams, paging: FhirPaging) => ({
    ...pageOf(paging),
    ...patientFilter(query.patient),
    ...window(query.date, 'date'),
    sort: 'startedAt' as const,
    ...CHART_SORT,
  }),
  toResource: encounterResource,
});

const conditionModule = defineFhirResource({
  type: 'Condition',
  interactions: ['read', 'search-type'],
  params: ['patient', 'code'],
  permission: 'encounter.read',
  collection: (repositories) => repositories.problems,
  toQuery: (query: SearchParams, paging: FhirPaging) => ({
    ...pageOf(paging),
    ...patientFilter(query.patient),
    ...(query.code === undefined ? {} : { code: tokenValue(query.code) }),
    sort: 'recordedAt' as const,
    ...CHART_SORT,
  }),
  toResource: conditionResource,
});

const medicationRequestModule = defineFhirResource({
  type: 'MedicationRequest',
  interactions: ['read', 'search-type'],
  params: ['patient', 'encounter', ...losslessStatus(MEDICATION_REQUEST_STATUS)],
  permission: 'encounter.read',
  collection: (repositories) => repositories.prescriptions,
  toQuery: (query: SearchParams, paging: FhirPaging) => ({
    ...pageOf(paging),
    ...patientFilter(query.patient),
    ...(query.encounter === undefined
      ? {}
      : { encounterId: referenceId(query.encounter, 'Encounter', 'encounter') }),
    ...(query.status === undefined
      ? {}
      : { status: statusToken(MEDICATION_REQUEST_STATUS, query.status, 'status') }),
    sort: 'writtenAt' as const,
    ...CHART_SORT,
  }),
  toResource: medicationRequestResource,
});

const medicationStatementModule = defineFhirResource({
  type: 'MedicationStatement',
  interactions: ['read', 'search-type'],
  params: ['patient'],
  permission: 'encounter.read',
  collection: (repositories) => repositories.medicationStatements,
  toQuery: (query: SearchParams, paging: FhirPaging) => ({
    ...pageOf(paging),
    ...patientFilter(query.patient),
    sort: 'reportedAt' as const,
    ...CHART_SORT,
  }),
  toResource: medicationStatementResource,
});

const allergyModule = defineFhirResource({
  type: 'AllergyIntolerance',
  interactions: ['read', 'search-type'],
  params: ['patient'],
  permission: 'encounter.read',
  collection: (repositories) => repositories.allergies,
  toQuery: (query: SearchParams, paging: FhirPaging) => ({
    ...pageOf(paging),
    ...patientFilter(query.patient),
    sort: 'recordedAt' as const,
    ...CHART_SORT,
  }),
  toResource: allergyResource,
});

const immunizationModule = defineFhirResource({
  type: 'Immunization',
  interactions: ['read', 'search-type'],
  params: ['patient', 'date'],
  permission: 'encounter.read',
  collection: (repositories) => repositories.immunisations,
  toQuery: (query: SearchParams, paging: FhirPaging) => ({
    ...pageOf(paging),
    ...patientFilter(query.patient),
    ...window(query.date, 'date'),
    sort: 'administeredAt' as const,
    ...CHART_SORT,
  }),
  toResource: immunizationResource,
});

const observationModule = defineFhirResource({
  type: 'Observation',
  interactions: ['read', 'search-type'],
  params: ['patient', 'code', 'date', ...losslessStatus(OBSERVATION_STATUS)],
  permission: 'encounter.read',
  collection: (repositories) => repositories.observations,
  toQuery: (query: SearchParams, paging: FhirPaging) => ({
    ...pageOf(paging),
    ...patientFilter(query.patient),
    ...(query.code === undefined ? {} : { code: tokenValue(query.code) }),
    ...(query.status === undefined
      ? {}
      : { status: statusToken(OBSERVATION_STATUS, query.status, 'status') }),
    ...window(query.date, 'date'),
    sort: 'effectiveAt' as const,
    ...CHART_SORT,
  }),
  toResource: observationResource,
});

const diagnosticReportModule = defineFhirResource({
  type: 'DiagnosticReport',
  interactions: ['read', 'search-type'],
  params: ['patient', 'date'],
  permission: 'result.read',
  collection: (repositories) => repositories.reports,
  toQuery: (query: SearchParams, paging: FhirPaging) => ({
    ...pageOf(paging),
    ...patientFilter(query.patient),
    ...window(query.date, 'date'),
    sort: 'issuedAt' as const,
    ...CHART_SORT,
  }),
  toResource: async (row, context) => {
    // A report without its analytes is a report that misrepresents what came
    // back, so the discrete results are resolved per row. That is one extra
    // query per report on a search, which is affordable at a page of twenty-five
    // and is the thing `_include` would replace when it lands.
    const results = await context.repositories.resultObservations.list({
      page: 1,
      pageSize: 500,
      diagnosticReportId: row.id,
      sort: 'sequence',
      order: 'asc',
    });
    return diagnosticReportResource(
      row,
      results.rows.map((result) => result.id)
    );
  },
});

const serviceRequestModule = defineFhirResource({
  type: 'ServiceRequest',
  interactions: ['read', 'search-type'],
  params: ['patient', 'authored', ...losslessStatus(SERVICE_REQUEST_STATUS)],
  permission: 'order.read',
  collection: (repositories) => repositories.orders,
  toQuery: (query: SearchParams, paging: FhirPaging) => ({
    ...pageOf(paging),
    ...patientFilter(query.patient),
    ...(query.status === undefined
      ? {}
      : { status: statusToken(SERVICE_REQUEST_STATUS, query.status, 'status') }),
    ...window(query.authored, 'authored'),
    sort: 'requestedAt' as const,
    ...CHART_SORT,
  }),
  toResource: serviceRequestResource,
});

const specimenModule = defineFhirResource({
  type: 'Specimen',
  interactions: ['read', 'search-type'],
  params: ['patient', 'accession'],
  permission: 'order.read',
  collection: (repositories) => repositories.specimens,
  toQuery: (query: SearchParams, paging: FhirPaging) => ({
    ...pageOf(paging),
    ...patientFilter(query.patient),
    ...(query.accession === undefined ? {} : { accessionNumber: tokenValue(query.accession) }),
    sort: 'collectedAt' as const,
    ...CHART_SORT,
  }),
  toResource: specimenResource,
});

const documentReferenceModule = defineFhirResource({
  type: 'DocumentReference',
  interactions: ['read', 'search-type'],
  params: ['patient', 'category', 'date', ...losslessStatus(DOCUMENT_STATUS)],
  permission: 'document.read',
  collection: (repositories) => repositories.documents,
  toQuery: (query: SearchParams, paging: FhirPaging) => ({
    ...pageOf(paging),
    ...patientFilter(query.patient),
    ...(query.category === undefined ? {} : { category: tokenValue(query.category) }),
    ...(query.status === undefined
      ? {}
      : { status: statusToken(DOCUMENT_STATUS, query.status, 'status') }),
    ...window(query.date, 'date'),
    sort: 'receivedAt' as const,
    ...CHART_SORT,
  }),
  toResource: documentReferenceResource,
});

const taskModule = defineFhirResource({
  type: 'Task',
  interactions: ['read', 'search-type'],
  params: ['patient', ...losslessStatus(TASK_STATUS)],
  permission: 'task.read',
  collection: (repositories) => repositories.tasks,
  toQuery: (query: SearchParams, paging: FhirPaging) => ({
    ...pageOf(paging),
    ...patientFilter(query.patient),
    ...(query.status === undefined
      ? {}
      : { status: statusToken(TASK_STATUS, query.status, 'status') }),
    sort: 'dueAt' as const,
    order: 'asc' as const,
  }),
  toResource: taskResource,
});

/**
 * The mounted resources, in the order the CapabilityStatement lists them.
 *
 * Claim and Organization are deliberately absent. A Claim resource without its
 * lines misrepresents what was billed, and resolving lines per row across a
 * search is a query shape this boundary does not yet support; an Organization
 * would have to be either the tenant itself, which is not addressable through a
 * tenant-scoped client, or a payer, whose directory is not part of this
 * workstream. Serving either half-formed would be worse than not serving it,
 * and the CapabilityStatement says so by not listing them.
 */
export const SERVED_MODULES: readonly FhirResourceModule[] = [
  patientModule,
  practitionerModule,
  locationModule,
  coverageModule,
  appointmentModule,
  encounterModule,
  conditionModule,
  medicationRequestModule,
  medicationStatementModule,
  allergyModule,
  immunizationModule,
  observationModule,
  diagnosticReportModule,
  serviceRequestModule,
  specimenModule,
  documentReferenceModule,
  taskModule,
];

export { booleanToken } from './params.js';
