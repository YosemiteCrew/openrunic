import type { Metadata } from 'next';

import { ChargesScreen } from './ChargesScreen';

/**
 * BL-01 Fee sheet (charge capture).
 *
 * Server component, metadata only. The screen is a client component because
 * @openrunic/ui uses React state, which the react-server condition does not
 * provide.
 */
export const metadata: Metadata = {
  title: 'Fee sheet',
  description: 'Capture visit charges and link each one to its diagnosis.',
};

export default function ChargesPage() {
  return <ChargesScreen />;
}
