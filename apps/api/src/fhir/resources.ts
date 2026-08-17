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
  claimResource,
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
  practitionerRoleResource,
  provenanceResource,
  serviceRequestResource,
  specimenResource,
  taskResource,
} from './projections.js';
import { CLAIM_STATUSES } from '@openrunic/database';

import type { ScopedRow } from '../repositories/rows.js';
import type { ClaimStatus } from '../repositories/specs/financial.js';
import type { Repositories } from '../repositories/types.js';

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

/**
 * What one page of role grants needs beyond the grants themselves.
 *
 * A grant names a role and a user; the resource needs the role's key, the
 * user's specialty and status, and when the user row last changed.
 *
 * Fetching those per row would be two queries per grant. This dedupes the ids
 * first, so a page of fifty grants held by five clinicians across two roles
 * costs seven reads rather than a hundred - which is the win in practice, since
 * grants cluster hard on both.
 *
 * It is worth being exact about what this is not: seven reads, not one. The
 * repository layer has no set-based read, so these are still individual
 * `findById` calls, merely deduped and issued concurrently. On a page where
 * every grant belongs to a different practitioner the dedupe buys nothing and
 * the count is back to one per row. Issue #88 tracks the set-based read that
 * would fix that properly, for every module's loader rather than this one.
 */
interface RolePageData {
  roleKeyById: Map<string, string>;
  userById: Map<string, ScopedRow<'User'>>;
}

async function prepareRoles(
  rows: readonly ScopedRow<'RoleAssignment'>[],
  repositories: Repositories
): Promise<RolePageData> {
  const roleKeyById = new Map<string, string>();
  const userById = new Map<string, ScopedRow<'User'>>();
  if (rows.length === 0) return { roleKeyById, userById };

  const roleIds = [...new Set(rows.map((row) => row.roleId))];
  const userIds = [...new Set(rows.map((row) => row.userId))];

  const [roles, users] = await Promise.all([
    Promise.all(roleIds.map(async (id) => repositories.roles.findById(id))),
    Promise.all(userIds.map(async (id) => repositories.users.findById(id))),
  ]);

  for (const role of roles) {
    if (role !== null) roleKeyById.set(role.id, role.key);
  }
  for (const user of users) {
    if (user !== null) userById.set(user.id, user);
  }

  return { roleKeyById, userById };
}

/**
 * PractitionerRole: who may do what, in which organisation.
 *
 * The resource a directory client asks for before it asks anything else, and
 * the one that makes Practitioner useful - a name with no role answers nothing
 * a referring practice wants to know.
 *
 * ## One resource per grant, not per practitioner
 *
 * `RoleAssignment` is unique on `(userId, roleId, facilityId)`, so a nurse who
 * works at two sites has two rows and therefore two PractitionerRoles. That is
 * the FHIR shape rather than an artefact of this schema: PractitionerRole is
 * the join, and a directory that collapsed the two into one resource could not
 * express that the role was granted at one site and not the other.
 *
 * `projections.ts` carries why an organisation-wide grant emits no `location`
 * rather than an empty one.
 */
