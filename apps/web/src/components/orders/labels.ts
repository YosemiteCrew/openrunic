import type { OrderCategory, OrderPriority, OrderStatus } from '@/lib/api';

/**
 * What this application calls its own order enums, as catalogue keys.
 *
 * The words used to be derived from the enum member by `formatEnumLabel`, which
 * turned `IN_PROGRESS` into "In progress" and was correct in exactly one
 * language. A derived label cannot be translated, because there is nothing for
 * a translator to open.
 *
 * Carried as `labelKey` data rather than translated here, for two reasons. The
 * words have to be looked up per render, because the reader's language is not
 * known at module scope. And `catalogue-drift.test.ts` reads `somethingKey:`
 * out of the source, so a key that is defined nowhere fails the build instead
 * of rendering as itself next to an order.
 *
 * These are labels this codebase wrote for states this codebase defined, which
 * is what makes them translatable at all. An order's name, code, destination
 * and specimen arrive from the catalogue already named and are never given a
 * second name here.
 */

export const ORDER_STATUS_LABELS: Record<OrderStatus, { labelKey: string }> = {
  PENDED: { labelKey: 'orders.status.pended' },
  SIGNED: { labelKey: 'orders.status.signed' },
  TRANSMITTED: { labelKey: 'orders.status.transmitted' },
  IN_PROGRESS: { labelKey: 'orders.status.inProgress' },
  RESULTED: { labelKey: 'orders.status.resulted' },
  CANCELLED: { labelKey: 'orders.status.cancelled' },
};

export const ORDER_PRIORITY_LABELS: Record<OrderPriority, { labelKey: string }> = {
  ROUTINE: { labelKey: 'orders.priority.routine' },
  URGENT: { labelKey: 'orders.priority.urgent' },
  STAT: { labelKey: 'orders.priority.stat' },
};

export const ORDER_CATEGORY_LABELS: Record<OrderCategory, { labelKey: string }> = {
  LAB: { labelKey: 'orders.category.lab' },
  IMAGING: { labelKey: 'orders.category.imaging' },
  PROCEDURE: { labelKey: 'orders.category.procedure' },
};
