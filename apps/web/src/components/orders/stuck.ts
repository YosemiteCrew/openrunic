import type { Order } from '@/lib/api';

/** Past this, a transmitted order that nobody has acknowledged is stuck. */
export const STUCK_AFTER_MINUTES = 24 * 60;

/**
 * An order the interface has stopped moving.
 *
 * Only TRANSMITTED can go stale: every other status is either still the
 * clinic's move or already finished, and calling those stuck would train people
 * to ignore the warning.
 */
export function isStuck(order: Order, now: string): boolean {
  if (order.status !== 'TRANSMITTED') return false;
  const minutes = (new Date(now).getTime() - new Date(order.lastEventAt).getTime()) / 60_000;
  return minutes > STUCK_AFTER_MINUTES;
}
