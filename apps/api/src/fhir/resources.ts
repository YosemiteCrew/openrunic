import {
  CARE_PLAN_STATUS,
  DEVICE_STATUS,
  GOAL_LIFECYCLE_STATUS,
  CARE_TEAM_STATUS,
  CLAIM_STATUS,
  DOCUMENT_STATUS,
  MEDICATION_REQUEST_STATUS,
  OBSERVATION_STATUS,
  SERVICE_REQUEST_STATUS,
  SYSTEMS,
  TASK_STATUS,
  type EnumMapping,
} from '@openrunic/fhir';

import { ApiError } from '../errors.js';

import {
  dateWindow,
  parseDateOnly,
  referenceId,
  tokenMatches,
  tokenSystem,
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
  type ClaimBiller,
  conditionResource,
  coverageResource,
  diagnosticReportResource,
  documentReferenceResource,
  encounterResource,
  immunizationResource,
  locationResource,
  organizationResource,
  medicationRequestResource,
  medicationStatementResource,
  observationResource,
  practitionerResource,
  practitionerRoleResource,
  provenanceResource,
  medicationDispenseResource,
  type DispensePageData,
  carePlanResource,
  deviceResource,
  goalResource,
  careTeamResource,
  procedureResource,
  relatedPersonResource,
  compileFormRow,
  questionnaireResource,
  questionnaireResponseResource,
  serviceRequestResource,
  imagingStudyResource,
  specimenResource,
  taskResource,
} from './projections.js';

import type { ScopedRow } from '../repositories/rows.js';
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
 * A coded parameter is advertised only when the server can answer the FHIR code
 * itself, rather than a private vocabulary wearing its name. Several of the
 * workflow enums are deliberately wider than FHIR's - the schedule needs a
 * state for "roomed" and R4 has no code for it - and `packages/fhir` derives
 * that loss rather than asserting it. A lossy mapping therefore takes one of
 * two routes, and never a third:
 *
 * - The parameter is left out, so the loss is visible in the CapabilityStatement
 *   as an absence rather than hidden behind a filter that half works. This is
 *   the default, and `losslessStatus` applies it from the mapping itself.
 * - The parameter is advertised and the FHIR code is answered as the *set* of
 *   domain states it stands for, via `statusTokens`. This costs a set-valued
 *   filter in the repository query and is worth it where the parameter earns
 *   its keep; `Claim` is the one resource that takes this route today.
 *
 * The route never taken is advertising the parameter and answering domain
 * tokens through it. A client reading the CapabilityStatement sends the FHIR
 * code, and a server that only understands its own names has published a
 * capability nobody outside this repository can use.
 */

const CHART_SORT = { order: 'desc' } as const;

/**
 * How many facility grants one practitioner's PractitionerRole will report.
 *
 * A bound rather than an unbounded read, because this runs once per distinct
 * user on a page. Nobody works at two hundred sites; a user who appears to has
 * bad data, and the resource showing the first two hundred of it is a better
 * failure than a page that will not load.
 */
/** Lots one dispense can be drawn from. A hand-over split across more than
    a handful of lots is a data problem rather than a page to widen. */
const MAX_DISPENSE_MOVEMENTS = 50;

const MAX_FACILITY_GRANTS = 200;

/**
 * The newest of the timestamps a joined resource depends on, if any.
 *
 * Every row that contributes to a PractitionerRole has to be able to move its
 * `meta.lastUpdated`, or an incremental export drops a resource that changed.
 * Adding a facility grant changes the emitted `location` and touches neither
 * the user nor the assignment, which is the bug the earlier fix left behind
 * after it started reading the grants: one dependency was added and the stamp
 * still tracked the other two.
 *
 * ## What this cannot see
 *
 * A *removed* facility grant. Deleting the row also changes `location`, and the
 * deleted row has no timestamp left to read, so the resource keeps the stamp it
 * had. Nothing derivable from the surviving rows fixes that; it needs the
 * deletion recorded - a soft delete, or the parent stamped on the way past.
 * Recorded here rather than passed over, because the failure is silent and the
 * next reader would otherwise assume this covers every change.
 */
function latestOf(candidates: readonly (Date | undefined)[]): { userUpdatedAt?: Date } {
  const newest = candidates
    .filter((value): value is Date => value !== undefined)
    .reduce<Date | undefined>(
      (latest, value) => (latest === undefined || value > latest ? value : latest),
      undefined
    );
  return newest === undefined ? {} : { userUpdatedAt: newest };
}

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

/**
 * Every domain state a FHIR status code stands for, or a refusal.
 *
 * The set-valued counterpart to `statusToken`, for a mapping that collapses
 * several domain states into one FHIR code. Answering such a code with a single
 * domain value - the canonical one - would match one state and silently miss
 * the rest, which is the failure the module header exists to prevent.
 *
 * An empty preimage is a code no domain state maps to, and it is refused rather
 * than answered with an empty bundle. `Observation` already behaves this way:
 * R4's `ObservationStatus` binding has eight codes and `OBSERVATION_STATUS`
 * maps seven, so `?status=unknown` is a 400 today even though the code is
 * inside the required binding. Two status readers in one file should not
 * disagree about what a legal-but-unmapped code means.
 */
