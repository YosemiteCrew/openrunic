'use client';

/**
 * The voice, wired to the conversation.
 *
 * The rules are next door in `readback.ts`; this is the part that has to touch
 * a browser, and it is written so that the three things that can go wrong there
 * cannot become a rule.
 *
 * **The voice list arrives late.** A browser answers "no voices" for the first
 * moment of its life and then corrects itself. Asked once at render, readback
 * would be permanently unavailable on a device that speaks perfectly well, so
 * the adapter is subscribed to and the answer is re-read when it changes.
 *
 * **An answer that is still arriving must not restart the voice.** The effect
 * that speaks depends on the utterance and never on the transcript: the words
 * travel with the utterance, copied off the turn when it was found speakable.
 * Depending on the turns would re-enter this effect on every token of the next
 * answer and say the previous one again from the top.
 *
 * **A stopped utterance can still report back.** An adapter's ending is passed
 * to the reducer as a claim about a named utterance, never as an instruction,
 * so an ending that arrives after the reader stopped finds nothing speaking and
 * changes nothing. Nothing is recorded as heard that the reader cut off.
 */

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { readbackAvailability } from '@/lib/voice';
import type { ReadbackAvailability, ReadbackPort } from '@/lib/voice';
import { SILENT, readbackReducer, speakableAnswer } from './readback';
import type { ReadbackState } from './readback';
import type { AssistantTurn } from './transcript';

export interface Readback {
  availability: ReadbackAvailability;
  state: ReadbackState;
  /** Turns the voice on, or off and silent. */
  toggle: () => void;
  /** Stops the answer being read now, leaving the switch on. */
  stop: () => void;
}

function sameAvailability(left: ReadbackAvailability, right: ReadbackAvailability): boolean {
  if (left.status === 'available' || right.status === 'available') {
    return left.status === right.status;
  }
  return left.reason === right.reason;
}

export function useReadback(
  port: ReadbackPort | null,
  language: string,
  turns: readonly AssistantTurn[],
  chartPatientId: string
): Readback {
  const [state, dispatch] = useReducer(readbackReducer, SILENT);
  const [availability, setAvailability] = useState<ReadbackAvailability>(() =>
    readbackAvailability(port, language)
  );

  useEffect(() => {
    const read = () => {
      setAvailability((current) => {
        const next = readbackAvailability(port, language);
        /* Same answer, same object: a new one would re-run every effect that
           depends on availability, including the one that speaks. */
        return sameAvailability(current, next) ? current : next;
      });
    };

    read();
    return port === null ? undefined : port.subscribe(read);
  }, [port, language]);

  /* A device that cannot speak must not sit with the switch on: the switch
     would be a promise of sound that never comes, and the next answer would be
     recorded as offered while nobody heard anything. */
  useEffect(() => {
    if (availability.status !== 'available' && state.on) dispatch({ kind: 'off' });
  }, [availability, state.on]);

  /* A different chart, or none, is a different person. The voice stops, the
     queue goes, and consent is asked for again rather than carried over. */
  const chartRef = useRef(chartPatientId);
  useEffect(() => {
    if (chartRef.current === chartPatientId) return;
    chartRef.current = chartPatientId;
    dispatch({ kind: 'revoke' });
    port?.cancel();
  }, [chartPatientId, port]);

  /* Leaving the page, or losing the voice, is not a quiet finish either: the
     utterance would outlive the surface that authorised it and go on reading
     into another screen.

     The interruption is dispatched before the cancel for the same reason it is
     below - a synthesiser reports the utterance it was told to cancel as ended,
     and an ending that lands before the interruption would record an answer
     nobody heard as heard. On an unmount the dispatch is a no-op; on a voice
     that was swapped out under a speaking utterance it is the whole of it. */
  useEffect(
    () => () => {
      dispatch({ kind: 'interrupt' });
      port?.cancel();
    },
    [port]
  );

  /* Every settled turn is offered exactly once. With the switch off that is a
     no-op that records it, which is what stops turning the switch on from
     reading the conversation so far back at somebody. */
  useEffect(() => {
    for (const turn of turns) {
      const text = speakableAnswer(turn);
      if (text === null) continue;
      if (state.attempted.includes(turn.id)) continue;
      dispatch({ kind: 'speak', turnId: turn.id, text });
    }
  }, [turns, state.attempted]);

  useEffect(() => {
    const speaking = state.speaking;
    /* Nothing to say, or nothing to say it with. A port that goes away under a
       speaking utterance leaves it here for the one commit it takes the
       availability above to turn the switch off, which settles it as an
       interruption. */
    if (speaking === null || port === null) return;

    port.speak({ id: speaking.turnId, text: speaking.text, language }, (event) => {
      /* `started` says the sound began, which the surface already draws from
         `speaking`. Only the two endings change anything. */
      if (event.type === 'started') return;
      dispatch({ kind: event.type, turnId: event.id });
    });
  }, [state.speaking, port, language]);

  /* The dispatch goes in before the cancel, and the order is the whole of it.
     A browser fires `end` when an utterance is cancelled, so cancelling first
     would queue that ending ahead of the interruption and the reducer would
     record a cut-off answer as heard. Queued the other way round, the
     interruption lands first and the ending that follows it has nothing left to
     match. */
  const toggle = useCallback(() => {
    if (state.on) {
      dispatch({ kind: 'off' });
      port?.cancel();
      return;
    }
    dispatch({ kind: 'on' });
  }, [state.on, port]);

  const stop = useCallback(() => {
    dispatch({ kind: 'interrupt' });
    port?.cancel();
  }, [port]);

  return { availability, state, toggle, stop };
}
