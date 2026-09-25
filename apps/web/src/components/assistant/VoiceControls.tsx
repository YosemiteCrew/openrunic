'use client';

import { Button, IconButton } from '@openrunic/ui';
import { useState } from 'react';
import { useTranslator } from '@/lib/i18n/messages';
import type { ReactElement } from 'react';

import { useVoiceRecognition } from './useVoiceRecognition';

export interface VoiceControlsProps {
  /** Current text in the composer field. */
  value: string;
  /** Called when the text changes (from voice input). */
  onChange: (value: string) => void;
  /** Called when the user wants to submit the current text. */
  onSubmit?: () => void;
  /** Whether the assistant is currently streaming an answer. */
  streaming?: boolean;
  /** Optional custom className. */
  className?: string;
}

/**
 * Voice input controls for the assistant composer.
 *
 * Provides a microphone button with clear visual states (idle, listening, paused, error),
 * pause/resume/stop controls during active recognition, live captions display, and a
 * typed alternative message. All text comes from the message catalogue.
 */
export function VoiceControls({
  value,
  onChange,
  onSubmit,
  streaming = false,
  className,
}: Readonly<VoiceControlsProps>): ReactElement {
  const t = useTranslator();

  const [captions, setCaptions] = useState<string>('');
  const [showCaptions, setShowCaptions] = useState(false);

  const { state, start, pause, resume, stop, isSupported, error } = useVoiceRecognition({
    onInterimTranscript: (transcript) => {
      setCaptions(transcript);
      setShowCaptions(true);
      // Update the composer field with interim results
      onChange(transcript);
    },
    onFinalTranscript: (transcript) => {
      // Append final transcript to existing value
      const newValue = value ? `${value} ${transcript}`.trim() : transcript;
      onChange(newValue);
      setCaptions(transcript);
    },
    onStateChange: (newState) => {
      if (newState === 'idle') {
        setShowCaptions(false);
        setCaptions('');
      }
    },
    onError: () => {
      setShowCaptions(false);
      setCaptions('');
    },
  });

  const handleStart = () => {
    if (!isSupported) return;
    setShowCaptions(true);
    start();
  };

  const handlePause = () => {
    pause();
  };

  const handleResume = () => {
    resume();
  };

  const handleStop = () => {
    stop();
    if (onSubmit && value.trim()) {
      onSubmit();
    }
  };

  const getMicIcon = (): string => {
    switch (state) {
      case 'listening':
        return 'mic';
      case 'paused':
        return 'mic-off';
      case 'error':
        return 'mic-off';
      default:
        return 'mic';
    }
  };

  const getMicAriaLabel = (): string => {
    switch (state) {
      case 'listening':
        return t('assistant.voice.listening');
      case 'paused':
        return t('assistant.voice.paused');
      case 'error':
        return t('assistant.voice.error');
      default:
        return t('assistant.voice.start');
    }
  };

  const getMicVariant = (): 'primary' | 'secondary' | 'ghost' => {
    if (state === 'listening') return 'primary';
    if (state === 'error') return 'secondary';
    return 'secondary';
  };

  const isMicError = state === 'error';

  if (!isSupported) {
    return (
      <div className={`or-assistant__voice or-assistant__voice--unsupported ${className ?? ''}`}>
        <p className="or-caption or-assistant__voice-error">{t('assistant.voice.notSupported')}</p>
      </div>
    );
  }

  return (
    <div className={`or-assistant__voice ${className ?? ''}`}>
      {/* Live captions display */}
      {showCaptions && (
        <div
          className="or-assistant__captions"
          aria-live="polite"
          aria-label={t('assistant.captions.label')}
        >
          <span className="or-assistant__captions-label">{t('assistant.captions.label')}: </span>
          <span className="or-assistant__captions-text">
            {captions || t('assistant.captions.empty')}
          </span>
        </div>
      )}

      {/* Voice controls */}
      <div className="or-assistant__voice-controls">
        <div className="or-assistant__voice-primary">
          <IconButton
            icon={getMicIcon()}
            label={getMicAriaLabel()}
            aria-label={getMicAriaLabel()}
            variant={getMicVariant()}
            onClick={
              state === 'listening' ? handlePause : state === 'paused' ? handleResume : handleStart
            }
            disabled={streaming}
            className={`or-assistant__mic-button ${isMicError ? 'or-assistant__mic-button--error' : ''}`}
          />
        </div>

        {/* Secondary controls (pause/stop) when listening or paused */}
        {(state === 'listening' || state === 'paused') && (
          <div className="or-assistant__voice-secondary">
            {state === 'listening' && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                iconLeft="pause"
                onClick={handlePause}
                disabled={streaming}
              >
                {t('assistant.voice.pause')}
              </Button>
            )}
            {state === 'paused' && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                iconLeft="play"
                onClick={handleResume}
                disabled={streaming}
              >
                {t('assistant.voice.resume')}
              </Button>
            )}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              iconLeft="square"
              onClick={handleStop}
              disabled={streaming}
            >
              {t('assistant.voice.stop')}
            </Button>
          </div>
        )}

        {/* Error state */}
        {error && (
          <p className="or-caption or-assistant__voice-error" role="alert">
            {error}
          </p>
        )}

        {/* Typed alternative hint */}
        <p className="or-caption or-assistant__typed-hint">
          {t('assistant.voice.typedAlternative')}
        </p>
      </div>
    </div>
  );
}
