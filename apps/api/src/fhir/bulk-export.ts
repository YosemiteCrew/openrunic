import type { FhirResource } from '@openrunic/fhir';
import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';

import type { Principal } from '../auth/principal.js';
import { grantsScope, parseScopes } from '../auth/scopes.js';
import type { AppEnv } from '../context.js';
import { ApiError } from '../errors.js';
import type { PolicyContext } from '../policy/policy.js';

import type { FhirResourceModule } from './resource-module.js';

/**
 * FHIR BULK DATA EXPORT.
 *
 * The operation that makes a record leave the building. A practice changing
 * system, a payer under contract, a research extract, a patient exercising a
 * right of access at scale - all of them need every resource rather than a page
 * at a time, and a FHIR server without `$export` is one whose data can be read
 * but not taken.
 *
 * ## Why it is asynchronous, and why that is not ceremony here
 *
 * The specification requires kick-off to answer 202 with a `Content-Location`
 * the client polls, because a real export can run for hours. This implementation
 * finishes the work before it answers the kick-off, which would make a
 * synchronous body tempting - and wrong. A client written against the
 * specification expects the 202 and the poll; answering 200 with a bundle would
 * work only against clients written for this server, which is the opposite of
 * what an export is for.
 *
 * Two consequences follow from finishing early, and both are visible in the
 * types rather than hidden behind states that never occur:
 *
 * - A job has no status. Every job this server hands out an id for has already
 *   succeeded, so there is no `in-progress` to poll through and no `error` to
 *   discover late. A failure surfaces on the kick-off response itself, which the
 *   specification allows and which tells the client sooner.
 * - The job lives in this process's memory. It is bounded on both axes -
 *   {@link EXPORT_LIMIT} rows per type and {@link MAX_RETAINED_JOBS} jobs kept -
 *   because an unbounded one is a practice's whole record set pinned in memory
 *   by anyone who can call the endpoint. Both bounds are reported rather than
 *   silent: a truncated export says so in the manifest, and an evicted job
 *   answers 404 the way a restarted server does.
 *
 * ## Who may run one, and what they get
 *
 * Everyone in the tenant, at once, is the whole point of the operation, and it
 * is also what makes it the most sensitive read the API offers. Four separate
 * things constrain it, because they fail differently:
 *
 * - `facility.all`, checked by the route. A principal granted two facilities out
 *   of nine must not walk out with all nine, and every other route respects that
 *   grant by asking about one facility at a time - which is exactly the check a
 *   whole-organisation read has no opportunity to make.
 * - {@link requireOrganisationWideToken}. A patient-scoped token asking for a
 *   whole-organisation export is a contradiction rather than a permission
 *   question, and refusing it in code means a tenant that forks the seeded roles
 *   cannot grant its way into one.
 * - {@link permittedModules}. The export does not go through the per-resource
 *   routes, so it does not inherit their per-resource guards; without this it
 *   would hand a token scoped to `user/Patient.read` every Claim and the audit
 *   log along with it. The export therefore narrows itself to the types this
 *   principal could have read one at a time, which is what "everything this
 *   token may read" has to mean if it is to be said at all.
 * - {@link jobFor}. A finished export is a file of PHI sitting in memory under a
 *   uuid. Binding it to the tenant AND the principal that ran it is what stops
 *   the id alone from being the credential.
 */

/** One entry point, as the router mounts it and the CapabilityStatement declares it. */
export interface BulkExportEntry {
  readonly path: string;
  /** Where the operation is declared: the server, or the Patient type. */
  readonly scope: 'system' | 'Patient';
  readonly name: string;
  readonly definition: string;
}

/**
 * The `$export` entry points, in one list because three things must agree about
 * them: the router mounts these paths, the CapabilityStatement declares these
 * operations, and `fhir.conformance.test.ts` walks the published statement and
 * calls what it finds.
 *
 * The two are not aliases. The system-level operation means everything; the
 * patient-level one means the Patient compartment, so it excludes the resources
 * that describe the practice rather than its patients - see
 * {@link PATIENT_COMPARTMENT_TYPES}. Serving them identically would make the
 * declared `patient-export` OperationDefinition a false claim, and a payer
 * receiving a practitioner directory it never asked for is the mildest way that
 * goes wrong.
 *
 * `Group/[id]/$export` is deliberately absent until Groups exist to name.
 * Advertising it would promise a selection this server cannot make, and a client
 * planning an integration around a declared operation has no way to discover
 * that it was aspirational.
 */
