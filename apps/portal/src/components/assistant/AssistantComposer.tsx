'use client';

/**
 * Where the question is typed, the control that stops an answer, and the
 * microphone that can type for you.
 *
 * The box is never disabled, not even while an answer is arriving. Disabling
 * the element somebody is typing in throws their focus to the top of the
 * document and a keyboard user then has to find their way back; asking again
 * mid-answer settles the previous turn rather than being ignored, so no
 * keystroke is dropped either.
 *
 * Enter does not send. On the staff surface it does, because a clinician asks
 * dozens of questions an hour and every keystroke saved is real. Here the
 * button is the only way, because a patient typing a paragraph about their own
 * health should be able to press Enter for a new line without half a sentence
 * being sent for them.
 *
 * **Speech writes into the box and stops there.** That is why the microphone
 * lives in this file and not beside the send control: dictated words arrive the
 * way typed ones do, in the same field, where they can be read, corrected and
 * deleted, and the only thing that sends them is the same press that sends
 * anything else. Nothing in this component can reach the assistant, so there is
 * no arrangement of speech - the reader's, a television's, somebody else's in
 * the room - that starts a turn, a booking or a payment. That is a property of
 * the wiring rather than a rule anybody has to keep.
 */

import { useCallback, useState } from 'react';
import { Button } from '@openrunic/ui';
import { useTranslator } from '@/lib/i18n/messages';
import type { CapturePort, DictationEgress } from '@/lib/voice';
import { AssistantDictation } from './AssistantDictation';
import { appendDictation, useDictation } from '@openrunic/voice';

/** The API refuses a longer turn. Saying so beats a rejection after the fact. */
const MAX_QUESTION = 8000;

export interface AssistantComposerProps {
  answering: boolean;
  onAsk: (question: string) => void;
  onStop: () => void;
  /**
   * The record this box is asking about. Not sent anywhere from here: it is what
   * the microphone is scoped to, so that changing record closes it rather than
   * finishing a sentence into a question about somebody else.
   */
  chartPatientId: string;
  /**
   * The microphone. Absent means no dictation, which is what the server render
   * and every browser without an on-device recogniser both produce. Injected in
   * tests, where jsdom has no microphone to drive.
   */
  capture?: CapturePort | null;
  /** Where that microphone sends the audio, or null while it stays on the device. */
  dictationEgress?: DictationEgress | null;
}

export function AssistantComposer({
  answering,
  onAsk,
  onStop,
  chartPatientId,
  capture = null,
  dictationEgress = null,
}: Readonly<AssistantComposerProps>) {
  const t = useTranslator();
  const [question, setQuestion] = useState('');

  const dictated = useCallback((text: string) => {
    setQuestion((current) => appendDictation(current, text, MAX_QUESTION));
  }, []);

  const dictation = useDictation(capture, t.locale, chartPatientId, dictated);

  const send = () => {
    if (question.trim() === '') return;
    onAsk(question);
    setQuestion('');
  };

  return (
    <div className="portal-compose portal-assistant__compose">
      <label className="portal-field-label" htmlFor="assistant-question">
        {t('portal.assistant.compose.label')}
      </label>
      <textarea
        className="portal-textarea"
        id="assistant-question"
        maxLength={MAX_QUESTION}
        name="question"
        onChange={(event) => setQuestion(event.target.value)}
        placeholder={t('portal.assistant.compose.placeholder')}
        value={question}
      />

      <AssistantDictation
        availability={dictation.availability}
        egress={dictationEgress}
        onStart={dictation.start}
        onStop={dictation.stop}
        state={dictation.state}
      />

      <div className="portal-actions">
        {answering ? (
          <Button variant="secondary" iconLeft="square" onClick={onStop}>
            {t('portal.assistant.compose.stop')}
          </Button>
        ) : null}
        <Button iconLeft="corner-down-left" disabled={question.trim() === ''} onClick={send}>
          {t('portal.assistant.compose.ask')}
        </Button>
      </div>
    </div>
  );
}
