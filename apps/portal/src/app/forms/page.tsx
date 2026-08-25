import type { Metadata } from 'next';

import { pageMetadata } from '@/lib/i18n/metadata';

import { FormsScreen } from './FormsScreen';

export function generateMetadata(): Promise<Metadata> {
  return pageMetadata({
    titleKey: 'portal.forms.page.title',
    descriptionKey: 'portal.forms.page.description',
  });
}

export default function FormsPage() {
  return <FormsScreen />;
}
