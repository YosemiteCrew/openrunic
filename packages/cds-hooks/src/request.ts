/**
 * READING A HOOK REQUEST, AND THE ONE FIELD THIS SERVER REFUSES TO HONOUR.
 *
 * A CDS Hooks request arrives from an EMR that is not this one. Two fields in it
 * are worth stopping over:
 *
 * `fhirServer` is a URL the calling EMR offers so a service can fetch more of
 * the chart. Honouring it is a server-side request forgery with a specification
 * behind it: the caller names a host and this process connects to it. Some CDS
 * services genuinely need it. This one does not - it answers about a patient in
 * its own database - so the field is read, recorded, and never dereferenced, and
 * `fhirAuthorization` is not read at all because there is nothing to
 * authenticate to.
 *
 * `prefetch` is chart data the EMR supplies to save a round trip. It is accepted
 * and ignored for the same reason: this server already holds the chart, and
 * trusting a caller's copy of it would let the caller decide what the safety
 * screening screens against.
 *
 * Both decisions are recorded on the parsed request rather than hidden, so a
 * route can audit that a caller offered a server and was not followed.
 */

import { CdsHooksError } from './errors.js';

export interface CdsRequest {
  readonly hook: string;
  /** A UUID the EMR generates per invocation, for correlating logs. */
  readonly hookInstance: string;
  readonly context: Readonly<Record<string, unknown>>;
  /**
   * The FHIR server the caller offered, if any. Recorded, never dereferenced.
   * See the header: following it would be an SSRF with a specification behind it.
   */
  readonly offeredFhirServer?: string;
  /** True when the caller sent prefetch data, which this server does not use. */
  readonly prefetchOffered: boolean;
}

/** A UUID in any version. The specification requires one; loggers depend on it. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Parses and validates a request body.
 *
 * Strict about the three fields the specification makes required, because a
 * service that guesses at a missing `hookInstance` produces logs nobody can
 * correlate, and one that guesses at a missing `context` answers about the
 * wrong patient.
 */
export function parseRequest(body: unknown): CdsRequest {
  if (typeof body !== 'object' || body === null) {
    throw CdsHooksError.malformed('The request body must be a JSON object.');
  }

  const raw = body as Record<string, unknown>;
  const hook = raw.hook;
  const hookInstance = raw.hookInstance;
  const context = raw.context;

  if (typeof hook !== 'string' || hook === '') {
    throw CdsHooksError.malformed('`hook` is required and must name the hook being invoked.');
  }
  if (typeof hookInstance !== 'string' || !UUID.test(hookInstance)) {
    throw CdsHooksError.malformed('`hookInstance` is required and must be a UUID.');
  }
  if (typeof context !== 'object' || context === null || Array.isArray(context)) {
    throw CdsHooksError.malformed('`context` is required and must be an object.');
  }

  const fhirServer = raw.fhirServer;

  return {
    hook,
    hookInstance,
    context: context as Record<string, unknown>,
    ...(typeof fhirServer === 'string' && fhirServer !== ''
      ? { offeredFhirServer: fhirServer }
      : {}),
    prefetchOffered: typeof raw.prefetch === 'object' && raw.prefetch !== null,
  };
}

/** A required string out of the hook context, refusing rather than guessing. */
export function requireContextString(request: CdsRequest, key: string): string {
  const value = request.context[key];
  if (typeof value !== 'string' || value === '') {
    throw CdsHooksError.malformed(`\`context.${key}\` is required for the ${request.hook} hook.`);
  }
  return value;
}

/** An optional string out of the hook context. */
export function contextString(request: CdsRequest, key: string): string | undefined {
  const value = request.context[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/**
 * The draft orders a prescriber is working on, as FHIR resources.
 *
 * `context.draftOrders` is a Bundle, and the entries are the orders. A caller
 * that sends something else gets an empty list rather than an exception: a
 * malformed bundle is the caller's defect, and refusing the whole invocation
 * over it would replace a safety check with an error dialog.
 */
export function draftOrders(request: CdsRequest): Record<string, unknown>[] {
  const bundle = request.context.draftOrders;
  if (typeof bundle !== 'object' || bundle === null) return [];

  const entries = (bundle as { entry?: unknown }).entry;
  if (!Array.isArray(entries)) return [];

  return entries
    .map((entry) =>
      typeof entry === 'object' && entry !== null
        ? (entry as { resource?: unknown }).resource
        : undefined
    )
    .filter(
      (resource): resource is Record<string, unknown> =>
        typeof resource === 'object' && resource !== null
    );
}
