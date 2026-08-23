import type { Metadata } from 'next';

import { RegisterPatientScreen } from './RegisterPatientScreen';

/**
 * FD-06 New patient registration. Owned by the schedule and front desk agent.
 *
 * The route file is a server component and owns metadata only. The screen is a
 * client component because @openrunic/ui components use React state, which the
 * react-server condition does not provide. Keep this split on every route.
 */
export const metadata: Metadata = { title: 'Register patient' };

export default function RegisterPatientPage() {
  return <RegisterPatientScreen />;
}
