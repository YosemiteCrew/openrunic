import type { Metadata } from 'next';

import { RemittanceScreen } from './RemittanceScreen';

/** BL-05 ERA posting (remittance workbench). */
export const metadata: Metadata = {
  title: 'Remittance',
  description: 'Post the 835s, then work only what did not match.',
};

export default function RemittancePage() {
  return <RemittanceScreen />;
}
