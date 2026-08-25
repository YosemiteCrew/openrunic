import type { Metadata } from 'next';

import { pageMetadata } from '@/lib/i18n/metadata';

import { AppointmentsScreen } from './AppointmentsScreen';

export function generateMetadata(): Promise<Metadata> {
  return pageMetadata({
    titleKey: 'portal.appointments.page.title',
    descriptionKey: 'portal.appointments.page.description',
  });
}

export default function AppointmentsPage() {
  return <AppointmentsScreen />;
}
