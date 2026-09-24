import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { hidePage, showPage } from './visibility.js';
import { createRealtimeCapture, useDictation } from '../index.js';
import type {
  CaptureAvailability,
  CaptureEvent,
  CapturePort,
  CaptureSession,
  RealtimeHandlers,
  RealtimeTransport,
} from '../index.js';

/**
 * One contract, two adapters that share nothing but it.
 *
 * The claim this file exists to check is that replacing the recogniser is an
 * adapter change: no rule about when a microphone may be open, or about where
 * the words go, lives in one. So every case below runs twice, against two
 * deterministic doubles - labelled as doubles, because neither is a real
 * recogniser, no audio is produced and no paid service is contacted here.
 *
 * They are built to be unalike in the way that matters. The first is a
 * push-to-talk stage of the chained kind: it hands over one settled transcript,
 * never an interim one, and it polices its own aborts. The second is a duplex
 * streaming session with its own event vocabulary and a queue, which does
 * **not** suppress anything - it delivers a last result and an ending for a
 * session that was already abandoned, exactly as a browser does. The second is
 * the one that shows the core is doing the work rather than the adapter being
 * polite.
 */

interface Double {
  port: CapturePort;
  /** Every session the adapter was asked to open, in order. */
  opened: CaptureSession[];
  aborts: () => number;
  stops: () => number;
  /** Words from the recogniser. `settled` is what the adapter calls a final result. */
  say: (id: string, text: string, settled: boolean) => void;
  finish: (id: string) => void;
  fail: (id: string, reason: 'denied' | 'no-speech' | 'no-audio' | 'off-device') => void;
  /** Words for a session nobody is waiting on. Every adapter can produce these. */
  ghost: () => void;
}

/** A push-to-talk stage. One settled transcript per press, and it polices its own aborts. */
function pushToTalk(answer = 'available'): Double {
  const opened: CaptureSession[] = [];
  const listeners = new Set<(event: CaptureEvent) => void>();
  let live: string | null = null;
  let aborts = 0;
  let stops = 0;

  const emit = (event: CaptureEvent) => {
    for (const listener of listeners) listener(event);
  };

  const guarded = (id: string, event: CaptureEvent) => {
    if (live !== id) return;
    emit(event);
  };

  return {
    opened,
    aborts: () => aborts,
    stops: () => stops,
    port: {
      available: async () =>
        answer === 'available'
          ? { status: 'available' }
          : { status: 'unavailable', reason: 'language' },
      onEvent: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      start: (session) => {
        opened.push(session);
        live = session.id;
        emit({ type: 'listening', id: session.id });
      },
      stop: () => {
        stops += 1;
      },
      abort: () => {
        aborts += 1;
        live = null;
      },
    },
    /* No interim results at all: this stage recognises a whole utterance and
       hands it over once. An interim one is dropped rather than invented. */
    say: (id, text, settled) => {
      if (settled) guarded(id, { type: 'heard', id, text, final: true });
    },
    finish: (id) => {
      guarded(id, { type: 'ended', id });
      if (live === id) live = null;
    },
    fail: (id, reason) => {
      guarded(id, { type: 'failed', id, reason });
      if (live === id) live = null;
    },
    ghost: () => {
      emit({ type: 'heard', id: 'a-session-nobody-asked-for', text: 'somebody else', final: true });
    },
  };
}

