import type { Metadata } from 'next';

import { PatientsScreen } from './PatientsScreen';

/**
 * FD-06 Patient search and registration. Owned by the patients screen agent.
 *
 * The route file is a server component and owns metadata only. The screen is a
 * client component because @openrunic/ui components use React state, which the
 * react-server condition does not provide. Keep this split on every route.
 */
export const metadata: Metadata = { title: 'Patients' };

export default function PatientsPage() {
  return <PatientsScreen />;
}
