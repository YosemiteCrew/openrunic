import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type {
  SpeechAdapter,
  SpeechCapability,
  SpeechEvent,
  SpeechSessionHandle,
} from '@/lib/speech/types';
import { formatEvidenceReviewForSpeech, useSpeech } from '@/lib/speech/useSpeech';

/**
 * The hook is the only thing between an adapter's event stream and what a
 * biller sees, so what is asserted here is that mapping: one state at a time,
 * a caption that matches it, and a failure anywhere in the adapter surfacing
 * as an error rather than a silent stall.
 *
 * Every adapter here is a stub on purpose. The point of the provider-neutral
 * boundary is that the hook cannot tell one apart from a real one, so a test
 * that needed a real provider would be testing the provider.
 */

const ALL_CAPABILITIES: SpeechCapability[] = [
  'stt-streaming',
  'tts-streaming',
  'interruption-handling',
  'partial-transcripts',
];

interface Fake {
  adapter: SpeechAdapter;
  /** Pushes an event into whatever callback the hook registered. */
  emit: (event: SpeechEvent) => void;
  stopSession: ReturnType<typeof vi.fn>;
  speak: ReturnType<typeof vi.fn>;
  interrupt: ReturnType<typeof vi.fn>;
  startSession: ReturnType<typeof vi.fn>;
}

function fakeAdapter(
  overrides: Partial<
    Pick<SpeechAdapter, 'checkCapability' | 'startSession' | 'stopSession' | 'speak' | 'interrupt'>
  > = {}
): Fake {
  let sink: ((event: SpeechEvent) => void) | null = null;

  const startSession = vi.fn(async (config, onEvent: (event: SpeechEvent) => void) => {
    sink = onEvent;
    const handle: SpeechSessionHandle = {
      sessionId: config.sessionId,
      turnId: config.turnId,
      startedAt: 0,
    };
    return handle;
  });
  const stopSession = vi.fn(async () => {});
  const speak = vi.fn(async () => {});
  const interrupt = vi.fn(async () => {});

  const adapter: SpeechAdapter = {
    name: 'Fake',
    providerId: 'fake',
    capabilities: new Set<SpeechCapability>(ALL_CAPABILITIES),
    checkCapability: () => ({ supported: true }),
    startSession,
    stopSession,
    sendAudio: async () => {},
    speak,
    interrupt,
    ...overrides,
  };

  return {
    adapter,
    emit: (event) => {
      if (!sink) throw new Error('no session started; nothing to emit into');
      sink(event);
    },
    stopSession,
    speak,
    interrupt,
    startSession,
  };
}

function renderSpeech(fake: Fake | null, extra: Record<string, unknown> = {}) {
  return renderHook(() =>
    useSpeech({
      sessionId: 'session-1',
      chartId: 'chart-1',
      surface: 'staff',
      ...(fake === null ? {} : { adapter: fake.adapter }),
      ...extra,
    })
  );
}

/** Starts a session and waits for the handle to be stored. */
async function start(result: { current: ReturnType<typeof useSpeech> }, fake: Fake) {
  await act(async () => {
    await result.current.startCapture();
  });
  expect(fake.startSession).toHaveBeenCalled();
}

describe('useSpeech availability', () => {
  it('reports unavailable and says why when no adapter is configured', async () => {
    const { result } = renderSpeech(null);

    await waitFor(() => expect(result.current.available).toBe(false));
    expect(result.current.error).toBe('Speech capabilities not fully supported');
    expect(result.current.checkCapability('stt-streaming')).toBe(false);
    expect(result.current.state).toBe('idle');
  });

  it('is equally unavailable when only an adapterConfig is supplied', async () => {
    // A base URL is not an adapter. The config branch exists so a later
    // factory can be dropped in; until then it must not claim availability.
    const { result } = renderSpeech(null, {
      adapterConfig: { baseUrl: 'https://speech.example.invalid', authConfig: {} },
    });

    await waitFor(() =>
      expect(result.current.error).toBe('Speech capabilities not fully supported')
    );
    expect(result.current.available).toBe(false);
  });

  it('is available and error-free when the adapter supports every capability', async () => {
    const fake = fakeAdapter();
    const { result } = renderSpeech(fake);

    await waitFor(() => expect(result.current.available).toBe(true));
    expect(result.current.error).toBeNull();
    expect(result.current.checkCapability('interruption-handling')).toBe(true);
  });

  it('is unavailable when a single capability is missing', async () => {
    // Asserted one capability at a time rather than none at all: `every` over
    // the four is what decides, and an adapter that supports three of them is
    // the case that separates that from a truthiness check on the set.
    for (const missing of ALL_CAPABILITIES) {
      const fake = fakeAdapter({
        checkCapability: (capability) =>
          capability === missing
            ? { supported: false, reason: 'unsupported' }
            : { supported: true },
      });
      const { result, unmount } = renderSpeech(fake);

      await waitFor(() => expect(result.current.available).toBe(false));
      expect(result.current.error).toBe('Speech capabilities not fully supported');
      unmount();
    }
  });
});

