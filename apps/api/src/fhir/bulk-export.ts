import type { FhirResource } from '@openrunic/fhir';
import type { Context } from 'hono';

import type { Principal } from '../auth/principal.js';
import type { AppEnv } from '../context.js';
import { ApiError } from '../errors.js';

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
 * - The job lives in this process's memory, so an export dies with the process
 *   and a very large practice will feel it. That is a scaling problem with a
 *   known fix - a queue and object storage - and the fix brings the missing
 *   states back with it, at the point where they would be true.
 *
 * ## Who may run one
 *
 * Everyone in the tenant, at once, is the whole point of the operation, and it
 * is also what makes it the most sensitive read the API offers. Two things gate
 * it, and they gate different failures:
 *
 * - The `facility.all` permission, checked by the route. A principal granted two
 *   facilities out of nine must not be able to walk out with all nine, and every
 *   other route respects that grant by asking about one facility at a time -
 *   which is exactly the check a whole-organisation read has no opportunity to
 *   make.
 * - {@link assertNotCompartmentBound}, checked here. A patient-scoped token
 *   asking for a whole-organisation export is a contradiction rather than a
 *   permission question, and refusing it in code means a tenant that forks the
 *   seeded roles cannot grant its way into one.
 */

/**
 * The `$export` entry points, in one list because three things must agree about
 * them: the router mounts these paths, the CapabilityStatement declares these
 * operations, and `fhir.conformance.test.ts` walks the declaration and calls
 * what it finds. Two entry points, both meaning "everything this token may
 * read".
 *
 * `Group/[id]/$export` is deliberately absent until Groups exist to name.
 * Advertising it would promise a selection this server cannot make, and a client
 * planning an integration around a declared operation has no way to discover
 * that it was aspirational.
 */
export const BULK_EXPORT_OPERATIONS = [
  {
    path: '/$export',
    /** Where the operation is declared: the server, or the Patient type. */
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
] as const;

export interface ExportFile {
  readonly type: string;
  /** Newline-delimited JSON, one resource per line. */
  readonly ndjson: string;
  readonly count: number;
}

/** A finished export. There is no unfinished one to represent; see the header. */
export interface ExportJob {
  readonly id: string;
  readonly requestUrl: string;
  readonly transactionTime: string;
  readonly files: readonly ExportFile[];
}

export interface ExportStore {
  create(job: ExportJob): void;
  get(id: string): ExportJob | undefined;
  delete(id: string): boolean;
}

/**
 * In-memory job registry.
 *
 * Deliberately not a table. An export is derived data with a short life, and
 * persisting it would mean a second copy of the whole record sitting in the
 * database with its own retention question to answer. Restarting the API loses
 * finished exports the client has not collected yet, which is the documented
 * behaviour rather than a surprise: a client that polls a job the server has
 * forgotten gets 404 and starts again.
 */
export function createExportStore(): ExportStore {
  const jobs = new Map<string, ExportJob>();
  return {
    create: (job) => {
      jobs.set(job.id, job);
    },
    get: (id) => jobs.get(id),
    delete: (id) => jobs.delete(id),
  };
}

/**
 * A patient-scoped token may not export the organisation.
 *
 * The compartment on such a token is the binding that keeps a portal login
 * inside one chart. `$export` is defined as "everything", so honouring both at
 * once is impossible: the choice is between an export that silently means
 * something other than what it says and a refusal. It refuses, and it says so as
 * a forbidden rather than as an empty result, because an empty export reads to a
 * client as "this practice has no records".
 */
export function assertNotCompartmentBound(principal: Principal | undefined): void {
  if (principal === undefined) {
    throw ApiError.unauthenticated('A bearer token is required.');
  }
  if (principal.compartmentPatientId !== undefined) {
    throw ApiError.forbidden(
      'A patient-scoped token cannot run a bulk export. Read the chart through the ' +
        'Patient endpoints instead.'
    );
  }
}

/** Resource types a caller may ask for, from what this server actually serves. */
export function exportableTypes(modules: readonly FhirResourceModule[]): readonly string[] {
  return modules.filter((module) => module.interactions.includes('search-type')).map((m) => m.type);
}

/**
 * Parses `_type`, refusing anything this server does not serve.
 *
 * Silently dropping an unknown type would hand back an export that looks
 * complete and is missing a resource the client asked for by name - and the
 * client has no way to tell, because a bulk manifest lists what was produced,
 * not what was requested.
 */
export function parseTypeFilter(
  raw: string | undefined,
  available: readonly string[]
): readonly string[] {
  if (raw === undefined || raw.trim() === '') return available;

  const requested = raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value !== '');

  const unknown = requested.filter((type) => !available.includes(type));
  if (unknown.length > 0) {
    throw ApiError.malformed(
      `This server does not export ${unknown.join(', ')}. See /fhir/metadata for what it serves.`,
      {
        fhirIssueCode: 'not-supported',
        issues: unknown.map((type) => ({ path: '_type', message: `unsupported type ${type}` })),
      }
    );
  }
  return requested;
}

/** `_since`, or undefined. A malformed instant is refused rather than ignored. */
export function parseSince(raw: string | undefined): Date | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw ApiError.malformed('_since must be an ISO 8601 instant.', {
      issues: [{ path: '_since', message: `could not read ${raw} as an instant` }],
    });
  }
  return parsed;
}

/** How many of one resource type an export will walk. A ceiling, not a page size. */
const EXPORT_LIMIT = 10_000;

/**
 * Runs the export.
 *
 * One search per requested type, through the same modules and therefore the same
 * tenant-bound repositories as every other request. There is no bulk path around
 * the scoping, because a bulk path around the scoping is how one practice
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
  since: Date | undefined
): Promise<readonly ExportFile[]> {
  const files: ExportFile[] = [];

  for (const module of modules) {
    if (!types.includes(module.type)) continue;

    const page = await module.search(c, {}, { offset: 0, count: EXPORT_LIMIT });

    const rows = since === undefined ? page.rows : page.rows.filter((row) => isAfter(row, since));
    if (rows.length === 0) continue;

    files.push({
      type: module.type,
      ndjson: rows.map((resource) => JSON.stringify(resource)).join('\n'),
      count: rows.length,
    });
  }

  return files;
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

/** The manifest a completed job answers with, per the Bulk Data specification. */
export function manifestFor(job: ExportJob, baseUrl: string): Record<string, unknown> {
  return {
    transactionTime: job.transactionTime,
    request: job.requestUrl,
    // The file routes sit behind the same authentication as everything else, so
    // a client needs the token it already has, and a leaked manifest URL alone
    // reveals nothing.
    requiresAccessToken: true,
    output: job.files.map((file) => ({
      type: file.type,
      url: `${baseUrl}/fhir/$export-file/${job.id}/${file.type}`,
      count: file.count,
    })),
    // Empty, and present rather than omitted: a client checking for partial
    // failure should find the field it expects and see that there were none.
    error: [],
  };
}
