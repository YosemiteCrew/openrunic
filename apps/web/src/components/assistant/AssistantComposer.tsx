'use client';

import { Button, Textarea } from '@openrunic/ui';
import { useRef, useState } from 'react';
import type {
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  ReactElement,
  RefObject,
} from 'react';

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
 */

/** The API caps a turn at 8000 characters. Saying so beats a rejection after the fact. */
const MAX_QUESTION = 8000;

export interface AssistantComposerProps {
  streaming: boolean;
  onAsk: (question: string) => void;
  onStop: () => void;
  /** The panel focuses the field through this on open. */
  fieldRef?: RefObject<HTMLDivElement | null>;
}

export function AssistantComposer({
  streaming,
  onAsk,
  onStop,
  fieldRef,
}: Readonly<AssistantComposerProps>): ReactElement {
  const [question, setQuestion] = useState('');
  const fallbackRef = useRef<HTMLDivElement>(null);

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
          label="Ask about this record"
          placeholder="What did the last visit record about the knee?"
          hint="Enter sends, Shift and Enter start a new line."
          rows={2}
          autoGrow
          maxLength={MAX_QUESTION}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>

      <div className="or-assistant__controls">
        {streaming ? (
          <Button type="button" variant="secondary" iconLeft="square" onClick={onStop}>
            Stop
          </Button>
        ) : null}
        <Button type="submit" iconLeft="corner-down-left" disabled={question.trim() === ''}>
          Ask
        </Button>
      </div>
    </form>
  );
}
