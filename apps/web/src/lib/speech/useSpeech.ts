'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  SpeechAdapter,
  SpeechCapability,
  SpeechEvent,
  SpeechSessionConfig,
  SpeechSessionHandle,
  AssistantSpeechState,
  UseSpeechOptions,
} from './types';

/**
 * Speech session state for the assistant.
 */
export type { AssistantSpeechState, UseSpeechOptions } from './types';

export interface UseSpeechReturn {
  /** Current speech state */
  state: AssistantSpeechState;
  /** Current caption text */
  caption: string;
  /** Whether speech is available */
  available: boolean;
  /** Error message if any */
  error: string | null;
  /** Start voice capture */
  startCapture: () => Promise<void>;
  /** Stop voice capture */
  stopCapture: () => Promise<void>;
  /** Speak the given text (TTS) */
  speak: (text: string) => Promise<void>;
  /** Interrupt current playback */
  interrupt: () => Promise<void>;
  /** Check if a capability is supported */
  checkCapability: (capability: SpeechCapability) => boolean;
}

/**
 * No-op adapter for when speech is not configured
 */
const noOpAdapter: SpeechAdapter = {
  name: 'No-op (speech disabled)',
  providerId: 'noop',
  capabilities: new Set<SpeechCapability>(),
  checkCapability: () => ({ supported: false, reason: 'Speech is not configured' }),
  startSession: async (config, onEvent) => {
    const handle: SpeechSessionHandle = {
      sessionId: config.sessionId,
      turnId: config.turnId,
      startedAt: Date.now(),
    };
    onEvent({ type: 'session-started', sessionId: config.sessionId });
    onEvent({ type: 'session-ended', sessionId: config.sessionId, reason: 'completed' });
    return handle;
  },
  stopSession: async () => {},
  sendAudio: async () => {},
  speak: async () => {},
  interrupt: async () => {},
};

/**
 * Hook for managing speech in the assistant.
 *
 * Handles session lifecycle, capture, playback, and interruption.
 * Uses the injected adapter or falls back to no-op if not configured.
 */
