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

/** Turns a repository `null` into the 404 contract. */
export function required<T>(value: T | null, message: string): T {
  if (value === null) {
    throw ApiError.notFound(message);
  }
  return value;
}
