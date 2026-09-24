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

import { useCallback, useMemo } from 'react';
import { speakableTurns, useReadback } from '@openrunic/voice';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { AsyncBoundary } from '@/components/AsyncBoundary';
import { Notice } from '@/components/Notice';
import { PageHeader } from '@/components/PageHeader';
import { AssistantComposer } from '@/components/assistant/AssistantComposer';
import { useAssistant } from '@/components/assistant/AssistantProvider';
import { AssistantReadback } from '@/components/assistant/AssistantReadback';
import { AssistantTurnView } from '@/components/assistant/AssistantTurn';
import { speakableAnswer } from '@/components/assistant/readback';
import { announcementFor } from '@/components/assistant/transcript';
import { useConversation } from '@/components/assistant/useConversation';
import { getPortalApi } from '@/lib/api';
import type { PortalApi } from '@/lib/api/types';
import type { AssistantCapabilities } from '@/lib/assistant';
import { useTranslator } from '@/lib/i18n/messages';
import { useAsync } from '@/lib/useAsync';
import { defaultMintRealtime } from '@/lib/assistant';
import { chooseCapture, createPlatformReadback } from '@/lib/voice';
import type { BrowserMedia, CapturePort, ReadbackPort, RealtimeMint } from '@/lib/voice';

export interface AssistantScreenProps {
  api?: PortalApi;
  /**
   * The voice that reads an answer aloud. Absent means no readback, which is
   * what the server render and a browser without speech both produce. Injected
   * in tests, where jsdom has no synthesiser to drive.
   */
  readback?: ReadbackPort | null;
  /**
   * The microphone a question may be dictated into. Absent means the hosted
   * service the API named, when it named one and this browser can reach it, and
   * otherwise the device's own recogniser or none. Injected in tests, where
   * jsdom has none to drive.
   */
  capture?: CapturePort | null;
  /**
   * Asks the API for a hosted dictation credential. Only used when the API
   * named a transcription service; injected in tests.
   */
  mintRealtime?: RealtimeMint;
  /** The browser's microphone, peer connection and fetch. Injected in tests. */
  realtimeMedia?: BrowserMedia | null;
}

export function AssistantScreen({
  api = getPortalApi(),
  readback,
  capture,
  mintRealtime = defaultMintRealtime,
  realtimeMedia,
}: Readonly<AssistantScreenProps>) {
  const { availability, settled } = useAssistant();

  /* Nothing while the answer is still coming. Guessing either way is worse:
     guessing present flashes an assistant at a practice that has none, and
     guessing absent 404s every first load. */
  if (!settled) return null;

  if (availability.status !== 'enabled') {
    notFound();
    return null;
  }

  return (
    <ConfiguredAssistant
      api={api}
      capabilities={availability.capabilities}
      capture={capture}
      mintRealtime={mintRealtime}
      readback={readback}
      realtimeMedia={realtimeMedia}
    />
  );
}

interface ConfiguredAssistantProps {
  api: PortalApi;
  capabilities: AssistantCapabilities;
  readback?: ReadbackPort | null;
  capture?: CapturePort | null;
  mintRealtime: RealtimeMint;
  realtimeMedia?: BrowserMedia | null;
}

function ConfiguredAssistant({
  api,
  capabilities,
  readback,
  capture,
  mintRealtime,
  realtimeMedia,
}: Readonly<ConfiguredAssistantProps>) {
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
        {(patient) => (
          <Conversation
            capabilities={capabilities}
            capture={capture}
            chartPatientId={patient.id}
            mintRealtime={mintRealtime}
            realtimeMedia={realtimeMedia}
            readback={readback}
          />
        )}
      </AsyncBoundary>
    </>
  );
}

interface ConversationProps {
  capabilities: AssistantCapabilities;
  chartPatientId: string;
  readback?: ReadbackPort | null;
  capture?: CapturePort | null;
  mintRealtime: RealtimeMint;
  realtimeMedia?: BrowserMedia | null;
}

function Conversation({
  capabilities,
  chartPatientId,
  readback,
  capture,
  mintRealtime,
  realtimeMedia,
}: Readonly<ConversationProps>) {
  const t = useTranslator();
  const { runTurn } = useAssistant();
  const { state, ask, stop } = useConversation(runTurn, chartPatientId);

  /* Built once. A new port every render would resubscribe to the device's voice
     list on every keystroke, and the effect that speaks would take a new
     dependency each time and read the last answer again. `undefined` means
     nobody injected one, which is the browser's own voice or nothing; `null`
     means a caller said there is none, and is not the same answer. */
  const port = useMemo(
    () => (readback === undefined ? createPlatformReadback() : readback),
    [readback]
  );
  /* The rule runs here, beside the rule about what this portal will show. What
     reaches the voice is a turn id and the string on screen. */
  const speakable = useMemo(() => speakableTurns(state.turns, speakableAnswer), [state.turns]);
  const voice = useReadback(port, t.locale, speakable, chartPatientId);

  /* Built once, for the same reason the voice is: a new port every render would
     re-ask the browser what it can recognise on every keystroke, and would tear
     down an open microphone to do it. `undefined` means nobody injected one,
     which is the device's own recogniser or nothing; `null` means a caller said
     there is none, and is not the same answer. */
  const dictation = capabilities.dictation;
  const microphone = useMemo(
    () =>
      capture === undefined
        ? chooseCapture(dictation, mintRealtime, realtimeMedia)
        : { port: capture, egress: null },
    [capture, dictation, mintRealtime, realtimeMedia]
  );

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

      <AssistantReadback
        availability={voice.availability}
        lastTurnId={state.turns.at(-1)?.id ?? null}
        onStop={voice.stop}
        onToggle={voice.toggle}
        state={voice.state}
      />

      <AssistantComposer
        answering={state.answering}
        capture={microphone.port}
        chartPatientId={chartPatientId}
        dictationEgress={microphone.egress}
        onAsk={ask}
        onStop={stop}
      />
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
