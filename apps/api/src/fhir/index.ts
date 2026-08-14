import { uuidv7 } from '@openrunic/database';
import { Hono, type Context } from 'hono';

import type { AppEnv } from '../context.js';
import { ApiError } from '../errors.js';
import { fhirResponse } from '../http/fhir.js';
import { parseParam } from '../http/validate.js';
import { requirePermission } from '../middleware/policy.js';
import { idParamSchema, repositories, required } from '../routes/helpers.js';

import { buildSearchsetBundle } from './bundle.js';
import {
  assertNotCompartmentBound,
  BULK_EXPORT_OPERATIONS,
  createExportStore,
  exportableTypes,
  manifestFor,
  parseSince,
  parseTypeFilter,
  runExport,
} from './bulk-export.js';
import { buildCapabilityStatement } from './metadata.js';
import { parsePaging, rejectUnsupportedParams } from './params.js';
import { fhirPatientToCreateInput, patientRowToFhir } from './patient.js';
import { acceptedSearchParams, type ServedResource } from './registry.js';
import type { FhirResourceModule } from './resource-module.js';
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
   * The work happens before the poll is answered rather than in a queue, so the
   * limits here are memory and process lifetime rather than the contract - see
   * bulk-export.ts, which also explains why a job carries no status.
   *
   * `facility.all` is the gate rather than `patient.read`. Every other route
   * honours a principal's facility grants by asking about one facility at a
   * time; a whole-organisation read never gets that opportunity, so it demands
   * the permission that means organisation-wide access outright.
   */
  const exports = createExportStore();
  const available = exportableTypes(modules);

  const kickOff = async (c: Context<AppEnv>): Promise<Response> => {
    assertNotCompartmentBound(c.get('principal'));

    // `Prefer: respond-async` is required by the specification. Refusing without
    // it is what stops a client assuming a synchronous body is coming.
    if (!(c.req.header('prefer') ?? '').includes('respond-async')) {
      throw ApiError.malformed('Bulk export requires the header `Prefer: respond-async`.', {
        fhirIssueCode: 'required',
        issues: [{ path: 'Prefer', message: 'expected respond-async' }],
      });
    }

    const types = parseTypeFilter(c.req.query('_type'), available);
    const since = parseSince(c.req.query('_since'));
    const id = uuidv7();

    // Any failure below propagates to the kick-off response as an
    // OperationOutcome, which the specification allows and which tells the
    // client now rather than at a poll it has not made yet.
    const files = await runExport(c, modules, types, since);
    exports.create({ id, requestUrl: c.req.url, transactionTime: now().toISOString(), files });

    const base = new URL(c.req.url).origin;
    c.header('Content-Location', `${base}${FHIR_BASE_PATH}/$export-status/${id}`);
    return c.body(null, 202);
  };

  // Mounted from the same list the CapabilityStatement declares, so an entry
  // point cannot be advertised without being served or served without being
  // advertised.
  for (const operation of BULK_EXPORT_OPERATIONS) {
    router.get(
      operation.path,
      requireScope('Patient', 'read'),
      requirePermission('facility.all'),
      kickOff
    );
  }

  /**
   * The poll. The manifest, or 404 for a job this server never had or has
   * already forgotten - a restart loses finished exports, and a client that
   * cannot tell "gone" from "still working" would wait forever.
   */
  router.get(
    '/$export-status/:id',
    requireScope('Patient', 'read'),
    requirePermission('facility.all'),
    (c) => {
      const job = exports.get(c.req.param('id'));
      if (job === undefined) {
        throw ApiError.notFound(
          'No export by that id. A restarted server forgets finished exports.'
        );
      }
      return c.json(manifestFor(job, new URL(c.req.url).origin));
    }
  );

  /**
   * One file. `application/fhir+ndjson` because that is what the manifest
   * promised, and a client streaming it line by line will not tolerate a JSON
   * array pretending.
   */
  router.get(
    '/$export-file/:id/:type',
    requireScope('Patient', 'read'),
    requirePermission('facility.all'),
    (c) => {
      const job = exports.get(c.req.param('id'));
      const file = job?.files.find((candidate) => candidate.type === c.req.param('type'));
      if (file === undefined) {
        throw ApiError.notFound('No such export file.');
      }
      return c.body(file.ndjson, 200, { 'content-type': 'application/fhir+ndjson' });
    }
  );

  /** Cancelling frees the memory the job is holding. */
  router.delete(
    '/$export-status/:id',
    requireScope('Patient', 'read'),
    requirePermission('facility.all'),
    (c) => {
      if (!exports.delete(c.req.param('id'))) {
        throw ApiError.notFound('No export by that id.');
      }
      return c.body(null, 202);
    }
  );

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
    return c.json(
      {
        issuer,
        // The token endpoint is the API's own session route: this deployment
        // authenticates through it and has no separate authorisation server
        // yet. When OIDC lands (see lib/auth in the web app) these two move to
        // the provider and this document is where an app finds out.
        authorization_endpoint: `${base.origin}/authorize`,
        token_endpoint: `${base.origin}/token`,
        capabilities: [
          'launch-standalone',
          'client-public',
          'context-standalone-patient',
          'permission-patient',
          'permission-user',
        ],
        code_challenge_methods_supported: ['S256'],
        grant_types_supported: ['authorization_code'],
        scopes_supported: ['openid', 'fhirUser', 'launch/patient', 'patient/*.read', 'user/*.read'],
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
      return fhirResponse(c, patientRowToFhir(row), 201, {
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
