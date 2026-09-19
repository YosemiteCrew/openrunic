import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useReadback } from '@/components/assistant';
import type { AssistantTurn } from '@/components/assistant';
import type { ReadbackEvent, ReadbackPort, Utterance } from '@/lib/voice';

/**
 * One contract, two adapters that share nothing but it.
 *
 * The claim this file exists to check is that replacing the voice is an adapter
 * change: no rule about what may be read aloud lives in one. So every case
 * below runs twice, against two deterministic doubles - labelled as doubles,
 * because neither is a real synthesiser and no paid service is contacted here.
 *
 * They are built to be unalike in the way that matters. The first is a
 * one-shot text-to-speech stage, called once per answer, which suppresses its
 * own events after a cancel. The second is a duplex session with its own event
 * vocabulary and a queue, which does **not** suppress anything: it reports an
 * ending for an utterance that was already cancelled, exactly as a browser
 * does. Both must produce the same answer, and the second is the one that shows
 * the core is doing the work rather than the adapter being polite.
 */

interface Double {
  port: ReadbackPort;
  /** Everything the adapter was asked to say, in order. */
  said: Utterance[];
  finish: (id: string) => void;
  fail: (id: string) => void;
  /** An ending for an utterance nobody asked about. Every adapter can produce one. */
  ghost: () => void;
}

/** A single text-to-speech stage, called once per answer. It polices its own cancels. */
function oneShot(): Double {
  const said: Utterance[] = [];
  let live: { id: string; emit: (event: ReadbackEvent) => void } | null = null;

  const end = (type: 'finished' | 'failed') => (id: string) => {
    if (live?.id !== id) return;
    const { emit } = live;
    live = null;
    emit({ type, id });
  };

  return {
    said,
    port: {
      capabilities: () => ({ languages: ['en-GB'], interruption: true }),
      subscribe: () => () => undefined,
      speak: (utterance, emit) => {
        said.push(utterance);
        live = { id: utterance.id, emit };
        emit({ type: 'started', id: utterance.id });
      },
      cancel: () => {
        live = null;
      },
    },
    finish: end('finished'),
    fail: end('failed'),
    ghost: () => {
      live?.emit({ type: 'finished', id: 'an-utterance-nobody-asked-for' });
    },
  };
}

/**
 * A duplex session with a vendor's own event names, translated at the boundary.
 *
 * Cancelling it reports the utterance as complete, synchronously, which is
 * precisely what a browser's synthesiser does: `end` fires on an utterance that
 * was cancelled and on one that was read to the last word alike. Nothing
 * downstream is allowed to depend on an adapter being better behaved than this.
 */
function duplexSession(): Double {
  const said: Utterance[] = [];
  let emit: ((event: ReadbackEvent) => void) | null = null;
  let live: string | null = null;

  const vendor = (kind: 'audio.begin' | 'audio.complete' | 'audio.error', ref: string) => {
    const translated = {
      'audio.begin': 'started',
      'audio.complete': 'finished',
      'audio.error': 'failed',
    } as const;
    emit?.({ type: translated[kind], id: ref });
  };

  return {
    said,
    port: {
      capabilities: () => ({ languages: ['en-US', 'es-ES'], interruption: true }),
      subscribe: () => () => undefined,
      speak: (utterance, next) => {
        said.push(utterance);
        emit = next;
        live = utterance.id;
        vendor('audio.begin', utterance.id);
      },
      cancel: () => {
        if (live === null) return;
        vendor('audio.complete', live);
        live = null;
      },
    },
    finish: (id) => {
      vendor('audio.complete', id);
    },
    fail: (id) => {
      vendor('audio.error', id);
    },
    ghost: () => {
      vendor('audio.complete', 'an-utterance-nobody-asked-for');
    },
  };
}

const ANSWERED: AssistantTurn = {
  id: 'turn-1',
  question: 'What do I owe?',
  answer: 'Your balance is 40 pounds, due on 2 April.',
  steps: [],
  sources: [
    { resourceType: 'Bill', resourceId: 'b-1', label: 'April statement', untrusted: false },
  ],
  failures: [],
  deferrals: [],
  outcome: 'completed',
  withheld: 'none',
};

const UNSOURCED: AssistantTurn = {
  ...ANSWERED,
  id: 'turn-2',
  answer: '',
  sources: [],
  withheld: 'unsourced',
};

interface Props {
  turns: readonly AssistantTurn[];
  chart: string;
  port: ReadbackPort | null;
}

function drive(port: ReadbackPort) {
  return renderHook(
    ({ turns, chart, port: current }: Props) => useReadback(current, 'en', turns, chart),
    {
      initialProps: {
        turns: [] as readonly AssistantTurn[],
        chart: 'patient-1',
        port: port as ReadbackPort | null,
      },
    }
  );
}

/* A fresh double per test. Sharing one would let an utterance from the case
   before leak into the count the case after asserts on. */
