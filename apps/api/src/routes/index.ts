import { Hono } from 'hono';

import type { AppEnv } from '../context.js';
import type { RouteContract } from '../openapi/registry.js';

import { appointmentRouteContracts, appointmentRoutes } from './appointments.js';
import { clinicalRouteContracts, clinicalRoutes } from './clinical.js';
import { financialRouteContracts, financialRoutes } from './financial.js';
import { inventoryRouteContracts, inventoryRoutes } from './inventory.js';
import { orderRouteContracts, orderRoutes } from './orders.js';
import { patientRouteContracts, patientRoutes } from './patients.js';
import { platformRouteContracts, platformRoutes } from './platform.js';

/**
 * The internal API, one router per workstream mounted from one line each.
 *
 * Routers are separate files on purpose: the route registry is a known
 * high-collision surface once several workstreams are building at once, and a
 * one-line mount is the smallest merge conflict a workstream can create.
 *
 * The contracts list is the OpenAPI document. It is assembled from the same
 * modules in the same order, so a route and its documentation are added by the
 * same edit or by neither.
 */

/** Unstable and first-party. The stable public contract is FHIR R4. */
export const BFF_BASE_PATH = '/bff/v0';

export function internalRoutes(): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  router.route('/', patientRoutes());
  router.route('/', appointmentRoutes());
  router.route('/', clinicalRoutes());
  router.route('/', orderRoutes());
  router.route('/', financialRoutes());
  router.route('/', inventoryRoutes());
  router.route('/', platformRoutes());

  return router;
}

/** Every internal route contract, in the order the OpenAPI document lists them. */
export function internalRouteContracts(): RouteContract[] {
  return [
    ...patientRouteContracts,
    ...appointmentRouteContracts,
    ...clinicalRouteContracts(),
    ...orderRouteContracts(),
    ...financialRouteContracts(),
    ...inventoryRouteContracts(),
    ...platformRouteContracts(),
  ];
}