/** A duplex streaming session that reports whatever it is told to, whenever. */
function streaming(answer = 'available'): Double {
  const opened: CaptureSession[] = [];
  const listeners = new Set<(event: CaptureEvent) => void>();
  let live: string | null = null;
  let aborts = 0;
  let stops = 0;

  const emit = (event: CaptureEvent) => {
    for (const listener of listeners) listener(event);
  };

  return {
    opened,
    aborts: () => aborts,
    stops: () => stops,
    port: {
      available: async () =>
        answer === 'available'
          ? { status: 'available' }
          : { status: 'unavailable', reason: 'not-installed' },
      onEvent: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      start: (session) => {
        opened.push(session);
        live = session.id;
        emit({ type: 'listening', id: session.id });
      },
      stop: () => {
        stops += 1;
      },
      /* Reports on the way out, which is the whole reason the surface
         unsubscribes before it aborts. A recogniser told to stop mid-sentence
         hands over what it had; if that arrives while anybody is still
         listening, the words somebody said over one record land in a question
         about the next. */
      abort: () => {
        aborts += 1;
        if (live === null) return;
        emit({ type: 'heard', id: live, text: 'a sentence nobody finished', final: true });
        emit({ type: 'ended', id: live });
        live = null;
      },
    },
    /* Suppresses nothing. A session it was told to abandon still reports, which
       is what a real recogniser does and what the core has to survive. */
    say: (id, text, settled) => {
      emit({ type: 'heard', id, text, final: settled });
    },
    finish: (id) => {
      emit({ type: 'ended', id });
    },
    fail: (id, reason) => {
      emit({ type: 'failed', id, reason });
    },
    ghost: () => {
      emit({ type: 'heard', id: 'a-session-nobody-asked-for', text: 'somebody else', final: true });
    },
  };
}

/**
 * The hosted realtime adapter this package ships, over a scripted connection.
 *
 * Unlike the two above, the rules here are the real adapter's, and only the wire
 * is a double: it speaks the vendor's event vocabulary, and like the streaming
 * double it suppresses nothing - a connection that was closed keeps delivering
 * what it had in flight. Its `ghost` is the case only a hosted service can
 * produce: the service answering on its own, in text and in audio, on the live
 * connection. None of that is the reader's words and none of it may reach the box.
 */
function realtime(answer = 'available'): Double {
  const opened: CaptureSession[] = [];
  const wires = new Map<string, RealtimeHandlers>();
  let aborts = 0;
  let stops = 0;
  let current = '';
  let item = 0;

  const transport: RealtimeTransport = {
    languages: answer === 'available' ? ['en-US'] : ['fr'],
    /* Manual, so a stop always commits and the question ends when the service
       answers - the shape the other two doubles share. Server-side turn
       detection is covered in realtime-capture.test.ts. */
    turnDetection: 'manual',
    open: (_session, handlers) => {
      wires.set(current, handlers);
      handlers.listening();
      return { send: () => undefined, close: () => undefined };
    },
  };
  const adapter = createRealtimeCapture(transport, {
    endpoint: 'the endpoint a deployer configured',
    agreement: 'the agreement a deployer named',
  });
  if (adapter === null) throw new Error('unreachable: a transport was supplied');

  const wire = (id: string) => wires.get(id);

  return {
    opened,
    aborts: () => aborts,
    stops: () => stops,
    port: {
      ...adapter,
      start: (session) => {
        opened.push(session);
        current = session.id;
        adapter.start(session);
      },
      stop: () => {
        stops += 1;
        adapter.stop();
      },
      abort: () => {
        aborts += 1;
        adapter.abort();
      },
    },
    say: (id, text, settled) => {
      item += 1;
      const itemId = `item-${String(item)}`;
      wire(id)?.message(
        settled
          ? {
              type: 'conversation.item.input_audio_transcription.completed',
              item_id: itemId,
              transcript: text,
            }
          : {
              type: 'conversation.item.input_audio_transcription.delta',
              item_id: itemId,
              delta: text,
            }
      );
    },
    finish: (id) => {
      wire(id)?.closed();
    },
    fail: (id, reason) => {
      wire(id)?.failed(reason);
    },
    ghost: () => {
      const handlers = wire(current);
      handlers?.message({
        type: 'response.output_text.done',
        item_id: 'reply',
        text: 'somebody else',
      });
      handlers?.message({
        type: 'response.output_audio_transcript.done',
        item_id: 'reply',
        transcript: 'somebody else',
      });
      handlers?.message({ type: 'response.output_audio.delta', item_id: 'reply', delta: 'AAAA' });
      handlers?.message({
        type: 'response.function_call_arguments.done',
        item_id: 'reply',
        arguments: '{}',
      });
    },
  };
}

