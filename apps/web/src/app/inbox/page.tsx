import type { Metadata } from 'next';

import { InboxScreen } from './InboxScreen';

/**
 * The typed inbox (canon C13 plus guidelines section 3.3). Owned by the inbox screen agent.
 *
 * The route file is a server component and owns metadata only. The screen is a
 * client component because @openrunic/ui components use React state, which the
 * react-server condition does not provide. Keep this split on every route.
 */
export const metadata: Metadata = { title: 'Inbox' };

export default function InboxPage() {
  return <InboxScreen />;
}