export const BULK_EXPORT_OPERATIONS: readonly BulkExportEntry[] = [
  {
    path: '/$export',
    scope: 'system',
    name: 'export',
    definition: 'http://hl7.org/fhir/uv/bulkdata/OperationDefinition/export',
  },
  {
    path: '/Patient/$export',
    scope: 'Patient',
    name: 'export',
    definition: 'http://hl7.org/fhir/uv/bulkdata/OperationDefinition/patient-export',
  },
];

/**
 * The resource types FHIR places in the Patient compartment, restricted to the
 * ones this server serves.
 *
 * Taken from the R4 `CompartmentDefinition/patient`, not invented here. The
 * types this server serves that are NOT in it - Practitioner, PractitionerRole
 * and Location - describe the practice rather than any patient, which is why
 * the patient-level export must leave them out.
 *
 * `bulk-export.test.ts` asserts that every served module appears in exactly one
 * of this set and {@link NON_COMPARTMENT_TYPES}, so a resource added later
 * cannot quietly default into either answer.
 */
export const PATIENT_COMPARTMENT_TYPES: ReadonlySet<string> = new Set([
  'Patient',
  'Coverage',
  'Appointment',
  'Encounter',
  'Condition',
  'MedicationRequest',
  'MedicationStatement',
  'AllergyIntolerance',
  'Immunization',
  'Observation',
  'DiagnosticReport',
  'ServiceRequest',
  'Specimen',
  'DocumentReference',
  'Task',
  'Provenance',
  'Claim',
]);

/** Served types deliberately outside the Patient compartment. */
export const NON_COMPARTMENT_TYPES: ReadonlySet<string> = new Set([
  'Practitioner',
  'PractitionerRole',
  'Location',
]);

export interface ExportFile {
  readonly type: string;
  /** Newline-delimited JSON, one resource per line. */
  readonly ndjson: string;
  readonly count: number;
}

/** A finished export. There is no unfinished one to represent; see the header. */
export interface ExportJob {
  readonly id: string;
  /**
   * The tenant and the principal the export was run for. Both are asserted on
   * every retrieval: the files are a snapshot taken under one principal's scopes
   * and permissions, so serving them to a second principal would launder the
   * first one's access even inside the same organisation.
   */
  readonly tenantId: string;
  readonly subject: string;
  readonly requestUrl: string;
  readonly transactionTime: string;
  readonly files: readonly ExportFile[];
  /** OperationOutcome files, populated when a bound was hit. */
  readonly errors: readonly ExportFile[];
}

export interface ExportStore {
  create(job: ExportJob): void;
  get(id: string): ExportJob | undefined;
  delete(id: string): boolean;
  /** Jobs currently retained. For the eviction test, and for metrics later. */
  readonly size: number;
}

/**
 * How many finished exports are kept before the oldest is dropped.
 *
 * A cap rather than a timer, because a timer that has not fired yet is not a
 * bound. Each retained job holds a full serialisation of everything it
 * exported, so without this a caller who kicks off repeatedly pins the
 * practice's record set in memory once per call until the process dies.
 */
export const MAX_RETAINED_JOBS = 8;

/**
 * In-memory job registry, bounded and insertion-ordered.
 *
 * Deliberately not a table. An export is derived data with a short life, and
 * persisting it would mean a second copy of the whole record sitting in the
 * database with its own retention question to answer. Restarting the API - or
 * running past the cap - loses finished exports the client has not collected
 * yet, which is documented behaviour rather than a surprise: a client that polls
 * a job the server no longer has gets 404 and starts again.
 */
export function createExportStore(capacity: number = MAX_RETAINED_JOBS): ExportStore {
  const jobs = new Map<string, ExportJob>();
  return {
    create: (job) => {
      jobs.set(job.id, job);
      // Map iteration is insertion-ordered, so this walks oldest-first, and
      // deleting during iteration is well defined.
      for (const oldest of jobs.keys()) {
        if (jobs.size <= capacity) break;
        jobs.delete(oldest);
      }
    },
    get: (id) => jobs.get(id),
    delete: (id) => jobs.delete(id),
    get size(): number {
      return jobs.size;
    },
  };
}

