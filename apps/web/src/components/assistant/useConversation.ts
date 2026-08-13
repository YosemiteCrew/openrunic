'use client';

import { useCallback, useEffect, useId, useReducer, useRef } from 'react';

import { transportFailureEvents } from '@/lib/agent';

import { EMPTY_TRANSCRIPT, transcriptReducer } from './transcript';
import type { TranscriptState } from './transcript';
import type { RunAgentTurn } from './transport';

/**
 * One conversation: ask, stream, stop.
 *
 * Stopping is the case worth reading carefully. `abort()` cancels the request
 * so the server stops being paid to produce tokens nobody will see, and the
 * reducer settles the turn in the same tick, so what is on screen is never a
 * sentence that simply stopped arriving. The two have to happen together: an
 * abort without a settle leaves a turn that says it is still answering, and a
 * settle without an abort leaves a stream writing into a turn that has closed.
 */

export interface Conversation {
  state: TranscriptState;
  ask: (question: string) => void;
  stop: () => void;
}

export function useConversation(runTurn: RunAgentTurn, chartPatientId?: string): Conversation {
  const [state, dispatch] = useReducer(transcriptReducer, EMPTY_TRANSCRIPT);
  const abortRef = useRef<AbortController | null>(null);
  const turnCountRef = useRef(0);
  const idBase = useId();

  // Read at ask time rather than captured, so walking to another chart mid
  // conversation sends the chart that is open when the question is asked, and
  // so a new chart does not rebuild `ask` and invalidate the composer's props.
  const chartRef = useRef(chartPatientId);
  useEffect(() => {
    chartRef.current = chartPatientId;
  }, [chartPatientId]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    dispatch({ kind: 'stop' });
  }, []);

  // An unmount is a stop without a transcript to settle: the panel is gone, so
  // the only thing left to do is release the request.
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

      // Asking while an answer is still arriving replaces it. The previous turn
      // is settled rather than abandoned, so it never sits there claiming to be
      // still answering.
      if (abortRef.current !== null) stop();

      const controller = new AbortController();
      abortRef.current = controller;
      const turnIndex = turnCountRef.current;
      turnCountRef.current += 1;

      dispatch({ kind: 'ask', id: `${idBase}-${turnIndex}`, question: message });

      void (async () => {
        try {
          for await (const event of runTurn({
            message,
            turnIndex,
            ...(chartRef.current === undefined ? {} : { chartPatientId: chartRef.current }),
            signal: controller.signal,
          })) {
            if (controller.signal.aborted) return;
            dispatch({ kind: 'event', event });
          }
        } catch {
          // The stream client already turns a dead transport into events. This
          // catches a runner that threw outside it, so a turn cannot be left
          // permanently mid-answer by an error nobody handled.
          if (controller.signal.aborted) return;
          for (const event of transportFailureEvents()) dispatch({ kind: 'event', event });
        }
      })();
    },
    [runTurn, idBase, stop]
  );

  return { state, ask, stop };
}