describe('useSpeech with no provider configured', () => {
  it('opens and closes the no-op session without ever claiming to listen', async () => {
    // The fallback has to be inert rather than absent: a clinic with no
    // provider must not get a control that throws, and must not get one that
    // says "Listening..." over a microphone nothing opened.
    const { result } = renderSpeech(null);
    await waitFor(() => expect(result.current.available).toBe(false));
    expect(result.current.error).toBe('Speech capabilities not fully supported');

    await act(async () => {
      await result.current.startCapture();
    });

    expect(result.current.state).toBe('idle');
    expect(result.current.caption).toBe('');

    await act(async () => {
      await result.current.speak('two requirements are missing');
    });
    expect(result.current.state).toBe('playing');

    await act(async () => {
      await result.current.interrupt();
    });
    expect(result.current.caption).toBe('Interrupted');

    await act(async () => {
      await result.current.stopCapture();
    });
    expect(result.current.state).toBe('idle');
  });
});

describe('useSpeech session events', () => {
  it('maps each adapter event onto a state and a caption', async () => {
    const onTranscript = vi.fn();
    const onStateChange = vi.fn();
    const fake = fakeAdapter();
    const { result } = renderSpeech(fake, { onTranscript, onStateChange });
    await waitFor(() => expect(result.current.available).toBe(true));

    await start(result, fake);
    expect(result.current.state).toBe('initializing');

    act(() => fake.emit({ type: 'capture-started' }));
    expect(result.current.state).toBe('capturing');
    expect(result.current.caption).toBe('Listening...');

    act(() =>
      fake.emit({ type: 'transcript-partial', text: 'missing prior', turnId: 't', sequence: 1 })
    );
    expect(result.current.state).toBe('capturing');
    expect(result.current.caption).toBe('missing prior');

    act(() =>
      fake.emit({
        type: 'transcript-final',
        text: 'missing prior authorisation',
        turnId: 't',
        sequence: 2,
      })
    );
    expect(result.current.state).toBe('processing');
    expect(result.current.caption).toBe('Processing...');
    expect(onTranscript).toHaveBeenCalledWith('missing prior authorisation');

    act(() =>
      fake.emit({ type: 'tts-started', turnId: 't', text: 'two requirements are missing' })
    );
    expect(result.current.state).toBe('playing');
    expect(result.current.caption).toBe('Speaking...');

    act(() => fake.emit({ type: 'tts-finished', turnId: 't' }));
    expect(result.current.state).toBe('idle');
    expect(result.current.caption).toBe('');

    expect(onStateChange.mock.calls.map(([s]) => s)).toEqual([
      'initializing',
      'capturing',
      'processing',
      'playing',
      'idle',
    ]);
  });

  it('clears the caption when a session ends normally', async () => {
    const fake = fakeAdapter();
    const { result } = renderSpeech(fake);
    await waitFor(() => expect(result.current.available).toBe(true));
    await start(result, fake);

    act(() => fake.emit({ type: 'capture-started' }));
    expect(result.current.caption).toBe('Listening...');

    act(() => fake.emit({ type: 'session-ended', sessionId: 'session-1', reason: 'stopped' }));
    expect(result.current.state).toBe('idle');
    expect(result.current.caption).toBe('');
  });

  it('keeps the caption and goes to error when a session ends in error', async () => {
    // The two session-ended reasons take different arms, and the arm that
    // matters is the one that must not present as a clean stop.
    const fake = fakeAdapter();
    const { result } = renderSpeech(fake);
    await waitFor(() => expect(result.current.available).toBe(true));
    await start(result, fake);

    act(() => fake.emit({ type: 'capture-started' }));
    act(() => fake.emit({ type: 'session-ended', sessionId: 'session-1', reason: 'error' }));

    expect(result.current.state).toBe('error');
    expect(result.current.caption).toBe('Listening...');
  });

  it('surfaces an error event with the adapter message', async () => {
    const fake = fakeAdapter();
    const { result } = renderSpeech(fake);
    await waitFor(() => expect(result.current.available).toBe(true));
    await start(result, fake);

    act(() =>
      fake.emit({
        type: 'error',
        code: 'MIC_DENIED',
        message: 'Microphone permission denied',
        recoverable: false,
      })
    );
    expect(result.current.state).toBe('error');
    expect(result.current.error).toBe('Microphone permission denied');
  });

  it('ignores adapter events it has no mapping for', async () => {
    const fake = fakeAdapter();
    const { result } = renderSpeech(fake);
    await waitFor(() => expect(result.current.available).toBe(true));
    await start(result, fake);

    act(() => fake.emit({ type: 'capture-started' }));
    act(() => fake.emit({ type: 'interruption-received', turnId: 't', timestamp: 1 }));

    expect(result.current.state).toBe('capturing');
    expect(result.current.caption).toBe('Listening...');
  });
});

