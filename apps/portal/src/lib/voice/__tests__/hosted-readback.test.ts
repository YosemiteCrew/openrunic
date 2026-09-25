import { describe, expect, it, vi, beforeEach, afterAll } from 'vitest';
import {
  createPortalHostedSynthesiser,
  createPortalHostedReadbackEgress,
} from '../hosted-readback.js';
import type { PlaybackHandlers } from '@openrunic/voice';

describe('createPortalHostedSynthesiser', () => {
  const originalEnv = { ...process.env };
  const originalFetch = globalThis.fetch;
  const originalAudio = globalThis.Audio;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    globalThis.fetch = originalFetch;
    globalThis.Audio = originalAudio;
  });

  afterAll(() => {
    process.env = originalEnv;
    globalThis.fetch = originalFetch;
    globalThis.Audio = originalAudio;
  });

  it('returns null when endpoint is not configured', () => {
    delete process.env.NEXT_PUBLIC_HOSTED_VOICE_ENDPOINT;
    delete process.env.NEXT_PUBLIC_HOSTED_VOICE_AGREEMENT;
    delete process.env.OPENRUNIC_HOSTED_VOICE_ENDPOINT;
    delete process.env.OPENRUNIC_HOSTED_VOICE_AGREEMENT;

    expect(createPortalHostedSynthesiser()).toBeNull();
    expect(createPortalHostedReadbackEgress()).toBeNull();
  });

  it('returns null when agreement is not configured', () => {
    process.env.NEXT_PUBLIC_HOSTED_VOICE_ENDPOINT = 'https://tts.example.com/synthesize';
    delete process.env.NEXT_PUBLIC_HOSTED_VOICE_AGREEMENT;

    expect(createPortalHostedSynthesiser()).toBeNull();
    expect(createPortalHostedReadbackEgress()).toBeNull();
  });

  it('creates a synthesiser when both endpoint and agreement are configured', () => {
    process.env.NEXT_PUBLIC_HOSTED_VOICE_ENDPOINT = 'https://tts.example.com/synthesize';
    process.env.NEXT_PUBLIC_HOSTED_VOICE_AGREEMENT = 'Google Cloud TTS BAA 2024-Q1';
    process.env.NEXT_PUBLIC_HOSTED_VOICE_LANGUAGES = 'en-GB,en-US,es-ES';

    const synthesiser = createPortalHostedSynthesiser();
    const egress = createPortalHostedReadbackEgress();

    expect(synthesiser).not.toBeNull();
    expect(egress).not.toBeNull();
    expect(egress).toEqual({
      endpoint: 'https://tts.example.com/synthesize',
      agreement: 'Google Cloud TTS BAA 2024-Q1',
    });
    expect(synthesiser!.languages).toEqual(['en-GB', 'en-US', 'es-ES']);
  });

  it('falls back to OPENRUNIC_ prefixed env vars', () => {
    delete process.env.NEXT_PUBLIC_HOSTED_VOICE_ENDPOINT;
    delete process.env.NEXT_PUBLIC_HOSTED_VOICE_AGREEMENT;
    delete process.env.NEXT_PUBLIC_HOSTED_VOICE_LANGUAGES;

    process.env.OPENRUNIC_HOSTED_VOICE_ENDPOINT = 'https://tts.example.com/synthesize';
    process.env.OPENRUNIC_HOSTED_VOICE_AGREEMENT = 'Google Cloud TTS BAA 2024-Q1';
    process.env.OPENRUNIC_HOSTED_VOICE_LANGUAGES = 'en-GB,en-US,es-ES';

    const synthesiser = createPortalHostedSynthesiser();
    const egress = createPortalHostedReadbackEgress();

    expect(synthesiser).not.toBeNull();
    expect(egress).not.toBeNull();
    expect(egress).toEqual({
      endpoint: 'https://tts.example.com/synthesize',
      agreement: 'Google Cloud TTS BAA 2024-Q1',
    });
    expect(synthesiser!.languages).toEqual(['en-GB', 'en-US', 'es-ES']);
  });

  it('defaults to en-GB when no languages are configured', () => {
    process.env.NEXT_PUBLIC_HOSTED_VOICE_ENDPOINT = 'https://tts.example.com/synthesize';
    process.env.NEXT_PUBLIC_HOSTED_VOICE_AGREEMENT = 'Google Cloud TTS BAA 2024-Q1';
    delete process.env.NEXT_PUBLIC_HOSTED_VOICE_LANGUAGES;

    const synthesiser = createPortalHostedSynthesiser();
    expect(synthesiser).not.toBeNull();
    expect(synthesiser!.languages).toEqual(['en-GB']);
  });

  it('calls the TTS endpoint with the correct payload', async () => {
    process.env.NEXT_PUBLIC_HOSTED_VOICE_ENDPOINT = 'https://tts.example.com/synthesize';
    process.env.NEXT_PUBLIC_HOSTED_VOICE_AGREEMENT = 'Google Cloud TTS BAA 2024-Q1';

    const synthesiser = createPortalHostedSynthesiser();
    expect(synthesiser).not.toBeNull();

    const mockAudioBlob = new Blob(['audio data'], { type: 'audio/mpeg' });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(mockAudioBlob),
    });
    globalThis.fetch = fetchMock;

    globalThis.Audio = vi.fn(() => ({
      play: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn(),
      src: '',
      onended: null,
      onerror: null,
    })) as unknown as typeof Audio;

    const handlers: PlaybackHandlers = {
      started: vi.fn(),
      finished: vi.fn(),
      failed: vi.fn(),
    };

    const _playback = synthesiser!.play({ text: 'Hello world', language: 'en-GB' }, handlers);

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(fetchMock).toHaveBeenCalledWith('https://tts.example.com/synthesize', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'audio/*, */*',
      },
      body: JSON.stringify({ text: 'Hello world', language: 'en-GB' }),
      signal: expect.any(AbortSignal),
    });
  });

  it('handles fetch errors', async () => {
    process.env.NEXT_PUBLIC_HOSTED_VOICE_ENDPOINT = 'https://tts.example.com/synthesize';
    process.env.NEXT_PUBLIC_HOSTED_VOICE_AGREEMENT = 'Google Cloud TTS BAA 2024-Q1';

    const synthesiser = createPortalHostedSynthesiser();
    expect(synthesiser).not.toBeNull();

    const fetchMock = vi.fn().mockRejectedValue(new Error('Network error'));
    globalThis.fetch = fetchMock;

    const handlers: PlaybackHandlers = {
      started: vi.fn(),
      finished: vi.fn(),
      failed: vi.fn(),
    };

    const _playback = synthesiser!.play({ text: 'Hello world', language: 'en-GB' }, handlers);

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(handlers.failed).toHaveBeenCalled();
    expect(handlers.started).not.toHaveBeenCalled();
  });

  it('handles non-ok responses', async () => {
    process.env.NEXT_PUBLIC_HOSTED_VOICE_ENDPOINT = 'https://tts.example.com/synthesize';
    process.env.NEXT_PUBLIC_HOSTED_VOICE_AGREEMENT = 'Google Cloud TTS BAA 2024-Q1';

    const synthesiser = createPortalHostedSynthesiser();
    expect(synthesiser).not.toBeNull();

    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });
    globalThis.fetch = fetchMock;

    const handlers: PlaybackHandlers = {
      started: vi.fn(),
      finished: vi.fn(),
      failed: vi.fn(),
    };

    const _playback = synthesiser!.play({ text: 'Hello world', language: 'en-GB' }, handlers);

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(handlers.failed).toHaveBeenCalled();
    expect(handlers.started).not.toHaveBeenCalled();
  });
});
