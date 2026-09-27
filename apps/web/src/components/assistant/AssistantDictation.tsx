'use client';

/**
 * The control that opens the microphone, and the sentences about what it is
 * doing.
 *
 * The rules are in `@openrunic/voice` and are the portal's rules, not a copy of
 * them: one press is one question, the status is drawn from the microphone
 * rather than the press, and a closed session cannot speak into the next one.
 * This file is only the part that is this surface's own - its words and its
 * classes.
 *
 * **A spoken question is a question, not a command.** What is heard goes into
 * the box a clinician types in, where names, negations and numbers can be read
 * and corrected before anything is asked, and the only thing that asks is the
 * same press or Enter that asks a typed one. Nothing here can reach the
 * assistant, and this surface runs every turn in read mode besides, so no
 * arrangement of speech in a consulting room can write to a chart, sign or send
 * anything.
 *
 * **A device that cannot do this on its own says so rather than showing a dead
 * control**, but only when there is something to say. A browser with no
 * on-device recogniser - and the server render, which is every first paint -
 * draws nothing here, the same answer the shell gives everywhere for a feature
 * that is not present.
 *
 * The status line is a live region because three of the things it says are that
 * nothing was captured. Somebody who pressed this is waiting to be heard, and a
 * silent refusal only a sighted reader can see is the one failure this control
 * could have that nobody would notice.
 */

import type { MessageKey } from '@openrunic/i18n';
import { Button } from '@openrunic/ui';
import type { CaptureAvailability, DictationEgress, DictationState } from '@openrunic/voice';
import type { ReactElement } from 'react';

import { useTranslator } from '@/lib/i18n/messages';

export interface AssistantDictationProps {
  availability: CaptureAvailability;
  state: DictationState;
  /**
   * Where the audio goes when a deployer configured a hosted service. The
   * device's own recogniser sends nothing, and says so; this one does, and the
   * sentence under the button names where and under what agreement before the
   * microphone is pressed.
   */
  egress?: DictationEgress | null;
  onStart: () => void;
  onStop: () => void;
  /** The sentences, when this is not the assistant's microphone. */
  messages?: DictationMessages;
}

/**
 * Every sentence this control says, by what it is saying. The assistant's are
 * the default; a surface that asks something other than a question - the
 * schedule's slot request - hands its own, and the rules stay the same ones.
 */
export interface DictationMessages {
  speak: MessageKey;
  stop: MessageKey;
  hint: MessageKey;
  hintHosted: MessageKey;
  noLanguage: MessageKey;
  noLanguageHosted: MessageKey;
  notInstalled: MessageKey;
  starting: MessageKey;
  listening: MessageKey;
  denied: MessageKey;
  noSpeech: MessageKey;
  noAudio: MessageKey;
  offDevice: MessageKey;
  failed: MessageKey;
}

export const ASSISTANT_DICTATION_MESSAGES: DictationMessages = {
  speak: 'assistant.dictation.speak',
  stop: 'assistant.dictation.stop',
  hint: 'assistant.dictation.hint',
  hintHosted: 'assistant.dictation.hintHosted',
  noLanguage: 'assistant.dictation.noLanguage',
  noLanguageHosted: 'assistant.dictation.noLanguageHosted',
  notInstalled: 'assistant.dictation.notInstalled',
  starting: 'assistant.dictation.starting',
  listening: 'assistant.dictation.listening',
  denied: 'assistant.dictation.denied',
  noSpeech: 'assistant.dictation.noSpeech',
  noAudio: 'assistant.dictation.noAudio',
  offDevice: 'assistant.dictation.offDevice',
  failed: 'assistant.dictation.failed',
};

/** Why nothing can be dictated, in the reader's words. */
const UNAVAILABLE_KEYS = {
  language: 'noLanguage',
  'not-installed': 'notInstalled',
} as const;

/** How a session ended without words, as the sentence that says so. */
const ENDING_KEYS = {
  denied: 'denied',
  'no-speech': 'noSpeech',
  'no-audio': 'noAudio',
  'off-device': 'offDevice',
  failed: 'failed',
} as const;

/**
 * The one sentence the status line has, or nothing. While the microphone is
 * open, how the last attempt ended is history; a question that was heard says
 * nothing at all, because the words in the box are the better answer.
 */
function statusKey(state: DictationState): keyof DictationMessages | null {
  if (state.phase !== 'idle') return state.phase;
  return state.ended === 'none' ? null : ENDING_KEYS[state.ended];
}

export function AssistantDictation({
  availability,
  state,
  egress = null,
  onStart,
  onStop,
  messages = ASSISTANT_DICTATION_MESSAGES,
}: Readonly<AssistantDictationProps>): ReactElement | null {
  const t = useTranslator();

  if (availability.status === 'unavailable' && availability.reason === 'no-adapter') return null;

  /* A hosted service that does not transcribe this page's language has nothing
     to do with the device, so the on-device sentence would be wrong about why. */
  let unavailable: string | null = null;
  if (availability.status === 'unavailable' && availability.reason !== 'no-adapter') {
    unavailable = t(
      messages[egress === null ? UNAVAILABLE_KEYS[availability.reason] : 'noLanguageHosted']
    );
  }
  const hint =
    egress === null
      ? t(messages.hint)
      : t(messages.hintHosted, { host: egress.host, agreement: egress.agreement });

  const sentence = statusKey(state);
  const status = sentence === null ? '' : t(messages[sentence]);

  return (
    <div className="or-assistant__dictation">
      <div className="or-assistant__dictation-live">
        {state.session === null ? (
          <Button
            type="button"
            variant="secondary"
            iconLeft="mic"
            disabled={unavailable !== null}
            onClick={onStart}
          >
            {t(messages.speak)}
          </Button>
        ) : (
          <Button type="button" variant="secondary" iconLeft="square" onClick={onStop}>
            {t(messages.stop)}
          </Button>
        )}

        {/* Always in the document, empty most of the time. A live region added
            to the page at the moment it has something to say is a region several
            screen readers never announce. */}
        <output className="or-caption or-assistant__dictation-status">{status}</output>
      </div>

      {/* Not in the live region: it changes on every word, and a screen reader
          would read the sentence back over the person still saying it. */}
      {state.heard === '' ? null : (
        <p className="or-caption or-assistant__dictation-heard">{state.heard}</p>
      )}

      <p className="or-caption">{unavailable ?? hint}</p>
    </div>
  );
}
