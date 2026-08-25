import type { Metadata } from 'next';

import { pageMetadata } from '@/lib/i18n/metadata';

import { RemittanceScreen } from './RemittanceScreen';

/** BL-05 ERA posting (remittance workbench). */
export function generateMetadata(): Promise<Metadata> {
  return pageMetadata({
    titleKey: 'billing.remittance.page.title',
    descriptionKey: 'billing.remittance.page.description',
  });
}

export default function RemittancePage() {
  return <RemittanceScreen />;
}
