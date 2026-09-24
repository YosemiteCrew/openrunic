import { describe, expect, it } from 'vitest';
import { createRealtimeCapture } from '../index.js';
import type { CaptureEvent, RealtimeHandlers, RealtimeTransport } from '../index.js';

/**
 * The hosted realtime adapter, over a scripted connection.
 *
 * A double of the wire, not of the service: no audio is produced, nothing is
 * sent anywhere and no paid endpoint is contacted. The contract it shares with
 * the other recognisers is in `dictation-contract.test.ts`; this file is the part
 * only a hosted session has - the egress it needs, the vendor events it reads,
 * and everything else the service can say that must go nowhere.
 */

const EGRESS = {
  endpoint: 'the endpoint a deployer configured',
  agreement: 'the agreement a deployer named',
};

const SESSION = { id: 'session-1', language: 'en' };

function wire(
  languages: readonly string[] = ['en-US'],
  turnDetection: RealtimeTransport['turnDetection'] = 'server'
) {
  const handlers: RealtimeHandlers[] = [];
  const asked: unknown[] = [];
  const sent: unknown[] = [];
  let closes = 0;
  const transport: RealtimeTransport = {
    languages,
    turnDetection,
    open: (session, handed) => {
      asked.push(session);
      handlers.push(handed);
      return {
        send: (message) => sent.push(message),
        close: () => {
          closes += 1;
        },
      };
    },
  };
  return { transport, handlers, asked, sent, closes: () => closes };
}

function capture(transport: RealtimeTransport) {
  const port = createRealtimeCapture(transport, EGRESS);
  if (port === null) throw new Error('unreachable: a transport was supplied');
  const seen: CaptureEvent[] = [];
  port.onEvent((event) => seen.push(event));
  return { port, seen };
}

const delta = (item: string, text: string) => ({
  type: 'conversation.item.input_audio_transcription.delta',
  item_id: item,
  delta: text,
});

const started = (item: string) => ({ type: 'input_audio_buffer.speech_started', item_id: item });
const committed = (item: string) => ({ type: 'input_audio_buffer.committed', item_id: item });

const completed = (item: string, text: string) => ({
  type: 'conversation.item.input_audio_transcription.completed',
  item_id: item,
  transcript: text,
});

describe('configuring a recogniser that sends audio away', () => {
  it('is absent where no transport is configured', () => {
    expect(createRealtimeCapture(null, null)).toBeNull();
  });

  it.each([
    ['no egress at all', null],
    ['an endpoint without the agreement', { endpoint: EGRESS.endpoint, agreement: '' }],
    ['the agreement without an endpoint', { endpoint: ' ', agreement: EGRESS.agreement }],
  ])('refuses to start with %s', (_label, egress) => {
    expect(() => createRealtimeCapture(wire().transport, egress)).toThrow(/ADR-0005 rule 6/);
  });

  it('answers about the page language by primary subtag, before anything opens', async () => {
    const { transport, asked } = wire(['en-US', 'es']);
    const { port } = capture(transport);

    expect(await port.available('en')).toEqual({ status: 'available' });
    expect(await port.available('es-MX')).toEqual({ status: 'available' });
    expect(await port.available('fr')).toEqual({ status: 'unavailable', reason: 'language' });
    expect(asked).toEqual([]);
  });
});