/* The reason each double gives when it says no. They differ so that a test
   waiting for "unavailable" cannot be satisfied by the `no-adapter` this hook
   reports before the browser has answered - which is already true at mount, and
   would let every case below run against a question nobody had answered yet. */
const ADAPTERS = [
  ['a push-to-talk stage', pushToTalk, 'language'],
  ['a streaming session', streaming, 'not-installed'],
  ['the hosted realtime adapter', realtime, 'language'],
] as const;

function harness(double: Double, chart = 'patient-1') {
  const box: string[] = [];
  const rendered = renderHook(
    ({ chartPatientId }: { chartPatientId: string }) =>
      useDictation(double.port, 'en', chartPatientId, (text) => box.push(text)),
    { initialProps: { chartPatientId: chart } }
  );
  return { ...rendered, box };
}

async function ready(double: Double) {
  const harnessed = harness(double);
  await waitFor(() => {
    expect(harnessed.result.current.availability.status).toBe('available');
  });
  return harnessed;
}

describe.each(ADAPTERS)('the microphone, through %s', (_label, build) => {
  it('opens nothing until a press, and then opens exactly one', async () => {
    const double = build();
    const { result } = await ready(double);

    expect(double.opened).toEqual([]);

    act(() => {
      result.current.start();
    });

    expect(double.opened).toHaveLength(1);
    expect(double.opened[0]?.language).toBe('en');
    expect(result.current.state.phase).toBe('listening');
  });

  it('carries the page language and nothing about the record', async () => {
    const double = build();
    const { result } = await ready(double);

    act(() => {
      result.current.start();
    });

    /* The whole session, asserted as a whole rather than field by field: a
       recogniser that is never told whose portal it is listening in cannot widen
       what it hears, whatever it is wired to. A new field added here has to be
       defended in this assertion first. */
    expect(Object.keys(double.opened[0] ?? {}).sort()).toEqual(['id', 'language']);
  });

  it('puts the settled words in the box and nothing else', async () => {
    const double = build();
    const { result, box } = await ready(double);

    act(() => {
      result.current.start();
    });
    const session = double.opened[0]?.id ?? '';

    act(() => {
      double.say(session, 'when is my', false);
    });
    expect(box).toEqual([]);

    act(() => {
      double.say(session, 'when is my appointment', true);
    });
    expect(box).toEqual(['when is my appointment']);
  });

  it('closes when the recogniser says it is done', async () => {
    const double = build();
    const { result } = await ready(double);

    act(() => {
      result.current.start();
    });
    act(() => {
      double.finish(double.opened[0]?.id ?? '');
    });

    expect(result.current.state.phase).toBe('idle');
    expect(result.current.state.session).toBeNull();
  });

  it('says why nothing was heard when the microphone was refused', async () => {
    const double = build();
    const { result } = await ready(double);

    act(() => {
      result.current.start();
    });
    act(() => {
      double.fail(double.opened[0]?.id ?? '', 'denied');
    });

    expect(result.current.state).toMatchObject({ phase: 'idle', ended: 'denied' });
  });

  it('keeps what was said when the reader stops, rather than throwing it away', async () => {
    const double = build();
    const { result, box } = await ready(double);

    act(() => {
      result.current.start();
    });
    const session = double.opened[0]?.id ?? '';

    act(() => {
      result.current.stop();
    });
    expect(double.stops()).toBe(1);
    expect(double.aborts()).toBe(0);

    act(() => {
      double.say(session, 'what do I owe', true);
      double.finish(session);
    });

    expect(box).toEqual(['what do I owe']);
  });

  it('closes the microphone and drops the words when the record changes', async () => {
    const double = build();
    const box: string[] = [];
    const { result, rerender } = renderHook(
      ({ chartPatientId }: { chartPatientId: string }) =>
        useDictation(double.port, 'en', chartPatientId, (text) => box.push(text)),
      { initialProps: { chartPatientId: 'patient-1' } }
    );
    await waitFor(() => {
      expect(result.current.availability.status).toBe('available');
    });

    act(() => {
      result.current.start();
    });
    const session = double.opened[0]?.id ?? '';

    act(() => {
      rerender({ chartPatientId: 'patient-2' });
    });

    expect(double.aborts()).toBe(1);
    expect(result.current.state.session).toBeNull();

    /* The one the second double really produces: a last result for a session
       this surface has already abandoned. It must not finish a sentence into a
       question about somebody else's record. */
    act(() => {
      double.say(session, 'my address is', true);
      double.finish(session);
    });

    expect(box).toEqual([]);
    expect(result.current.state.session).toBeNull();
  });

  it('closes the microphone and drops the words when the page goes out of sight', async () => {
    const double = build();
    const { result, box } = await ready(double);

    act(() => {
      result.current.start();
    });
    const session = double.opened[0]?.id ?? '';

    act(() => {
      hidePage();
    });

    expect(double.aborts()).toBe(1);
    expect(result.current.state.session).toBeNull();

    /* The one a real recogniser produces on the way out: a last settled result
       for a session this surface has already abandoned. It must not land in a
       box on a page nobody is looking at, to be sent when they come back. */
    act(() => {
      double.say(session, 'my date of birth is', true);
      double.finish(session);
    });

    expect(box).toEqual([]);

    /* Coming back does not reopen it. One press is one question, and the press
       that opened this one was for a page the reader has since left. */
    act(() => {
      showPage();
    });

    expect(double.opened).toHaveLength(1);
    expect(result.current.state.phase).toBe('idle');
  });

  it('closes the microphone when the page is left behind', async () => {
    const double = build();
    const { result, unmount } = await ready(double);

    act(() => {
      result.current.start();
    });
    unmount();

    expect(double.aborts()).toBe(1);
  });

  it('ignores words for a session nobody is waiting on', async () => {
    const double = build();
    const { result, box } = await ready(double);

    act(() => {
      result.current.start();
    });
    act(() => {
      double.ghost();
    });

    expect(box).toEqual([]);
    expect(result.current.state.heard).toBe('');
  });
});

