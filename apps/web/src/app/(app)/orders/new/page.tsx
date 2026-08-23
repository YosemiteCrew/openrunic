import type { Metadata } from 'next';

import { NewOrderScreen } from './NewOrderScreen';

/**
 * OR-01 Order composer. Owned by the orders and results screen agent.
 *
 * The route file is a server component and owns metadata only. The screen is a
 * client component because @openrunic/ui components use React state, which the
 * react-server condition does not provide. Keep this split on every route.
 */
export const metadata: Metadata = { title: 'New order' };

export default function NewOrderPage() {
  return <NewOrderScreen />;
}
