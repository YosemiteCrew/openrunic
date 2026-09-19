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

describe('DeterministicTestSpeechAdapter', () => {
  let adapter: DeterministicTestSpeechAdapter;
  const events: SpeechEvent[] = [];

  beforeEach(() => {
    adapter = new DeterministicTestSpeechAdapter();
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
    supportsInterruption: true,
  };

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
    expect(events).toHaveLength(2);
    const event0 = events[0];
    const event1 = events[1];
    expect(event0).toBeDefined();
    expect(event1).toBeDefined();
    if (event0 && event1) {
      expect(event0.type).toBe('session-started');
      expect(event1.type).toBe('capture-started');
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
