import type { Metadata } from 'next';

import { ClaimsScreen } from './ClaimsScreen';

/** BL-03 Claim workbench, with BL-04 claim detail in its drawer. */
export const metadata: Metadata = {
  title: 'Claim workbench',
  description: 'Every claim as a state ledger row, from captured to paid.',
};

export default function ClaimsPage() {
  return <ClaimsScreen />;
}
