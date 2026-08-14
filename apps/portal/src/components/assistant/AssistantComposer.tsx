'use client';

/**
 * Where the question is typed, and the control that stops an answer.
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
 */

import { useState } from 'react';
import { Button } from '@openrunic/ui';

/** The API refuses a longer turn. Saying so beats a rejection after the fact. */
const MAX_QUESTION = 8000;

export interface AssistantComposerProps {
  answering: boolean;
  onAsk: (question: string) => void;
  onStop: () => void;
}

export function AssistantComposer({ answering, onAsk, onStop }: Readonly<AssistantComposerProps>) {
  const [question, setQuestion] = useState('');

  const send = () => {
    if (question.trim() === '') return;
    onAsk(question);
    setQuestion('');
  };

  return (
    <div className="portal-compose portal-assistant__compose">
      <label className="portal-field-label" htmlFor="assistant-question">
        Your question
      </label>
      <textarea
        className="portal-textarea"
        id="assistant-question"
        maxLength={MAX_QUESTION}
        name="question"
        onChange={(event) => setQuestion(event.target.value)}
        placeholder="What did the practice write down about my last visit?"
        value={question}
      />

      <div className="portal-actions">
        {answering ? (
          <Button variant="secondary" iconLeft="square" onClick={onStop}>
            Stop
          </Button>
        ) : null}
        <Button iconLeft="corner-down-left" disabled={question.trim() === ''} onClick={send}>
          Ask
        </Button>
      </div>
    </div>
  );
}
