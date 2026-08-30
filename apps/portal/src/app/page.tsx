import type { Metadata } from 'next';

import { pageMetadata } from '@/lib/i18n/metadata';

import { HomeScreen } from './HomeScreen';

/* Server component: metadata only. The screen below it is a client component because
   @openrunic/ui ships no 'use client' directive, so a server component that imported one
   of its components directly would fail the build. */

export function generateMetadata(): Promise<Metadata> {
  return pageMetadata({
    titleKey: 'portal.home.page.title',
    descriptionKey: 'portal.home.page.description',
  });
}

export default function HomePage() {
  return <HomeScreen />;
}
