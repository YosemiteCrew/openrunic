import type { Metadata } from 'next';

import { pageMetadata } from '@/lib/i18n/metadata';

import { StatementsScreen } from './StatementsScreen';

/** BL-07 Statements and patient AR, with BL-08's ageing summary above it. */
export function generateMetadata(): Promise<Metadata> {
  return pageMetadata({
    titleKey: 'billing.statements.page.title',
    descriptionKey: 'billing.statements.page.description',
  });
}

export default function StatementsPage() {
  return <StatementsScreen />;
}
