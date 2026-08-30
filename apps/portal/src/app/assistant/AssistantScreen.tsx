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
import { useTranslator } from '@/lib/i18n/messages';
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
  const t = useTranslator();
  const load = useCallback(() => api.getPatient(), [api]);
  const { state, reload } = useAsync(load);

  return (
    <>
      <PageHeader
        overline={t('portal.assistant.overline')}
        title={t('portal.assistant.title')}
        lede={t('portal.assistant.lede')}
      />

      {/* Above the box, always. A note under it is read after the question has
          been written and usually after it has been sent. */}
      <Notice title={t('portal.assistant.notice.title')}>
        {t('portal.assistant.notice.body')}
      </Notice>

      <ServiceLine capabilities={capabilities} />

      <AsyncBoundary
        state={state}
        loadingKey="portal.assistant.async.loading"
        errorKey="portal.assistant.async.error"
        onRetry={reload}
      >
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
  const t = useTranslator();
  const { runTurn } = useAssistant();
  const { state, ask, stop } = useConversation(runTurn, chartPatientId);

  return (
    <section
      className="portal-section portal-assistant"
      aria-label={t('portal.assistant.section.label')}
    >
      <details className="portal-assistant__reach">
        <summary>{t('portal.assistant.reach.summary')}</summary>
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
        {announcementFor(t, state)}
      </output>

      {state.turns.length === 0 ? (
        <p className="portal-assistant__intro">
          {t('portal.assistant.intro')}{' '}
          <Link href="/messages">{t('portal.assistant.intro.careTeam')}</Link>{' '}
          {t('portal.assistant.intro.forAnythingElse')}
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
  const t = useTranslator();
  const { service } = capabilities;

  /*
   * One sentence with the model and the host in it, rather than two spans set
   * into English prose. Which name comes first, and what sits between them, is
   * a decision each language makes; the emphasis the spans carried was styling
   * on two values, and a sentence that has to say where a patient's words go
   * should not need markup in the middle of it to be sayable.
   */
  return (
    <p className="portal-assistant__service">
      {t('portal.assistant.service.line', {
        model: service.modelId,
        host: service.endpointHost,
      })}{' '}
      {t(
        service.dataLeavesDeployment
          ? 'portal.assistant.service.leaves'
          : 'portal.assistant.service.stays'
      )}
    </p>
  );
}
