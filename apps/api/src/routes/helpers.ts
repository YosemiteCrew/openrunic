import type { Context } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context.js';
import { ApiError } from '../errors.js';
import { assertCareRelationship } from '../middleware/policy.js';
import { chartIdOf } from '../policy/chart.js';
import type { PolicyContext } from '../policy/policy.js';
import type { CollectionKey, Repositories } from '../repositories/types.js';

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

/**
 * The chart guard applied to rows a route has already read.
 *
 * Reading a row is not the check. `findById` and `list` narrow by tenant, by
 * the portal compartment and by facility, and by nothing else - the care
 * relationship is a separate question that the row's own route asks, and a
 * route that reads a row without asking it serves chart data whose addressed
 * read is refused (#300).
 *
 * Every distinct chart on the page rather than the first: a page spans
 * patients, and one refused chart refuses the page, which is what the addressed
 * read of that row would have done on its own.
 */
export async function gateCharts(
  c: Context<AppEnv>,
  chartFrom: CollectionKey,
  rows: readonly unknown[]
): Promise<void> {
  for (const chart of new Set(
    rows.map((row) => chartIdOf(chartFrom, row)).filter((id) => id !== undefined)
  )) {
    await assertCareRelationship(c, chart);
  }
}

/**
 * The parent of a child collection: read, then gated, in one call.
 *
 * A child route reads its parent so that an id it cannot reach is a 404 rather
 * than an empty list - an empty list would say the parent has no children,
 * which is a different and false statement. That reasoning is right about the
 * row being ABSENT and says nothing about it being present and ungated, which
 * is how `notes/{id}` answered 404 while `notes/{id}/addenda` answered 200 with
 * the amendment text.
 *
 * So the read and the guard are one function and there is no way to spell the
 * read that omits the guard.
 */
export async function requiredParentChart<T>(
  c: Context<AppEnv>,
  chartFrom: CollectionKey,
  row: T | null,
  message: string
): Promise<T> {
  const found = required(row, message);
  await gateCharts(c, chartFrom, [found]);
  return found;
}

/** The `{id}` path parameter, described the same way on every route that has one. */
export function idParam(subject: string): {
  name: string;
  description: string;
  schema: z.ZodType;
} {
  return { name: 'id', description: `${subject} id (UUIDv7).`, schema: idParamSchema };
}
