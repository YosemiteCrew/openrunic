import type { Metadata } from 'next';

import { ScheduleScreen } from './ScheduleScreen';

/**
 * FD-01 Schedule day view: the front door. Owned by the schedule screen agent.
 *
 * The route file is a server component and owns metadata only. The screen is a
 * client component because @openrunic/ui components use React state, which the
 * react-server condition does not provide. Keep this split on every route.
 */
export const metadata: Metadata = { title: 'Schedule' };

export default function SchedulePage() {
  return <ScheduleScreen />;
}
