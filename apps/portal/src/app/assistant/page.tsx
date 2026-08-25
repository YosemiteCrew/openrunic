import type { Metadata } from 'next';

import { pageMetadata } from '@/lib/i18n/metadata';

import { AssistantScreen } from './AssistantScreen';

export function generateMetadata(): Promise<Metadata> {
  return pageMetadata({
    titleKey: 'portal.assistant.page.title',
    descriptionKey: 'portal.assistant.page.description',
  });
}

export default function AssistantPage() {
  return <AssistantScreen />;
}
