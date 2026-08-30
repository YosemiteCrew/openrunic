import type { Metadata } from 'next';

import { pageMetadata } from '@/lib/i18n/metadata';

import { ClaimsScreen } from './ClaimsScreen';

/** BL-03 Claim workbench, with BL-04 claim detail in its drawer. */
export function generateMetadata(): Promise<Metadata> {
  return pageMetadata({
    titleKey: 'billing.claims.page.title',
    descriptionKey: 'billing.claims.page.description',
  });
}

export default function ClaimsPage() {
  return <ClaimsScreen />;
}