/**
 * Retrieves a job for this principal, or refuses as if it did not exist.
 *
 * 404 rather than 403 on a mismatch, the same way a read of another tenant's
 * resource answers 404: a distinguishable "exists but is not yours" would let a
 * caller confirm that a given id is a live export somewhere else in the estate.
 */
export function jobFor(store: ExportStore, id: string, principal: Principal): ExportJob {
  const job = store.get(id);
  // An absent job compares unequal here, which is the answer it should get: a
  // job that is not this principal's and a job that does not exist are the same
  // 404 on purpose.
  if (job?.tenantId !== principal.tenantId || job.subject !== principal.subject) {
    throw ApiError.notFound(
      'No export by that id. A restarted server, and one that has run several exports since, both forget finished ones.'
    );
  }
  return job;
}

/**
 * Route guard: a patient-scoped token may not run or reach a bulk export.
 *
 * The compartment on such a token is the binding that keeps a portal login
 * inside one chart. `$export` is defined as "everything", so honouring both at
 * once is impossible: the choice is between an export that silently means
 * something other than what it says and a refusal. It refuses, as a forbidden
 * rather than as an empty result, because an empty export reads to a client as
 * "this practice has no records".
 *
 * The denial is audited before it is raised, for the reason `requirePermission`
 * gives for doing the same: a refused attempt on the endpoint that hands over
 * every record is exactly the event a breach investigation goes looking for.
 */
export function requireOrganisationWideToken() {
  return createMiddleware<AppEnv>(async (c, next) => {
    const principal = c.get('principal');
    if (principal === undefined) {
      throw ApiError.unauthenticated('A bearer token is required.');
    }
    if (principal.compartmentPatientId !== undefined) {
      await c.get('audit')?.denial({
        action: 'authorisation.denied',
        targetType: 'Route',
        targetId: c.req.path,
        metadata: { reason: 'bulk export from a patient-scoped token' },
      });
      throw ApiError.forbidden(
        'A patient-scoped token cannot run a bulk export. Read the chart through the Patient endpoints instead.',
        { fhirIssueCode: 'forbidden' }
      );
    }
    await next();
  });
}

/**
 * Every type this server could export for someone, ignoring who is asking.
 *
 * Distinct from {@link permittedModules}, and the distinction is what lets
 * {@link parseTypeFilter} answer 400 for a type that does not exist here and 403
 * for one that does and is not this caller's to take.
 */
export function exportableTypes(modules: readonly FhirResourceModule[]): readonly string[] {
  return modules.filter((module) => module.interactions.includes('search-type')).map((m) => m.type);
}

/**
 * The types this principal may actually export, at this entry point.
 *
 * The generated resource routes gate every type twice - `requirePermission` for
 * what the principal may do, `requireScope` for what the application was
 * authorised to ask for - and the export reaches the same repositories without
 * passing either, because `module.search` enforces nothing on its own. Applying
 * both here is what keeps `$export` from being a hole in a wall that is
 * otherwise checked at every door.
 *
 * A type the caller cannot read is left out rather than refused, because the
 * caller did not ask for it by name; a type they DID name and cannot read is
 * refused by {@link parseTypeFilter}, which can tell the difference.
 */
export function permittedModules(
  modules: readonly FhirResourceModule[],
  principal: Principal,
  policy: PolicyContext | undefined,
  entry: BulkExportEntry
): readonly FhirResourceModule[] {
  const scopes = parseScopes(principal.scopes);

  return modules.filter((module) => {
    if (!module.interactions.includes('search-type')) return false;
    if (entry.scope === 'Patient' && !PATIENT_COMPARTMENT_TYPES.has(module.type)) return false;
    if (!grantsScope(scopes, { resourceType: module.type, action: 'search' })) return false;
    // Absence denies, as it does in `requirePermission`: no policy context means
    // the route was mounted outside the chain, and that must refuse rather than
    // expose.
    return policy?.can(module.permission) === true;
  });
}

/**
 * Parses `_type` against what the server serves and what this caller may read.
 *
 * Three outcomes, and the difference between them is what the client can act on:
 * a type this server does not serve is a 400 naming it, a type it serves that
 * this token may not read is a 403 naming it, and anything else narrows the
 * export. Silently dropping either would hand back an export that looks complete
 * and is missing a resource the client asked for by name - and the client has no
 * way to tell, because a bulk manifest lists what was produced, not what was
 * requested.
 *
 * `raw` is every value of the parameter rather than the first, because
 * `?_type=Patient&_type=Encounter` is a legal way to send a list and reading
 * only the first would drop the rest into the same silent gap.
 */
