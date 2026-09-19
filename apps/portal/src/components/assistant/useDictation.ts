'use client';

/**
 * The microphone, wired to the box the question is typed in.
 *
 * The rules are next door in `dictation.ts`; this is the part that has to touch
 * a browser, and it is written so that the three things that can go wrong there
 * cannot become a rule.
 *
 * **Whether the device can do this is an answer that arrives late.** The browser
 * has to look, so availability is a promise, and a promise resolving into a
 * component that has moved on is the ordinary case rather than an error. Until
 * it answers, this reports no adapter - which renders nothing - because a
 * control that appears and then withdraws is worse than one that arrives a
 * moment after the page.
 *
 * **A microphone is a thing with a lifetime, not a pair of calls.** It is opened
 * by the effect that owns the session and closed by that effect's cleanup, so
 * every way out - said to the end, stopped by the reader, the record changed,
 * signed out, the page left behind - closes it through one line rather than
 * through five that have to agree.
 *
 * **A closed session can still report.** Every event is handed to the reducer as
 * a claim about a named session, so words that arrive after the reader moved on
 * find nothing open and change nothing. The words also do not reach the box,
 * because the subscription is gone before the abort.
 */

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { CaptureAvailability, CapturePort } from '@/lib/voice';
import { IDLE, dictationReducer } from './dictation';
import type { DictationState } from './dictation';

export interface Dictation {
  availability: CaptureAvailability;
  state: DictationState;
  /** Opens the microphone for one question. Only ever called from a press. */
  start: () => void;
  /** Closes it and keeps what was said. */
  stop: () => void;
}

const NO_ADAPTER: CaptureAvailability = { status: 'unavailable', reason: 'no-adapter' };

/** One answer, and the question it was an answer to. */
interface Answered {
  port: CapturePort;
  language: string;
  value: CaptureAvailability;
}

export function useDictation(
  port: CapturePort | null,
  language: string,
  chartPatientId: string,
  onDictated: (text: string) => void
): Dictation {
  const [state, dispatch] = useReducer(dictationReducer, IDLE);

  /*
   * The browser's answer, kept beside the question it answers.
   *
   * Derived rather than stored on its own, so that changing the language or the
   * adapter puts this back to "nothing yet" in the same render that changed it.
   * Holding the answer alone would leave the previous device's verdict standing
   * while the new question was outstanding - and the direction that goes wrong
   * is the dangerous one: a control left enabled on the strength of an answer
   * about a language the page is no longer in.
   */
  const [answer, setAnswer] = useState<Answered | null>(null);
  const availability =
    answer !== null && answer.port === port && answer.language === language
      ? answer.value
      : NO_ADAPTER;

  /* The session id is a counter rather than a name, because nothing outside this
     hook ever sees it: it exists to tell this stretch of listening from the one
     the reader just closed, and two presses a second apart must not collide. */
  const sessions = useRef(0);

  /* Held in a ref so that the effect owning the microphone does not depend on
     it. The composer rebuilds this callback whenever its own state changes,
     which is on every keystroke, and an open microphone must not be torn down
     and reopened because somebody typed. */
  const deliver = useRef(onDictated);
  useEffect(() => {
    deliver.current = onDictated;
  }, [onDictated]);

  useEffect(() => {
    if (port === null) return undefined;

    /* The page can change language, or leave, while the browser is still
       looking. An answer that arrives after that is dropped here as well as
       ignored by the derivation above: two guards for two hazards, because this
       one stops a resolved promise writing into a surface nobody is on, and the
       derivation stops an answer about one question being read as an answer to
       another. */
    let asking = true;
    void port
      .available(language)
      .then((value) => {
        if (asking) setAnswer({ port, language, value });
      })
      /* A browser that throws the question has not answered it, and this
         surface only ever opens a microphone on a yes - so a rejection is
         recorded as the same no a missing adapter gets. Recorded rather than
         swallowed: without it the rejection is unhandled, and the answer to
         this question is the one that decides whether somebody's voice stays
         on their device, so it is not left to a promise nobody is holding. */
      .catch(() => {
        if (asking) setAnswer({ port, language, value: NO_ADAPTER });
      });

    return () => {
      asking = false;
    };
  }, [port, language]);

  /* A device that turns out not to be able to do this must not be left with a
     microphone open on the strength of an earlier answer. */
  useEffect(() => {
    if (availability.status !== 'available') dispatch({ kind: 'revoke' });
  }, [availability]);

  /* A different chart, or none, is a different person. The microphone closes and
     the words in flight go, rather than finishing a sentence into a question
     about somebody else's record. */
  const chartRef = useRef(chartPatientId);
  useEffect(() => {
    if (chartRef.current === chartPatientId) return;
    chartRef.current = chartPatientId;
    dispatch({ kind: 'revoke' });
  }, [chartPatientId]);

  /*
   * One microphone, for as long as it is the microphone.
   *
   * The subscription lives and dies with the session rather than with the port,
   * and it is torn down **before** the abort. That order is the one thing in
   * here worth reading twice: a recogniser reports the session it was told to
   * abort as ended, and hands over one last result on the way. Aborting while
   * still listening would deliver that result into the box of whatever the
   * reader moved on to.
   */
  useEffect(() => {
    const session = state.session;
    if (session === null || port === null) return undefined;

    const unsubscribe = port.onEvent((event) => {
      switch (event.type) {
        case 'listening':
          dispatch({ kind: 'listening', id: event.id });
          return;
        case 'heard':
          /* The box is written to here rather than from the reducer, so the
             words somebody said are never state this surface holds on to. They
             go where the reader can see and edit them, and nowhere else.
             Checked against this session by name as well as by subscription,
             because delivery is the one thing here that does not pass through
             the reducer and so does not inherit its guard. */
          if (event.final && event.id === session.id) deliver.current(event.text);
          dispatch({ kind: 'heard', id: event.id, text: event.text, final: event.final });
          return;
        case 'ended':
          dispatch({ kind: 'ended', id: event.id });
          return;
        case 'failed':
          dispatch({ kind: 'failed', id: event.id, reason: event.reason });
      }
    });

    port.start({ id: session.id, language });

    return () => {
      unsubscribe();
      port.abort();
    };
  }, [state.session, port, language]);

  const start = useCallback(() => {
    /* The refusal lives here rather than only on the disabled control. A control
       is a rendering, and the answer this guards is the one that decides whether
       somebody's spoken health question stays on their device: a press that
       arrives from a keyboard, a stale render or a caller holding this hook
       directly must meet the same answer the button shows. */
    if (availability.status !== 'available') return;

    sessions.current += 1;
    dispatch({ kind: 'ask', id: `dictation-${sessions.current}` });
  }, [availability]);

  /* Straight to the port rather than through the reducer. Stopping keeps what
     was said, so the session has to stay open until the recogniser has handed
     over the last of it - and the `ended` that follows is what closes it. */
  const stop = useCallback(() => {
    port?.stop();
  }, [port]);

  return { availability, state, start, stop };
}
