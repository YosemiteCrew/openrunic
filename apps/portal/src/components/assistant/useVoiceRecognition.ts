'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type VoiceRecognitionState = 'idle' | 'listening' | 'paused' | 'error';

export interface UseVoiceRecognitionOptions {
  /** Called with interim results as the user speaks. */
  onInterimTranscript?: (transcript: string) => void;
  /** Called with final results when a segment ends. */
  onFinalTranscript?: (transcript: string) => void;
  /** Called when the recognition state changes. */
  onStateChange?: (state: VoiceRecognitionState) => void;
  /** Called when an error occurs. */
  onError?: (error: string) => void;
  /** Language for recognition (BCP 47). Defaults to browser language. */
  lang?: string;
  /** Whether to return interim results. Defaults to true. */
  interimResults?: boolean;
  /** Whether to continue listening after a pause. Defaults to true. */
  continuous?: boolean;
}

export interface UseVoiceRecognitionReturn {
  /** Current recognition state. */
  state: VoiceRecognitionState;
  /** Start voice recognition. */
  start: () => void;
  /** Pause voice recognition (keeps the session alive). */
  pause: () => void;
  /** Resume voice recognition after pause. */
  resume: () => void;
  /** Stop voice recognition and end the session. */
  stop: () => void;
  /** Whether voice recognition is supported in this browser. */
  isSupported: boolean;
  /** Current error message, if any. */
  error: string | null;
}

/** Type for the browser SpeechRecognition API. */
interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onresult:
    | ((event: {
        resultIndex: number;
        results: {
          length: number;
          [index: number]: {
            0: { transcript: string };
            isFinal: boolean;
          };
        };
      }) => void)
    | null;
  start(): void;
  stop(): void;
}

// Extend Window type for SpeechRecognition
interface WindowWithSpeechRecognition extends Window {
  SpeechRecognition?: new () => SpeechRecognitionLike;
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
}

/** Get the SpeechRecognition constructor at runtime. */
function getSpeechRecognitionConstructor(): new () => SpeechRecognitionLike | null {
  const SpeechRecognition = ((window as WindowWithSpeechRecognition).SpeechRecognition ??
    (window as WindowWithSpeechRecognition)
      .webkitSpeechRecognition) as new () => SpeechRecognitionLike | null;
  return SpeechRecognition;
}

/**
 * Hook for browser speech recognition (Web Speech API).
 *
 * Wraps the native SpeechRecognition API with a React-friendly interface.
 * Handles browser compatibility, state management, and cleanup.
 */
export function useVoiceRecognition({
  onInterimTranscript,
  onFinalTranscript,
  onStateChange,
  onError,
  lang,
  interimResults = true,
  continuous = true,
}: Readonly<UseVoiceRecognitionOptions>): UseVoiceRecognitionReturn {
  const [state, setState] = useState<VoiceRecognitionState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [isSupported] = useState(() => getSpeechRecognitionConstructor() !== null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const interimTranscriptRef = useRef('');
  // Ref to track current state for callbacks that fire asynchronously
  const stateRef = useRef(state);
  // Ref to track if we're intentionally pausing (vs stopping/error)
  const isPausingRef = useRef(false);

  // Update stateRef when state changes - useEffect to avoid updating ref during render
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const setStateAndNotify = useCallback(
    (newState: VoiceRecognitionState) => {
      setState(newState);
      onStateChange?.(newState);
    },
    [onStateChange]
  );

  const start = useCallback(() => {
    if (!isSupported) {
      const err = 'Voice input is not supported in this browser.';
      setError(err);
      onError?.(err);
      return;
    }

    if (state === 'listening') return;

    // Get the constructor at runtime to allow for testing
    const Constructor = getSpeechRecognitionConstructor();
    if (Constructor === null) return;
    // TypeScript doesn't narrow the constructor type after null check, so we assert
    const recognition: SpeechRecognitionLike = new (
      Constructor as new () => SpeechRecognitionLike
    )();

    recognition.lang = lang ?? navigator.language ?? 'en-US';
    recognition.interimResults = interimResults;
    recognition.continuous = continuous;

    const handleStart = () => {
      setError(null);
      isPausingRef.current = false;
      setStateAndNotify('listening');
    };

    const handleEnd = () => {
      // Only auto-restart if we're in continuous mode and still listening
      // Use stateRef to get the current state at callback execution time
      const currentState = stateRef.current;
      if (continuous && currentState === 'listening' && !isPausingRef.current) {
        try {
          recognition.start();
        } catch {
          // Ignore restart errors
        }
      } else if (currentState !== 'paused' && currentState !== 'error' && !isPausingRef.current) {
        setStateAndNotify('idle');
      }
    };

    const handleError = (event: { error: string }) => {
      // 'no-speech' is not a real error, just means silence timeout
      if (event.error === 'no-speech') return;

      const errMsg =
        event.error === 'not-allowed'
          ? 'Microphone permission denied. Please allow microphone access.'
          : event.error === 'service-not-allowed'
            ? 'Speech recognition service not allowed.'
            : `Voice input error: ${event.error}`;

      setError(errMsg);
      onError?.(errMsg);
      setStateAndNotify('error');
    };

    const handleResult = (event: {
      resultIndex: number;
      results: {
        length: number;
        [index: number]: {
          0: { transcript: string };
          isFinal: boolean;
        };
      };
    }) => {
      let interimTranscript = '';
      let finalTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (!result) continue;
        const transcript = result[0]?.transcript ?? '';
        if (result.isFinal) {
          finalTranscript += transcript;
        } else {
          interimTranscript += transcript;
        }
      }

      if (interimTranscript) {
        interimTranscriptRef.current = interimTranscript;
        onInterimTranscript?.(interimTranscript);
      }

      if (finalTranscript) {
        interimTranscriptRef.current = '';
        onFinalTranscript?.(finalTranscript);
      }
    };

    recognition.onstart = handleStart;
    recognition.onend = handleEnd;
    recognition.onerror = handleError;
    recognition.onresult = handleResult;

    recognitionRef.current = recognition;

    try {
      recognition.start();
    } catch {
      const err = 'Could not start voice recognition. Please try again.';
      setError(err);
      onError?.(err);
      setStateAndNotify('error');
    }
  }, [
    state,
    isSupported,
    lang,
    interimResults,
    continuous,
    onInterimTranscript,
    onFinalTranscript,
    onError,
    setStateAndNotify,
  ]);

  const pause = useCallback(() => {
    if (state !== 'listening') return;
    isPausingRef.current = true;
    recognitionRef.current?.stop();
    setStateAndNotify('paused');
  }, [state, setStateAndNotify]);

  const resume = useCallback(() => {
    if (state !== 'paused') return;
    recognitionRef.current?.start();
    setStateAndNotify('listening');
  }, [state, setStateAndNotify]);

  const stop = useCallback(() => {
    if (state === 'idle') return;
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    interimTranscriptRef.current = '';
    setStateAndNotify('idle');
  }, [state, setStateAndNotify]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      const recognition = recognitionRef.current;
      if (recognition) {
        recognition.stop();
        recognitionRef.current = null;
      }
    };
  }, []);

  return {
    state,
    start,
    pause,
    resume,
    stop,
    isSupported,
    error,
  };
}
