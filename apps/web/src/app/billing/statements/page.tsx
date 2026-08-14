import type { Metadata } from 'next';

import { StatementsScreen } from './StatementsScreen';

/** BL-07 Statements and patient AR, with BL-08's ageing summary above it. */
export const metadata: Metadata = {
  title: 'Statements and AR',
  description: 'Patient balances, ageing buckets, statement runs and text-to-pay.',
};

export default function StatementsPage() {
  return <StatementsScreen />;
}