export function useSpeech(options: UseSpeechOptions): UseSpeechReturn {
  const {
    adapter: injectedAdapter,
    adapterConfig,
    surface,
    chartId,
    sessionId,
    onTranscript,
    onStateChange,
    onError,
    language = 'en-US',
    voiceId,
  } = options;

  const [state, setState] = useState<AssistantSpeechState>('idle');
  const [caption, setCaption] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [available, setAvailable] = useState(false);

  const adapterRef = useRef<SpeechAdapter | null>(null);
  const handleRef = useRef<SpeechSessionHandle | null>(null);
  const turnIdRef = useRef(0);
  const isInitializedRef = useRef(false);

  // Initialize adapter
  useEffect(() => {
    let mounted = true;

    async function init() {
      if (injectedAdapter) {
        adapterRef.current = injectedAdapter;
      } else if (adapterConfig) {
        // In production, this would create a real adapter
        // For now, use no-op
        adapterRef.current = noOpAdapter;
      } else {
        adapterRef.current = noOpAdapter;
      }

      if (mounted && adapterRef.current) {
        const caps: SpeechCapability[] = [
          'stt-streaming',
          'tts-streaming',
          'interruption-handling',
          'partial-transcripts',
        ];
        const allSupported = caps.every(
          (cap) => adapterRef.current!.checkCapability(cap).supported
        );
        setAvailable(allSupported);
        if (!allSupported) {
          setError('Speech capabilities not fully supported');
        }
        isInitializedRef.current = true;
      }
    }

    init();

    return () => {
      mounted = false;
    };
  }, [injectedAdapter, adapterConfig]);

  const updateState = useCallback(
    (newState: AssistantSpeechState) => {
      setState(newState);
      onStateChange?.(newState);
    },
    [onStateChange]
  );

  const startCapture = useCallback(async () => {
    if (!adapterRef.current || !isInitializedRef.current) {
      setError('Speech not initialized');
      return;
    }

    if (state !== 'idle' && state !== 'error') return;

    updateState('initializing');
    setError(null);

    try {
      const turnId = `turn-${++turnIdRef.current}`;
      const config: SpeechSessionConfig = {
        sessionId,
        turnId,
        surface,
        chartId,
        inputFormat: { sampleRate: 16000, channels: 1, encoding: 'pcm16' },
        outputFormat: { sampleRate: 24000, channels: 1, encoding: 'pcm16' },
        language,
        voiceId,
        enablePartialTranscripts: true,
        supportsInterruption: true,
      };

      // SECURITY: chartId is passed for adapter-side access control validation only.
      // It is NOT transmitted to the speech provider. Audio data is encrypted in transit
      // via the adapter's TLS connection. The adapter MUST enforce chartId scoping
      // and revoke access on session end (ADR-0005).
      const handle = await adapterRef.current.startSession(config, (event: SpeechEvent) => {
        switch (event.type) {
          case 'capture-started':
            updateState('capturing');
            setCaption('Listening...');
            break;
          case 'transcript-partial':
            setCaption(event.text);
            break;
          case 'transcript-final':
            updateState('processing');
            setCaption('Processing...');
            onTranscript?.(event.text);
            break;
          case 'tts-started':
            updateState('playing');
            setCaption('Speaking...');
            break;
          case 'tts-finished':
            updateState('idle');
            setCaption('');
            break;
          case 'session-ended':
            if (event.reason === 'error') {
              updateState('error');
            } else {
              updateState('idle');
              setCaption('');
            }
            break;
          case 'error':
            updateState('error');
            setError(event.message);
            break;
        }
      });

      handleRef.current = handle;
    } catch (err) {
      updateState('error');
      const message = err instanceof Error ? err.message : 'Failed to start capture';
      setError(message);
      onError?.(message);
    }
  }, [sessionId, surface, chartId, language, voiceId, onTranscript, updateState, onError, state]);

  const stopCapture = useCallback(async () => {
    if (!handleRef.current || !adapterRef.current) return;

    try {
      await adapterRef.current.stopSession(handleRef.current, 'user');
      handleRef.current = null;
      updateState('idle');
      setCaption('');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to stop capture';
      setError(message);
      onError?.(message);
    }
  }, [updateState, onError]);

  const speak = useCallback(
    async (text: string) => {
      if (!adapterRef.current || !handleRef.current) {
        setError('No active speech session');
        return;
      }

      const turnId = `turn-${++turnIdRef.current}`;
      updateState('playing');
      setCaption('Speaking...');

      try {
        await adapterRef.current.speak(handleRef.current, text, turnId);
      } catch (err) {
        updateState('error');
        const message = err instanceof Error ? err.message : 'Failed to speak';
        setError(message);
        onError?.(message);
      }
    },
    [updateState, onError]
  );

  const interrupt = useCallback(async () => {
    if (!handleRef.current || !adapterRef.current) return;

    try {
      await adapterRef.current.interrupt(handleRef.current, `turn-${turnIdRef.current}`);
      setCaption('Interrupted');
    } catch {
      // Ignore interruption errors
    }
  }, []);

  const checkCapability = useCallback((capability: SpeechCapability): boolean => {
    return adapterRef.current?.checkCapability(capability).supported ?? false;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (handleRef.current && adapterRef.current) {
        adapterRef.current.stopSession(handleRef.current, 'context-change').catch(() => {});
      }
    };
  }, []);

  return {
    state,
    caption,
    available,
    error,
    startCapture,
    stopCapture,
    speak,
    interrupt,
    checkCapability,
  };
}

/**
 * Formats the authorisation review evidence result for spoken output.
 * This ensures the output is source-checked and follows ADR-0005 rule 8.
 */
export function formatEvidenceReviewForSpeech(review: {
  caseType: string;
  status: string;
  missingRequirements: Array<{ label: string; satisfied: boolean; reason?: string }>;
  evidence: Array<{ label: string; resourceType: string }>;
}): string {
  const parts: string[] = [];

  // Case type and status
  const caseTypeLabel =
    review.caseType === 'prior-authorisation' ? 'prior authorization' : 'denied claim';
  parts.push(`Reviewing ${caseTypeLabel}. Status: ${review.status.replace(/-/g, ' ')}.`);

  // Missing requirements
  const missing = review.missingRequirements.filter((r) => !r.satisfied);
  if (missing.length > 0) {
    parts.push(`${missing.length} requirement${missing.length === 1 ? ' is' : 's are'} missing:`);
    for (const req of missing) {
      parts.push(`${req.label}: ${req.reason ?? 'not provided'}`);
    }
  } else {
    parts.push('All requirements are satisfied.');
  }

  // Evidence
  if (review.evidence.length > 0) {
    parts.push(
      `Supported by ${review.evidence.length} source${review.evidence.length === 1 ? '' : 's'}:`
    );
    for (const ev of review.evidence) {
      parts.push(`${ev.label} from ${ev.resourceType}`);
    }
  }

  // Important disclaimer
  parts.push('This information is for review only. No submission or approval has been made.');

  return parts.join(' ');
}
