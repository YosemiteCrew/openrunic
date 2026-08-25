import type { Metadata } from 'next';

import { pageMetadata } from '@/lib/i18n/metadata';

import { MessagesScreen } from './MessagesScreen';

export function generateMetadata(): Promise<Metadata> {
  return pageMetadata({
    titleKey: 'portal.messages.page.title',
    descriptionKey: 'portal.messages.page.description',
  });
}

export default function MessagesPage() {
  return <MessagesScreen />;
}