describe('a device that cannot do this on its own', () => {
  it.each(ADAPTERS)('opens nothing, through %s', async (_label, build, reason) => {
    const double = build('unavailable');
    const { result } = harness(double);

    /* The double's own reason, not merely "unavailable": this hook reports
       `no-adapter` from mount, so waiting for the status alone is a wait that
       has already finished before the browser was asked. */
    await waitFor(() => {
      expect(result.current.availability).toEqual({ status: 'unavailable', reason });
    });

    act(() => {
      result.current.start();
    });

    expect(double.opened).toEqual([]);
    expect(result.current.state.session).toBeNull();
  });

  it('reports no adapter while the browser is still being asked', () => {
    const { result } = harness(pushToTalk());

    /* Before the answer arrives there is no control at all, rather than one that
       appears and then withdraws. */
    expect(result.current.availability).toEqual({ status: 'unavailable', reason: 'no-adapter' });
  });

  it('reports no adapter, and opens nothing, where there is no port', () => {
    const onDictated = vi.fn();
    const { result } = renderHook(() => useDictation(null, 'en', 'patient-1', onDictated));

    act(() => {
      result.current.start();
      result.current.stop();
    });

    expect(result.current.availability).toEqual({ status: 'unavailable', reason: 'no-adapter' });
    expect(onDictated).not.toHaveBeenCalled();
  });

  it('does not answer into a surface that has gone', async () => {
    let answer: (value: CaptureAvailability) => void = () => undefined;
    const port: CapturePort = {
      available: () =>
        new Promise<CaptureAvailability>((resolve) => {
          answer = resolve;
        }),
      onEvent: () => () => undefined,
      start: () => undefined,
      stop: () => undefined,
      abort: () => undefined,
    };

    const { result, unmount } = renderHook(() =>
      useDictation(port, 'en', 'patient-1', () => undefined)
    );
    unmount();

    /* The browser was still looking when the reader left. Setting state into an
       unmounted surface is React's warning; the reason it matters here is that
       the answer would be about a page nobody is on. */
    await act(async () => {
      answer({ status: 'available' });
    });

    expect(result.current.availability).toEqual({ status: 'unavailable', reason: 'no-adapter' });
  });

  /*
   * A browser that throws the question has not answered it.
   *
   * The two assertions are for two different failures. The availability one is
   * the behaviour: a rejection is the same no that a missing recogniser gets,
   * so nothing draws and nothing opens. The unhandled-rejection one is the
   * reason this has a `.catch` at all, and it is the only assertion here that
   * can tell a handled rejection from an unhandled one - both leave the surface
   * reporting `no-adapter`, because that is what this hook reports until it has
   * a yes.
   */
  it('refuses, and handles the rejection, when the browser throws the question', async () => {
    const unhandled: unknown[] = [];
    const record = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', record);

    const opened: CaptureSession[] = [];
    const port: CapturePort = {
      available: () => Promise.reject(new Error('malformed language tag')),
      onEvent: () => () => undefined,
      start: (session) => {
        opened.push(session);
      },
      stop: () => undefined,
      abort: () => undefined,
    };

    try {
      const { result } = renderHook(() => useDictation(port, 'en', 'patient-1', () => undefined));

      /* A macrotask, not a microtask: Node decides a rejection is unhandled one
         turn of the loop after it settles, so a test that only flushes
         microtasks passes with no `.catch` at all. */
      await act(async () => {
        await new Promise((resolve) => {
          setTimeout(resolve, 0);
        });
      });

      act(() => {
        result.current.start();
      });

      expect(result.current.availability).toEqual({ status: 'unavailable', reason: 'no-adapter' });
      expect(opened).toEqual([]);
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', record);
    }
  });

  /*
   * A refusal about the language the page has left cannot take the control away.
   *
   * This is the rejection half of the guard the resolved path already has, and
   * it is the arm with a consequence: the stale answer here is a *no*, so
   * without the guard a slow rejection about the previous language lands on top
   * of a good answer about the current one and the microphone disappears from a
   * device that can use it.
   */
  it('drops a rejection about a language the page has left', async () => {
    let refuseEnglish: (reason: Error) => void = () => undefined;
    const port: CapturePort = {
      available: (language) =>
        language === 'en'
          ? new Promise<CaptureAvailability>((_resolve, reject) => {
              refuseEnglish = reject;
            })
          : Promise.resolve<CaptureAvailability>({ status: 'available' }),
      onEvent: () => () => undefined,
      start: () => undefined,
      stop: () => undefined,
      abort: () => undefined,
    };

    const { result, rerender } = renderHook(
      ({ language }: { language: string }) =>
        useDictation(port, language, 'patient-1', () => undefined),
      { initialProps: { language: 'en' } }
    );

    rerender({ language: 'es' });
    await waitFor(() => {
      expect(result.current.availability).toEqual({ status: 'available' });
    });

    await act(async () => {
      refuseEnglish(new Error('asked too late'));
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    });

    expect(result.current.availability).toEqual({ status: 'available' });
  });

  it('asks about the language of the page, and asks again when it changes', async () => {
    const asked: string[] = [];
    const port: CapturePort = {
      available: async (language) => {
        asked.push(language);
        return { status: 'available' };
      },
      onEvent: () => () => undefined,
      start: () => undefined,
      stop: () => undefined,
      abort: () => undefined,
    };

    const { rerender } = renderHook(
      ({ language }: { language: string }) =>
        useDictation(port, language, 'patient-1', () => undefined),
      { initialProps: { language: 'en' } }
    );

    await waitFor(() => {
      expect(asked).toEqual(['en']);
    });

    rerender({ language: 'es' });
    await waitFor(() => {
      expect(asked).toEqual(['en', 'es']);
    });
  });
});
