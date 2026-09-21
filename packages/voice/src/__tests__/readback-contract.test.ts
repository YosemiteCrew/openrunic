import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { hidePage, showPage } from './visibility.js';
import { speakableTurns } from '../readback.js';
import { useReadback } from '../useReadback.js';
import type { ReadbackEvent, ReadbackPort, Utterance } from '../ports.js';

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
  /** How many times the voice was told to stop. */
  cancels: () => number;
  finish: (id: string) => void;
  fail: (id: string) => void;
  /** An ending for an utterance nobody asked about. Every adapter can produce one. */
  ghost: () => void;
}

/** A single text-to-speech stage, called once per answer. It polices its own cancels. */
function oneShot(): Double {
  const said: Utterance[] = [];
  const listeners = new Set<(event: ReadbackEvent) => void>();
  let live: string | null = null;
  let cancels = 0;

  const emit = (event: ReadbackEvent) => {
    for (const listener of listeners) listener(event);
  };

  const end = (type: 'finished' | 'failed') => (id: string) => {
    if (live !== id) return;
    live = null;
    emit({ type, id });
  };

  return {
    said,
    cancels: () => cancels,
    port: {
      capabilities: () => ({ languages: ['en-GB'], interruption: true }),
      onCapabilities: () => () => undefined,
      onEvent: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      speak: (utterance) => {
        said.push(utterance);
        live = utterance.id;
        emit({ type: 'started', id: utterance.id });
      },
      cancel: () => {
        cancels += 1;
        live = null;
      },
    },
    finish: end('finished'),
    fail: end('failed'),
    ghost: () => {
      emit({ type: 'finished', id: 'an-utterance-nobody-asked-for' });
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
  const listeners = new Set<(event: ReadbackEvent) => void>();
  let live: string | null = null;
  let cancels = 0;

  const vendor = (kind: 'audio.begin' | 'audio.complete' | 'audio.error', ref: string) => {
    const translated = {
      'audio.begin': 'started',
      'audio.complete': 'finished',
      'audio.error': 'failed',
    } as const;
    for (const listener of listeners) listener({ type: translated[kind], id: ref });
  };

  return {
    said,
    cancels: () => cancels,
    port: {
      capabilities: () => ({ languages: ['en-US', 'es-ES'], interruption: true }),
      onCapabilities: () => () => undefined,
      onEvent: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      speak: (utterance) => {
        said.push(utterance);
        live = utterance.id;
        vendor('audio.begin', utterance.id);
      },
      cancel: () => {
        cancels += 1;
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

/**
 * A turn, as little of one as the hook is allowed to know.
 *
 * The hook is generic over this on purpose: it is handed an id and a rule, and
 * the shape in between is the app's. The fields here are the two a real rule
 * turns on - whether the turn settled, and whether its sources arrived - so the
 * rule below is a real rule rather than a flag the test sets.
 */
interface Turn {
  id: string;
  answer: string;
  settled: boolean;
  sourced: boolean;
}

/**
 * The surface's rule, in its smallest honest form.
 *
 * Both apps' rules reduce to this: an answer is read aloud only when it is
 * finished and only when it is the checkable text already on the screen. The
 * hook never sees the clauses, which is the property under test - a surface
 * that learns a new reason to withhold does not have to teach the voice.
 */
function speakable(turn: Turn): string | null {
  if (!turn.settled) return null;
  if (!turn.sourced) return null;
  return turn.answer;
}

const ANSWERED: Turn = {
  id: 'turn-1',
  answer: 'Your balance is 40 pounds, due on 2 April.',
  settled: true,
  sourced: true,
};

/**
 * One turn, held still.
 *
 * Written once rather than inline at each rerender because a fresh array is a
 * changed transcript to every effect that watches one - which would make the
 * case below pass whatever it was pointed at.
 */
const ONE_ANSWER: readonly Turn[] = [ANSWERED];

const UNSOURCED: Turn = {
  ...ANSWERED,
  id: 'turn-2',
  answer: '',
  sourced: false,
};

interface Props {
  turns: readonly Turn[];
  scope: string;
  port: ReadbackPort | null;
}

function drive(port: ReadbackPort) {
  return renderHook(
    /* Mapped here rather than in the hook, the way a surface does it: what
       reaches the voice is a turn id and the string the screen shows, and the
       rule that decided so has already run. */
    ({ turns, scope, port: current }: Props) =>
      useReadback(current, 'en', speakableTurns(turns, speakable), scope),
    {
      initialProps: {
        turns: [] as readonly Turn[],
        scope: 'patient-1',
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
    rerender({ turns: [ANSWERED], scope: 'patient-1', port: double.port });

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
    rerender({ turns: [ANSWERED], scope: 'patient-1', port: double.port });
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
    rerender({ turns: [ANSWERED], scope: 'patient-1', port: double.port });
    act(() => {
      result.current.stop();
    });
    act(() => {
      double.finish('turn-1');
    });

    expect(result.current.state.ended).toBe('interrupted');
  });

  it('tells the voice to stop, rather than only saying so on screen', () => {
    /* Without this the surface could look interrupted while the device read the
       rest of the answer out to a room. */
    const { result, rerender } = drive(double.port);

    act(() => {
      result.current.toggle();
    });
    rerender({ turns: [ANSWERED], scope: 'patient-1', port: double.port });
    expect(double.cancels()).toBe(0);

    act(() => {
      result.current.stop();
    });

    expect(double.cancels()).toBe(1);
  });

  it('ignores an ending for an utterance it is not waiting on', () => {
    const { result, rerender } = drive(double.port);

    act(() => {
      result.current.toggle();
    });
    rerender({ turns: [ANSWERED], scope: 'patient-1', port: double.port });
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
    rerender({ turns: [ANSWERED], scope: 'patient-1', port: double.port });
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
    rerender({ turns: [UNSOURCED], scope: 'patient-1', port: double.port });

    expect(double.said).toEqual([]);
    expect(result.current.state.speaking).toBeNull();
  });

  it('stays silent while the switch is off, and stays silent about what it missed', () => {
    const { result, rerender } = drive(double.port);

    rerender({ turns: [ANSWERED], scope: 'patient-1', port: double.port });
    act(() => {
      result.current.toggle();
    });

    expect(double.said).toEqual([]);
    expect(result.current.state.attempted).toEqual(new Set(['turn-1']));
    expect(result.current.state.speaking).toBeNull();
  });

  it('stops the voice when the switch is turned off, and does not call that heard', () => {
    const { result, rerender } = drive(double.port);

    act(() => {
      result.current.toggle();
    });
    rerender({ turns: [ANSWERED], scope: 'patient-1', port: double.port });
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
    rerender({ turns: [ANSWERED], scope: 'patient-1', port: double.port });
    rerender({ turns: [ANSWERED], scope: 'patient-1', port: null });

    expect(result.current.state.speaking).toBeNull();
    expect(result.current.state.on).toBe(false);
    expect(result.current.state.ended).toBe('interrupted');
  });

  it('stops the voice and forgets the consent when the page goes out of sight', () => {
    const { result, rerender } = drive(double.port);

    act(() => {
      result.current.toggle();
    });
    rerender({ turns: [ANSWERED], scope: 'patient-1', port: double.port });

    act(() => {
      hidePage();
    });

    expect(double.cancels()).toBe(1);
    expect(result.current.state.speaking).toBeNull();
    expect(result.current.state.on).toBe(false);

    /* The half that matters more than the silence. An answer that settles while
       the screen is dark - which is exactly when one does, because the reader
       asked and then put the phone down - must not become audible to the room
       they are in. The switch being off is what stops it, and coming back does
       not turn it on again. */
    act(() => {
      showPage();
    });
    rerender({
      turns: [ANSWERED, { ...ANSWERED, id: 'turn-3' }],
      scope: 'patient-1',
      port: double.port,
    });

    expect(double.said.map((utterance) => utterance.id)).toEqual(['turn-1']);
  });

  it('reads a turn its rule has only just allowed, without the turn changing', () => {
    /* A surface's rule is not a constant: it can be waiting on the role, the
       locale or anything else the screen is waiting on, and it refuses until
       that arrives. The turn on screen does not change when it does. A hook
       that watched only the turns would have taken the refusal as final and
       left the answer unread with the switch on and nothing to say why. */
    const { result, rerender } = renderHook(
      ({ turns, allow }: { turns: readonly Turn[]; allow: boolean }) =>
        useReadback(
          double.port,
          'en',
          speakableTurns(turns, (turn) => (allow ? speakable(turn) : null)),
          'case-1'
        ),
      { initialProps: { turns: [] as readonly Turn[], allow: false } }
    );

    act(() => {
      result.current.toggle();
    });
    rerender({ turns: ONE_ANSWER, allow: false });
    expect(double.said).toEqual([]);

    rerender({ turns: ONE_ANSWER, allow: true });

    expect(double.said.map((utterance) => utterance.id)).toEqual(['turn-1']);
    /* And still only once, now that the rule lets it through: what stops a
       second reading is the record of what has been offered, not the rule
       holding still. */
    rerender({ turns: ONE_ANSWER, allow: true });
    expect(double.said).toHaveLength(1);
  });

  it('forgets the voice and the consent when the record underneath changes', () => {
    const { result, rerender } = drive(double.port);

    act(() => {
      result.current.toggle();
    });
    rerender({ turns: [ANSWERED], scope: 'patient-1', port: double.port });
    rerender({ turns: [], scope: 'patient-2', port: double.port });

    expect(result.current.state.on).toBe(false);
    expect(result.current.state.speaking).toBeNull();
    expect(result.current.state.attempted).toEqual(new Set());
  });
});
