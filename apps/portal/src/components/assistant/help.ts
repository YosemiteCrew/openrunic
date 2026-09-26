import type { AssistantCapabilities } from '@/lib/assistant';

/**
 * Which portal screens offer to hand a question to the assistant, and what they
 * offer to ask.
 *
 * A topic names the one capability that can answer it. A screen whose topic the
 * practice has not granted offers nothing, rather than a link to an assistant
 * that would then have to say it cannot look.
 *
 * The question is written into the box and stops there. It is a suggestion the
 * reader can read, change or delete, and only the same press that sends any
 * other question sends it.
 */
export type HelpTopic = 'visits' | 'bills';

interface HelpTopicEntry {
  capability: string;
  questionKey: string;
}

const HELP_TOPICS: Readonly<Record<HelpTopic, HelpTopicEntry>> = {
  visits: {
    capability: 'visits.list',
    questionKey: 'portal.assistant.help.visits.question',
  },
  bills: {
    capability: 'bills.list',
    questionKey: 'portal.assistant.help.bills.question',
  },
};

/** The topic a query value names, or null for anything else. */
export function helpTopicFrom(value: string | null | undefined): HelpTopic | null {
  return value === 'visits' || value === 'bills' ? value : null;
}

/** True when this reader's assistant was granted the capability that answers the topic. */
export function helpTopicGranted(capabilities: AssistantCapabilities, topic: HelpTopic): boolean {
  const { capability } = HELP_TOPICS[topic];
  return capabilities.capabilities.some((entry) => entry.id === capability);
}

/** The catalogue key of the question a topic suggests. */
export function helpQuestionKey(topic: HelpTopic): string {
  return HELP_TOPICS[topic].questionKey;
}

/** Where a screen sends somebody who wants to ask about its topic. */
export function helpHref(topic: HelpTopic): string {
  return `/assistant?about=${topic}`;
}
