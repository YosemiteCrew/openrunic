'use client';

/**
 * The control that opens the microphone, and the sentences about what it is
 * doing.
 *
 * Closed is the state it ships in and the state it returns to after every
 * question. There is no switch here, unlike the voice next door, and the
 * difference is deliberate: a switch is a preference that persists, and a
 * microphone that persists is one somebody left on. This is a press, it lasts
 * one question, and the label says which of those two things is happening.
 *
 * **What it says about the microphone is what the microphone is doing.** The
 * status is drawn from the adapter reporting audio, never from the press that
 * asked for it, so during a permission prompt it says the microphone is opening
 * rather than that it is listening. A surface that claims an open microphone
 * before there is one has told somebody they are being recorded when they are
 * not, and will tell them the opposite just as readily.
 *
 * **A device that cannot do this on its own says so rather than showing a dead
 * control**, but only when there is something to say. A browser with no
 * on-device recogniser at all - and the server render, which is every first
 * paint - draws nothing here, the same answer this portal gives everywhere for a
 * feature that is not present. A device that could do this in another language,
 * or once a language pack is installed, is a different case: that is a sentence
 * worth the room, because it explains an absence the reader can act on.
 *
 * The status line is a live region because three of the things it says are that
 * nothing was captured. Somebody who pressed this is waiting to be heard, and a
 * silent refusal that only a sighted reader can see is the one failure this
 * control could have that nobody would notice.
 */

import { Button } from '@openrunic/ui';
import { useTranslator } from '@/lib/i18n/messages';
import type { CaptureAvailability } from '@/lib/voice';
import type { DictationState } from './dictation';

export interface AssistantDictationProps {
  availability: CaptureAvailability;
  state: DictationState;
  onStart: () => void;
  onStop: () => void;
}

/** Why nothing can be dictated, in the reader's words. */
const UNAVAILABLE_KEYS = {
  language: 'portal.assistant.dictation.noLanguage',
  'not-installed': 'portal.assistant.dictation.notInstalled',
} as const;

const ENDING_KEYS = {
  denied: 'portal.assistant.dictation.denied',
  'no-speech': 'portal.assistant.dictation.noSpeech',
  'no-audio': 'portal.assistant.dictation.noAudio',
  'off-device': 'portal.assistant.dictation.offDevice',
  failed: 'portal.assistant.dictation.failed',
} as const;

const PHASE_KEYS = {
  starting: 'portal.assistant.dictation.starting',
  listening: 'portal.assistant.dictation.listening',
} as const;

export function AssistantDictation({
  availability,
  state,
  onStart,
  onStop,
}: Readonly<AssistantDictationProps>) {
  const t = useTranslator();

  if (availability.status === 'unavailable' && availability.reason === 'no-adapter') return null;

  const unavailable =
    availability.status === 'unavailable' && availability.reason !== 'no-adapter'
      ? t(UNAVAILABLE_KEYS[availability.reason])
      : null;

  /* One sentence at a time, and the microphone wins: while it is open, how the
     last attempt ended is history. A question that was heard says nothing at all
     - the words are in the box, which is the better answer. */
  const status =
    state.phase === 'idle'
      ? state.ended !== 'none'
        ? t(ENDING_KEYS[state.ended])
        : ''
      : t(PHASE_KEYS[state.phase]);

  const open = state.session !== null;

  return (
    <div className="portal-assistant__dictation">
      <div className="portal-assistant__dictation-live">
        {open ? (
          <Button variant="secondary" iconLeft="square" onClick={onStop}>
            {t('portal.assistant.dictation.stop')}
          </Button>
        ) : (
          <Button
            variant="secondary"
            iconLeft="mic"
            disabled={unavailable !== null}
            onClick={onStart}
          >
            {t('portal.assistant.dictation.speak')}
          </Button>
        )}

        {/* Always in the document, empty most of the time. A live region added
            to the page at the moment it has something to say is a region several
            screen readers never announce. */}
        <output className="portal-assistant__dictation-status">{status}</output>
      </div>

      {/* Not in the live region. It changes on every word, and a screen reader
          would read the sentence back over the person still saying it; it is
          here for the reader who needs to see that they were understood, which
          on this surface includes anybody who cannot hear the room they are in. */}
      {state.heard === '' ? null : (
        <p className="portal-assistant__dictation-heard">{state.heard}</p>
      )}

      <p className="portal-assistant__dictation-note">
        {unavailable ?? t('portal.assistant.dictation.hint')}
      </p>
    </div>
  );
}
