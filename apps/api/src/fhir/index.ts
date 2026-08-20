import { uuidv7 } from '@openrunic/database';
import { Hono, type Context } from 'hono';

import type { Principal } from '../auth/principal.js';
import type { AppEnv } from '../context.js';
import type { SmartLaunchSettings } from '../env.js';
import { ApiError } from '../errors.js';
import { fhirResponse } from '../http/fhir.js';
import { parseParam } from '../http/validate.js';
import { requirePermission } from '../middleware/policy.js';
import { idParamSchema, repositories, required } from '../routes/helpers.js';

import { buildSearchsetBundle } from './bundle.js';
import {
  BULK_EXPORT_OPERATIONS,
  type BulkExportEntry,
  createExportStore,
  exportableTypes,
  jobFor,
  manifestFor,
  parseSince,
  parseTypeFilter,
  permittedModules,
  requireOrganisationWideToken,
  runExport,
  truncationOutcomes,
} from './bulk-export.js';
import { buildCapabilityStatement } from './metadata.js';
import { parsePaging, rejectUnsupportedParams } from './params.js';
import { fhirPatientToCreateInput, patientRowToFhir } from './patient.js';
import { acceptedSearchParams, type ServedResource } from './registry.js';
import { stampLastUpdated, type FhirResourceModule } from './resource-module.js';
import { SERVED_MODULES } from './resources.js';
import { requireScope } from './scope-guard.js';

/**
 * The FHIR R4 boundary.
 *
 * This is the *public* contract: stable, versioned by FHIR itself, and the one
 * third parties build against. The internal `/bff/v0` surface is the unstable
 * one, and the asymmetry is deliberate - there is no second proprietary public
 * API to keep in step.
 *
 * Everything on this router answers `application/fhir+json`, errors included,
 * and every error is an `OperationOutcome` - including the ones raised before a
 * handler here is reached. That is why {@link isFhirPath} is consulted in the
 * first middleware rather than in a router-level one: an authentication failure
 * on `/fhir/Patient` never reaches this file, and a FHIR client would have no
 * idea what a problem document was.
 *
 * Every resource is served by the same two handlers, generated from the module
 * list. Two consequences worth stating: a resource cannot be mounted without
 * appearing in the CapabilityStatement, and it cannot be reached without
 * passing both the role permission and the SMART scope check.
 */

/** Mount point of the FHIR boundary. */
export const FHIR_BASE_PATH = '/fhir';

export function isFhirPath(path: string): boolean {
  return path === FHIR_BASE_PATH || path.startsWith(`${FHIR_BASE_PATH}/`);
}

export interface FhirRouterOptions {
  /** Software version reported in the CapabilityStatement. */
  softwareVersion: string;
  now?: () => Date;
  /** Overridable so a test can mount a narrower server than the real one. */
  modules?: readonly FhirResourceModule[];
  /**
   * The authorisation server SMART apps are sent to, when one is configured.
   *
   * Undefined means this deployment publishes no launch, and the discovery
   * document says so by omitting the endpoints rather than by naming a plausible
   * one. See the route for why that distinction is the whole point.
   */
  smartLaunch?: SmartLaunchSettings;
}

/** What the registry needs to validate a search, derived from the mounted modules. */
export function servedResources(
  modules: readonly FhirResourceModule[] = SERVED_MODULES
): ServedResource[] {
  return modules.map((module) => ({
    type: module.type,
    interactions: module.interactions,
    params: module.params,
  }));
}

/**
 * Query parameters the kick-off implements. Anything else is refused rather than
 * ignored, so `_typeFilter` and `_elements` - both real Bulk Data parameters
 * this server does not implement - fail loudly instead of producing an export
 * that is wider than the client asked for.
 */
const EXPORT_PARAMS: ReadonlySet<string> = new Set(['_type', '_since']);

