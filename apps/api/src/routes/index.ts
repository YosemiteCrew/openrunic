import { Hono } from 'hono';

import type { AppEnv } from '../context.js';
import type { RouteContract } from '../openapi/registry.js';

import { appointmentRouteContracts, appointmentRoutes } from './appointments.js';
import { stubRouteContracts, stubRoutes } from './not-implemented.js';
import { patientRouteContracts, patientRoutes } from './patients.js';

/**
 * The internal API, one router per aggregate mounted from one line each.
 *
 * Routers are separate files on purpose: `apps/api`'s route registry is a
 * known high-collision surface once nine workstreams are building at once
 * (plan section 7), and a one-line mount is the smallest merge conflict a
 * workstream can create.
 */

/** Unstable and first-party. The stable public contract is FHIR R4. */
export const BFF_BASE_PATH = '/bff/v0';

export function internalRoutes(): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  router.route('/', patientRoutes());
  router.route('/', appointmentRoutes());
  router.route('/', stubRoutes());

  return router;
}

/** Every internal route contract, in the order the OpenAPI document lists them. */
export function internalRouteContracts(): RouteContract[] {
  return [...patientRouteContracts, ...appointmentRouteContracts, ...stubRouteContracts()];
}
