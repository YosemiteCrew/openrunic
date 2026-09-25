import { renderHook, act } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { useVoiceRecognition } from '@/components/assistant/useVoiceRecognition';

describe('useVoiceRecognition', () => {
  const mockOnInterimTranscript = vi.fn();
  const mockOnFinalTranscript = vi.fn();
  const mockOnStateChange = vi.fn();
  const mockOnError = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock SpeechRecognition as supported
    vi.stubGlobal(
      'SpeechRecognition',
      class {
        lang = '';
        interimResults = false;
        continuous = false;
        onstart: (() => void) | null = null;
        onend: (() => void) | null = null;
        onerror: ((event: { error: string }) => void) | null = null;
        onresult: ((event: unknown) => void) | null = null;
        start = vi.fn(() => {
          // Call onstart synchronously for test purposes
          this.onstart?.();
        });
        stop = vi.fn(() => {
          // Call onend synchronously for test purposes
          this.onend?.();
        });
      }
    );
    vi.stubGlobal('webkitSpeechRecognition', undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns isSupported: true when SpeechRecognition is available', () => {
    const { result } = renderHook(() =>
      useVoiceRecognition({
        onInterimTranscript: mockOnInterimTranscript,
        onFinalTranscript: mockOnFinalTranscript,
        onStateChange: mockOnStateChange,
        onError: mockOnError,
      })
    );

    expect(result.current.isSupported).toBe(true);
    expect(result.current.state).toBe('idle');
    expect(result.current.error).toBeNull();
  });

  it('returns isSupported: false when SpeechRecognition is not available', () => {
    vi.stubGlobal('SpeechRecognition', undefined);
    vi.stubGlobal('webkitSpeechRecognition', undefined);

    const { result } = renderHook(() =>
      useVoiceRecognition({
        onInterimTranscript: mockOnInterimTranscript,
        onFinalTranscript: mockOnFinalTranscript,
        onStateChange: mockOnStateChange,
        onError: mockOnError,
      })
    );

    expect(result.current.isSupported).toBe(false);
  });

  it('starts recognition and transitions to listening state', () => {
    const { result } = renderHook(() =>
      useVoiceRecognition({
        onInterimTranscript: mockOnInterimTranscript,
        onFinalTranscript: mockOnFinalTranscript,
        onStateChange: mockOnStateChange,
        onError: mockOnError,
      })
    );

    act(() => {
      result.current.start();
    });

    expect(result.current.state).toBe('listening');
    expect(mockOnStateChange).toHaveBeenCalledWith('listening');
  });

  it('stops recognition when stop is called', () => {
    const { result } = renderHook(() =>
      useVoiceRecognition({
        onInterimTranscript: mockOnInterimTranscript,
        onFinalTranscript: mockOnFinalTranscript,
        onStateChange: mockOnStateChange,
        onError: mockOnError,
      })
    );

    act(() => {
      result.current.start();
    });

    act(() => {
      result.current.stop();
    });

    expect(result.current.state).toBe('idle');
  });

  it('calls onError when recognition fails with not-allowed', () => {
    vi.stubGlobal(
      'SpeechRecognition',
      class {
        lang = '';
        interimResults = false;
        continuous = false;
        onstart: (() => void) | null = null;
        onend: (() => void) | null = null;
        onerror: ((event: { error: string }) => void) | null = null;
        onresult: ((event: unknown) => void) | null = null;
        start = vi.fn(() => {
          this.onerror?.({ error: 'not-allowed' });
        });
        stop = vi.fn();
      }
    );

    const { result } = renderHook(() =>
      useVoiceRecognition({
        onInterimTranscript: mockOnInterimTranscript,
        onFinalTranscript: mockOnFinalTranscript,
        onStateChange: mockOnStateChange,
        onError: mockOnError,
      })
    );

    act(() => {
      result.current.start();
    });

    expect(result.current.state).toBe('error');
    expect(result.current.error).toContain('Microphone permission denied');
    expect(mockOnError).toHaveBeenCalled();
  });
});