describe('useSpeech capture control', () => {
  it('passes a product-owned session and chart scope to the adapter', async () => {
    const fake = fakeAdapter();
    const { result } = renderSpeech(fake, { language: 'en-GB', voiceId: 'voice-2' });
    await waitFor(() => expect(result.current.available).toBe(true));
    await start(result, fake);

    expect(fake.startSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-1',
        chartId: 'chart-1',
        surface: 'staff',
        language: 'en-GB',
        voiceId: 'voice-2',
        turnId: 'turn-1',
        enablePartialTranscripts: true,
        supportsInterruption: true,
      }),
      expect.any(Function)
    );
  });

  it('defaults the language when the caller does not choose one', async () => {
    const fake = fakeAdapter();
    const { result } = renderSpeech(fake);
    await waitFor(() => expect(result.current.available).toBe(true));
    await start(result, fake);

    expect(fake.startSession).toHaveBeenCalledWith(
      expect.objectContaining({ language: 'en-US' }),
      expect.any(Function)
    );
  });

  it('refuses a second capture while one is already running', async () => {
    const fake = fakeAdapter();
    const { result } = renderSpeech(fake);
    await waitFor(() => expect(result.current.available).toBe(true));
    await start(result, fake);

    act(() => fake.emit({ type: 'capture-started' }));
    await act(async () => {
      await result.current.startCapture();
    });

    expect(fake.startSession).toHaveBeenCalledTimes(1);
  });

  it('allows a retry from the error state', async () => {
    const fake = fakeAdapter();
    const { result } = renderSpeech(fake);
    await waitFor(() => expect(result.current.available).toBe(true));
    await start(result, fake);

    act(() =>
      fake.emit({ type: 'error', code: 'X', message: 'transport gone', recoverable: true })
    );
    expect(result.current.state).toBe('error');

    await act(async () => {
      await result.current.startCapture();
    });
    expect(fake.startSession).toHaveBeenCalledTimes(2);
    expect(result.current.error).toBeNull();
  });

  it('reports a failure to start and tells the caller', async () => {
    const onError = vi.fn();
    const fake = fakeAdapter({
      startSession: vi.fn(async () => {
        throw new Error('adapter refused the chart scope');
      }),
    });
    const { result } = renderSpeech(fake, { onError });
    await waitFor(() => expect(result.current.available).toBe(true));

    await act(async () => {
      await result.current.startCapture();
    });

    expect(result.current.state).toBe('error');
    expect(result.current.error).toBe('adapter refused the chart scope');
    expect(onError).toHaveBeenCalledWith('adapter refused the chart scope');
  });

  it('falls back to a fixed message when the adapter throws a non-Error', async () => {
    const fake = fakeAdapter({
      startSession: vi.fn(async () => {
        throw 'refused';
      }),
    });
    const { result } = renderSpeech(fake);
    await waitFor(() => expect(result.current.available).toBe(true));

    await act(async () => {
      await result.current.startCapture();
    });
    expect(result.current.error).toBe('Failed to start capture');
  });

  it('stops the session as a user stop and returns to idle', async () => {
    const fake = fakeAdapter();
    const { result } = renderSpeech(fake);
    await waitFor(() => expect(result.current.available).toBe(true));
    await start(result, fake);
    act(() => fake.emit({ type: 'capture-started' }));

    await act(async () => {
      await result.current.stopCapture();
    });

    expect(fake.stopSession).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'session-1' }),
      'user'
    );
    expect(result.current.state).toBe('idle');
    expect(result.current.caption).toBe('');
  });

  it('does nothing when asked to stop with no session open', async () => {
    const fake = fakeAdapter();
    const { result } = renderSpeech(fake);
    await waitFor(() => expect(result.current.available).toBe(true));

    await act(async () => {
      await result.current.stopCapture();
    });
    expect(fake.stopSession).not.toHaveBeenCalled();
  });

  it('surfaces a failure to stop', async () => {
    const onError = vi.fn();
    const fake = fakeAdapter({
      stopSession: vi.fn(async () => {
        throw new Error('socket already closed');
      }),
    });
    const { result } = renderSpeech(fake, { onError });
    await waitFor(() => expect(result.current.available).toBe(true));
    await start(result, fake);

    await act(async () => {
      await result.current.stopCapture();
    });
    expect(result.current.error).toBe('socket already closed');
    expect(onError).toHaveBeenCalledWith('socket already closed');
  });

  it('falls back to a fixed message when stopping throws a non-Error', async () => {
    const fake = fakeAdapter({
      stopSession: vi.fn(async () => {
        throw 'closed';
      }),
    });
    const { result } = renderSpeech(fake);
    await waitFor(() => expect(result.current.available).toBe(true));
    await start(result, fake);

    await act(async () => {
      await result.current.stopCapture();
    });
    expect(result.current.error).toBe('Failed to stop capture');
  });
});

