import type { Metadata } from 'next';

import { PaymentsScreen } from './PaymentsScreen';

/** BL-02 checkout payment and BL-06 allocation, on one desk. */
export const metadata: Metadata = {
  title: 'Payments',
  description: 'Take a payment, allocate it across visits, and issue the receipt.',
};

export default function PaymentsPage() {
  return <PaymentsScreen />;
}
