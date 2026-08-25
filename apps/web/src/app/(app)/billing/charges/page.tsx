import type { Metadata } from 'next';

import { pageMetadata } from '@/lib/i18n/metadata';

import { ChargesScreen } from './ChargesScreen';

/**
 * BL-01 Fee sheet (charge capture).
 *
 * Server component, metadata only. The screen is a client component because
 * @openrunic/ui uses React state, which the react-server condition does not
 * provide.
 */
export function generateMetadata(): Promise<Metadata> {
  return pageMetadata({
    titleKey: 'billing.charges.page.title',
    descriptionKey: 'billing.charges.page.description',
  });
}

export default function ChargesPage() {
  return <ChargesScreen />;
}
