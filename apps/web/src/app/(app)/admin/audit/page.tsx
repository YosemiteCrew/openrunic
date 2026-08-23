import type { Metadata } from 'next';

import { AuditScreen } from './AuditScreen';

/**
 * AD-06 Audit viewer.
 *
 * The route file is a server component and owns metadata only. The screen is a
 * client component because @openrunic/ui components use React state, which the
 * react-server condition does not provide. Keep this split on every route.
 */
export const metadata: Metadata = { title: 'Audit trail' };

export default function AuditPage() {
  return <AuditScreen />;
}
