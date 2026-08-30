import type { Metadata } from 'next';

import { pageMetadata } from '@/lib/i18n/metadata';

import { PaymentsScreen } from './PaymentsScreen';

/** BL-02 checkout payment and BL-06 allocation, on one desk. */
export function generateMetadata(): Promise<Metadata> {
  return pageMetadata({
    titleKey: 'billing.payments.page.title',
    descriptionKey: 'billing.payments.page.description',
  });
}

export default function PaymentsPage() {
  return <PaymentsScreen />;
}
