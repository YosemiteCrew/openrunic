'use client';

/**
 * An offer, on the screen a question is about, to ask the assistant about it.
 *
 * Nothing at all is drawn until the probe has said the assistant is on and the
 * practice granted the capability that answers this topic. The same rule as the
 * navigation: no screen reserves space for a feature most deployments will not
 * have, and an offer that could only lead to "I cannot look at that" is not one.
 */

import Link from 'next/link';
import { useTranslator } from '@/lib/i18n/messages';
import { useAssistant } from './AssistantProvider';
import { helpHref, helpTopicGranted } from './help';
import type { HelpTopic } from './help';

const COPY_KEYS: Readonly<Record<HelpTopic, { lead: string; link: string }>> = {
  visits: {
    lead: 'portal.assistant.help.visits.lead',
    link: 'portal.assistant.help.visits.link',
  },
  bills: {
    lead: 'portal.assistant.help.bills.lead',
    link: 'portal.assistant.help.bills.link',
  },
};

export interface AssistantHelpProps {
  topic: HelpTopic;
}

export function AssistantHelp({ topic }: Readonly<AssistantHelpProps>) {
  const t = useTranslator();
  const { availability } = useAssistant();

  if (availability.status !== 'enabled') return null;
  if (!helpTopicGranted(availability.capabilities, topic)) return null;

  const copy = COPY_KEYS[topic];
  return (
    <p className="portal-assistant-help">
      {t(copy.lead)} <Link href={helpHref(topic)}>{t(copy.link)}</Link>
    </p>
  );
}
