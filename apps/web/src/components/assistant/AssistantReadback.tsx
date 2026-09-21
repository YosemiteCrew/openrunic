'use client';

/**
 * The control that turns the voice on, and the one sentence about what it is
 * doing.
 *
 * Off is the state it ships in and the state it returns to. A consulting room
 * is a shared room and a front desk is a public one, and this surface reads a
 * patient's record and what a payer is still owed out loud, so sound is never
 * the default and the switch says plainly what it will read before it reads
 * anything.
 *
 * **A device that cannot speak says so rather than showing a dead switch**, but
 * only when there is something to say. A browser with no speech at all - and
 * the server render, which is every first paint - draws nothing here, the same
 * answer the shell gives everywhere for a feature that is not present. A device
 * that has speech and no usable voice is a different case: the clinic could
 * install one, so the sentence is worth the room.
 *
 * The status line is a live region because one of the things it says is that
 * the answer could *not* be read. Somebody who turned this on is waiting for
 * sound, and silence with an explanation only a sighted reader can see is the
 * one failure this control could have that nobody would notice.
 */

import { Button, Switch } from '@openrunic/ui';
import type { ReadbackAvailability, ReadbackState } from '@openrunic/voice';
import type { ReactElement } from 'react';

import { useTranslator } from '@/lib/i18n/messages';

export interface AssistantReadbackProps {
  availability: ReadbackAvailability;
  state: ReadbackState;
  onToggle: () => void;
  onStop: () => void;
}

/** Why nothing can be read, in the reader's words. Null where there is nothing to explain. */
const UNAVAILABLE_KEYS = {
  'no-voice': 'assistant.readback.noVoice',
  language: 'assistant.readback.noLanguage',
} as const;

const ENDING_KEYS = {
  interrupted: 'assistant.readback.interrupted',
  failed: 'assistant.readback.failed',
} as const;

export function AssistantReadback({
  availability,
  state,
  onToggle,
  onStop,
}: Readonly<AssistantReadbackProps>): ReactElement | null {
  const t = useTranslator();

  if (availability.status === 'unavailable' && availability.reason === 'no-adapter') return null;

  const unavailable =
    availability.status === 'unavailable' && availability.reason !== 'no-adapter'
      ? t(UNAVAILABLE_KEYS[availability.reason])
      : null;

  /* One sentence at a time, and the one being spoken wins: while the voice is
     reading, how the last answer ended is history. An answer read in full says
     nothing at all - the reader just heard it. */
  const ending =
    state.ended === 'interrupted' || state.ended === 'failed' ? t(ENDING_KEYS[state.ended]) : '';
  const status = state.speaking === null ? ending : t('assistant.readback.reading');

  return (
    <div className="or-assistant__readback">
      <Switch
        checked={state.on}
        disabled={unavailable !== null}
        hint={t('assistant.readback.hint')}
        label={t('assistant.readback.label')}
        onChange={onToggle}
      />

      {unavailable === null ? null : <p className="or-caption">{unavailable}</p>}

      <div className="or-assistant__readback-live">
        {/* Always in the document, empty most of the time. A live region added
            to the page at the moment it has something to say is a region
            several screen readers never announce. */}
        <output className="or-caption or-assistant__readback-status">{status}</output>

        {state.speaking === null ? null : (
          <Button variant="secondary" iconLeft="square" onClick={onStop}>
            {t('assistant.readback.stop')}
          </Button>
        )}
      </div>
    </div>
  );
}
