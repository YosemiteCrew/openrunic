import type { Metadata } from 'next';

import { DeveloperScreen } from './DeveloperScreen';

/**
 * DV-01 to DV-03 developer platform.
 *
 * The route file is a server component and owns metadata only. The screen is a
 * client component because @openrunic/ui components use React state, which the
 * react-server condition does not provide. Keep this split on every route.
 */
export const metadata: Metadata = { title: 'Developer platform' };

export default function DeveloperPage() {
  return <DeveloperScreen />;
}
