import { uuidv7 } from '@openrunic/database';
import { createMiddleware } from 'hono/factory';

import type { AppEnv } from '../context.js';

/** Bound on an inbound correlation id, so a client cannot stuff the audit log. */
const MAX_REQUEST_ID_LENGTH = 128;

/** Printable ASCII without whitespace or control characters. */
const SAFE_REQUEST_ID = /^[\x21-\x7e]+$/;

export interface RequestIdOptions {
  /** Overridable so tests get deterministic ids. */
  generate?: () => string;
  header?: string;
  /**
   * Chooses the error representation for a path. Decided here, in stage 1,
   * because stages 2 to 5 can all fail: a 401 from authentication on a FHIR
   * route has to be an OperationOutcome, and a router-level middleware would
   * be too late to say so.
   */
  responseFormatFor?: (path: string) => AppEnv['Variables']['responseFormat'];
}

/**
 * Stage 1 of the chain. Establishes the id that ties this request's logs, audit
 * events and error responses together.
 *
 * An inbound `x-request-id` is honoured so a trace survives a gateway hop, but
 * only after validation: it is echoed back in a response header and copied into
 * audit metadata, so an unvalidated value would be a log-injection and
 * header-splitting vector. Anything unacceptable is replaced rather than
 * rejected, because a malformed trace header should not fail a clinical request.
 */
export function requestId(options: RequestIdOptions = {}) {
  const generate = options.generate ?? uuidv7;
  const header = options.header ?? 'x-request-id';
  const responseFormatFor = options.responseFormatFor ?? ((): 'problem' => 'problem');

  return createMiddleware<AppEnv>(async (c, next) => {
    const inbound = c.req.header(header);
    const id =
      inbound !== undefined &&
      inbound.length <= MAX_REQUEST_ID_LENGTH &&
      SAFE_REQUEST_ID.test(inbound)
        ? inbound
        : generate();

    c.set('requestId', id);
    c.set('responseFormat', responseFormatFor(c.req.path));
    await next();
    c.res.headers.set(header, id);
  });
}