describe('useSpeech playback', () => {
  it('refuses to speak with no session open', async () => {
    const fake = fakeAdapter();
    const { result } = renderSpeech(fake);
    await waitFor(() => expect(result.current.available).toBe(true));

    await act(async () => {
      await result.current.speak('two requirements are missing');
    });

    expect(fake.speak).not.toHaveBeenCalled();
    expect(result.current.error).toBe('No active speech session');
  });

  it('speaks on its own turn id, after the capture turn', async () => {
    const fake = fakeAdapter();
    const { result } = renderSpeech(fake);
    await waitFor(() => expect(result.current.available).toBe(true));
    await start(result, fake);

    await act(async () => {
      await result.current.speak('two requirements are missing');
    });

    expect(fake.speak).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'session-1' }),
      'two requirements are missing',
      'turn-2'
    );
    expect(result.current.state).toBe('playing');
    expect(result.current.caption).toBe('Speaking...');
  });

  it('reports a playback failure', async () => {
    const onError = vi.fn();
    const fake = fakeAdapter({
      speak: vi.fn(async () => {
        throw new Error('voice id rejected');
      }),
    });
    const { result } = renderSpeech(fake, { onError });
    await waitFor(() => expect(result.current.available).toBe(true));
    await start(result, fake);

    await act(async () => {
      await result.current.speak('anything');
    });
    expect(result.current.state).toBe('error');
    expect(result.current.error).toBe('voice id rejected');
    expect(onError).toHaveBeenCalledWith('voice id rejected');
  });

  it('falls back to a fixed message when speaking throws a non-Error', async () => {
    const fake = fakeAdapter({
      speak: vi.fn(async () => {
        throw 'rejected';
      }),
    });
    const { result } = renderSpeech(fake);
    await waitFor(() => expect(result.current.available).toBe(true));
    await start(result, fake);

    await act(async () => {
      await result.current.speak('anything');
    });
    expect(result.current.error).toBe('Failed to speak');
  });

  it('interrupts the current turn and says so', async () => {
    const fake = fakeAdapter();
    const { result } = renderSpeech(fake);
    await waitFor(() => expect(result.current.available).toBe(true));
    await start(result, fake);

    await act(async () => {
      await result.current.interrupt();
    });

    expect(fake.interrupt).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'session-1' }),
      'turn-1'
    );
    expect(result.current.caption).toBe('Interrupted');
  });

  it('does nothing when asked to interrupt with no session open', async () => {
    const fake = fakeAdapter();
    const { result } = renderSpeech(fake);
    await waitFor(() => expect(result.current.available).toBe(true));

    await act(async () => {
      await result.current.interrupt();
    });
    expect(fake.interrupt).not.toHaveBeenCalled();
  });

  it('swallows an interruption failure rather than stranding the caller in error', async () => {
    const fake = fakeAdapter({
      interrupt: vi.fn(async () => {
        throw new Error('nothing to interrupt');
      }),
    });
    const { result } = renderSpeech(fake);
    await waitFor(() => expect(result.current.available).toBe(true));
    await start(result, fake);

    await act(async () => {
      await result.current.interrupt();
    });
    expect(result.current.error).toBeNull();
    expect(result.current.caption).toBe('');
  });
});

