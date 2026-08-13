'use client';

import { IconButton } from '@openrunic/ui';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactElement } from 'react';

import { chartPatientIdFromPath } from '@/lib/agent';
import type { AgentModelIdentity } from '@/lib/agent';

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
  const { availability, capabilities, isOpen, close, runTurn } = useAssistant();
  const pathname = usePathname();
  const chartPatientId = chartPatientIdFromPath(pathname);
  const { state, ask, stop } = useConversation(runTurn, chartPatientId);
  const fieldRef = useRef<HTMLDivElement>(null);

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

  if (availability.status !== 'enabled' || capabilities === null || !isOpen) return null;

  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    close();
  };

  return (
    <aside
      id={ASSISTANT_PANEL_ID}
      className="or-assistant"
      aria-label="Assistant"
      onKeyDown={onKeyDown}
    >
      <header className="or-assistant__head">
        <h2 className="or-h3">Assistant</h2>
        <IconButton icon="x" label="Close the assistant" onClick={close} />
      </header>

      {/* The standing disclosure, above the composer rather than behind a
          link. It is what the surface asserts about itself, and the turn
          request records that it was on screen. */}
      <p className="or-caption or-assistant__purpose">
        Documentation support. It finds what is already in the record and shows what each answer was
        drawn from. It does not advise, does not rank, and does not say what is urgent.
      </p>
      <ModelLine model={capabilities.model} />
      {chartPatientId === undefined ? null : (
        <p className="or-caption or-assistant__scope">
          Answers are limited to the chart you have open.
        </p>
      )}

      <details className="or-assistant__capabilities">
        <summary className="or-caption">
          What it can reach here ({capabilities.tools.length})
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
        {announcementFor(state)}
      </output>

      <div className="or-assistant__transcript">
        {state.turns.length === 0 ? (
          <p className="or-body or-assistant__intro">
            Ask about the record in front of you. Every answer shows the rows it was drawn from, and
            you can open each one.
          </p>
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
  return (
    <p className="or-caption or-assistant__model">
      Answers come from <span className="or-mono">{model.modelId}</span> at{' '}
      <span className="or-mono">{model.endpointHost}</span>.{' '}
      {model.dataLeavesDeployment
        ? 'What you type here leaves this deployment and is sent to that endpoint.'
        : 'Nothing you type here leaves this deployment.'}
    </p>
  );
}
