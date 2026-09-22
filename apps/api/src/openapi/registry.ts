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
  /**
   * The capability the route requires.
   *
   * Absent is not "public" and not "no capability": it is UNDECIDED, and
   * `openapi.test.ts` refuses it. A route that genuinely needs none says so with
   * `authenticatedOnly`, because the two states used to be the same value and a
   * route nobody had thought about was indistinguishable from one deliberately
   * left open.
   */
  permission?: Permission;
  /**
   * The route requires a bearer token and no capability.
   *
   * Every principal may call it, and what it answers is about the caller rather
   * than about the practice - `/bff/v0/me` is the case it exists for. Declaring
   * it is what separates "decided: none" from "not decided", and it is emitted
   * into the document so a reader is told which one this is.
   */
  authenticatedOnly?: true;
  /**
   * Further capabilities the route ALSO requires, all of them.
   *
   * For a route that answers with data belonging to two boundaries at once. The
   * growth chart is the case: the readings are `encounter.read` and the sex and
   * birth date it plots them against are `patient.read`, and publishing only one
   * of the two would describe a door that is narrower than it looks.
   */
  alsoRequires?: readonly Permission[];
  pathParams?: PathParameterContract[];
  query?: z.ZodType;
  body?: z.ZodType;
  responses: RouteResponseContract[];
}

/**
 * Converts `/bff/v0/patients/{id}` to the Hono form `/bff/v0/patients/:id`.
 *
 * The name class excludes the opening brace as well as the closing one. With
 * `[^}]+` a parameter name was allowed to swallow a `{`, so an attempt that
 * began at one brace and found no `}` ran to the end of the string before
 * failing, and the global scan restarted that run at every subsequent brace:
 * quadratic in the number of braces. Excluding `{` stops a failed attempt at
 * the next brace instead, which is linear.
 *
 * Excluding it is also the stricter reading of the OpenAPI path template, where
 * a parameter name cannot contain a brace, so `{{a}` is a malformed path rather
 * than a parameter named `{a`.
 */
export function toHonoPath(openApiPath: string): string {
  return openApiPath.replace(/\{(?<name>[^{}]+)\}/g, ':$<name>');
}