export function parseTypeFilter(
  raw: readonly string[],
  served: readonly string[],
  permitted: readonly string[]
): readonly string[] {
  const requested = raw
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter((value) => value !== '');

  if (requested.length === 0) return permitted;

  const unknown = requested.filter((type) => !served.includes(type));
  if (unknown.length > 0) {
    throw ApiError.malformed(
      `This server does not export ${unknown.join(', ')}. See /fhir/metadata for what it serves.`,
      {
        fhirIssueCode: 'not-supported',
        issues: unknown.map((type) => ({ path: '_type', message: `unsupported type ${type}` })),
      }
    );
  }

  const refused = requested.filter((type) => !permitted.includes(type));
  if (refused.length > 0) {
    throw ApiError.forbidden(
      `This request may not export ${refused.join(', ')}. A type is exportable only where the token holds a search scope for it, the role holds its permission, and - at the patient level - the type is in the Patient compartment.`,
      { fhirIssueCode: 'forbidden' }
    );
  }

  return requested;
}

/**
 * A FHIR `instant`: a date, a time, and an offset. All three are required.
 *
 * Anchored, with no nested quantifier, so it cannot backtrack catastrophically.
 */
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * `_since`, or undefined.
 *
 * Validated against the grammar rather than by handing it to `new Date`, which
 * accepts `'2026'`, `'March 5, 2026'` and - most damagingly - a zone-less
 * `'2026-03-01T00:00:00'`, which ECMAScript reads in the server's local
 * timezone. A client in another timezone would then receive an export missing up
 * to a day of changes, with nothing to indicate anything was left out.
 */
export function parseSince(raw: string | undefined): Date | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  const value = raw.trim();
  const parsed = new Date(value);
  if (!INSTANT.test(value) || Number.isNaN(parsed.getTime())) {
    throw ApiError.malformed(
      '_since must be an ISO 8601 instant with a timezone offset, for example 2026-03-01T00:00:00Z.',
      { issues: [{ path: '_since', message: `could not read ${raw} as an instant` }] }
    );
  }
  return parsed;
}

/** Rows fetched per repository round trip. */
const EXPORT_PAGE_SIZE = 500;

/**
 * The ceiling per resource type.
 *
 * A bound is unavoidable while the job lives in this process's memory. What is
 * avoidable is a silent one, so hitting it produces an OperationOutcome in the
 * manifest's `error` array rather than a short file that looks complete.
 */
export const EXPORT_LIMIT = 50_000;

/** One type that did not fit, for the manifest to report. */
export interface ExportTruncation {
  readonly type: string;
  readonly exported: number;
  readonly total: number;
}

export interface ExportResult {
  readonly files: readonly ExportFile[];
  readonly truncations: readonly ExportTruncation[];
}

/**
 * Runs the export.
 *
 * Pages each type to exhaustion through the same modules, and therefore the same
 * tenant-bound repositories, as every other request. There is no bulk path
 * around the scoping, because a bulk path around the scoping is how one practice
 * exports another's charts.
 *
 * A type that yields nothing produces no file at all, which is what the
 * specification asks for: a manifest entry with an empty file reads to a client
 * as "this resource exists and is empty" rather than "there were none".
 */
export async function runExport(
  c: Context<AppEnv>,
  modules: readonly FhirResourceModule[],
  types: readonly string[],
  since: Date | undefined,
  /**
   * The per-type ceiling. A parameter rather than a constant because it is a
   * property of the deployment - a small instance wants a lower one than
   * {@link EXPORT_LIMIT} - and because a ceiling nobody can vary is a ceiling
   * whose reporting path nobody exercises.
   */
  limit: number = EXPORT_LIMIT
): Promise<ExportResult> {
  const files: ExportFile[] = [];
  const truncations: ExportTruncation[] = [];

  for (const module of modules) {
    if (!types.includes(module.type)) continue;

    const { kept, total } = await collectType(c, module, limit);
    if (total > kept.length) {
      truncations.push({ type: module.type, exported: kept.length, total });
    }

    const rows = since === undefined ? kept : kept.filter((row) => isAfter(row, since));
    if (rows.length === 0) continue;

    files.push({
      type: module.type,
      ndjson: rows.map((resource) => JSON.stringify(resource)).join('\n'),
      count: rows.length,
    });
  }

  return { files, truncations };
}