describe('a session', () => {
  it('hands the transport the language and nothing else', () => {
    const { transport, asked } = wire();
    const { port } = capture(transport);

    port.start(SESSION);

    expect(asked).toEqual([{ language: 'en' }]);
  });

  it('says listening when the transport says audio is flowing, not on the press', () => {
    const { transport, handlers } = wire();
    const { port, seen } = capture(transport);

    port.start(SESSION);
    expect(seen).toEqual([]);

    handlers[0]?.listening();
    expect(seen).toEqual([{ type: 'listening', id: 'session-1' }]);
  });

  it('builds interim words from deltas and settles each item once', () => {
    const { transport, handlers } = wire();
    const { port, seen } = capture(transport);
    port.start(SESSION);
    const on = handlers[0];

    on?.message(delta('a', 'when is '));
    on?.message(delta('a', 'my visit'));
    on?.message(completed('a', 'when is my visit'));
    /* The service repeating itself, and a delta arriving after its item settled. */
    on?.message(completed('a', 'when is my visit'));
    on?.message(delta('a', ' again'));

    expect(seen).toEqual([
      { type: 'heard', id: 'session-1', text: 'when is ', final: false },
      { type: 'heard', id: 'session-1', text: 'when is my visit', final: false },
      { type: 'heard', id: 'session-1', text: 'when is my visit', final: true },
    ]);
  });

  it('keeps separate items apart', () => {
    const { transport, handlers } = wire();
    const { port, seen } = capture(transport);
    port.start(SESSION);

    handlers[0]?.message(delta('a', 'first'));
    handlers[0]?.message(delta('b', 'second'));

    expect(seen.map((event) => (event.type === 'heard' ? event.text : event.type))).toEqual([
      'first',
      'second',
    ]);
  });

  it('drops anything malformed without failing the session', () => {
    const { transport, handlers } = wire();
    const { port, seen } = capture(transport);
    port.start(SESSION);
    const on = handlers[0];

    for (const junk of [
      null,
      'a string',
      42,
      {},
      { type: 7 },
      { type: 'conversation.item.input_audio_transcription.delta', delta: 'no item' },
      { type: 'conversation.item.input_audio_transcription.completed', item_id: 'a' },
      { type: 'conversation.item.input_audio_transcription.delta', item_id: 'a', delta: 3 },
    ]) {
      on?.message(junk);
    }

    expect(seen).toEqual([]);
    on?.message(completed('a', 'still listening'));
    expect(seen).toEqual([
      { type: 'heard', id: 'session-1', text: 'still listening', final: true },
    ]);
  });

  it('puts nothing the service says on its own into the box', () => {
    const { transport, handlers, sent } = wire();
    const { port, seen } = capture(transport);
    port.start(SESSION);

    /* A reply, its audio, its transcript and a tool call, arriving on the live
       connection. The adapter never asked for any of them. */
    for (const type of [
      'response.output_text.delta',
      'response.output_audio.delta',
      'response.output_audio_transcript.done',
      'response.function_call_arguments.done',
      'input_audio_buffer.speech_started',
    ]) {
      handlers[0]?.message({ type, item_id: 'reply', delta: 'x', transcript: 'x' });
    }

    expect(seen).toEqual([]);
    /* And it never asks: no response.create, no session change, nothing. */
    expect(sent).toEqual([]);
  });

  it.each([
    ['a service error', { type: 'error', error: { message: 'nope' } }],
    [
      'a failed transcription',
      { type: 'conversation.item.input_audio_transcription.failed', item_id: 'a' },
    ],
  ])('fails and closes on %s', (_label, message) => {
    const { transport, handlers, closes } = wire();
    const { port, seen } = capture(transport);
    port.start(SESSION);

    handlers[0]?.message(message);
    handlers[0]?.message(completed('a', 'too late'));

    expect(seen).toEqual([{ type: 'failed', id: 'session-1', reason: 'failed' }]);
    expect(closes()).toBe(1);
  });

  it('passes the transport’s own failure reason through', () => {
    const { transport, handlers } = wire();
    const { port, seen } = capture(transport);
    port.start(SESSION);

    handlers[0]?.failed('denied');

    expect(seen).toEqual([{ type: 'failed', id: 'session-1', reason: 'denied' }]);
  });

  it('reports a transport that throws as a failure, not an exception', () => {
    const { port, seen } = capture({
      languages: ['en'],
      turnDetection: 'server',
      open: () => {
        throw new Error('no microphone device');
      },
    });

    expect(() => port.start(SESSION)).not.toThrow();
    expect(seen).toEqual([{ type: 'failed', id: 'session-1', reason: 'failed' }]);
  });

  it('reports a transport that fails and then throws only once', () => {
    const { port, seen } = capture({
      languages: ['en'],
      turnDetection: 'server',
      open: (_session, handlers) => {
        handlers.failed('denied');
        throw new Error('and then gave up');
      },
    });

    port.start(SESSION);

    expect(seen).toEqual([{ type: 'failed', id: 'session-1', reason: 'denied' }]);
  });

  it('closes the connection a transport returns after failing inside open', () => {
    let closed = 0;
    const { port, seen } = capture({
      languages: ['en'],
      turnDetection: 'server',
      open: (_session, handlers) => {
        handlers.failed('no-audio');
        return {
          send: () => undefined,
          close: () => {
            closed += 1;
          },
        };
      },
    });

    port.start(SESSION);
    port.stop();

    expect(seen).toEqual([{ type: 'failed', id: 'session-1', reason: 'no-audio' }]);
    expect(closed).toBe(1);
  });
});

