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
 * Every schema on this boundary is a `strictObject`, so an unexpected key is a
 * rejection rather than a silent drop. Silently dropping is how a client ships
 * a typo'd field name and only finds out in production that the value never
 * arrived.
 *
 * That sentence used to be false for three of the forty-seven query schemas.
 * `growthQuerySchema`, `pendingQuerySchema` and `referralListQuerySchema` were
 * `z.object`, so `GET /referrals?openrunicNoSuchParam=1` answered 200 and
 * ignored the parameter where the same request against `/patients` answered
 * 400. One door, one helper, opposite answers, and the paragraph claiming the
 * strict one covered both.
 */

function toFieldIssues(error: z.ZodError): FieldIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }));
}

/**
 * A parameter sent more than once is refused, not answered with one of its
 * values.
 *
 * `c.req.query()` keeps the first occurrence and discards the rest, so the
 * multiplicity is gone before any schema sees the request. `?family=A&family=B`
 * answered with A's rows and the reverse answered with B's - the response wider
 * than the question, and order-dependent, with nothing in it saying so.
 *
 * It bypassed validation as well as filtering. `?birthDate=1994-03-02&
 * birthDate=nonsense` answered 200 while the reverse answered 400, because a
 * schema only ever saw the first occurrence. Every regex, `z.enum` and coercion
 * on this boundary was reachable in the first position only. Refusing here, in
 * front of the parse, makes that unreachable rather than unlikely.
 *
 * Refusing rather than combining them. These schemas are scalars: 0 of the 47
 * query schemas has an array field, so there is no parameter that means a list
 * and nothing to exempt - and `?sort=a&sort=b` is not a question with an
 * answer. The FHIR boundary needed a per-parameter exemption because `$export`
 * has `_type`; this one has no equivalent, checked rather than assumed.
 */
function rejectRepeated(occurrences: Record<string, readonly string[]>): void {
  const repeated = Object.entries(occurrences)
    .filter(([, values]) => values.length > 1)
    .map(([name]) => name);
  if (repeated.length === 0) return;

  throw ApiError.malformed(
    `Repeated query ${repeated.length === 1 ? 'parameter' : 'parameters'}: ${repeated.join(', ')}. Send each parameter once; this server does not combine two values for the same parameter.`,
    {
      issues: repeated.map((name) => ({ path: name, message: 'sent more than once' })),
    }
  );
}

/** Parses the query string, refusing a parameter that arrives more than once. */
export function parseQuery<T>(c: Context<AppEnv>, schema: z.ZodType<T>): T {
  rejectRepeated(c.req.queries());
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