function statusTokens<D extends string>(
  mapping: EnumMapping<D, string>,
  raw: string,
  param: string
): D[] {
  const code = tokenValue(raw);
  const domains = mapping.domainValues.filter((value) => mapping.toFhir(value) === code);
  if (domains.length === 0) {
    throw ApiError.malformed(`${param} is not a status this server recognises.`, {
      issues: [{ path: param, message: 'not a value from the resource status value set' }],
    });
  }
  return domains;
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
  /* The chart is the patient. Every other resource that names one has its own
     id, and gating those is the same question with a different mapping; this is
     the one where knowing the id is knowing the chart. */
  chartFrom: 'patients',
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

/**
 * Which stored identifier a `Practitioner?identifier=` token is asking about.
 *
 * A bare token names no system, so it may match either column - that is what
 * FHIR says a bare token means, and it is what a client that does not care
 * about the vocabulary sends. A qualified token has to agree about the system:
 * an NPI and a DEA number are different identifiers in different namespaces,
 * and answering `{dea-system}|1234567893` with the practitioner whose NPI is
 * 1234567893 is a wrong answer about a different person, not a near miss.
 *
 * A system this server does not publish admits no column at all, which selects
 * nothing. Falling back to the value alone would be the same wrong answer with
 * an extra step - and unlike a refusal it would look like a result.
 *
 * `|value`, meaning "an identifier with no system", also admits nothing: every
 * identifier this server emits carries one.
 */
function practitionerIdentifierColumns(token: string): readonly ('npi' | 'dea')[] {
  const system = tokenSystem(token);
  if (system === undefined) return ['npi', 'dea'];
  if (system === SYSTEMS.npi) return ['npi'];
  if (system === SYSTEMS.dea) return ['dea'];
  return [];
}

const practitionerModule = defineFhirResource({
  type: 'Practitioner',
  interactions: ['read', 'search-type'],
  params: ['identifier', 'name'],
  permission: 'user.read',
  collection: (repositories) => repositories.users,
  toQuery: (query: SearchParams, paging: FhirPaging) => ({
    ...pageOf(paging),
    /* Resolved to columns here rather than passed down as a token: the systems
       are this boundary's vocabulary, and a repository that had to know them
       would be the wrong place to decide what an unrecognised one means. */
    ...(query.identifier === undefined
      ? {}
      : {
          identifier: {
            value: tokenValue(query.identifier),
            columns: practitionerIdentifierColumns(query.identifier),
          },
        }),
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
 * The roles and the users are now one read each, whatever the page holds, via
 * the repository's `findByIds`. This used to be a dedupe of individual
 * `findById` calls, which bought nothing on a page where every grant belonged
 * to a different practitioner: a five-hundred-row bulk-export page put up to a
 * thousand concurrent reads through a connection pool sized for far fewer.
 *
 * The facility grants are still one list per user, because they are a list
 * rather than a lookup and each is separately bounded by `MAX_FACILITY_GRANTS`.
 * A set-based version of that wants a different shape - grouping a single
 * bounded page by user - and is not this change.
 */
interface RolePageData {
  roleKeyById: Map<string, string>;
  userById: Map<string, ScopedRow<'User'>>;
  /** Facilities each user works at, from `UserFacility` - not from the grant. */
  facilityIdsByUser: Map<string, string[]>;
  /** When each user's facility grants last changed, for the resource stamp. */
  facilitiesChangedByUser: Map<string, Date>;
}

async function prepareRoles(
  rows: readonly ScopedRow<'RoleAssignment'>[],
  repositories: Repositories
): Promise<RolePageData> {
  const roleKeyById = new Map<string, string>();
  const userById = new Map<string, ScopedRow<'User'>>();
  const facilityIdsByUser = new Map<string, string[]>();
  const facilitiesChangedByUser = new Map<string, Date>();
  if (rows.length === 0) {
    return { roleKeyById, userById, facilityIdsByUser, facilitiesChangedByUser };
  }

  const roleIds = [...new Set(rows.map((row) => row.roleId))];
  const userIds = [...new Set(rows.map((row) => row.userId))];

  const [roles, users, grants] = await Promise.all([
    repositories.roles.findByIds(roleIds),
    repositories.users.findByIds(userIds),
    Promise.all(
      userIds.map(async (userId) =>
        repositories.userFacilities.list({
          userId,
          page: 1,
          pageSize: MAX_FACILITY_GRANTS,
          sort: 'createdAt',
          order: 'asc',
        })
      )
    ),
  ]);

  // No null check: `findByIds` omits ids that name nothing rather than
  // returning a hole for them, which is what the callers wanted anyway.
  for (const role of roles) roleKeyById.set(role.id, role.key);
  for (const user of users) userById.set(user.id, user);
  for (const [index, page] of grants.entries()) {
    const userId = userIds[index];
    if (userId === undefined) continue;
    facilityIdsByUser.set(
      userId,
      page.rows.map((grant) => grant.facilityId)
    );
    const latest = page.rows.reduce<Date | undefined>(
      (newest, grant) =>
        newest === undefined || grant.updatedAt > newest ? grant.updatedAt : newest,
      undefined
    );
    if (latest !== undefined) facilitiesChangedByUser.set(userId, latest);
  }

  return { roleKeyById, userById, facilityIdsByUser, facilitiesChangedByUser };
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
 * One `RoleAssignment` becomes one PractitionerRole. A nurse granted a role at
 * two sites has two rows and two resources, which is the FHIR shape rather than
 * an artefact of this schema: PractitionerRole is the join, and a directory
 * that collapsed the two could not express that the role was granted at one
 * site and not the other.
 *
 * ## The uniqueness this does not rely on
 *
 * `RoleAssignment` carries `@@unique([userId, roleId, facilityId])`, and that
 * constraint does not do what its shape suggests for an organisation-wide
 * grant: Postgres treats nulls as distinct in a unique index, so two rows with
 * a null `facilityId` do not collide and the duplicate check lives in the
 * application layer. The schema says so above the model. This module therefore
 * describes what a row means rather than asserting there can only be one of it,
 * and a duplicate organisation-wide grant would surface here as two identical
 * PractitionerRoles - which is the truthful projection of a duplicate row.
 *
 * `projections.ts` carries where `location` comes from, and why it is the
 * facility grants rather than the role assignment's own facility.
 */
/**
 * How many practitioners one `specialty` search will resolve.
 *
 * The parameter is a code on the practitioner and the rows are the role
 * assignments hanging off them, so answering it means resolving the code to a
 * set of user ids and filtering on the set. That set has to be complete: a
 * truncated one silently drops practitioners, and a client that filtered on
 * `specialty` and received a slice believing it received the whole is exactly
 * the failure this boundary exists to prevent.
 *
 * So the bound is a refusal, not a truncation. The trade is real and worth
 * naming: a practice with more than a thousand providers sharing one taxonomy
 * code gets a 400 on this parameter rather than a wrong answer. That is a
 * health system rather than a practice, and the honest fix there is a join
 * rather than a wider bound, which is why this does not simply grow.
 */
const MAX_SPECIALTY_PRACTITIONERS = 1000;

/**
 * The NUCC code a `specialty` token asks for, or nothing.
 *
 * FHIR token syntax lets a client qualify a code with its system. A bare code
 * is the common case and means "this code, any system". `system|code` with the
 * NUCC system is the same question asked precisely. Anything else - another
 * system, or the `|code` form that means "code with no system at all" - is a
 * question about a vocabulary this server does not store, and the answer is
 * that nothing matches.
 *
 * Nothing matching is a 200 with an empty bundle, not a 400. A system this
 * server has no codes in is not a malformed search; it is a search whose answer
 * is empty, and the two are different things to a client.
 */
function specialtyCode(token: string): string | undefined {
  const separator = token.indexOf('|');
  if (separator === -1) return token;
  const system = token.slice(0, separator);
  return system === SYSTEMS.nucc ? token.slice(separator + 1) : undefined;
}

/**
 * The practitioners carrying a taxonomy code, as the user ids their role
 * assignments are filtered by.
 */
async function practitionersWithSpecialty(
  token: string,
  repositories: Repositories
): Promise<string[]> {
  const code = specialtyCode(token);
  if (code === undefined) return [];
  const page = await repositories.users.list({
    page: 1,
    pageSize: MAX_SPECIALTY_PRACTITIONERS,
    sort: 'familyName',
    order: 'asc',
    taxonomyCode: code,
  });
  if (page.total > MAX_SPECIALTY_PRACTITIONERS) {
    throw ApiError.malformed(
      `specialty matches more practitioners than this server will resolve in one search.`,
      {
        issues: [
          {
            path: 'specialty',
            message: `${page.total} practitioners carry this code; the bound is ${MAX_SPECIALTY_PRACTITIONERS}`,
          },
        ],
      }
    );
  }
  return page.rows.map((row) => row.id);
}

const practitionerRoleModule = defineFhirResource({
  type: 'PractitionerRole',
  interactions: ['read', 'search-type'],
  params: ['practitioner', 'specialty'],
  // `role.read`, not `user.read`. This resource is a list of who holds which
  // access-control role, and `/users/:id/roles` - the same rows through the BFF
  // - is behind `role.read` already. Serving them under the weaker permission
  // would have let a clinician or biller, who holds `user.read` and not
  // `role.read`, enumerate the whole access-control matrix through the FHIR
  // route that the BFF route refuses them. A boundary that answers a question
  // one door will not is not a second door, it is the way round.
  permission: 'role.read',
  collection: (repositories) => repositories.roleAssignments,
  toQuery: async (query: SearchParams, paging: FhirPaging, repositories: Repositories) => ({
    ...pageOf(paging),
    // Through `referenceId` rather than straight through: a directory client
    // searches with the reference it was given, `Practitioner/{id}`, and a bare
    // comparison against `userId` would match nothing and report it as an empty
    // result rather than as the malformed search it is.
    ...(query.practitioner === undefined
      ? {}
      : { userId: referenceId(query.practitioner, 'Practitioner', 'practitioner') }),
    // `userIds` rather than a second `userId`: the spec meets the two rather
    // than letting one overwrite the other, so `practitioner` and `specialty`
    // together mean both, which is what a client sending both asked for.
    ...(query.specialty === undefined
      ? {}
      : { userIds: await practitionersWithSpecialty(query.specialty, repositories) }),
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
      ...latestOf([user?.updatedAt, context.prepared.facilitiesChangedByUser.get(row.userId)]),
      worksAt: context.prepared.facilityIdsByUser.get(row.userId) ?? [],
    });
  },
});

/**
 * The practice itself.
 *
 * One row, always the caller's own, because `Organisation` *is* the tenant: its
 * id is what every other row's `tenantId` points at. A search returns a page of
 * one and a read of any other id is a 404, which is the truthful answer rather
 * than a permission error - another practice's record does not exist as far as
 * this caller is concerned. `organisation-query.ts` carries why that narrowing
 * is hand-written rather than a spec.
 *
 * It is served because four resources already emit references to it -
 * `Location.managingOrganization`, `PractitionerRole.organization`,
 * `Coverage.payor` and `Claim.provider` - and a reference that 404s is worse
 * than no reference: a client cannot tell "this pointer is broken" from "you
 * are not allowed to follow it".
 *
 * `address` and `identifier` are must-support and absent, because the columns
 * are: the practice's postal address and NPI live on `Facility`, which is what
 * `Location` serves. Inventing one from the first facility would be a fact the
 * record never stated, and a practice may have several sites. The gap is
 * written down in `fhir.must-support.test.ts` the way `Location`'s is.
 */
const organizationModule = defineFhirResource({
  type: 'Organization',
  interactions: ['read', 'search-type'],
  params: ['name'],
  // `facility.read`, the same permission `Location` needs. Reading which
  // practice this is, is the same question as reading its sites.
  permission: 'facility.read',
  collection: (repositories) => repositories.organisations,
  toQuery: (query: SearchParams, paging: FhirPaging) => ({
    // Paging is accepted and ignored: the result is one row or none, so there
    // is no second page to ask for and no ordering to choose between.
    ...pageOf(paging),
    ...(query.name === undefined ? {} : { name: query.name }),
    sort: 'name' as const,
    order: 'asc' as const,
  }),
  toResource: organizationResource,
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
  chartFrom: 'coverages',
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

/**
 * The forms a practice publishes, as Questionnaires.
 *
 * PUBLISHED only. A draft is a form somebody is still editing, and a canonical
 * URL whose content can change underneath whoever resolved it is worse than an
 * absent one. Publishing is also what proves the definition compiles, which is
 * the invariant `questionnaireResource` relies on.
 */
/**
 * Medicine actually handed to a patient.
 *
 * Read from the stock ledger, because that is where the fact lives: a
 * prescription records what was intended and only a posting records what left
 * the shelf, in what quantity and from which lot. Filtered to DISPENSE, so the
 * receipts, counts and wastages in the same table stay out of a clinical
 * search.
 *
 * `prepare` loads the movements for the page and then the items and lots those
 * movements name, three reads for any number of dispenses rather than three
 * per dispense.
 */
const medicationDispenseModule = defineFhirResource({
  type: 'MedicationDispense',
  chartFrom: 'stockPostings',
  interactions: ['read', 'search-type'],
  params: ['patient'],
  /*
   * `encounter.read`, the permission its own prescription is served under, and
   * not `order.read`.
   *
   * A dispense is the fulfilment half of a medication record: `MedicationRequest`
   * is what was intended, this is what was actually handed over, and
   * `MedicationStatement` is what the patient reports taking. The other two are
   * served under `encounter.read` and this one was not, which left a patient
   * able to read their own prescription and not the record of collecting it.
   *
   * `patient-portal` holds `encounter.read` and does not hold `order.read`, so
   * a patient-scoped token was refused here before the compartment narrowing
   * could authorise its own record - and `stockPostingSpec` had already been
   * widened from `closed` to an equality on `patientId` for exactly this read,
   * with the comment saying so. The gate was the only thing left out of step
   * with the decision.
   *
   * Granting the portal `order.read` instead would have been the wider change
   * by far: `ServiceRequest` and `Specimen` are served under it, so a patient
   * app would have gained the practice's lab ordering alongside its own
   * medicines.
   *
   * It is a widening for `front-desk`, which holds `encounter.read` and not
   * `order.read`. Reception can already read the prescription, the condition it
   * was written for and the observations behind it; that a dispense against it
   * was collected is the smaller fact, and answering "has my prescription been
   * filled" is reception's job. Every other bundle holding `order.read` -
   * `admin`, `clinician`, `read-only` - holds `encounter.read` too, so nothing
   * loses this read.
   */
  permission: 'encounter.read',
  collection: (repositories) => {
    const postings = repositories.stockPostings;
    return {
      list: postings.list.bind(postings),
      /* A read is narrowed the same way the search is. Without this, any
         posting could be fetched by id through this route, including the
         receipts and counts that belong to no patient at all. */
      findById: async (id: string) => {
        const row = await postings.findById(id);
        return row?.kind === 'DISPENSE' && row.patientId !== null ? row : null;
      },
    };
  },
  toQuery: (query: SearchParams, paging: FhirPaging) => ({
    ...pageOf(paging),
    ...patientFilter(query.patient),
    kind: 'DISPENSE' as const,
    sort: 'occurredOn' as const,
    order: 'desc' as const,
  }),
  prepare: async (rows, repositories): Promise<DispensePageData> => {
    const movementsByPosting = new Map<string, ScopedRow<'StockMovement'>[]>();
    const itemsById = new Map<string, ScopedRow<'StockItem'>>();
    const lotsById = new Map<string, ScopedRow<'StockLot'>>();
    if (rows.length === 0) return { movementsByPosting, itemsById, lotsById };

    const pages = await Promise.all(
      rows.map(async (row) =>
        repositories.stockMovements.list({
          postingId: row.id,
          page: 1,
          pageSize: MAX_DISPENSE_MOVEMENTS,
          sort: 'occurredOn',
          order: 'asc',
        })
      )
    );
    for (const page of pages) {
      /*
       * A dispense whose lines did not fit is refused, not summed.
       *
       * `medicationDispenseResource` adds up the movements it is given and
       * publishes the total as `quantity`, which a receiving system reads as
       * how much medicine this person was handed. Loading one page per posting
       * and summing whatever came back makes that number quietly wrong for a
       * dispense drawn from more than `MAX_DISPENSE_MOVEMENTS` lots: too low,
       * plausible, and indistinguishable from a smaller dispense.
       *
       * There is no such thing as an approximately correct dispensed quantity.
       * An understated one reconciles against nothing, hides a recall, and
       * would be read by a clinician as the dose that was actually supplied. So
       * this answers "this server cannot represent that record" rather than
       * answering with a number it knows is short.
       *
       * 501 rather than a 4xx: the client asked for something reasonable and it
       * is this server's projection that cannot carry it. The bound is not a
       * page size a caller can raise, which is why it is not reported as one.
       */
      if (page.total > page.rows.length) {
        throw ApiError.notImplemented(
          `This dispense was drawn from more than ${String(MAX_DISPENSE_MOVEMENTS)} lots, ` +
            'which this server cannot summarise as a single quantity. ' +
            'Read the stock ledger for the individual movements.',
          { title: 'Dispense too large to project' }
        );
      }
      for (const movement of page.rows) {
        const bucket = movementsByPosting.get(movement.postingId);
        if (bucket) bucket.push(movement);
        else movementsByPosting.set(movement.postingId, [movement]);
      }
    }

    const movements = [...movementsByPosting.values()].flat();
    const [items, lots] = await Promise.all([
      repositories.stockItems.findByIds([...new Set(movements.map((one) => one.itemId))]),
      repositories.stockLots.findByIds([...new Set(movements.map((one) => one.lotId))]),
    ]);
    for (const item of items) itemsById.set(item.id, item);
    for (const lot of lots) lotsById.set(lot.id, lot);

    return { movementsByPosting, itemsById, lotsById };
  },
  toResource: (row, context) => medicationDispenseResource(row, context.prepared),
});

const questionnaireModule = defineFhirResource({
  type: 'Questionnaire',
  interactions: ['read', 'search-type'],
  /*
   * `name`, not `status`. `status` was advertised and then ignored, which is
   * the exact failure this arrangement exists to make impossible: the router
   * accepted `?status=draft` and answered with the published list. Only
   * published forms are served, so a status filter has one legal value and
   * nothing to select between.
   *
   * `name` is the FHIR spelling of the row's `key`, which is the stable
   * identifier a client integrating against a named form actually has, and it
   * is honoured below rather than declared.
   */
  params: ['name'],
  permission: 'form.read',
  /*
   * `findById` is narrowed as well as the search, and it has to be narrowed
   * here rather than in `toQuery`: a read goes straight to the collection and
   * never builds a query, so filtering only there left every draft readable at
   * `/fhir/Questionnaire/{id}` by anyone who could guess an id. Answering null
   * makes that a 404, which is what an unpublished form should look like.
   */
  collection: (repositories) => {
    const definitions = repositories.formDefinitions;
    return {
      list: definitions.list.bind(definitions),
      findById: async (id: string) => {
        const row = await definitions.findById(id);
        return row?.status === 'PUBLISHED' ? row : null;
      },
    };
  },
  toQuery: (query: SearchParams, paging: FhirPaging) => ({
    ...pageOf(paging),
    ...(query.name === undefined ? {} : { key: query.name }),
    status: 'PUBLISHED' as const,
    sort: 'version' as const,
    order: 'desc' as const,
  }),
  toResource: questionnaireResource,
});

/**
 * Submitted forms, as QuestionnaireResponses.
 *
 * `prepare` reads AND compiles the definitions for a page, once each. An intake
 * list is overwhelmingly the same form many times over, so compiling inside
 * `toResource` would recompile one definition per submission. The first version
 * of this deduplicated only the read and its comment claimed otherwise.
 */
const questionnaireResponseModule = defineFhirResource({
  type: 'QuestionnaireResponse',
  chartFrom: 'formSubmissions',
  interactions: ['read', 'search-type'],
  params: ['patient'],
  permission: 'form.read',
  collection: (repositories) => repositories.formSubmissions,
  toQuery: (query: SearchParams, paging: FhirPaging) => ({
    ...pageOf(paging),
    ...patientFilter(query.patient),
    sort: 'effectiveAt' as const,
    order: 'desc' as const,
  }),
  prepare: async (rows, repositories) => {
    const ids = [...new Set(rows.map((row) => row.formDefinitionId))];
    const definitions = ids.length === 0 ? [] : await repositories.formDefinitions.findByIds(ids);
    return new Map(definitions.map((definition) => [definition.id, compileFormRow(definition)]));
  },
  toResource: (row, context) => {
    const definition = context.prepared.get(row.formDefinitionId);
    if (definition === undefined) {
      /* The row has a required foreign key to its definition, so this is a
         deleted or cross-tenant definition rather than an ordinary miss. */
      throw new Error(`form submission ${row.id} has no readable definition`);
    }
    return questionnaireResponseResource(row, definition);
  },
});

/**
 * Procedures performed, which neither the order nor the claim records.
 *
 * `ServiceRequest` says what was asked for and may never have happened;
 * `Claim` says what is billed and exists only when somebody bills. A procedure
 * carried out and not billed, which is most of a clinical day, is here alone.
 */
const procedureModule = defineFhirResource({
  type: 'Procedure',
  chartFrom: 'procedures',
  interactions: ['read', 'search-type'],
  params: ['patient', 'date'],
  permission: 'encounter.read',
  collection: (repositories) => repositories.procedures,
  toQuery: (query: SearchParams, paging: FhirPaging) => ({
    ...pageOf(paging),
    ...patientFilter(query.patient),
    ...window(query.date, 'date'),
    sort: 'performedStart' as const,
    order: 'desc' as const,
  }),
  toResource: procedureResource,
});

/**
 * Who is looking after this patient, and in what capacity.
 *
 * The members come from a second table, so the page loads them once for every
 * team on it rather than once per team: a lookup inside the mapper would be one
 * round trip per row, invisible against three fixtures and quadratic on a real
 * page.
 */
/**
 * The most members one team contributes to a page.
 *
 * A team of twenty is a large multidisciplinary one, so this is a ceiling
 * rather than a limit anybody reaches. It is applied per team rather than to
 * the page, so a team past it loses its own tail and no other team loses
 * anything.
 */
const MAX_TEAM_MEMBERS = 20;

/**
 * The most goals one plan contributes to a page.
 *
 * Same shape and same reasoning as {@link MAX_TEAM_MEMBERS}: a ceiling nobody
 * reaches rather than a limit, applied per plan so a plan past it loses its own
 * tail and no other plan loses anything. Deliberately NOT the global page the
 * care team loader used to take - that shape is the bug this issue is here to
 * stop being copied.
 */
const MAX_PLAN_GOALS = 20;

/**
 * The goals each plan on the page is working towards.
 *
 * The link lives on the goal - a `Goal` row carries the `carePlanId` it belongs
 * to - so this reads it in the direction FHIR asks for it, once per plan, and
 * hands the ids to the projection.
 */
async function prepareCarePlans(
  rows: readonly ScopedRow<'CarePlan'>[],
  repositories: Repositories
): Promise<Map<string, string[]>> {
  const byPlan = new Map<string, string[]>();
  if (rows.length === 0) return byPlan;

  const pages = await Promise.all(
    rows.map(async (row) =>
      repositories.goals.list({
        page: 1,
        pageSize: MAX_PLAN_GOALS,
        sort: 'createdAt',
        order: 'asc',
        carePlanId: row.id,
      })
    )
  );
  for (const [index, page] of pages.entries()) {
    const plan = rows[index];
    if (plan !== undefined && page.rows.length > 0) {
      byPlan.set(
        plan.id,
        page.rows.map((goal) => goal.id)
      );
    }
  }
  return byPlan;
}

async function prepareCareTeams(
  rows: readonly ScopedRow<'CareTeam'>[],
  repositories: Repositories
): Promise<Map<string, ScopedRow<'CareTeamParticipant'>[]>> {
  const byTeam = new Map<string, ScopedRow<'CareTeamParticipant'>[]>();
  if (rows.length === 0) return byTeam;

  /*
   * One bounded query per team, rather than one page shared by all of them.
   *
   * The shared page was a global ceiling of `MAX_TEAM_MEMBERS * rows.length`
   * trimmed per team afterwards, and the trim came too late: rows arrive
   * ordered by creation across every team on the page, so one team with more
   * members than the whole allowance consumed it, and every team after it was
   * served with no participants at all. That is not a truncation a client can
   * detect. It is a care team that appears to have nobody on it, because a
   * different patient's team was large.
   *
   * Asking per team makes the bound mean what its name says. A team past the
   * cap loses its own tail and no other team loses anything, which is what the
   * old comment claimed and the old query could not deliver.
   *
   * The cost is one round trip per team on the page instead of one for the
   * page. That is the same shape the dispense loader already uses, and it is
   * the right trade here: the alternative is a correct answer for some teams
   * and an empty one for the rest, decided by which patient's team happened to
   * sort first.
   */
  const pages = await Promise.all(
    rows.map(async (row) =>
      repositories.careTeamParticipants.list({
        page: 1,
        pageSize: MAX_TEAM_MEMBERS,
        sort: 'createdAt',
        order: 'asc',
        careTeamId: row.id,
      })
    )
  );
  for (const [index, page] of pages.entries()) {
    const team = rows[index];
    if (team !== undefined && page.rows.length > 0) byTeam.set(team.id, [...page.rows]);
  }
  return byTeam;
}

/**
 * The assessment and plan.
 *
 * `category` is advertised and answered, unusually for a parameter with one
 * legal value. US Core requires every conforming CarePlan to carry
 * `assess-plan`, so a client that filters on it is asking a question this
 * server can answer exactly; leaving it out would make a conforming client's
 * ordinary search fail, and accepting it without answering would be the failure
 * this boundary exists to prevent.
 */
/**
 * What the patient and the clinician agreed to aim at.
 *
 * The status parameter is `lifecycle-status`, not `status`. R4 gives Goal no
 * `status` parameter at all, so `losslessStatus` is not used here: it names the
 * parameter it advertises, and the name would be one no conforming client sends
 * and no other server answers. The losslessness argument still applies and is
 * asserted rather than assumed, because a lossy mapping behind an advertised
 * filter is the failure this boundary exists to prevent.
 *
 * `target-date` is the due date, which is the one target element US Core
 * requires support for. It sorts on the same column it filters, so a client
 * paging through goals by when they are due gets a stable order.
 */
const goalModule = defineFhirResource({
  type: 'Goal',
  chartFrom: 'goals',
  interactions: ['read', 'search-type'],
  params: ['patient', 'target-date', ...goalLifecycleParam()],
  permission: 'encounter.read',
  collection: (repositories) => repositories.goals,
  toQuery: (query: SearchParams, paging: FhirPaging) => ({
    ...pageOf(paging),
    ...patientFilter(query.patient),
    ...(query['lifecycle-status'] === undefined
      ? {}
      : {
          lifecycleStatus: statusToken(
            GOAL_LIFECYCLE_STATUS,
            query['lifecycle-status'],
            'lifecycle-status'
          ),
        }),
    ...window(query['target-date'], 'target-date'),
    sort: 'dueDate' as const,
    order: 'asc' as const,
  }),
  toResource: goalResource,
});

/**
 * Advertises `lifecycle-status` only when the FHIR value set covers every
 * domain state, which is what {@link losslessStatus} does for the parameter
 * that is actually called `status`.
 */
function goalLifecycleParam(): string[] {
  return GOAL_LIFECYCLE_STATUS.lossyValues.length === 0 ? ['lifecycle-status'] : [];
}

/**
 * A device implanted in a patient.
 *
 * `identifier` is why this is served. A manufacturer recalls a batch and names
 * a device identifier; the practice has to turn that into a list of patients,
 * and no other resource here can answer it. Inventory knows what was bought and
 * what left the shelf, and neither knows what is still inside somebody twenty
 * years later.
 *
 * The parameter is answered against the stored device identifier and never
 * against the carrier string. Matching a recall's identifier as a substring of
 * a scanned barcode would find devices whose lot or serial happened to contain
 * those digits, and a recall list with strangers on it is as unusable as one
 * with people missing.
 */
const deviceModule = defineFhirResource({
  type: 'Device',
  chartFrom: 'devices',
  /*
   * Read and search only. A device is recorded where it was implanted, and one
   * written through an API is an implant nobody performed.
   */
  interactions: ['read', 'search-type'],
  params: ['patient', 'identifier', ...losslessStatus(DEVICE_STATUS)],
  permission: 'encounter.read',
  collection: (repositories) => repositories.devices,
  toQuery: (query: SearchParams, paging: FhirPaging) => ({
    ...pageOf(paging),
    ...patientFilter(query.patient),
    ...(query.identifier === undefined ? {} : { deviceIdentifier: tokenValue(query.identifier) }),
    ...(query.status === undefined
      ? {}
      : { status: statusToken(DEVICE_STATUS, query.status, 'status') }),
    sort: 'createdAt' as const,
    order: 'desc' as const,
  }),
  toResource: deviceResource,
});

const carePlanModule = defineFhirResource({
  type: 'CarePlan',
  chartFrom: 'carePlans',
  /*
   * Read and search only. The assessment is a clinician's conclusion about a
   * patient, and a plan written through an API is words the chart would then
   * attribute to whoever it names as author.
   */
  interactions: ['read', 'search-type'],
  params: ['patient', 'category', ...losslessStatus(CARE_PLAN_STATUS)],
  permission: 'encounter.read',
  collection: (repositories) => repositories.carePlans,
  toQuery: (query: SearchParams, paging: FhirPaging) => ({
    ...pageOf(paging),
    ...patientFilter(query.patient),
    ...(query.status === undefined
      ? {}
      : { status: statusTokens(CARE_PLAN_STATUS, query.status, 'status')[0] }),
    /* The one legal value, checked rather than ignored. Every plan served here
       is an assessment and plan, so any other category matches nothing, and
       answering it with the whole list would be the lie this rejects. */
    ...assessPlanOnly(query.category),
    sort: 'createdAt' as const,
    order: 'desc' as const,
  }),
  prepare: prepareCarePlans,
  toResource: (row: ScopedRow<'CarePlan'>, context) =>
    carePlanResource(row, context.prepared.get(row.id) ?? []),
});

/**
 * Narrows a `category` search to the one category this server serves.
 *
 * A token naming `assess-plan` is a no-op, because every row already is one.
 * Anything else has to answer with nothing, expressed as an empty id set rather
 * than as a sentinel value: an id no row can have is a claim about ids, and the
 * empty set is the actual statement, which is that this search matches nothing.
 *
 * The alternative - reading the parameter and dropping it - is the failure this
 * boundary exists to prevent, and it is unusually well hidden here. Every
 * conforming client sends `assess-plan`, for which the filter is a no-op, so a
 * dropped filter looks correct in every ordinary request and answers a query
 * for some other category with the whole list.
 */
function assessPlanOnly(raw: string | undefined): { ids?: readonly string[] } {
  if (raw === undefined) return {};
  /* The system is checked, not only the code. `urn:elsewhere|assess-plan` is a
     different concept that happens to share a code, and answering it with this
     server's plans is the same wrong answer as ignoring the parameter. */
  return tokenMatches(raw, SYSTEMS.usCoreCategory, 'assess-plan') ? {} : { ids: [] };
}

const careTeamModule = defineFhirResource({
  type: 'CareTeam',
  chartFrom: 'careTeams',
  /*
   * Read and search only. Membership is decided in the practice, by the people
   * who take responsibility for a patient, and a client adding itself to a team
   * would be granting itself a clinical relationship nobody agreed to.
   */
  interactions: ['read', 'search-type'],
  params: ['patient', ...losslessStatus(CARE_TEAM_STATUS)],
  permission: 'patient.read',
  collection: (repositories) => repositories.careTeams,
  toQuery: (query: SearchParams, paging: FhirPaging) => ({
    ...pageOf(paging),
    ...patientFilter(query.patient),
    ...(query.status === undefined
      ? {}
      : { status: statusTokens(CARE_TEAM_STATUS, query.status, 'status')[0] }),
    sort: 'createdAt' as const,
    order: 'desc' as const,
  }),
  prepare: prepareCareTeams,
  toResource: (row: ScopedRow<'CareTeam'>, context) =>
    careTeamResource(row, context.prepared.get(row.id) ?? []),
});

const relatedPersonModule = defineFhirResource({
  type: 'RelatedPerson',
  chartFrom: 'relatedPersons',
  /*
   * Read and search only. These rows are created during registration, and a
   * guardian written by any client holding a token is a consent decision made
   * in the wrong place. The search catalogue says the same thing, and
   * `fhir.test.ts` asserts the two agree.
   */
  interactions: ['read', 'search-type'],
  params: ['patient'],
  /*
   * `patient.read` rather than a permission of its own. Who a patient's
   * guardian and emergency contact are is demographics: a role that can open
   * the chart and cannot see who to ring in an emergency is a worse answer than
   * either, and a new permission would silently deny every existing role until
   * each grant was edited.
   */
  permission: 'patient.read',
  collection: (repositories) => repositories.relatedPersons,
  toQuery: (query: SearchParams, paging: FhirPaging) => ({
    ...pageOf(paging),
    ...patientFilter(query.patient),
    sort: 'familyName' as const,
    order: 'asc' as const,
  }),
  toResource: relatedPersonResource,
});

const appointmentModule = defineFhirResource({
  type: 'Appointment',
  chartFrom: 'appointments',
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
  chartFrom: 'encounters',
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
  chartFrom: 'problems',
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
  chartFrom: 'prescriptions',
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
  chartFrom: 'medicationStatements',
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
  chartFrom: 'allergies',
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
  chartFrom: 'immunisations',
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
  chartFrom: 'observations',
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
  chartFrom: 'reports',
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
  chartFrom: 'orders',
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
  chartFrom: 'specimens',
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

/**
 * ImagingStudy: the record that pictures exist, and where a viewer gets them.
 *
 * `accession` is a search parameter because it is the identifier the order, the
 * modality worklist and the PACS all carry, so it is how anything outside this
 * system finds the study it means.
 */
const imagingStudyModule = defineFhirResource({
  type: 'ImagingStudy',
  chartFrom: 'imagingStudies',
  interactions: ['read', 'search-type'],
  params: ['patient', 'accession', 'date'],
  permission: 'result.read',
  collection: (repositories) => repositories.imagingStudies,
  toQuery: (query: SearchParams, paging: FhirPaging) => ({
    ...pageOf(paging),
    ...patientFilter(query.patient),
    ...(query.accession === undefined ? {} : { accessionNumber: tokenValue(query.accession) }),
    ...window(query.date, 'date'),
    sort: 'startedAt' as const,
    ...CHART_SORT,
  }),
  toResource: imagingStudyResource,
});

const documentReferenceModule = defineFhirResource({
  type: 'DocumentReference',
  chartFrom: 'documents',
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
  chartFrom: 'tasks',
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

/**
 * The biller a claim names, and which kind of thing it is.
 *
 * Separated from the mapper so the fallback is a decision with a name rather
 * than a `??` at the end of an argument list, and so the two branches state
 * their own type instead of one being inferred from the other's absence.
 */
function billerFor(
  row: ScopedRow<'Claim'>,
  providerByEncounter: ReadonlyMap<string, string>
): ClaimBiller {
  const practitioner = providerByEncounter.get(row.encounterId);
  return practitioner === undefined
    ? { id: row.tenantId, type: 'Organization' }
    : { id: practitioner, type: 'Practitioner' };
}

const claimModule = defineFhirResource({
  type: 'Claim',
  chartFrom: 'claims',
  interactions: ['read', 'search-type'],
  params: ['patient', 'status', 'created'],
  permission: 'claim.read',
  collection: (repositories) => repositories.claims,
  toQuery: (query: SearchParams, paging: FhirPaging) => ({
    ...pageOf(paging),
    ...patientFilter(query.patient),
    // The FHIR code, as the set of domain states it stands for. `active` alone
    // covers seven of the ten, so a scalar here would answer with one of them.
    ...(query.status === undefined
      ? {}
      : { statuses: statusTokens(CLAIM_STATUS, query.status, 'status') }),
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
      // Falls back to the practice when the encounter is unreadable in this
      // scope, because a claim naming no biller at all would fail validation at
      // the clearinghouse. The organisation is the truthful answer: the
      // practice billed it.
      //
      // The type travels with the id. Emitting the fallback as
      // `Practitioner/{id}` used to ship a reference to a practitioner that
      // does not exist, and once Organization was served it resolved at the
      // wrong type, which is harder to notice than the 404 it had been.
      billerFor(row, context.prepared.providerByEncounter)
    ),
});

export const SERVED_MODULES: readonly FhirResourceModule[] = [
  patientModule,
  practitionerModule,
  practitionerRoleModule,
  organizationModule,
  locationModule,
  coverageModule,
  relatedPersonModule,
  medicationDispenseModule,
  procedureModule,
  carePlanModule,
  goalModule,
  deviceModule,
  careTeamModule,
  questionnaireModule,
  questionnaireResponseModule,
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
  imagingStudyModule,
  specimenModule,
  documentReferenceModule,
  taskModule,
  provenanceModule,
  claimModule,
];

export { booleanToken } from './params.js';