/**
 * Every row of one type this export may take, and the repository's own count of
 * how many there were.
 *
 * The two are not the same number when the ceiling bites, and returning both is
 * what lets the caller report a truncation instead of handing back a short file
 * that reads as complete.
 */
async function collectType(
  c: Context<AppEnv>,
  module: FhirResourceModule,
  limit: number
): Promise<{ kept: readonly FhirResource[]; total: number }> {
  const collected: FhirResource[] = [];
  let total = 0;

  for (let offset = 0; offset < limit; offset += EXPORT_PAGE_SIZE) {
    const page = await module.search(c, {}, { offset, count: EXPORT_PAGE_SIZE });
    total = page.total;
    collected.push(...page.rows);
    // All three conditions are needed. A page shorter than the one asked for is
    // the last one; a repository reporting a total it cannot deliver would
    // otherwise spin until the ceiling; and a page may carry the export past the
    // ceiling in one step.
    if (page.rows.length < EXPORT_PAGE_SIZE) break;
    if (collected.length >= total) break;
    if (collected.length >= limit) break;
  }

  // Trimmed rather than left as fetched, so the ceiling means the same thing
  // whatever the page size divides into: a page is allowed to overshoot it, the
  // export is not.
  return { kept: collected.length > limit ? collected.slice(0, limit) : collected, total };
}

/**
 * `_since` compares against `meta.lastUpdated`, which the boundary stamps from
 * each row's own `updatedAt` - see `stampLastUpdated` in resource-module.ts.
 *
 * A resource without one is included rather than dropped. Some rows genuinely
 * have no `updatedAt` to stamp from, and an incremental export that silently
 * excluded them would let a record disappear from a downstream system that
 * already had it. Sending a resource twice is a cost; losing one is a defect.
 */
export function isAfter(resource: FhirResource, since: Date): boolean {
  const stamp = (resource as { meta?: { lastUpdated?: string } }).meta?.lastUpdated;
  if (stamp === undefined) return true;
  const updated = new Date(stamp);
  return Number.isNaN(updated.getTime()) || updated >= since;
}

/**
 * The `error` files a truncated export carries.
 *
 * The specification's `error` array holds files of OperationOutcome resources
 * rather than inline outcomes, so a truncation is delivered the same way the
 * data is: fetched, streamed, and read by a client that already knows how to
 * read ndjson. An empty array - the normal case - means what a client assumes it
 * means, which is only true because this exists for the case where it does not.
 */
export function truncationOutcomes(
  truncations: readonly ExportTruncation[],
  limit: number = EXPORT_LIMIT
): readonly ExportFile[] {
  if (truncations.length === 0) return [];

  const outcomes = truncations.map((truncation) => ({
    resourceType: 'OperationOutcome',
    issue: [
      {
        severity: 'warning',
        code: 'too-costly',
        diagnostics: `Exported ${truncation.exported} of ${truncation.total} ${truncation.type} resources: this server exports at most ${limit} of a type in one job. Narrow the export with _since or _type.`,
        expression: [truncation.type],
      },
    ],
  }));

  return [
    {
      type: 'OperationOutcome',
      ndjson: outcomes.map((outcome) => JSON.stringify(outcome)).join('\n'),
      count: outcomes.length,
    },
  ];
}

/** The manifest a completed job answers with, per the Bulk Data specification. */
export function manifestFor(job: ExportJob, baseUrl: string): Record<string, unknown> {
  const fileEntry = (file: ExportFile): Record<string, unknown> => ({
    type: file.type,
    url: `${baseUrl}/fhir/$export-file/${job.id}/${file.type}`,
    count: file.count,
  });

  return {
    transactionTime: job.transactionTime,
    request: job.requestUrl,
    // The file routes sit behind the same authentication as everything else and
    // are bound to the principal that ran the export, so a client needs the
    // token it already has and a leaked manifest URL alone reveals nothing.
    requiresAccessToken: true,
    output: job.files.map(fileEntry),
    error: job.errors.map(fileEntry),
  };
}
