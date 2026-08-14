import { operationOutcome, type OperationOutcome, type OutcomeIssue } from '@openrunic/fhir';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

import type { AppEnv } from '../context.js';
import type { ApiError } from '../errors.js';

/** The FHIR JSON media type. Everything on `/fhir` speaks it, errors included. */
export const FHIR_JSON = 'application/fhir+json';

/**
 * Serialises a resource with `JSON.stringify` rather than `c.json` so the
 * `application/fhir+json` content type survives. A FHIR client that receives
 * `application/json` cannot tell a resource from an arbitrary body.
 */
export function fhirResponse(
  c: Context<AppEnv>,
  resource: object,
  status: ContentfulStatusCode = 200,
  headers: Record<string, string> = {}
): Response {
  return c.body(JSON.stringify(resource), status, { 'Content-Type': FHIR_JSON, ...headers });
}

/**
 * Renders an {@link ApiError} as an `OperationOutcome`.
 *
 * One issue per field-level complaint, so a client can point at the element
 * that failed; a single issue otherwise. `expression` carries the FHIRPath to
 * the offending element - the R4 replacement for the deprecated `location` -
 * and `diagnostics` carries the human sentence. The request id is echoed as an
 * extra `information` issue rather than a header alone, because an
 * OperationOutcome is what gets pasted into a support ticket.
 */
export function toOperationOutcome(error: ApiError, requestId: string): OperationOutcome {
  const issues: OutcomeIssue[] =
    error.issues.length > 0
      ? error.issues.map((issue) => ({
          severity: 'error' as const,
          code: error.fhirIssueCode,
          diagnostics: issue.message,
          ...(issue.path === '' ? {} : { expression: [issue.path] }),
        }))
      : [{ severity: 'error' as const, code: error.fhirIssueCode, diagnostics: error.detail }];

  // Built by `packages/fhir` rather than by an object literal here: the builder
  // compacts each issue, so an empty `diagnostics` or expression never reaches
  // the wire as an empty string or array, which FHIR JSON does not allow.
  return operationOutcome([
    ...issues,
    { severity: 'information', code: 'informational', diagnostics: `requestId: ${requestId}` },
  ]);
}

export function operationOutcomeResponse(c: Context<AppEnv>, error: ApiError): Response {
  const outcome = toOperationOutcome(error, c.get('requestId'));
  // A 401 without a challenge is not a 401 any SMART client can act on.
  const headers: Record<string, string> =
    error.status === 401 ? { 'WWW-Authenticate': 'Bearer realm="openrunic"' } : {};
  return fhirResponse(c, outcome, error.status, headers);
}