describe.each([
  ['a one-shot text-to-speech stage', oneShot],
  ['a duplex session with its own event names', duplexSession],
] as const)('%s', (_name, build) => {
  let double: Double;

  beforeEach(() => {
    double = build();
  });

  it('reads the answer that is on the screen, and hands over nothing else', () => {
    const { result, rerender } = drive(double.port);

    act(() => {
      result.current.toggle();
    });
    rerender({ turns: [ANSWERED], chart: 'patient-1', port: double.port });

    expect(double.said).toEqual([
      { id: 'turn-1', text: 'Your balance is 40 pounds, due on 2 April.', language: 'en' },
    ]);
    /* The whole of what crosses this boundary. No chart, no record id, no
       question, and no way for an adapter to ask for one. */
    expect(Object.keys(double.said[0] ?? {}).sort()).toEqual(['id', 'language', 'text']);
  });

  it('records an answer read to the end as heard', () => {
    const { result, rerender } = drive(double.port);

    act(() => {
      result.current.toggle();
    });
    rerender({ turns: [ANSWERED], chart: 'patient-1', port: double.port });
    act(() => {
      double.finish('turn-1');
    });

    expect(result.current.state.ended).toBe('heard');
    expect(result.current.state.speaking).toBeNull();
  });

  it('never records an answer the reader stopped as heard, whatever the adapter says next', () => {
    const { result, rerender } = drive(double.port);

    act(() => {
      result.current.toggle();
    });
    rerender({ turns: [ANSWERED], chart: 'patient-1', port: double.port });
    act(() => {
      result.current.stop();
    });
    act(() => {
      double.finish('turn-1');
    });

    expect(result.current.state.ended).toBe('interrupted');
  });

  it('ignores an ending for an utterance it is not waiting on', () => {
    const { result, rerender } = drive(double.port);

    act(() => {
      result.current.toggle();
    });
    rerender({ turns: [ANSWERED], chart: 'patient-1', port: double.port });
    act(() => {
      double.ghost();
    });

    expect(result.current.state.speaking).toEqual({
      turnId: 'turn-1',
      text: ANSWERED.answer,
    });
    expect(result.current.state.ended).toBe('none');
  });

  it('says a voice that could not speak, rather than going quiet', () => {
    const { result, rerender } = drive(double.port);

    act(() => {
      result.current.toggle();
    });
    rerender({ turns: [ANSWERED], chart: 'patient-1', port: double.port });
    act(() => {
      double.fail('turn-1');
    });

    expect(result.current.state.ended).toBe('failed');
  });

  it('never offers an answer whose records did not arrive', () => {
    const { result, rerender } = drive(double.port);

    act(() => {
      result.current.toggle();
    });
    rerender({ turns: [UNSOURCED], chart: 'patient-1', port: double.port });

    expect(double.said).toEqual([]);
    expect(result.current.state.speaking).toBeNull();
  });

  it('stays silent while the switch is off, and stays silent about what it missed', () => {
    const { result, rerender } = drive(double.port);

    rerender({ turns: [ANSWERED], chart: 'patient-1', port: double.port });
    act(() => {
      result.current.toggle();
    });

    expect(double.said).toEqual([]);
    expect(result.current.state.attempted).toEqual(['turn-1']);
    expect(result.current.state.speaking).toBeNull();
  });

  it('stops the voice when the switch is turned off, and does not call that heard', () => {
    const { result, rerender } = drive(double.port);

    act(() => {
      result.current.toggle();
    });
    rerender({ turns: [ANSWERED], chart: 'patient-1', port: double.port });
    act(() => {
      result.current.toggle();
    });
    act(() => {
      double.finish('turn-1');
    });

    expect(result.current.state.on).toBe(false);
    expect(result.current.state.ended).toBe('interrupted');
  });

  it('settles as an interruption when the voice disappears mid-answer', () => {
    /* A device can lose its voices while it is using one. Left alone the
       surface would say "reading the answer aloud" for ever, over silence. */
    const { result, rerender } = drive(double.port);

    act(() => {
      result.current.toggle();
    });
    rerender({ turns: [ANSWERED], chart: 'patient-1', port: double.port });
    rerender({ turns: [ANSWERED], chart: 'patient-1', port: null });

    expect(result.current.state.speaking).toBeNull();
    expect(result.current.state.on).toBe(false);
    expect(result.current.state.ended).toBe('interrupted');
  });

  it('forgets the voice and the consent when the record underneath changes', () => {
    const { result, rerender } = drive(double.port);

    act(() => {
      result.current.toggle();
    });
    rerender({ turns: [ANSWERED], chart: 'patient-1', port: double.port });
    rerender({ turns: [], chart: 'patient-2', port: double.port });

    expect(result.current.state.on).toBe(false);
    expect(result.current.state.speaking).toBeNull();
    expect(result.current.state.attempted).toEqual([]);
  });
});
