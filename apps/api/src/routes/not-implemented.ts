import { Hono } from 'hono';

import type { AppEnv } from '../context.js';
import { ApiError } from '../errors.js';
import { problemDocumentSchema } from '../http/problem.js';
import { requirePermission } from '../middleware/policy.js';
import type { RouteContract } from '../openapi/registry.js';
import type { Permission } from '../policy/permissions.js';

/**
 * The aggregates that are wired but not yet built.
 *
 * These are not placeholders in the "add a router later" sense. Each one is
 * mounted through the full middleware chain and behind its real permission, so
 * an unauthenticated caller still gets 401, a caller with the wrong role still
 * gets 403 and an audited denial, and only a caller who *would* have been
 * allowed sees 501. That ordering is the point: the security envelope for these
 * aggregates is already load-bearing and already tested, and the workstream
 * that implements the handlers inherits it rather than reinventing it.
 *
 * 501 is the honest status. 404 would say the endpoint does not exist, 200 with
 * an empty list would say there is no data, and a client would have no way to
 * tell either from the truth.
 */

export interface StubAggregate {
  name: string;
  /** Plural path segment under `/bff/v0`. */
  segment: string;
  readPermission: Permission;
  writePermission: Permission;
  /** The workstream that owns the real implementation, per plan section 7. */
  owner: string;
}

export const STUB_AGGREGATES: readonly StubAggregate[] = [
  {
    name: 'encounters',
    segment: 'encounters',
    readPermission: 'encounter.read',
    writePermission: 'encounter.write',
    owner: 'WS2 Charting/Forms',
  },
  {
    name: 'orders',
    segment: 'orders',
    readPermission: 'order.read',
    writePermission: 'order.write',
    owner: 'WS3 Orders/Results',
  },
  {
    name: 'results',
    segment: 'results',
    readPermission: 'result.read',
    writePermission: 'result.write',
    owner: 'WS3 Orders/Results',
  },
  {
    name: 'claims',
    segment: 'claims',
    readPermission: 'claim.read',
    writePermission: 'claim.write',
    owner: 'WS4 Billing/RCM',
  },
  {
    name: 'payments',
    segment: 'payments',
    readPermission: 'payment.read',
    writePermission: 'payment.write',
    owner: 'WS4 Billing/RCM',
  },
  {
    name: 'tasks',
    segment: 'tasks',
    readPermission: 'task.read',
    writePermission: 'task.write',
    owner: 'WS3 Orders/Results (typed inbox)',
  },
  {
    name: 'forms',
    segment: 'forms',
    readPermission: 'form.read',
    writePermission: 'form.write',
    owner: 'WS2 Charting/Forms',
  },
];

function notImplemented(aggregate: StubAggregate): never {
  throw ApiError.notImplemented(
    `The ${aggregate.name} API is not implemented yet. It is owned by ${aggregate.owner}.`
  );
}

export function stubRouteContracts(): RouteContract[] {
  return STUB_AGGREGATES.flatMap((aggregate) => [
    {
      method: 'get' as const,
      path: `/bff/v0/${aggregate.segment}`,
      operationId: `list${capitalise(aggregate.segment)}`,
      summary: `List ${aggregate.name}. Not implemented.`,
      description: `Reserved. Owned by ${aggregate.owner}. Authentication and authorisation are already enforced; the handler answers 501.`,
      tags: [aggregate.name],
      permission: aggregate.readPermission,
      responses: [
        { status: 401, description: 'No usable bearer token.', schema: problemDocumentSchema },
        {
          status: 403,
          description: 'The role lacks the permission.',
          schema: problemDocumentSchema,
        },
        { status: 501, description: 'Not implemented yet.', schema: problemDocumentSchema },
      ],
    },
    {
      method: 'post' as const,
      path: `/bff/v0/${aggregate.segment}`,
      operationId: `create${capitalise(aggregate.segment)}`,
      summary: `Create ${aggregate.name}. Not implemented.`,
      description: `Reserved. Owned by ${aggregate.owner}.`,
      tags: [aggregate.name],
      permission: aggregate.writePermission,
      responses: [
        { status: 401, description: 'No usable bearer token.', schema: problemDocumentSchema },
        {
          status: 403,
          description: 'The role lacks the permission.',
          schema: problemDocumentSchema,
        },
        { status: 501, description: 'Not implemented yet.', schema: problemDocumentSchema },
      ],
    },
  ]);
}

export function stubRoutes(): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  for (const aggregate of STUB_AGGREGATES) {
    router.get(`/${aggregate.segment}`, requirePermission(aggregate.readPermission), () =>
      notImplemented(aggregate)
    );
    router.get(`/${aggregate.segment}/:id`, requirePermission(aggregate.readPermission), () =>
      notImplemented(aggregate)
    );
    router.post(`/${aggregate.segment}`, requirePermission(aggregate.writePermission), () =>
      notImplemented(aggregate)
    );
    router.patch(`/${aggregate.segment}/:id`, requirePermission(aggregate.writePermission), () =>
      notImplemented(aggregate)
    );
  }

  return router;
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
