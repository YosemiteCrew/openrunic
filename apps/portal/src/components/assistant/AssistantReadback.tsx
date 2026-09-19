'use client';

/**
 * The control that turns the voice on, and the one sentence about what it is
 * doing.
 *
 * Off is the state it ships in and the state it returns to. Sound that starts
 * by itself is an accessibility feature in a waiting room and a disclosure in a
 * bus queue, and this surface reads somebody's own appointments and what they
 * owe out loud, so it is never the default and the switch says plainly what it
 * will read before it reads anything.
 *
 * **A device that cannot speak says so rather than showing a dead switch**, but
 * only when there is something to say. A browser with no speech at all - and
 * the server render, which is every first paint - draws nothing here, the same
 * answer this portal gives everywhere for a feature that is not present. A
 * device that has speech and no usable voice is a different case: the reader
 * could install one, so the sentence is worth the room.
 *
 * The status line is a live region because one of the four things it says is
 * that the answer could *not* be read. Somebody who turned this on is waiting
 * for sound, and silence with an explanation only a sighted reader can see is
 * the one failure this control could have that nobody would notice.
 */

import { Button, Switch } from '@openrunic/ui';
import { useTranslator } from '@/lib/i18n/messages';
import type { ReadbackAvailability } from '@/lib/voice';
import type { ReadbackState } from './readback';

export interface AssistantReadbackProps {
  availability: ReadbackAvailability;
  state: ReadbackState;
  onToggle: () => void;
  onStop: () => void;
}

/** Why nothing can be read, in the reader's words. Null where there is nothing to explain. */
const UNAVAILABLE_KEYS = {
  'no-voice': 'portal.assistant.readback.noVoice',
  language: 'portal.assistant.readback.noLanguage',
} as const;

const ENDING_KEYS = {
  interrupted: 'portal.assistant.readback.interrupted',
  failed: 'portal.assistant.readback.failed',
} as const;

export function AssistantReadback({
  availability,
  state,
  onToggle,
  onStop,
}: Readonly<AssistantReadbackProps>) {
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
  const status = state.speaking === null ? ending : t('portal.assistant.readback.reading');

  return (
    <div className="portal-assistant__readback">
      <Switch
        checked={state.on}
        disabled={unavailable !== null}
        hint={t('portal.assistant.readback.hint')}
        label={t('portal.assistant.readback.label')}
        onChange={onToggle}
      />

      {unavailable === null ? null : (
        <p className="portal-assistant__readback-note">{unavailable}</p>
      )}

      <div className="portal-assistant__readback-live">
        {/* Always in the document, empty most of the time. A live region added
            to the page at the moment it has something to say is a region
            several screen readers never announce. */}
        <output className="portal-assistant__readback-status">{status}</output>

        {state.speaking === null ? null : (
          <Button variant="secondary" iconLeft="square" onClick={onStop}>
            {t('portal.assistant.readback.stop')}
          </Button>
        )}
      </div>
    </div>
  );
}
