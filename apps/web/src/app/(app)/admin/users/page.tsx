import type { Metadata } from 'next';

import { UsersScreen } from './UsersScreen';

/**
 * AD-01 Users and roles.
 *
 * The route file is a server component and owns metadata only. The screen is a
 * client component because @openrunic/ui components use React state, which the
 * react-server condition does not provide. Keep this split on every route.
 */
export const metadata: Metadata = { title: 'Users and roles' };

export default function UsersPage() {
  return <UsersScreen />;
}