describe('ending a question', () => {
  it('commits once on stop while speech is uncommitted, and ends when it settles', () => {
    const { transport, handlers, sent, closes } = wire();
    const { port, seen } = capture(transport);
    port.start(SESSION);

    handlers[0]?.message(started('a'));
    handlers[0]?.message(delta('a', 'what do'));
    port.stop();
    port.stop();
    expect(sent).toEqual([{ type: 'input_audio_buffer.commit' }]);

    handlers[0]?.message(committed('a'));
    expect(closes()).toBe(0);

    handlers[0]?.message(completed('a', 'what do I owe'));

    expect(seen.slice(-2)).toEqual([
      { type: 'heard', id: 'session-1', text: 'what do I owe', final: true },
      { type: 'ended', id: 'session-1' },
    ]);
    expect(closes()).toBe(1);
  });

  it('waits for every item in flight, not the first to settle', () => {
    const { transport, handlers, sent } = wire();
    const { port, seen } = capture(transport);
    port.start(SESSION);
    const on = handlers[0];

    /* The service's own turn detection has already cut the question in two. */
    on?.message(started('a'));
    on?.message(committed('a'));
    on?.message(delta('a', 'my knee'));
    on?.message(started('b'));
    on?.message(committed('b'));
    on?.message(delta('b', 'still hurts'));

    port.stop();
    /* Both stretches are committed: the buffer is empty, so no commit. */
    expect(sent).toEqual([]);

    on?.message(completed('a', 'my knee'));
    expect(seen.at(-1)).toEqual({ type: 'heard', id: 'session-1', text: 'my knee', final: true });

    on?.message(completed('b', 'still hurts'));
    expect(seen.slice(-2)).toEqual([
      { type: 'heard', id: 'session-1', text: 'still hurts', final: true },
      { type: 'ended', id: 'session-1' },
    ]);
  });

  it('ends at once, without a commit, when everything has already settled', () => {
    const { transport, handlers, sent, closes } = wire();
    const { port, seen } = capture(transport);
    port.start(SESSION);

    handlers[0]?.message(started('a'));
    handlers[0]?.message(committed('a'));
    handlers[0]?.message(completed('a', 'when is my visit'));
    port.stop();

    expect(sent).toEqual([]);
    expect(seen.at(-1)).toEqual({ type: 'ended', id: 'session-1' });
    expect(closes()).toBe(1);
  });

  it('commits for speech the service heard start but has not transcribed a word of', () => {
    const { transport, handlers, sent } = wire();
    const { port, seen } = capture(transport);
    port.start(SESSION);

    handlers[0]?.message(started('a'));
    port.stop();

    expect(sent).toEqual([{ type: 'input_audio_buffer.commit' }]);
    expect(seen).toEqual([]);
  });

  it('under manual turn detection, always commits and waits for the item it made', () => {
    const { transport, handlers, sent } = wire(['en'], 'manual');
    const { port, seen } = capture(transport);
    port.start(SESSION);

    port.stop();
    expect(sent).toEqual([{ type: 'input_audio_buffer.commit' }]);
    /* Nothing is pending yet, and that is not the end: the commit is unanswered. */
    expect(seen).toEqual([]);

    handlers[0]?.message(committed('c'));
    expect(seen).toEqual([]);

    handlers[0]?.message(completed('c', 'what do I owe'));
    expect(seen).toEqual([
      { type: 'heard', id: 'session-1', text: 'what do I owe', final: true },
      { type: 'ended', id: 'session-1' },
    ]);
  });

  it('ignores bookkeeping events that name no item', () => {
    const { transport, handlers } = wire();
    const { port, seen } = capture(transport);
    port.start(SESSION);

    handlers[0]?.message({ type: 'input_audio_buffer.speech_started' });
    handlers[0]?.message({ type: 'input_audio_buffer.committed' });
    port.stop();

    expect(seen).toEqual([{ type: 'ended', id: 'session-1' }]);
  });

  it('does nothing on stop when nothing is open', () => {
    const { transport, sent } = wire();
    const { port } = capture(transport);

    port.stop();

    expect(sent).toEqual([]);
  });

  it('closes the connection on abort and drops what it still delivers', () => {
    const { transport, handlers, closes } = wire();
    const { port, seen } = capture(transport);
    port.start(SESSION);

    port.abort();
    handlers[0]?.listening();
    handlers[0]?.message(completed('a', 'my address is'));
    handlers[0]?.closed();
    handlers[0]?.failed('failed');

    expect(closes()).toBe(1);
    expect(seen).toEqual([]);
  });

  it('closes the previous connection when a new question starts', () => {
    const { transport, handlers, closes } = wire();
    const { port, seen } = capture(transport);

    port.start(SESSION);
    handlers[0]?.message(completed('a', 'the old question'));
    handlers[0]?.message(delta('b', 'half of the old'));
    port.start({ id: 'session-2', language: 'en' });
    handlers[0]?.message(completed('c', 'late from the old connection'));
    /* Item ids are the service's and restart with each session, so what the
       last session settled or half-heard is no reason to drop or extend these. */
    handlers[1]?.message(delta('b', 'the new'));
    handlers[1]?.message(completed('a', 'the new question'));

    expect(closes()).toBe(1);
    expect(seen.filter((event) => event.id === 'session-2')).toEqual([
      { type: 'heard', id: 'session-2', text: 'the new', final: false },
      { type: 'heard', id: 'session-2', text: 'the new question', final: true },
    ]);
    expect(seen.map((event) => (event.type === 'heard' ? event.text : ''))).not.toContain(
      'late from the old connection'
    );
  });

  it('ends when the service closes the connection', () => {
    const { transport, handlers } = wire();
    const { port, seen } = capture(transport);
    port.start(SESSION);

    handlers[0]?.closed();

    expect(seen).toEqual([{ type: 'ended', id: 'session-1' }]);
  });

  it('stops reporting to a listener that unsubscribed', () => {
    const { transport, handlers } = wire();
    const port = createRealtimeCapture(transport, EGRESS);
    const seen: CaptureEvent[] = [];
    const off = port?.onEvent((event) => seen.push(event));
    port?.start(SESSION);

    off?.();
    handlers[0]?.listening();

    expect(seen).toEqual([]);
  });
});
