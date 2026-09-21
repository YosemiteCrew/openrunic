import { describe, expect, it, beforeEach } from 'vitest';

import { NoOpSpeechAdapter, DeterministicTestSpeechAdapter } from './speech.js';
import type { SpeechCapability, SpeechEvent, SpeechSessionConfig } from './speech.js';

describe('NoOpSpeechAdapter', () => {
  let adapter: NoOpSpeechAdapter;
  const events: SpeechEvent[] = [];

  beforeEach(() => {
    adapter = new NoOpSpeechAdapter();
    events.length = 0;
  });

  const collectEvent = (event: SpeechEvent) => {
    events.push(event);
  };

  const config: SpeechSessionConfig = {
    sessionId: 'test-session',
    turnId: 'test-turn',
    surface: 'staff',
    chartId: 'test-chart',
    inputFormat: { sampleRate: 16000, channels: 1, encoding: 'pcm16' },
    outputFormat: { sampleRate: 24000, channels: 1, encoding: 'pcm16' },
    language: 'en-US',
    enablePartialTranscripts: true,
    supportsInterruption: false,
  };

  it('has correct name and providerId', () => {
    expect(adapter.name).toBe('No-op (speech disabled)');
    expect(adapter.providerId).toBe('noop');
    expect(adapter.capabilities.size).toBe(0);
  });

  it('reports all capabilities as unsupported', () => {
    const caps: SpeechCapability[] = [
      'realtime-streaming',
      'stt-streaming',
      'tts-streaming',
      'interruption-handling',
      'language-detection',
      'partial-transcripts',
    ];
    for (const cap of caps) {
      expect(adapter.checkCapability(cap).supported).toBe(false);
      expect(adapter.checkCapability(cap).reason).toBe('Speech is not configured');
    }
  });

  it('starts and ends session immediately', async () => {
    const handle = await adapter.startSession(config, collectEvent);
    expect(handle.sessionId).toBe('test-session');
    expect(handle.turnId).toBe('test-turn');
    expect(events).toHaveLength(2);
    const event0 = events[0];
    const event1 = events[1];
    expect(event0).toBeDefined();
    expect(event1).toBeDefined();
    if (event0 && event1) {
      expect(event0.type).toBe('session-started');
      expect(event1.type).toBe('session-ended');
      expect((event1 as Extract<SpeechEvent, { type: 'session-ended' }>).reason).toBe('completed');
    }
  });

  it('stopSession does not throw', async () => {
    const handle = await adapter.startSession(config, collectEvent);
    await expect(adapter.stopSession(handle, 'user')).resolves.toBeUndefined();
  });

  it('sendAudio does not throw', async () => {
    const handle = await adapter.startSession(config, collectEvent);
    await expect(adapter.sendAudio(handle, new Uint8Array([1, 2, 3]))).resolves.toBeUndefined();
  });

  it('speak does not throw', async () => {
    const handle = await adapter.startSession(config, collectEvent);
    await expect(adapter.speak(handle, 'test', 'turn-1')).resolves.toBeUndefined();
  });

  it('interrupt does not throw', async () => {
    const handle = await adapter.startSession(config, collectEvent);
    await expect(adapter.interrupt(handle, 'turn-1')).resolves.toBeUndefined();
  });
});

/**
 * These assert the events the adapter emits, not that its methods return.
 * A `does not throw` test passes over an adapter that builds a TTS payload
 * and drops it, which is what this one did: `speak` chunked and encoded a
 * response into a local that was immediately voided, and the fixture
 * transcripts handed to the constructor were never read at all.
 */
