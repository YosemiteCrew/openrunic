import type { Metadata } from 'next';

import { pageMetadata } from '@/lib/i18n/metadata';

import { FlowBoardScreen } from './FlowBoardScreen';

/**
 * FD-03 Patient Flow Board. Owned by the schedule and front desk screen agent.
 *
 * The route file is a server component and owns metadata only. The screen is a
 * client component because @openrunic/ui components use React state, which the
 * react-server condition does not provide. Keep this split on every route.
 */
export function generateMetadata(): Promise<Metadata> {
  return pageMetadata({ titleKey: 'schedule.flowBoard.page.title' });
}

export default function FlowBoardPage() {
  return <FlowBoardScreen />;
}
