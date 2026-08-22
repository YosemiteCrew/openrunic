import type { Context } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context.js';
import { ApiError } from '../errors.js';
import type { PolicyContext } from '../policy/policy.js';
import type { Repositories } from '../repositories/types.js';

/** The `:id` path parameter: always a UUID, never a sequential integer. */
export const idParamSchema = z.uuid();

/**
 * Reads the tenant-bound repositories off the context.
 *
 * Absent means the route was mounted outside the middleware chain, which is a
 * wiring bug rather than a client error. It surfaces as a 500 through the
 * generic handler; what it must never do is fall back to an unscoped registry.
 */
export function repositories(c: Context<AppEnv>): Repositories {
  const repos = c.get('repositories');
  if (repos === undefined) {
    throw new Error(
      'route reached without tenant-bound repositories: it is mounted outside the middleware chain'
    );
  }
  return repos;
}

export function policyOf(c: Context<AppEnv>): PolicyContext | undefined {
  return c.get('policy');
}

/**
 * The user id to stamp on something a named person answers for.
 *
 * Taken from the verified principal, never from a request body. `AGENTS.md`
 * records what happened the one time this repository did otherwise: an addendum
 * route accepted `authorId`, the client obligingly sent the original note's
 * author, and a correction written by one clinician against another's signed
 * note was stored permanently under the other clinician's name with nothing
 * failing.
 *
 * The throw is a wiring assertion rather than a path a client can reach:
 * `requirePermission` has already refused a request with no principal, so an
 * absent one here means the route is mounted outside the middleware chain.
 */
export function attributedTo(c: Context<AppEnv>): string {
  const principal = c.get('principal');
  if (principal === undefined) {
    throw new Error(
      'a route needing the acting user ran without a principal: it is mounted outside the middleware chain'
    );
  }
  return principal.subject;
}

/** Turns a repository `null` into the 404 contract. */
export function required<T>(value: T | null, message: string): T {
  if (value === null) {
    throw ApiError.notFound(message);
  }
  return value;
}

/** The `{id}` path parameter, described the same way on every route that has one. */
export function idParam(subject: string): {
  name: string;
  description: string;
  schema: z.ZodType;
} {
  return { name: 'id', description: `${subject} id (UUIDv7).`, schema: idParamSchema };
}
