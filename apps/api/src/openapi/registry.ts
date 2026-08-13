import type { z } from 'zod';

import type { Permission } from '../policy/permissions.js';

/**
 * Route contracts as data.
 *
 * A route module exports its contracts and mounts its handlers from the same
 * file, and `openapi/spec.ts` turns the contracts into the published document.
 * The point is that the spec is not written twice: `routes.test.ts` asserts
 * that every contract corresponds to a route Hono actually registered, so a
 * documented endpoint that does not exist - the usual way an OpenAPI file rots
 * - fails the build.
 */

export type HttpMethod = 'get' | 'post' | 'patch' | 'put' | 'delete';

export interface RouteResponseContract {
  status: number;
  description: string;
  /** Response body schema. Absent for 204 and for the FHIR surface. */
  schema?: z.ZodType;
  /** Overrides `application/json`. */
  mediaType?: string;
}

export interface PathParameterContract {
  name: string;
  description: string;
  schema: z.ZodType;
}

export interface RouteContract {
  method: HttpMethod;
  /** OpenAPI-style path with braced parameters, e.g. `/bff/v0/patients/{id}`. */
  path: string;
  operationId: string;
  summary: string;
  description?: string;
  tags: string[];
  /** The capability the route requires. Absent means the route is public. */
  permission?: Permission;
  pathParams?: PathParameterContract[];
  query?: z.ZodType;
  body?: z.ZodType;
  responses: RouteResponseContract[];
}

/** Converts `/bff/v0/patients/{id}` to the Hono form `/bff/v0/patients/:id`. */
export function toHonoPath(openApiPath: string): string {
  return openApiPath.replace(/\{(?<name>[^}]+)\}/g, ':$<name>');
}
