import type { Metadata } from 'next';

import { pageMetadata } from '@/lib/i18n/metadata';

import { BillsScreen } from './BillsScreen';

export function generateMetadata(): Promise<Metadata> {
  return pageMetadata({
    titleKey: 'portal.bills.page.title',
    descriptionKey: 'portal.bills.page.description',
  });
}

export default function BillsPage() {
  return <BillsScreen />;
}
