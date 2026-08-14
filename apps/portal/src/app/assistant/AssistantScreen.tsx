'use client';

/**
 * The assistant, as a section of the portal rather than as a bubble over it.
 *
 * The staff app puts it in a column beside the chart, because a clinician is
 * mid-task and the chart has to stay readable underneath. A patient is not
 * mid-task: they came to ask something. So it is a page like every other
 * section here, reached from the same navigation, with the same header and the
 * same voice, and there is no floating control fighting the tab bar for the
 * bottom of a phone.
 *
 * **It does not exist unless the practice configured one.** The probe answers
 * once per app load, and until it has answered this renders nothing at all: no
 * spinner, no skeleton, no "checking". Once it has answered `absent` - which
 * covers unconfigured, signed out, broken and unreadable alike - the route is a
 * 404, the same answer a patient would get for any address that is not part of
 * their portal. There is no disabled state and no explanatory empty screen,
 * because a page that exists only to say a feature does not is still a feature.
 *
 * **It will not ask anything until it knows whose record it is.** The question
 * carries the reader's own chart, and a turn with no chart bound is refused by
 * the capability itself before it reads a row. It cannot change which chart a
 * turn reads: a portal session is patient-scoped, so the API binds the turn to
 * the chart on the token and does not consult this field at all. It is sent
 * because the same route serves the staff surface, and because it is what binds
 * a turn on any session whose token named no chart. So the box does not appear
 * until the record has loaded, and a record that fails to load leaves the
 * ordinary portal error in its place.
 */

import { useCallback } from 'react';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { AsyncBoundary } from '@/components/AsyncBoundary';
import { Notice } from '@/components/Notice';
import { PageHeader } from '@/components/PageHeader';
import { AssistantComposer } from '@/components/assistant/AssistantComposer';
import { useAssistant } from '@/components/assistant/AssistantProvider';
import { AssistantTurnView } from '@/components/assistant/AssistantTurn';
import { announcementFor } from '@/components/assistant/transcript';
import { useConversation } from '@/components/assistant/useConversation';
import { getPortalApi } from '@/lib/api';
import type { PortalApi } from '@/lib/api/types';
import type { AssistantCapabilities } from '@/lib/assistant';
import { useAsync } from '@/lib/useAsync';

export interface AssistantScreenProps {
  api?: PortalApi;
}

export function AssistantScreen({ api = getPortalApi() }: Readonly<AssistantScreenProps>) {
  const { availability, settled } = useAssistant();

  /* Nothing while the answer is still coming. Guessing either way is worse:
     guessing present flashes an assistant at a practice that has none, and
     guessing absent 404s every first load. */
  if (!settled) return null;

  if (availability.status !== 'enabled') {
    notFound();
    return null;
  }

  return <ConfiguredAssistant api={api} capabilities={availability.capabilities} />;
}

interface ConfiguredAssistantProps {
  api: PortalApi;
  capabilities: AssistantCapabilities;
}

function ConfiguredAssistant({ api, capabilities }: Readonly<ConfiguredAssistantProps>) {
  const load = useCallback(() => api.getPatient(), [api]);
  const { state, reload } = useAsync(load);

  return (
    <>
      <PageHeader
        overline="Your record"
        title="Assistant"
        lede="Ask a question about what your care team has written down, and see the records each answer came from."
      />

      {/* Above the box, always. A note under it is read after the question has
          been written and usually after it has been sent. */}
      <Notice title="What this can and cannot do">
        It looks things up in your own record and shows you where each answer came from. It cannot
        tell you what something means, whether it matters, or what to do next. For those, message
        your care team. For a medical emergency, call the emergency services on your local number.
      </Notice>

      <ServiceLine capabilities={capabilities} />

      <AsyncBoundary state={state} what="your record" onRetry={reload}>
        {(patient) => <Conversation capabilities={capabilities} chartPatientId={patient.id} />}
      </AsyncBoundary>
    </>
  );
}

interface ConversationProps {
  capabilities: AssistantCapabilities;
  chartPatientId: string;
}

function Conversation({ capabilities, chartPatientId }: Readonly<ConversationProps>) {
  const { runTurn } = useAssistant();
  const { state, ask, stop } = useConversation(runTurn, chartPatientId);

  return (
    <section className="portal-section portal-assistant" aria-label="Assistant">
      <details className="portal-assistant__reach">
        <summary>What it is allowed to look at</summary>
        <ul className="portal-inline-list">
          {capabilities.capabilities.map((capability) => (
            <li key={capability.id}>{capability.summary}</li>
          ))}
        </ul>
      </details>

      {/* Not a live region over the arriving words: a screen reader would
          restart the answer on every one of them. One short sentence per state
          change instead. */}
      <output aria-live="polite" className="portal-visually-hidden">
        {announcementFor(state)}
      </output>

      {state.turns.length === 0 ? (
        <p className="portal-assistant__intro">
          Ask about something already written down, such as when your next appointment is, what
          medicines are on your record, or what is left to pay. Every answer shows the records
          behind it, and you can open each one.{' '}
          <Link href="/messages">Write to your care team</Link> for anything else.
        </p>
      ) : (
        <ol className="portal-assistant__turns">
          {state.turns.map((turn, index) => (
            <AssistantTurnView
              answering={state.answering && index === state.turns.length - 1}
              key={turn.id}
              turn={turn}
            />
          ))}
        </ol>
      )}

      <AssistantComposer answering={state.answering} onAsk={ask} onStop={stop} />
    </section>
  );
}

/**
 * Which service answers, and whether asking it sends anything out of the
 * practice.
 *
 * ADR-0005 restates the no-telemetry promise as: the product says plainly, in
 * the product, when a deployer has configured an external endpoint. This is
 * that sentence, and it is on this page rather than in a settings screen
 * because the person whose words are being sent is the one reading here.
 */
function ServiceLine({ capabilities }: Readonly<{ capabilities: AssistantCapabilities }>) {
  const { service } = capabilities;

  return (
    <p className="portal-assistant__service">
      Your practice uses a computer service to write these answers. It is called{' '}
      <span className="portal-assistant__service-name">{service.modelId}</span> and it runs at{' '}
      <span className="portal-assistant__service-name">{service.endpointHost}</span>.{' '}
      {service.dataLeavesDeployment
        ? 'What you type here is sent out of your practice to that service. Your practice chose it and holds the agreement with it.'
        : "What you type here stays on the practice's own computers and is not sent anywhere else."}
    </p>
  );
}
