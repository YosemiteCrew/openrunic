import { clinicalSpecs } from './clinical.js';
import { contactIntakeOutboxSpec, contactIntakeSpec } from './contact.js';
import { coreSpecs } from './core.js';
import { financialSpecs } from './financial.js';
import { inventorySpecs } from './inventory.js';
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
  ...inventorySpecs,
  ...platformSpecs,
  contactIntakes: contactIntakeSpec,
  contactIntakeOutboxes: contactIntakeOutboxSpec,
} as const;

export {
  clinicalSpecs,
  contactIntakeOutboxSpec,
  contactIntakeSpec,
  coreSpecs,
  financialSpecs,
  inventorySpecs,
  orderSpecs,
  platformSpecs,
};
