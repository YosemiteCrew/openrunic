import type { Metadata } from 'next';

import { pageMetadata } from '@/lib/i18n/metadata';

import { helpTopicFrom } from '@/components/assistant/help';

import { AssistantScreen } from './AssistantScreen';

export function generateMetadata(): Promise<Metadata> {
  return pageMetadata({
    titleKey: 'portal.assistant.page.title',
    descriptionKey: 'portal.assistant.page.description',
  });
}

export default async function AssistantPage({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  const { about } = await searchParams;
  return <AssistantScreen about={helpTopicFrom(Array.isArray(about) ? about[0] : about)} />;
}