describe('useSpeech teardown', () => {
  it('stops an open session as a context change when the panel unmounts', async () => {
    // ADR-0005: leaving the record has to end capture. Unmount is the only
    // signal the hook gets for that, so this is the whole revocation path.
    const fake = fakeAdapter();
    const { result, unmount } = renderSpeech(fake);
    await waitFor(() => expect(result.current.available).toBe(true));
    await start(result, fake);

    unmount();

    expect(fake.stopSession).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'session-1' }),
      'context-change'
    );
  });

  it('does not reject when the teardown stop fails', async () => {
    const fake = fakeAdapter({
      stopSession: vi.fn(async () => {
        throw new Error('already gone');
      }),
    });
    const { result, unmount } = renderSpeech(fake);
    await waitFor(() => expect(result.current.available).toBe(true));
    await start(result, fake);

    expect(() => unmount()).not.toThrow();
  });

  it('has nothing to stop when no session was opened', async () => {
    const fake = fakeAdapter();
    const { result, unmount } = renderSpeech(fake);
    await waitFor(() => expect(result.current.available).toBe(true));

    unmount();
    expect(fake.stopSession).not.toHaveBeenCalled();
  });
});

describe('formatEvidenceReviewForSpeech', () => {
  const evidence = [{ label: 'Chest x-ray report', resourceType: 'DiagnosticReport' }];

  it('names the case type and reads the status as words', () => {
    const spoken = formatEvidenceReviewForSpeech({
      caseType: 'prior-authorisation',
      status: 'awaiting-evidence',
      missingRequirements: [],
      evidence: [],
    });
    expect(spoken).toContain('Reviewing prior authorization. Status: awaiting evidence.');
  });

  it('distinguishes a denied claim from a prior authorisation', () => {
    const spoken = formatEvidenceReviewForSpeech({
      caseType: 'denied-claim',
      status: 'denied',
      missingRequirements: [],
      evidence: [],
    });
    expect(spoken).toContain('Reviewing denied claim.');
    expect(spoken).not.toContain('prior authorization');
  });

  it('says so when nothing is missing', () => {
    const spoken = formatEvidenceReviewForSpeech({
      caseType: 'prior-authorisation',
      status: 'ready',
      missingRequirements: [{ label: 'Imaging', satisfied: true }],
      evidence: [],
    });
    expect(spoken).toContain('All requirements are satisfied.');
    expect(spoken).not.toContain('missing:');
  });

  it('agrees the verb with a single missing requirement and states the reason', () => {
    const spoken = formatEvidenceReviewForSpeech({
      caseType: 'prior-authorisation',
      status: 'awaiting-evidence',
      missingRequirements: [
        { label: 'Imaging', satisfied: false, reason: 'no report on file' },
        { label: 'Notes', satisfied: true },
      ],
      evidence: [],
    });
    expect(spoken).toContain('1 requirement is missing:');
    expect(spoken).toContain('Imaging: no report on file');
    expect(spoken).not.toContain('Notes');
  });

  it('agrees the verb with several missing requirements', () => {
    const spoken = formatEvidenceReviewForSpeech({
      caseType: 'prior-authorisation',
      status: 'awaiting-evidence',
      missingRequirements: [
        { label: 'Imaging', satisfied: false, reason: 'no report on file' },
        { label: 'Notes', satisfied: false },
      ],
      evidence: [],
    });
    expect(spoken).toContain('2 requirements are missing:');
    expect(spoken).toContain('Notes: not provided');
  });

  it('counts a single source without pluralising it', () => {
    const spoken = formatEvidenceReviewForSpeech({
      caseType: 'prior-authorisation',
      status: 'ready',
      missingRequirements: [],
      evidence,
    });
    expect(spoken).toContain('Supported by 1 source:');
    expect(spoken).toContain('Chest x-ray report from DiagnosticReport');
  });

  it('counts several sources', () => {
    const spoken = formatEvidenceReviewForSpeech({
      caseType: 'prior-authorisation',
      status: 'ready',
      missingRequirements: [],
      evidence: [...evidence, { label: 'Progress note', resourceType: 'DocumentReference' }],
    });
    expect(spoken).toContain('Supported by 2 sources:');
    expect(spoken).toContain('Progress note from DocumentReference');
  });

  it('says nothing about sources when there are none', () => {
    const spoken = formatEvidenceReviewForSpeech({
      caseType: 'prior-authorisation',
      status: 'ready',
      missingRequirements: [],
      evidence: [],
    });
    expect(spoken).not.toContain('Supported by');
  });

  it('always ends by disclaiming that anything was submitted', () => {
    // ADR-0005: readback is review, not approval. The disclaimer is the only
    // thing separating "the packet is ready" from "the payer said yes", so it
    // is asserted on the branch most likely to sound like an approval.
    const spoken = formatEvidenceReviewForSpeech({
      caseType: 'prior-authorisation',
      status: 'ready',
      missingRequirements: [],
      evidence,
    });
    expect(
      spoken.endsWith(
        'This information is for review only. No submission or approval has been made.'
      )
    ).toBe(true);
  });
});