const practitionerRoleModule = defineFhirResource({
  type: 'PractitionerRole',
  interactions: ['read', 'search-type'],
  params: ['practitioner'],
  // `role.read`, not `user.read`. This resource is a list of who holds which
  // access-control role, and `/users/:id/roles` - the same rows through the BFF
  // - is behind `role.read` already. Serving them under the weaker permission
  // would have let a clinician or biller, who holds `user.read` and not
  // `role.read`, enumerate the whole access-control matrix through the FHIR
  // route that the BFF route refuses them. A boundary that answers a question
  // one door will not is not a second door, it is the way round.
  permission: 'role.read',
  collection: (repositories) => repositories.roleAssignments,
  toQuery: (query: SearchParams, paging: FhirPaging) => ({
    ...pageOf(paging),
    // Through `referenceId` rather than straight through: a directory client
    // searches with the reference it was given, `Practitioner/{id}`, and a bare
    // comparison against `userId` would match nothing and report it as an empty
    // result rather than as the malformed search it is.
    ...(query.practitioner === undefined
      ? {}
      : { userId: referenceId(query.practitioner, 'Practitioner', 'practitioner') }),
    sort: 'createdAt' as const,
    order: 'asc' as const,
  }),
  prepare: prepareRoles,
  toResource: (row: ScopedRow<'RoleAssignment'>, context) => {
    const user = context.prepared.userById.get(row.userId);
    const roleKey = context.prepared.roleKeyById.get(row.roleId);
    return practitionerRoleResource(row, {
      ...(roleKey === undefined ? {} : { roleKey }),
      ...(user?.email === undefined || user.email === null ? {} : { email: user.email }),
      ...(user === undefined ? {} : { active: user.status === 'ACTIVE' }),
      ...(user?.taxonomyCode === undefined || user.taxonomyCode === null
        ? {}
        : { taxonomyCode: user.taxonomyCode }),
      ...(user?.updatedAt === undefined ? {} : { userUpdatedAt: user.updatedAt }),
    });
  },
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
/**
 * `target` accepts any resource type, unlike every other reference parameter
 * here.
 *
 * Provenance is the one resource whose subject is another resource of unknown
 * type, so `referenceId(value, 'Patient', ...)` - which refuses a reference to
 * anything else - would be wrong. A bare id is accepted too, and narrows on the
 * id alone: a caller who knows the id but not the type gets the right events
 * rather than an error about a type they never mentioned.
 */
function provenanceTarget(raw: string | undefined): { targetType?: string; targetId?: string } {
  if (raw === undefined) return {};
  const separator = raw.indexOf('/');
  if (separator === -1) return { targetId: raw };
  return { targetType: raw.slice(0, separator), targetId: raw.slice(separator + 1) };
}

const provenanceModule = defineFhirResource({
  type: 'Provenance',
  interactions: ['read', 'search-type'],
  params: ['target', 'recorded', 'agent'],
  // The audit log is readable only by a role that may read the audit log. A
  // SMART app holding patient scopes does not acquire the practice's activity
  // history by asking for it as Provenance.
  permission: 'audit.read',
  collection: (repositories) => repositories.audit,
  toQuery: (query: SearchParams, paging: FhirPaging) => ({
    ...pageOf(paging),
    ...provenanceTarget(query.target),
    ...(query.agent === undefined
      ? {}
      : { actorId: referenceId(query.agent, 'Practitioner', 'agent') }),
    ...(query.recorded === undefined ? {} : dateWindow(query.recorded, 'recorded')),
    // Newest first: a provenance search is nearly always "what happened to this
    // recently", and `seq` would order by write rather than by event time.
    sort: 'occurredAt' as const,
    order: 'desc' as const,
  }),
  toResource: provenanceResource,
});

/**
 * A FHIR `status` token as the collection's enum, or a refusal.
 *
 * The search parameter is a free string and the column is an enum, so an
 * unmapped value has to fail loudly. Passing it through would filter on
 * something the database cannot hold and return an empty bundle, which reads to
 * a client as "no claims" rather than "that is not a status".
 */
function claimStatusToken(value: string): ClaimStatus {
  const upper = value.toUpperCase();
  if (!(CLAIM_STATUSES as readonly string[]).includes(upper)) {
    throw ApiError.malformed(`status must be one of ${CLAIM_STATUSES.join(', ')}.`, {
      issues: [{ path: 'status', message: `unknown claim status ${value}` }],
    });
  }
  return upper as ClaimStatus;
}

/** What a page of Claims needs loading before any of it can be mapped. */
interface ClaimPageData {
  readonly linesByClaim: ReadonlyMap<string, ScopedRow<'ClaimLine'>[]>;
  readonly providerByEncounter: ReadonlyMap<string, string>;
}

/**
 * Two queries for the page, not two per claim.
 *
 * A Claim resource needs its lines, and its billing provider, which lives on
 * the encounter rather than on the claim. Fetching either inside the mapper
 * would be one round trip per row: unnoticeable against the three fixtures a
 * test seeds, and quadratic on a real page.
 */
async function prepareClaims(
  rows: readonly ScopedRow<'Claim'>[],
  repositories: Repositories
): Promise<ClaimPageData> {
  const linesByClaim = new Map<string, ScopedRow<'ClaimLine'>[]>();
  const providerByEncounter = new Map<string, string>();
  if (rows.length === 0) return { linesByClaim, providerByEncounter };

  const claimIds = rows.map((row) => row.id);
  const lines = await repositories.claimLines.list({
    page: 1,
    // Every line of every claim on this page. Fifty a claim is far past what a
    // clearinghouse accepts on a professional claim, so this is a ceiling
    // rather than a limit anyone reaches.
    pageSize: 50 * rows.length,
    sort: 'sequence',
    order: 'asc',
    claimIds,
  });
  for (const line of lines.rows) {
    const existing = linesByClaim.get(line.claimId);
    if (existing === undefined) linesByClaim.set(line.claimId, [line]);
    else existing.push(line);
  }

  // findById per encounter rather than a list: the encounter collection narrows
  // by patient, not by a set of ids, and a claim page spans patients. These are
  // primary-key reads and they run together.
  const encounterIds = [...new Set(rows.map((row) => row.encounterId))];
  const encounters = await Promise.all(
    encounterIds.map(async (id) => repositories.encounters.findById(id))
  );
  for (const encounter of encounters) {
    if (encounter !== null) providerByEncounter.set(encounter.id, encounter.providerId);
  }

  return { linesByClaim, providerByEncounter };
}

const claimModule = defineFhirResource({
  type: 'Claim',
  interactions: ['read', 'search-type'],
  params: ['patient', 'status', 'created'],
  permission: 'claim.read',
  collection: (repositories) => repositories.claims,
  toQuery: (query: SearchParams, paging: FhirPaging) => ({
    ...pageOf(paging),
    ...patientFilter(query.patient),
    ...(query.status === undefined ? {} : { status: claimStatusToken(tokenValue(query.status)) }),
    ...(query.created === undefined ? {} : dateWindow(query.created, 'created')),
    // A claim has two instants that matter and the collection makes the caller
    // say which. `created` is the one FHIR names, so it is the one this maps.
    window: 'createdAt' as const,
    sort: 'createdAt' as const,
    order: 'desc' as const,
  }),
  prepare: prepareClaims,
  toResource: (row: ScopedRow<'Claim'>, context) =>
    claimResource(
      row,
      context.prepared.linesByClaim.get(row.id) ?? [],
      // Falls back to the tenant when the encounter is unreadable in this
      // scope. A claim naming no biller at all would fail validation at the
      // clearinghouse, and the organisation is the truthful answer: the
      // practice billed it.
      context.prepared.providerByEncounter.get(row.encounterId) ?? row.tenantId
    ),
});

export const SERVED_MODULES: readonly FhirResourceModule[] = [
  patientModule,
  practitionerModule,
  practitionerRoleModule,
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
  provenanceModule,
  claimModule,
];

export { booleanToken } from './params.js';
