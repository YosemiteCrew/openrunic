import type { AdapterRegistry } from '@openrunic/adapters';
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
import { qualityRouteContracts, qualityRoutes, type QualityRouteOptions } from './quality.js';
import { sessionRouteContracts, sessionRoutes } from './session.js';
import { telehealthRouteContracts, telehealthRoutes } from './telehealth.js';

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

export interface InternalRouteOptions {
  /** Quality reporting limits; see `routes/quality.ts`. */
  quality?: QualityRouteOptions;
  /**
   * The clock, threaded from `createApp` exactly as `fhirRoutes` already takes
   * it. `CreateAppOptions.now` has existed and been injected by every test for
   * as long as the FHIR routes have consumed it; the BFF routers were never
   * passed it, so every handler under this mount reads the wall clock and no
   * test can say when "now" is.
   *
   * Threading it is not the same as consuming it, and a router that takes this
   * and ignores it is worse than one that never had it - so only the handlers
   * that read it take it, and each one is a change with a test behind it.
   */
  now: () => Date;
  /**
   * Partner seams. Passed in rather than resolved here because the routes that
   * use one are the only routes that should know a registry exists.
   */
  adapters: AdapterRegistry;
}

export function internalRoutes(options: InternalRouteOptions): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  router.route('/', patientRoutes());
  router.route('/', appointmentRoutes());
  router.route('/', clinicalRoutes(options.adapters));
  router.route('/', orderRoutes());
  router.route('/', financialRoutes({ now: options.now }));
  router.route('/', inventoryRoutes());
  router.route('/', platformRoutes());
  router.route('/', qualityRoutes(options.quality));
  router.route('/', sessionRoutes());
  router.route('/', telehealthRoutes(options.adapters));

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
    ...qualityRouteContracts(),
    ...sessionRouteContracts(),
    ...telehealthRouteContracts(),
  ];
}
