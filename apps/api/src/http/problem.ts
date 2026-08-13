import type { Context } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context.js';
import { PROBLEM_KINDS, type ApiError } from '../errors.js';

/** RFC 9457 media type. */
export const PROBLEM_JSON = 'application/problem+json';

/** Namespace for the `type` URI. Stable, dereferenceable, and versionless. */
const PROBLEM_BASE = 'https://openrunic.org/problems/';

/**
 * The error body every internal route returns. RFC 9457 with two additions:
 * `requestId`, so a report can be correlated with the audit trail, and
 * `errors`, so a form can highlight the field that failed rather than showing a
 * sentence.
 */
export const problemDocumentSchema = z.strictObject({
  /** `https://openrunic.org/problems/<kind>`. Branch on this, not on the title. */
  type: z.enum(PROBLEM_KINDS.map((kind) => `${PROBLEM_BASE}${kind}`)),
  title: z.string(),
  status: z.int().min(400).max(599),
  detail: z.string(),
  /** The path that produced the failure. */
  instance: z.string(),
  requestId: z.string(),
  /** Field-level complaints, present only on a validation failure. */
  errors: z.array(z.strictObject({ path: z.string(), message: z.string() })).optional(),
});

export type ProblemDocument = z.infer<typeof problemDocumentSchema>;

export function toProblemDocument(
  error: ApiError,
  context: { instance: string; requestId: string }
): ProblemDocument {
  return {
    type: `${PROBLEM_BASE}${error.kind}`,
    title: error.title,
    status: error.status,
    detail: error.detail,
    instance: context.instance,
    requestId: context.requestId,
    ...(error.issues.length > 0 ? { errors: [...error.issues] } : {}),
  };
}

export function problemResponse(c: Context<AppEnv>, error: ApiError): Response {
  const document = toProblemDocument(error, {
    instance: c.req.path,
    requestId: c.get('requestId'),
  });
  return c.body(JSON.stringify(document), error.status, { 'Content-Type': PROBLEM_JSON });
}
