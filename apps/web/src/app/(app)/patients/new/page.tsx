import type { Metadata } from 'next';

import { pageMetadata } from '@/lib/i18n/metadata';

import { RegisterPatientScreen } from './RegisterPatientScreen';

/**
 * FD-06 New patient registration. Owned by the schedule and front desk agent.
 *
 * The route file is a server component and owns metadata only. The screen is a
 * client component because @openrunic/ui components use React state, which the
 * react-server condition does not provide. Keep this split on every route.
 */
export function generateMetadata(): Promise<Metadata> {
  return pageMetadata({ titleKey: 'patients.new.page.title' });
}

export default function RegisterPatientPage() {
  return <RegisterPatientScreen />;
}
