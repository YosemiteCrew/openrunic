'use client';

import { Button, Textarea } from '@openrunic/ui';
import { appendDictation, useDictation } from '@openrunic/voice';
import type { CapturePort, DictationEgress } from '@openrunic/voice';
import { useCallback, useRef, useState } from 'react';
import type {
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  ReactElement,
  RefObject,
} from 'react';

import { useTranslator } from '@/lib/i18n/messages';

import { AssistantDictation } from './AssistantDictation';

/**
 * Where the question is typed, and the control that stops an answer.
 *
 * The composer owns its own keys rather than sharing a handler with the panel:
 * Enter sends, Shift-Enter starts a line, and an input method editor mid
 * composition gets its Enter back untouched, because in Japanese, Chinese and
 * Korean input that keystroke is committing a candidate, not sending a message.
 * Escape is the exception and is deliberately left to bubble, so dismissing the
 * panel works the same way from the field as from anywhere else in it.
 *
 * The field is never disabled, not even while an answer is arriving. Disabling
 * the element a person is typing in throws their focus to the top of the
 * document, and a keyboard user then has to find their way back; asking again
 * mid-answer settles the previous turn rather than being ignored, so no
 * keystroke is silently dropped either.
 *
 * **Speech writes into the box and stops there.** Dictated words arrive where
 * typed ones do, so a misheard name, a dropped "no" or a wrong number is on
 * screen to correct before it becomes a question, and the only thing that asks
 * is the same Enter or press that asks anything else.
 */

/** The API caps a turn at 8000 characters. Saying so beats a rejection after the fact. */
const MAX_QUESTION = 8000;

export interface AssistantComposerProps {
  streaming: boolean;
  onAsk: (question: string) => void;
  onStop: () => void;
  /** The panel focuses the field through this on open. */
  fieldRef?: RefObject<HTMLDivElement | null>;
  /**
   * The chart this box is asking about, or `''` for none. Not sent anywhere from
   * here: it is what the microphone is scoped to, so moving to another chart
   * closes it rather than finishing a sentence into a question about somebody
   * else.
   */
  chartPatientId?: string;
  /**
   * The microphone. Absent or null means no dictation, which is what the server
   * render and every browser without an on-device recogniser both produce.
   */
  capture?: CapturePort | null;
  /** Where that microphone sends the audio, or null while it stays on the device. */
  dictationEgress?: DictationEgress | null;
}

export function AssistantComposer({
  streaming,
  onAsk,
  onStop,
  fieldRef,
  chartPatientId = '',
  capture = null,
  dictationEgress = null,
}: Readonly<AssistantComposerProps>): ReactElement {
  const t = useTranslator();
  const [question, setQuestion] = useState('');
  const fallbackRef = useRef<HTMLDivElement>(null);

  const dictated = useCallback((text: string) => {
    setQuestion((current) => appendDictation(current, text, MAX_QUESTION));
  }, []);
  const dictation = useDictation(capture, t.locale, chartPatientId, dictated);

  const send = () => {
    if (question.trim() === '') return;
    onAsk(question);
    setQuestion('');
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    send();
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    send();
  };

  return (
    <form className="or-assistant__composer" onSubmit={onSubmit}>
      <div ref={fieldRef ?? fallbackRef} className="or-assistant__field">
        <Textarea
          label={t('assistant.composer.label')}
          placeholder={t('assistant.composer.placeholder')}
          hint={t('assistant.composer.hint')}
          rows={2}
          autoGrow
          maxLength={MAX_QUESTION}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>

      <AssistantDictation
        availability={dictation.availability}
        state={dictation.state}
        egress={dictationEgress}
        onStart={dictation.start}
        onStop={dictation.stop}
      />

      <div className="or-assistant__controls">
        {streaming ? (
          <Button type="button" variant="secondary" iconLeft="square" onClick={onStop}>
            {t('assistant.composer.stop')}
          </Button>
        ) : null}
        <Button type="submit" iconLeft="corner-down-left" disabled={question.trim() === ''}>
          {t('assistant.composer.ask')}
        </Button>
      </div>
    </form>
  );
}
