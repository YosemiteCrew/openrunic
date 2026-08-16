import type { Context } from 'hono';
import type { z } from 'zod';

import type { AppEnv } from '../context.js';
import { ApiError, type FieldIssue } from '../errors.js';

/**
 * Zod at every boundary, with one status convention.
 *
 * A **query string** that fails is a 400: the URL itself is wrong, and there is
 * no meaningful "the request was understood but rejected" reading of an
 * unknown search parameter. A **body** that fails is a 422: it parsed as JSON,
 * so the request was understood, and what failed was the content. Malformed
 * JSON is a 400 again, because nothing was understood.
 *
 * Every schema in this API is a `strictObject`, so an unexpected key is a
 * rejection rather than a silent drop. Silently dropping is how a client ships
 * a typo'd field name and only finds out in production that the value never
 * arrived.
 */

function toFieldIssues(error: z.ZodError): FieldIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }));
}

/** Parses the query string. Repeated parameters collapse to their first value. */
export function parseQuery<T>(c: Context<AppEnv>, schema: z.ZodType<T>): T {
  const result = schema.safeParse(c.req.query());
  if (!result.success) {
    throw ApiError.malformed('The query string is not valid.', {
      issues: toFieldIssues(result.error),
    });
  }
  return result.data;
}

/** Parses a JSON request body. */
export async function parseJsonBody<T>(c: Context<AppEnv>, schema: z.ZodType<T>): Promise<T> {
  let payload: unknown;
  try {
    payload = await c.req.json();
  } catch {
    throw ApiError.malformed('The request body is not valid JSON.');
  }

  const result = schema.safeParse(payload);
  if (!result.success) {
    throw ApiError.validation('The request body failed validation.', toFieldIssues(result.error));
  }
  return result.data;
}

/** Parses a path parameter, e.g. an id that must be a UUID. */
export function parseParam<T>(
  /**
   * Accepts `undefined` as well as a string. Hono types `c.req.param('id')` as a
   * string only where it can see the path literal, which it cannot inside a
   * helper that takes a plain `Context` - and an absent parameter should reach
   * the schema and come back as the same 400 as a malformed one, rather than
   * being ruled out by a type the handler had to assert.
   */
  value: string | undefined,
  schema: z.ZodType<T>,
  name: string
): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw ApiError.malformed(`The ${name} path parameter is not valid.`, {
      issues: [{ path: name, message: result.error.issues[0]?.message ?? 'invalid' }],
    });
  }
  return result.data;
}

export { toFieldIssues };
