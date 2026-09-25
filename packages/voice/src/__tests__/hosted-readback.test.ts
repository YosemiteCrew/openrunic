import { describe, expect, it, vi } from 'vitest';
import { createHostedReadback } from '../hosted-readback.js';
import type { HostedSynthesiser, PlaybackHandlers } from '../hosted-readback.js';
import type { ReadbackEvent } from '../ports.js';

/**
 * What the contract suite cannot reach: the refusal to exist without named
 * egress, what crosses to the synthesiser, and a synthesiser that settles or
 * throws before it has handed its playback back. Scripted throughout; no
 * service is contacted.
 */

const EGRESS = { endpoint: 'the configured voice endpoint', agreement: 'a named agreement' };

interface Script {
  synthesiser: HostedSynthesiser;
  heard: { text: string; language: string }[];
  handlers: PlaybackHandlers[];
  stops: ReturnType<typeof vi.fn>[];
}

function scripted(onPlay?: (handlers: PlaybackHandlers) => void): Script {
  const script: Script = {
    heard: [],
    handlers: [],
    stops: [],
    synthesiser: {
      languages: ['en-GB', 'es'],
      play: (speech, handlers) => {
        script.heard.push(speech);
        script.handlers.push(handlers);
        onPlay?.(handlers);
        const stop = vi.fn();
        script.stops.push(stop);
        return { stop };
      },
    },
  };
  return script;
}

function listen(script: Script) {
  const port = createHostedReadback(script.synthesiser, EGRESS);
  if (port === null) throw new Error('a synthesiser was supplied');
  const events: ReadbackEvent[] = [];
  port.onEvent((event) => events.push(event));
  return { port, events };
}

describe('createHostedReadback', () => {
  it('is absent when no synthesiser is configured', () => {
    expect(createHostedReadback(null, null)).toBeNull();
  });

  it.each([
    ['no egress at all', null],
    ['no endpoint', { endpoint: ' ', agreement: 'a named agreement' }],
    ['no agreement', { endpoint: 'the configured voice endpoint', agreement: '' }],
  ])('refuses to exist with %s', (_name, egress) => {
    expect(() => createHostedReadback(scripted().synthesiser, egress)).toThrow(/ADR-0005 rule 6/);
  });

  it('hands the synthesiser the words and the language, and not the turn', () => {
    const script = scripted();
    const { port } = listen(script);

    port.speak({ id: 'turn-1', text: 'Your balance is 40 pounds.', language: 'en-GB' });

    expect(script.heard).toEqual([{ text: 'Your balance is 40 pounds.', language: 'en-GB' }]);
  });

  it('reports the configured languages and that it can be interrupted', () => {
    const { port } = listen(scripted());

    expect(port.capabilities()).toEqual({ languages: ['en-GB', 'es'], interruption: true });
    const unsubscribe = port.onCapabilities(() => undefined);
    expect(unsubscribe()).toBeUndefined();
  });

  it('reports a playback from start to finish under the id it was asked for', () => {
    const script = scripted();
    const { port, events } = listen(script);

    port.speak({ id: 'turn-1', text: 'One.', language: 'en-GB' });
    script.handlers[0]?.started();
    script.handlers[0]?.finished();
    /* A second ending for a settled playback is not a second answer heard. */
    script.handlers[0]?.finished();

    expect(events).toEqual([
      { type: 'started', id: 'turn-1' },
      { type: 'finished', id: 'turn-1' },
    ]);
  });

  it('reports a failed playback as failed', () => {
    const script = scripted();
    const { port, events } = listen(script);

    port.speak({ id: 'turn-1', text: 'One.', language: 'en-GB' });
    script.handlers[0]?.failed();

    expect(events).toEqual([{ type: 'failed', id: 'turn-1' }]);
  });

  it('stops the answer it replaces, and drops what that answer says afterwards', () => {
    const script = scripted();
    const { port, events } = listen(script);

    port.speak({ id: 'turn-1', text: 'One.', language: 'en-GB' });
    port.speak({ id: 'turn-2', text: 'Two.', language: 'en-GB' });
    script.handlers[0]?.started();
    script.handlers[0]?.finished();

    expect(script.stops[0]).toHaveBeenCalledTimes(1);
    expect(script.stops[1]).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it('stops the sound on cancel, calls nothing a finish, and is safe when silent', () => {
    const script = scripted();
    const { port, events } = listen(script);

    port.cancel();
    port.speak({ id: 'turn-1', text: 'One.', language: 'en-GB' });
    port.cancel();
    port.cancel();
    script.handlers[0]?.finished();

    expect(script.stops[0]).toHaveBeenCalledTimes(1);
    expect(events).toEqual([]);
  });

  it('stops a playback that settled before it was handed back', () => {
    const script = scripted((handlers) => handlers.failed());
    const { port, events } = listen(script);

    port.speak({ id: 'turn-1', text: 'One.', language: 'en-GB' });
    port.cancel();

    expect(events).toEqual([{ type: 'failed', id: 'turn-1' }]);
    expect(script.stops[0]).toHaveBeenCalledTimes(1);
  });

  it('turns a synthesiser that throws into one failure, not an exception', () => {
    const { port, events } = listen({
      heard: [],
      handlers: [],
      stops: [],
      synthesiser: {
        languages: ['en-GB'],
        play: () => {
          throw new Error('no connection');
        },
      },
    });

    expect(() => port.speak({ id: 'turn-1', text: 'One.', language: 'en-GB' })).not.toThrow();
    expect(events).toEqual([{ type: 'failed', id: 'turn-1' }]);
  });

  it('stops telling a listener that unsubscribed', () => {
    const script = scripted();
    const port = createHostedReadback(script.synthesiser, EGRESS);
    const listener = vi.fn();
    const unsubscribe = port?.onEvent(listener);
    unsubscribe?.();

    port?.speak({ id: 'turn-1', text: 'One.', language: 'en-GB' });
    script.handlers[0]?.started();

    expect(listener).not.toHaveBeenCalled();
  });
});
