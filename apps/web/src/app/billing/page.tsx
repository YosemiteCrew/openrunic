import type { Metadata } from 'next';

import { BillingScreen } from './BillingScreen';

/**
 * The billing area's front door. The five workbenches live under it:
 * /billing/charges, /claims, /remittance, /statements and /payments.
 *
 * The route file is a server component and owns metadata only. The screen is a
 * client component because @openrunic/ui components use React state, which the
 * react-server condition does not provide. Keep this split on every route.
 */
export const metadata: Metadata = {
  title: 'Billing',
  description: 'Where the money is today, and the workbench that moves it.',
};

export default function BillingPage() {
  return <BillingScreen />;
}
