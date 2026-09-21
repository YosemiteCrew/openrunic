'use client';

import { formatCount } from '@openrunic/i18n';
import { IconButton } from '@openrunic/ui';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import type { ReactElement } from 'react';

import { chartPatientIdFromPath } from '@/lib/agent';
import type { AgentModelIdentity } from '@/lib/agent';
import { useTranslator } from '@/lib/i18n/messages';

import { useAssistant } from './AssistantProvider';
import { AssistantComposer } from './AssistantComposer';
import { AssistantTurnView } from './AssistantTurn';
import { announcementFor } from './transcript';
import { useConversation } from './useConversation';

/**
 * The assistant panel.
 *
 * It is a dismissible column beside the chart, not a screen of its own and not
 * a modal over one. A clinician asks about what is in front of them, so what is
 * in front of them has to stay readable and stay operable; a takeover would
 * make the assistant the task instead of the thing helping with it. That is
 * also why there is no focus trap: this is a complementary landmark, Tab leaves
 * it the way it leaves any other region, and Escape dismisses it.
 *
 * The whole surface returns null unless the API said an assistant exists. There
 * is no disabled affordance, no greyed control and no "not configured" empty
 * state anywhere in the shell: ADR-0005 asks that a clinic which configured
 * nothing see the product it had before, and the only way to be sure of that is
 * to render nothing at all.
 */

export const ASSISTANT_PANEL_ID = 'or-assistant-panel';

export function AssistantPanel(): ReactElement | null {
  const t = useTranslator();
  const { availability, capabilities, isOpen, close, runTurn } = useAssistant();
  const pathname = usePathname();
  const chartPatientId = chartPatientIdFromPath(pathname);
  const { state, ask, stop } = useConversation(runTurn, chartPatientId);
  const panelRef = useRef<HTMLElement>(null);
  const fieldRef = useRef<HTMLDivElement>(null);

  const onScreen = availability.status === 'enabled' && capabilities !== null && isOpen;

  /* Focus goes to the field on open and back to whatever opened the panel on
     close. Both live in one effect so the grab and the restore cannot drift
     apart, which is the failure that leaves a keyboard user at the top of the
     document with no idea where they are. */
  useEffect(() => {
    if (!isOpen) return;
    const trigger = document.activeElement;
    fieldRef.current?.querySelector('textarea')?.focus();
    return () => {
      if (trigger instanceof HTMLElement) trigger.focus();
    };
  }, [isOpen]);

  /* Escape dismisses the panel, registered on the region rather than declared
     as a prop on it. The two drawers already write their Escape this way; the
     difference here is the node it is bound to. A drawer is modal and listens
     on the document, which is right when nothing behind it is operable. This
     panel is not modal - the chart beside it stays live, and a clinician who
     has clicked back into a note is typing in the note, where Escape means
     whatever the note says it means. Binding to the panel keeps the key inside
     the surface that owns it, which is what the `<aside>` was doing by
     catching its children's bubbles, without asking a landmark to read as
     something a person can operate. */
  useEffect(() => {
    /* `onScreen` is a dependency rather than a guard: it is what changes when
       the panel mounts and unmounts, and the ref holds the node for exactly as
       long as it is true, so the one null check below covers both. */
    const panel = panelRef.current;
    if (panel === null) return;

    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Consumed here: the innermost open surface is the one Escape closes.
      event.stopPropagation();
      close();
    };

    panel.addEventListener('keydown', dismiss);
    return () => panel.removeEventListener('keydown', dismiss);
  }, [close, onScreen]);

  if (!onScreen) return null;

  return (
    <aside
      ref={panelRef}
      id={ASSISTANT_PANEL_ID}
      className="or-assistant"
      aria-label={t('assistant.name')}
    >
      <header className="or-assistant__head">
        <h2 className="or-h3">{t('assistant.name')}</h2>
        <IconButton icon="x" label={t('assistant.close')} onClick={close} />
      </header>

      {/* The standing disclosure, above the composer rather than behind a
          link. It is what the surface asserts about itself, and the turn
          request records that it was on screen. */}
      <p className="or-caption or-assistant__purpose">{t('assistant.panel.purpose')}</p>
      <ModelLine model={capabilities.model} />
      {chartPatientId === undefined ? null : (
        <p className="or-caption or-assistant__scope">{t('assistant.panel.scope')}</p>
      )}

      <details className="or-assistant__capabilities">
        <summary className="or-caption">
          {t('assistant.panel.capabilities', {
            count: formatCount(capabilities.tools.length, t.locale),
          })}
        </summary>
        <ul>
          {capabilities.tools.map((tool) => (
            <li key={tool.id} className="or-caption">
              {tool.summary}
            </li>
          ))}
        </ul>
      </details>

      {/* Not a live region. Marking the streaming prose live would make a
          screen reader restart the answer on every token; this one short
          sentence changes once when a turn starts and once when it settles. */}
      <output aria-live="polite" className="or-visually-hidden">
        {announcementFor(t, state)}
      </output>

      <div className="or-assistant__transcript">
        {state.turns.length === 0 ? (
          <p className="or-body or-assistant__intro">{t('assistant.panel.intro')}</p>
        ) : (
          <ol className="or-assistant__turns">
            {state.turns.map((turn, index) => (
              <AssistantTurnView
                key={turn.id}
                turn={turn}
                streaming={state.streaming && index === state.turns.length - 1}
              />
            ))}
          </ol>
        )}
      </div>

      <AssistantComposer
        streaming={state.streaming}
        onAsk={ask}
        onStop={stop}
        fieldRef={fieldRef}
      />
    </aside>
  );
}

/**
 * Which endpoint answers, and whether asking it sends anything outside the
 * deployment.
 *
 * ADR-0005 restates the no-telemetry promise as: the product says plainly, in
 * the product, when a deployer has configured an external endpoint. This line
 * is that sentence. It is not in an admin screen, because the person whose text
 * is being sent is the one reading this panel.
 */
function ModelLine({ model }: Readonly<{ model: AgentModelIdentity }>): ReactElement {
  const t = useTranslator();

  /* Two whole sentences rather than a frame with the identifiers spliced into
     it. The model id and the host used to sit in their own monospace spans,
     which meant the words around them were three translatable fragments - and
     a sentence assembled from fragments cannot be translated, because the
     pieces do not stay in that order in another language. The identifiers are
     values inside the message instead, and this line loses its monospace face
     to keep its meaning. */
  return (
    <p className="or-caption or-assistant__model">
      {t('assistant.model.source', { model: model.modelId, host: model.endpointHost })}{' '}
      {model.dataLeavesDeployment ? t('assistant.model.leaves') : t('assistant.model.stays')}
    </p>
  );
}
