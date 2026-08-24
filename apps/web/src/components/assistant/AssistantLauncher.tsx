'use client';

import { useMemo } from 'react';
import type { ReactElement } from 'react';

import { useRegisterCommands } from '@/components/command';
import type { Command } from '@/components/command';
import { useTranslator } from '@/lib/i18n/messages';

import { useAssistant } from './AssistantProvider';
import { ASSISTANT_PANEL_ID } from './AssistantPanel';

/**
 * The one way into the assistant, in the top bar beside the command control.
 *
 * It renders nothing at all when no assistant is configured. Not a disabled
 * button, not a tooltip explaining what is missing: a control that exists only
 * to say a feature does not is still a feature in the interface, and ADR-0005
 * asks for the unconfigured product to be the one a clinic had before.
 *
 * It also registers the palette command, so the panel is reachable by typing
 * rather than only by finding a button - the same contract every other action
 * in this app holds.
 */
export function AssistantLauncher(): ReactElement | null {
  const t = useTranslator();
  const { availability, isOpen, open, close } = useAssistant();
  const enabled = availability.status === 'enabled';

  const commands = useMemo<Command[]>(
    () =>
      enabled
        ? [
            {
              id: 'assistant.open',
              group: 'actions',
              label: t('assistant.command.open'),
              icon: 'message-circle',
              /* Per-language search words, comma separated in the catalogue:
                 somebody searching in another language does not type "ask". */
              keywords: t('assistant.command.open.keywords')
                .split(',')
                .map((word) => word.trim())
                .filter((word) => word !== ''),
              perform: open,
            },
          ]
        : [],
    [enabled, open, t]
  );

  useRegisterCommands(commands);

  if (!enabled) return null;

  return (
    <button
      type="button"
      className="or-topbar__command or-assistant__launch"
      aria-expanded={isOpen}
      /* Only while the panel is on screen: `aria-controls` naming an element
         that is not in the document is a broken reference, not a hint. */
      {...(isOpen ? { 'aria-controls': ASSISTANT_PANEL_ID } : {})}
      onClick={isOpen ? close : open}
    >
      {t('assistant.name')}
    </button>
  );
}
