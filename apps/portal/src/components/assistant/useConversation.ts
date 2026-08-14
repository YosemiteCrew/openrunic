'use client';

/**
 * One conversation: ask, stream, stop.
 *
 * Two things here are worth reading carefully.
 *
 * **Some questions never leave the phone.** A question that asks for a
 * judgement rather than for a record is answered locally with the route to the
 * care team, and nothing is sent anywhere. That is faster, it costs the
 * practice nothing, and it means the words of a question about somebody's
 * symptoms are not posted to an inference endpoint to be declined there.
 *
 * **Stopping settles and aborts together.** The abort stops the practice paying
 * for words nobody will read; the reducer settles the turn in the same tick so
 * what is on screen is never a sentence that simply stopped arriving. An abort
 * without a settle leaves a turn claiming to still be answering; a settle
 * without an abort leaves a stream writing into a turn that has closed.
 */

import { useCallback, useEffect, useId, useReducer, useRef } from 'react';
import { unreachableEvents } from '@/lib/assistant';
import type { RunTurn } from '@/lib/assistant';
import { needsCareTeam } from './escalation';
import { EMPTY_TRANSCRIPT, transcriptReducer } from './transcript';
import type { TranscriptState } from './transcript';

export interface Conversation {
  state: TranscriptState;
  ask: (question: string) => void;
  stop: () => void;
}

export function useConversation(runTurn: RunTurn, chartPatientId: string): Conversation {
  const [state, dispatch] = useReducer(transcriptReducer, EMPTY_TRANSCRIPT);
  const abortRef = useRef<AbortController | null>(null);
  const askedRef = useRef(0);
  const idBase = useId();

  /* Read at ask time rather than captured, so a chart that resolves after the
     first render does not rebuild `ask` and reset the box mid-sentence. */
  const chartRef = useRef(chartPatientId);
  useEffect(() => {
    chartRef.current = chartPatientId;
  }, [chartPatientId]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    dispatch({ kind: 'stop' });
  }, []);

  /* An unmount is a stop with no transcript left to settle: the page is gone,
     so the only thing to do is release the request. */
  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    []
  );

  const ask = useCallback(
    (question: string) => {
      const message = question.trim();
      if (message === '') return;

      /* Asking while an answer is still arriving replaces it. The previous turn
         is settled rather than abandoned, so it never sits there claiming to be
         still answering. */
      if (abortRef.current !== null) stop();

      const index = askedRef.current;
      askedRef.current += 1;
      const id = `${idBase}-${String(index)}`;

      if (needsCareTeam(message)) {
        dispatch({ kind: 'redirect', id, question: message });
        return;
      }

      const controller = new AbortController();
      abortRef.current = controller;
      dispatch({ kind: 'ask', id, question: message });

      void (async () => {
        try {
          for await (const event of runTurn({
            message,
            turnIndex: index,
            chartPatientId: chartRef.current,
            signal: controller.signal,
          })) {
            if (controller.signal.aborted) return;
            dispatch({ kind: 'event', event });
          }
        } catch {
          /* The stream client already turns a dead transport into events. This
             catches a runner that threw outside it, so a turn cannot be left
             permanently mid-answer by an error nobody handled. */
          if (controller.signal.aborted) return;
          for (const event of unreachableEvents()) dispatch({ kind: 'event', event });
        }
      })();
    },
    [runTurn, idBase, stop]
  );

  return { state, ask, stop };
}
