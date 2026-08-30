import type { Metadata } from 'next';

import { pageMetadata } from '@/lib/i18n/metadata';

import { OrdersScreen } from './OrdersScreen';

/**
 * OR-03 Orders list and tracking. Owned by the orders screen agent.
 *
 * The route file is a server component and owns metadata only. The screen is a
 * client component because @openrunic/ui components use React state, which the
 * react-server condition does not provide. Keep this split on every route.
 */
export function generateMetadata(): Promise<Metadata> {
  return pageMetadata({ titleKey: 'orders.page.title' });
}

export default function OrdersPage() {
  return <OrdersScreen />;
}
