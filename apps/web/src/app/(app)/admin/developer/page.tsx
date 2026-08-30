import type { Metadata } from 'next';

import { pageMetadata } from '@/lib/i18n/metadata';

import { DeveloperScreen } from './DeveloperScreen';

/**
 * DV-01 to DV-03 developer platform.
 *
 * The route file is a server component and owns metadata only. The screen is a
 * client component because @openrunic/ui components use React state, which the
 * react-server condition does not provide. Keep this split on every route.
 */
export function generateMetadata(): Promise<Metadata> {
  return pageMetadata({ titleKey: 'admin.developer.page.title' });
}

export default function DeveloperPage() {
  return <DeveloperScreen />;
}
