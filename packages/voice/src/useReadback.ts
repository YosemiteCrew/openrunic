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
 * **A stopped utterance can still report back.** An adapter's event is handed
 * to the reducer as a claim about a named utterance rather than as an
 * instruction, so an ending that arrives after the reader stopped finds nothing
 * speaking and changes nothing. Nothing is recorded as heard that the reader
 * cut off.
 *
 * **Which answers may be read is not decided here.** The hook is handed the
 * turns a surface has already found speakable, paired with the very strings it
 * renders for them. That is what keeps "may this be shown" and "may this be
 * heard" one sentence: a surface that learns a new reason to withhold an answer
 * does not have to remember to come here and teach the voice the same reason,
 * and nothing in this file could read a record even if it wanted to.
 */

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { readbackAvailability } from './ports.js';
import type { ReadbackAvailability, ReadbackPort } from './ports.js';
import { SILENT, readbackReducer } from './readback.js';
import { usePageHidden } from './usePageHidden.js';
import type { ReadbackState, Speaking } from './readback.js';

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
  speakable: readonly Speaking[],
  scope: string
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
    return port === null ? undefined : port.onCapabilities(read);
  }, [port, language]);

  /* A device that cannot speak must not sit with the switch on: the switch
     would be a promise of sound that never comes, and the next answer would be
     recorded as offered while nobody heard anything.

     Which of the two ways of stopping applies turns on whether the control is
     still on screen, and that is what the reason says. `no-voice` and
     `language` leave it drawn, with a sentence saying which one it is, so how
     the last utterance ended is still worth having beside it - `off` keeps it,
     and keeping it is the point: a voice that failed must not have its failure
     wiped off the screen by the switch going down.

     `no-adapter` is the case where the control draws nothing at all. There is
     no screen for an ending to be on, so carrying one forward cannot inform
     anybody now; it can only reappear later, when a voice comes back or a
     dismissed surface is opened again, as a sentence about an utterance from
     before - beside a switch that is off. Forgetting is the honest answer, and
     `revoke` is already it. */
  useEffect(() => {
    if (availability.status === 'available') return;

    if (availability.reason === 'no-adapter') {
      /* Only when there is something to forget. `revoke` answers a fresh state
         every time, so an unguarded dispatch would be a new object on every
         render that reached it. */
      if (state.on || state.speaking !== null || state.ended !== 'none') {
        dispatch({ kind: 'revoke' });
      }
      return;
    }

    if (state.on) dispatch({ kind: 'off' });
  }, [availability, state.on, state.speaking, state.ended]);

  /* A different record underneath, or none, is a different subject. The voice
     stops, the queue goes, and consent is asked for again rather than carried
     over. The surface names its own scope - a chart, a case, an empty string
     where the conversation is about nothing in particular - and this only has
     to notice that the name changed. */
  const scopeRef = useRef(scope);
  useEffect(() => {
    if (scopeRef.current === scope) return;
    scopeRef.current = scope;
    dispatch({ kind: 'revoke' });
  }, [scope]);

  /* So does the page going out of sight, and the switch goes with it. An answer
     becoming audible while the screen is dark is the single case where the
     words are not on the screen beside the sound - which is the thing that
     makes reading somebody's record aloud safe at all - so the consent that was
     given for a page in front of them is not carried into a room they left. */
  usePageHidden(() => dispatch({ kind: 'revoke' }));

  /* Every turn the surface has found speakable is offered exactly once. With
     the switch off that is a no-op that records it, which is what stops turning
     the switch on from reading the conversation so far back at somebody.

     The list is the whole of what this hook is told. Which turns are on it is
     the surface's decision, taken beside its decision about what to show - see
     {@link ./index.ts}. What stops one being spoken twice is `attempted` rather
     than anything about how often this runs, so a caller that rebuilds the list
     costs a loop over what is on screen and nothing else. */
  useEffect(() => {
    for (const item of speakable) {
      if (state.attempted.has(item.turnId)) continue;
      dispatch({ kind: 'speak', turnId: item.turnId, text: item.text });
    }
  }, [speakable, state.attempted]);

  /*
   * One utterance, for as long as it is the utterance.
   *
   * Written as a connection rather than as a pair of calls, because the thing
   * being managed is the lifetime of a sound: it begins when this utterance
   * becomes the one being spoken and it must end the moment it stops being
   * that, however it stopped - read to the end, stopped by the reader, the
   * switch turned off, a different chart, the voice swapped out, or the page
   * left behind. Six ways in, one way out.
   *
   * The subscription lives and dies with the utterance rather than with the
   * voice, and it is torn down **before** the cancel. That order is the one
   * thing in here worth reading twice: a synthesiser reports the utterance it
   * was told to cancel as ended, with the same event it reports for one read to
   * the last word. Cancelling while still listening would hand the reducer an
   * ending for an utterance that is, at that moment, still the current one -
   * and an answer the reader never heard would be recorded as heard.
   *
   * Every other way out is already settled in the state by the time React runs
   * this cleanup, so this covers the one that is not: the voice itself being
   * taken away underneath a speaking utterance.
   */
  useEffect(() => {
    const speaking = state.speaking;
    if (speaking === null || port === null) return undefined;

    const unsubscribe = port.onEvent((event) => {
      /* `started` says the sound began, which the surface already draws from
         `speaking`. Only the two endings carry anything new. */
      if (event.type === 'started') return;
      dispatch({ kind: event.type, turnId: event.id });
    });

    port.speak({ id: speaking.turnId, text: speaking.text, language });

    return () => {
      unsubscribe();
      port.cancel();
    };
  }, [state.speaking, port, language]);

  /* Neither of these touches the voice. They change what the state says is
     being spoken, and the effect above tears the sound down because of it,
     which is one place that stops sound rather than four that have to agree. */
  const toggle = useCallback(() => {
    dispatch({ kind: state.on ? 'off' : 'on' });
  }, [state.on]);

  const stop = useCallback(() => {
    dispatch({ kind: 'interrupt' });
  }, []);

  return { availability, state, toggle, stop };
}