describe('DeterministicTestSpeechAdapter', () => {
  let adapter: DeterministicTestSpeechAdapter;
  const events: SpeechEvent[] = [];

  const collectEvent = (event: SpeechEvent) => {
    events.push(event);
  };

  const config: SpeechSessionConfig = {
    sessionId: 'test-session',
    turnId: 'test-turn',
    surface: 'staff',
    chartId: 'test-chart',
    inputFormat: { sampleRate: 16000, channels: 1, encoding: 'pcm16' },
    outputFormat: { sampleRate: 24000, channels: 1, encoding: 'pcm16' },
    language: 'en-US',
    enablePartialTranscripts: true,
    supportsInterruption: true,
  };

  const decode = (audio: Uint8Array) => new TextDecoder().decode(audio);

  beforeEach(() => {
    adapter = new DeterministicTestSpeechAdapter();
    events.length = 0;
  });

  it('has correct name and providerId', () => {
    expect(adapter.name).toBe('Deterministic test adapter');
    expect(adapter.providerId).toBe('test-deterministic');
  });

  it('reports supported capabilities', () => {
    expect(adapter.checkCapability('stt-streaming').supported).toBe(true);
    expect(adapter.checkCapability('tts-streaming').supported).toBe(true);
    expect(adapter.checkCapability('interruption-handling').supported).toBe(true);
    expect(adapter.checkCapability('partial-transcripts').supported).toBe(true);
    expect(adapter.checkCapability('realtime-streaming').supported).toBe(false);
    expect(adapter.checkCapability('language-detection').supported).toBe(false);
  });

  it('starts session and emits capture-started', async () => {
    const handle = await adapter.startSession(config, collectEvent);
    expect(handle.sessionId).toBe('test-session');
    expect(events.map((event) => event.type)).toEqual(['session-started', 'capture-started']);
  });

  describe('speak', () => {
    it('emits the chunks it encodes rather than dropping them', async () => {
      const handle = await adapter.startSession(config, collectEvent);
      events.length = 0;

      await adapter.speak(handle, 'anything', 'turn-1');

      expect(events.map((event) => event.type)).toEqual([
        'tts-started',
        'tts-chunk',
        'tts-finished',
      ]);
      const chunk = events[1];
      expect(chunk?.type).toBe('tts-chunk');
      if (chunk?.type !== 'tts-chunk') throw new Error('expected a tts-chunk');
      expect(decode(chunk.audio)).toBe('Response to: anything');
      expect(chunk.turnId).toBe('turn-1');
      expect(chunk.isLast).toBe(true);
    });

    it('speaks a configured response instead of the stub', async () => {
      adapter = new DeterministicTestSpeechAdapter(
        new Map(),
        new Map([['two requirements are missing', 'Imaging and notes are missing.']])
      );
      const handle = await adapter.startSession(config, collectEvent);
      events.length = 0;

      await adapter.speak(handle, 'two requirements are missing', 'turn-1');

      const started = events[0];
      if (started?.type !== 'tts-started') throw new Error('expected a tts-started');
      expect(started.text).toBe('Imaging and notes are missing.');
    });

    it('splits a long response and marks only the last chunk', async () => {
      // 250 characters against a 100-character chunk: three chunks, and the
      // boundary is what a single-chunk fixture could not have checked.
      const long = 'x'.repeat(250);
      adapter = new DeterministicTestSpeechAdapter(new Map(), new Map([['long', long]]));
      const handle = await adapter.startSession(config, collectEvent);
      events.length = 0;

      await adapter.speak(handle, 'long', 'turn-1');

      const chunks = events.filter((event) => event.type === 'tts-chunk');
      expect(chunks).toHaveLength(3);
      expect(chunks.map((chunk) => decode(chunk.audio).length)).toEqual([100, 100, 50]);
      expect(chunks.map((chunk) => chunk.sequence)).toEqual([1, 2, 3]);
      expect(chunks.map((chunk) => chunk.isLast)).toEqual([false, false, true]);
      expect(decode(chunks[0]!.audio) + decode(chunks[1]!.audio) + decode(chunks[2]!.audio)).toBe(
        long
      );
    });

    it('emits nothing once the session is closed', async () => {
      const handle = await adapter.startSession(config, collectEvent);
      await adapter.stopSession(handle, 'user');
      events.length = 0;

      await adapter.speak(handle, 'anything', 'turn-1');

      expect(events).toEqual([]);
    });
  });

  describe('sendAudio', () => {
    it('plays back the fixture lines for the turn, the last one as final', async () => {
      adapter = new DeterministicTestSpeechAdapter(
        new Map([['test-turn', ['missing prior', 'missing prior authorisation']]])
      );
      const handle = await adapter.startSession(config, collectEvent);
      events.length = 0;

      await adapter.sendAudio(handle, new Uint8Array([1, 2, 3]));
      await adapter.sendAudio(handle, new Uint8Array([4, 5, 6]));

      expect(events).toEqual([
        {
          type: 'transcript-partial',
          text: 'missing prior',
          turnId: 'test-turn',
          sequence: 1,
        },
        {
          type: 'transcript-final',
          text: 'missing prior authorisation',
          turnId: 'test-turn',
          sequence: 2,
        },
      ]);
    });

    it('stops once the fixture is exhausted', async () => {
      adapter = new DeterministicTestSpeechAdapter(new Map([['test-turn', ['only line']]]));
      const handle = await adapter.startSession(config, collectEvent);
      await adapter.sendAudio(handle, new Uint8Array([1]));
      events.length = 0;

      await adapter.sendAudio(handle, new Uint8Array([2]));

      expect(events).toEqual([]);
    });

    it('emits nothing once the session is closed', async () => {
      adapter = new DeterministicTestSpeechAdapter(new Map([['test-turn', ['only line']]]));
      const handle = await adapter.startSession(config, collectEvent);
      await adapter.stopSession(handle, 'user');
      events.length = 0;

      await adapter.sendAudio(handle, new Uint8Array([1]));

      expect(events).toEqual([]);
    });

    it('emits nothing for a turn the fixture says nothing about', async () => {
      adapter = new DeterministicTestSpeechAdapter(new Map([['another-turn', ['unrelated']]]));
      const handle = await adapter.startSession(config, collectEvent);
      events.length = 0;

      await adapter.sendAudio(handle, new Uint8Array([1]));

      expect(events).toEqual([]);
    });
  });

  describe('stopSession', () => {
    it('reports a clinician stopping as a stop', async () => {
      const handle = await adapter.startSession(config, collectEvent);
      events.length = 0;

      await adapter.stopSession(handle, 'user');

      expect(events).toEqual([
        { type: 'capture-stopped', reason: 'user' },
        { type: 'session-ended', sessionId: 'test-session', reason: 'stopped' },
      ]);
    });

    it.each(['revoked', 'context-change'] as const)(
      'reports %s as a revocation, not a clean stop',
      async (reason) => {
        // ADR-0005 keeps these apart: a logout or a context change taking the
        // session away is a different fact from the clinician ending it, and a
        // single arm over one of them cannot tell the two mappings apart.
        const handle = await adapter.startSession(config, collectEvent);
        events.length = 0;

        await adapter.stopSession(handle, reason);

        expect(events).toEqual([
          { type: 'capture-stopped', reason: 'revoked' },
          { type: 'session-ended', sessionId: 'test-session', reason: 'revoked' },
        ]);
      }
    );

    it('is inert the second time', async () => {
      const handle = await adapter.startSession(config, collectEvent);
      await adapter.stopSession(handle, 'user');
      events.length = 0;

      await adapter.stopSession(handle, 'user');

      expect(events).toEqual([]);
    });
  });

  describe('interrupt', () => {
    it('reports the interruption against the turn it names', async () => {
      const handle = await adapter.startSession(config, collectEvent);
      events.length = 0;

      await adapter.interrupt(handle, 'turn-7');

      expect(events).toHaveLength(1);
      const event = events[0];
      if (event?.type !== 'interruption-received') throw new Error('expected an interruption');
      expect(event.turnId).toBe('turn-7');
    });

    it('emits nothing once the session is closed', async () => {
      const handle = await adapter.startSession(config, collectEvent);
      await adapter.stopSession(handle, 'user');
      events.length = 0;

      await adapter.interrupt(handle, 'turn-7');

      expect(events).toEqual([]);
    });
  });

  it('keeps two open sessions on their own transcript cursors', async () => {
    // One `delivered` counter shared across sessions would let the second
    // session resume where the first stopped, which a single-session fixture
    // cannot detect.
    adapter = new DeterministicTestSpeechAdapter(new Map([['test-turn', ['first', 'second']]]));
    const other: SpeechEvent[] = [];
    const handleA = await adapter.startSession(config, collectEvent);
    const handleB = await adapter.startSession({ ...config, sessionId: 'other-session' }, (event) =>
      other.push(event)
    );
    events.length = 0;
    other.length = 0;

    await adapter.sendAudio(handleA, new Uint8Array([1]));
    await adapter.sendAudio(handleB, new Uint8Array([1]));

    expect(events.map((event) => ('text' in event ? event.text : null))).toEqual(['first']);
    expect(other.map((event) => ('text' in event ? event.text : null))).toEqual(['first']);
  });
});
