import type { Metadata } from 'next';

import { OrdersScreen } from './OrdersScreen';

/**
 * OR-03 Orders list and tracking. Owned by the orders screen agent.
 *
 * The route file is a server component and owns metadata only. The screen is a
 * client component because @openrunic/ui components use React state, which the
 * react-server condition does not provide. Keep this split on every route.
 */
export const metadata: Metadata = { title: 'Orders' };

export default function OrdersPage() {
  return <OrdersScreen />;
}
