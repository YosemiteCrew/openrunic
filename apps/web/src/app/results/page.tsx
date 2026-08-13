import type { Metadata } from 'next';

import { ResultsScreen } from './ResultsScreen';

/**
 * OR-04 Results inbox. Owned by the results screen agent.
 *
 * The route file is a server component and owns metadata only. The screen is a
 * client component because @openrunic/ui components use React state, which the
 * react-server condition does not provide. Keep this split on every route.
 */
export const metadata: Metadata = { title: 'Results' };

export default function ResultsPage() {
  return <ResultsScreen />;
}
