import type { Metadata } from 'next';

import { pageMetadata } from '@/lib/i18n/metadata';

import { HealthRecordScreen } from './HealthRecordScreen';

export function generateMetadata(): Promise<Metadata> {
  return pageMetadata({
    titleKey: 'portal.healthRecord.page.title',
    descriptionKey: 'portal.healthRecord.page.description',
  });
}

export default function HealthRecordPage() {
  return <HealthRecordScreen />;
}
