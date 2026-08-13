import { clinicalSpecs } from './clinical.js';
import { coreSpecs } from './core.js';
import { financialSpecs } from './financial.js';
import { orderSpecs } from './orders.js';
import { platformSpecs } from './platform.js';

/**
 * Every aggregate the API can reach, in one map.
 *
 * This is the only list. `Repositories` is derived from it, both storage
 * implementations iterate it, and the cross-tenant suite enumerates it, so an
 * aggregate cannot exist in one of those three places and be missing from
 * another. Adding one is a single line here plus its spec.
 */
export const COLLECTION_SPECS = {
  ...coreSpecs,
  ...clinicalSpecs,
  ...orderSpecs,
  ...financialSpecs,
  ...platformSpecs,
} as const;

export { clinicalSpecs, coreSpecs, financialSpecs, orderSpecs, platformSpecs };