export function fhirRoutes(options: FhirRouterOptions): Hono<AppEnv> {
  const now = options.now ?? ((): Date => new Date());
  const modules = options.modules ?? SERVED_MODULES;
  const served = servedResources(modules);
  const router = new Hono<AppEnv>();

  /**
   * BULK DATA EXPORT.
   *
   * Kick-off answers 202 with a `Content-Location` the client polls, which is
   * what the specification requires and what every conformant client expects.
   * The work happens before the poll is answered rather than in a queue, which
   * is why a job carries no status and why the bounds it runs under are memory
   * rather than time - all of that is in bulk-export.ts, along with who may run
   * an export and why a finished one is bound to the principal that ran it.
   *
   * Every route below shares one guard chain, applied in the order the failures
   * should be reported: the SMART scope, then the role permission, then the
   * refusal of a patient-scoped token. `facility.all` is the permission because
   * every other route honours a principal's facility grants by asking about one
   * facility at a time, and a whole-organisation read never gets that
   * opportunity.
   */
  const exports = createExportStore();
  const servedTypes = exportableTypes(modules);
  const bulkGuards = [
    requireScope('Patient', 'read'),
    requirePermission('facility.all'),
    requireOrganisationWideToken(),
  ] as const;

  /** The principal, which every guard above has already proven is present. */
  const principalOf = (c: Context<AppEnv>): Principal => {
    const principal = c.get('principal');
    if (principal === undefined) {
      throw new Error('bulk export route reached outside the middleware chain');
    }
    return principal;
  };

  const kickOff =
    (entry: BulkExportEntry) =>
    async (c: Context<AppEnv>): Promise<Response> => {
      // `Prefer: respond-async` is required by the specification. Refusing without
      // it is what stops a client assuming a synchronous body is coming.
      if (!(c.req.header('prefer') ?? '').includes('respond-async')) {
        throw ApiError.malformed('Bulk export requires the header `Prefer: respond-async`.', {
          fhirIssueCode: 'required',
          issues: [{ path: 'Prefer', message: 'expected respond-async' }],
        });
      }

      const principal = principalOf(c);
      // Unknown parameters are refused for the reason params.ts gives about
      // search: `_typeFilter` or a misspelled `_since` that is quietly ignored
      // produces a complete export the client believes is narrowed.
      rejectUnsupportedParams('$export', c.req.query(), EXPORT_PARAMS);

      const permitted = permittedModules(modules, principal, c.get('policy'), entry);
      const types = parseTypeFilter(
        c.req.queries('_type') ?? [],
        servedTypes,
        permitted.map((module) => module.type)
      );
      const since = parseSince(c.req.query('_since'));

      // Stamped before the first read, not after the last. A client sends this
      // value back as the next `_since`, so a timestamp taken at the end would
      // skip every row written while the export was running - permanently, and
      // invisibly, in whatever system consumes it.
      const transactionTime = now().toISOString();
      const id = uuidv7();

      // Any failure below propagates to the kick-off response as an
      // OperationOutcome, which the specification allows and which tells the
      // client now rather than at a poll it has not made yet.
      const { files, truncations } = await runExport(c, permitted, types, since);
      exports.create({
        id,
        tenantId: principal.tenantId,
        subject: principal.subject,
        requestUrl: c.req.url,
        transactionTime,
        files,
        errors: truncationOutcomes(truncations),
      });

      // The export itself is audited, not only the rows it read. The batched
      // read event the repositories produce lists at most 500 targets and counts
      // the rest, which on an export is nearly all of them; this one says what
      // actually left, by type and count, which is the question asked after a
      // breach.
      await c.get('audit')?.write({
        action: 'export.created',
        targetType: 'Export',
        targetId: id,
        metadata: {
          entry: entry.path,
          transactionTime,
          exported: Object.fromEntries(files.map((file) => [file.type, file.count])),
          ...(truncations.length === 0 ? {} : { truncated: truncations }),
        },
      });

      const base = new URL(c.req.url).origin;
      c.header('Content-Location', `${base}${FHIR_BASE_PATH}/$export-status/${id}`);
      return c.body(null, 202);
    };

  // Mounted from the same list the CapabilityStatement declares, so an
  // advertised entry point is always a served one. The reverse direction is not
  // structural - nothing stops a future route being added beside these - so
  // `fhir.conformance.test.ts` walks the published statement and calls what it
  // finds rather than trusting this loop.
  for (const operation of BULK_EXPORT_OPERATIONS) {
    router.get(operation.path, ...bulkGuards, kickOff(operation));
  }

  /**
   * The poll. The manifest, or 404 for a job this server never had, has already
   * forgotten, or did not run for this principal - a client that cannot tell
   * "gone" from "still working" would wait forever.
   */
  router.get('/$export-status/:id', ...bulkGuards, (c) => {
    const job = jobFor(exports, c.req.param('id'), principalOf(c));
    return c.json(manifestFor(job, new URL(c.req.url).origin));
  });

  /**
   * One file. `application/fhir+ndjson` because that is what the manifest
   * promised, and a client streaming it line by line will not tolerate a JSON
   * array pretending.
   */
  router.get('/$export-file/:id/:type', ...bulkGuards, async (c) => {
    const job = jobFor(exports, c.req.param('id'), principalOf(c));
    const type = c.req.param('type');
    const file = [...job.files, ...job.errors].find((candidate) => candidate.type === type);
    if (file === undefined) {
      throw ApiError.notFound('No such export file.');
    }

    // This route touches no repository, so it emits none of the read events
    // that make auditing structural everywhere else - and it is the request
    // where the data actually leaves. Recorded explicitly for that reason.
    await c.get('audit')?.write({
      action: 'export.downloaded',
      targetType: 'Export',
      targetId: job.id,
      metadata: { type, count: file.count },
    });

    return c.body(file.ndjson, 200, { 'content-type': 'application/fhir+ndjson' });
  });

  /** Cancelling frees the memory the job is holding. */
  router.delete('/$export-status/:id', ...bulkGuards, (c) => {
    // Resolved through the same binding as a read: a caller may not delete a job
    // it could not have polled.
    const job = jobFor(exports, c.req.param('id'), principalOf(c));
    exports.delete(job.id);
    return c.body(null, 202);
  });

  router.get('/metadata', (c) =>
    fhirResponse(c, buildCapabilityStatement(now(), options.softwareVersion, modules))
  );

  /**
   * SMART on FHIR discovery.
   *
   * A third-party app cannot launch against a FHIR server it cannot interrogate:
   * before asking for a token it fetches this document to learn where to
   * authorise, what it may ask for, and which launch shapes the server supports.
   * Without it the boundary is reachable only by clients configured by hand,
   * which is not an app ecosystem.
   *
   * Served under `.well-known` off the FHIR base, as SMART requires, and left
   * unauthenticated on purpose: it is discovery metadata, it names no patient,
   * and a client that has not authenticated yet is exactly who needs to read it.
   *
   * `capabilities` claims only what the server implements. Listing a launch mode
   * that does not work would send an app down a flow that fails after the user
   * has already been redirected, which is the worst place to discover it.
   */
  router.get('/.well-known/smart-configuration', (c) => {
    const base = new URL(c.req.url);
    const issuer = `${base.origin}${FHIR_BASE_PATH}`;
    const launch = options.smartLaunch;

    // Capabilities that only mean anything once an app can actually reach an
    // authorisation server. Advertising these without one is what this route
    // used to do, and it sent every app to two endpoints this API has never
    // served: the failure landed after the user had already been redirected,
    // which is the worst place to discover a server cannot do what it claimed.
    const launchCapabilities = ['launch-standalone', 'client-public', 'context-standalone-patient'];

    return c.json(
      {
        issuer,
        ...(launch === undefined
          ? {}
          : {
              authorization_endpoint: launch.authorizationEndpoint,
              token_endpoint: launch.tokenEndpoint,
            }),
        // `permission-patient` and `permission-user` describe how this server
        // reads a scope it is handed, which is true whoever issued the token, so
        // they stay whether or not a launch is published.
        capabilities: [
          ...(launch === undefined ? [] : launchCapabilities),
          'permission-patient',
          'permission-user',
        ],
        code_challenge_methods_supported: ['S256'],
        grant_types_supported: ['authorization_code'],
        scopes_supported: [
          'openid',
          'fhirUser',
          'launch/patient',
          'patient/*.read',
          'user/*.read',
          'user/*.write',
        ],
        response_types_supported: ['code'],
      },
      200,
      { 'cache-control': 'public, max-age=300' }
    );
  });

  for (const module of modules) {
    router.get(
      `/${module.type}`,
      requirePermission(module.permission),
      requireScope(module.type, 'search'),
      async (c) => {
        const query = c.req.query();
        rejectUnsupportedParams(module.type, query, acceptedSearchParams(served, module.type));
        const paging = parsePaging(query);
        const page = await module.search(c, query, paging);

        return fhirResponse(
          c,
          buildSearchsetBundle(page, (resource) => resource, {
            baseUrl: fhirBaseUrl(c.req.url),
            resourceType: module.type,
            query,
          })
        );
      }
    );

    router.get(
      `/${module.type}/:id`,
      requirePermission(module.permission),
      requireScope(module.type, 'read'),
      async (c) => {
        const id = parseParam(c.req.param('id'), idParamSchema, 'id');
        const resource = await module.read(c, id);
        // Absent, in another organisation and outside the token's compartment
        // are the same answer here, on purpose: a distinguishable 403 would let
        // a caller enumerate ids across either boundary.
        return fhirResponse(c, required(resource, `No such ${module.type}.`));
      }
    );
  }

  router.post(
    '/Patient',
    requirePermission('patient.write'),
    requireScope('Patient', 'create'),
    async (c) => {
      let payload: unknown;
      try {
        payload = await c.req.json();
      } catch {
        throw ApiError.malformed('The request body is not valid JSON.');
      }
      const input = fhirPatientToCreateInput(payload);
      const row = await repositories(c).patients.create(input);
      // Stamped here as well as in `defineFhirResource`, because a create does
      // not go through a module: without this, the one resource a client is
      // handed at the moment it cares most about caching would be the only one
      // with no `meta.lastUpdated` on it.
      return fhirResponse(c, stampLastUpdated(row, patientRowToFhir(row)), 201, {
        Location: `${fhirBaseUrl(c.req.url)}/Patient/${row.id}`,
      });
    }
  );

  // Anything else under /fhir is a resource this server does not serve. 404
  // with an OperationOutcome rather than Hono's default text body, because a
  // FHIR client parses the body before it looks at the status.
  router.all('/*', (c) => {
    throw ApiError.notFound(
      `This server does not serve ${c.req.path}. See /fhir/metadata for what it does serve.`
    );
  });

  return router;
}

/** The absolute `/fhir` base, derived from the request rather than configured. */
export function fhirBaseUrl(requestUrl: string): string {
  const url = new URL(requestUrl);
  return `${url.origin}/fhir`;
}
