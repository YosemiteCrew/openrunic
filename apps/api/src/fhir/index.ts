import { Hono } from 'hono';

import type { AppEnv } from '../context.js';
import { ApiError } from '../errors.js';
import { fhirResponse } from '../http/fhir.js';
import { parseParam } from '../http/validate.js';
import { requirePermission } from '../middleware/policy.js';
import { idParamSchema, repositories, required } from '../routes/helpers.js';

import { buildSearchsetBundle } from './bundle.js';
import { buildCapabilityStatement } from './metadata.js';
import { fhirPatientToCreateInput, patientRowToFhir } from './patient.js';
import { parsePaging, rejectUnsupportedParams, toPatientSearchQuery } from './search.js';

/**
 * The FHIR R4 boundary.
 *
 * This is the *public* contract: stable, versioned by FHIR itself, and the one
 * third parties build against. The internal `/bff/v0` surface is the unstable
 * one, and the asymmetry is deliberate (scope item 104a) - there is no second
 * proprietary public API to keep in step.
 *
 * Everything on this router answers `application/fhir+json`, errors included,
 * and every error is an `OperationOutcome` - including the ones raised before a
 * handler here is reached. That is why {@link isFhirPath} is consulted in the
 * first middleware rather than in a router-level one: an authentication failure
 * on `/fhir/Patient` never reaches this file, and a FHIR client would have no
 * idea what a problem document was.
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
}

export function fhirRoutes(options: FhirRouterOptions): Hono<AppEnv> {
  const now = options.now ?? ((): Date => new Date());
  const router = new Hono<AppEnv>();

  router.get('/metadata', (c) =>
    fhirResponse(c, buildCapabilityStatement(now(), options.softwareVersion))
  );

  router.get('/Patient', requirePermission('patient.read'), async (c) => {
    const query = c.req.query();
    rejectUnsupportedParams('Patient', query);
    const paging = parsePaging(query);
    const page = await repositories(c).patients.list(toPatientSearchQuery(query, paging));

    return fhirResponse(
      c,
      buildSearchsetBundle(page, patientRowToFhir, {
        baseUrl: fhirBaseUrl(c.req.url),
        resourceType: 'Patient',
        query,
      })
    );
  });

  router.get('/Patient/:id', requirePermission('patient.read'), async (c) => {
    const id = parseParam(c.req.param('id'), idParamSchema, 'id');
    const row = await repositories(c).patients.findById(id);
    // Absent and belongs-to-another-organisation are the same answer here, on
    // purpose: a distinguishable 403 would let a caller enumerate ids across
    // tenants.
    return fhirResponse(c, patientRowToFhir(required(row, 'No such Patient.')));
  });

  router.post('/Patient', requirePermission('patient.write'), async (c) => {
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
  });

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
