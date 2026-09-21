'use client';

import { Button } from '../Button';
import { IconButton } from '../IconButton';
import { Tooltip } from '../Tooltip';
import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';

/**
 * Voice controls for the assistant surface.
 *
 * Provides explicit start/stop, push-to-talk alternative, input/output mute,
 * and visible capture state. Mirrors the requirements from ADR-0005 and #480:
 * - Microphone permission alone is not authorisation to start transmitting
 * - Require explicit start and visible capture state
 * - Pause/stop and a typed alternative always available
 * - Scope capture and playback to the authenticated user, organisation and selected record
 * - Logout, context change or revocation stops capture, clears queued audio
 *
 * This component receives pre-translated strings as props, following the
 * design system pattern where the consumer handles localisation.
 */
export type VoiceState = 'idle' | 'requesting' | 'capturing' | 'processing' | 'playing' | 'error';

export interface VoiceControlsProps {
  /** Current voice state */
  state: VoiceState;
  /** Called when user requests to start voice capture */
  onStart: () => void;
  /** Called when user requests to stop voice capture */
  onStop: () => void;
  /** Called when user toggles input mute */
  onMuteInput?: (muted: boolean) => void;
  /** Called when user toggles output mute */
  onMuteOutput?: (muted: boolean) => void;
  /** Whether voice is available (adapter configured) */
  available: boolean;
  /** Whether input is currently muted */
  inputMuted?: boolean;
  /** Whether output is currently muted */
  outputMuted?: boolean;
  /** Error message to display */
  error?: string;
  /** Caption text to display during capture/playback */
  caption?: string;
  /** Whether captions are enabled */
  captionsEnabled?: boolean;
  /** Callback when captions toggle changes */
  onCaptionsToggle?: (enabled: boolean) => void;

  /** Translated strings (consumer provides these) */
  labels: {
    /** Region label for the voice controls */
    regionLabel: string;
    /** Button label when idle */
    startLabel: string;
    /** Button label when active */
    stopLabel: string;
    /** Tooltip when idle */
    startTooltip: string;
    /** Tooltip when capturing */
    stopTooltip: string;
    /** Tooltip when processing */
    waitTooltip: string;
    /** Push-to-talk button label */
    pushToTalkLabel: string;
    /** Push-to-talk tooltip */
    pushToTalkTooltip: string;
    /** Push-to-talk hint text */
    pushToTalkHint: string;
    /** Mute input tooltip */
    muteInputTooltip: string;
    /** Unmute input tooltip */
    unmuteInputTooltip: string;
    /** Mute output tooltip */
    muteOutputTooltip: string;
    /** Unmute output tooltip */
    unmuteOutputTooltip: string;
    /** Enable captions tooltip */
    enableCaptionsTooltip: string;
    /** Disable captions tooltip */
    disableCaptionsTooltip: string;
    /** Unavailable message */
    unavailableMessage: string;
    /** State labels */
    states: Record<VoiceState, string>;
  };
}

const STATE_ICONS: Record<VoiceState, string> = {
  idle: 'mic',
  requesting: 'mic',
  capturing: 'mic-active',
  processing: 'loader',
  playing: 'volume-2',
  error: 'triangle-alert',
};

export function VoiceControls({
  state,
  onStart,
  onStop,
  onMuteInput,
  onMuteOutput,
  available,
  inputMuted = false,
  outputMuted = false,
  error,
  caption,
  captionsEnabled = false,
  onCaptionsToggle,
  labels,
}: Readonly<VoiceControlsProps>): ReactElement | null {
  const [isPushToTalkActive, setIsPushToTalkActive] = useState(false);

  // Handle push-to-talk keyboard interaction
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault();
        if (!isPushToTalkActive) {
          setIsPushToTalkActive(true);
          onStart();
        }
      }
    },
    [isPushToTalkActive, onStart]
  );

  const handleKeyUp = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if ((event.key === ' ' || event.key === 'Enter') && isPushToTalkActive) {
        event.preventDefault();
        setIsPushToTalkActive(false);
        onStop();
      }
    },
    [isPushToTalkActive, onStop]
  );

  const handleMouseDown = useCallback(() => {
    if (!isPushToTalkActive) {
      setIsPushToTalkActive(true);
      onStart();
    }
  }, [isPushToTalkActive, onStart]);

  const handleMouseUp = useCallback(() => {
    if (isPushToTalkActive) {
      setIsPushToTalkActive(false);
      onStop();
    }
  }, [isPushToTalkActive, onStop]);

  const handleMouseLeave = useCallback(() => {
    if (isPushToTalkActive) {
      setIsPushToTalkActive(false);
      onStop();
    }
  }, [isPushToTalkActive, onStop]);

  // No timeout used currently, but the ref exists for future use
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // No timeout to clear, but keeping the pattern for consistency
    };
  }, []);

  if (!available) {
    return (
      <div className="or-voice-controls or-voice-controls--unavailable" aria-live="polite">
        <p className="or-caption or-voice-controls__unavailable">{labels.unavailableMessage}</p>
      </div>
    );
  }

  const isActive =
    state === 'capturing' || state === 'processing' || state === 'playing' || state === 'error';
  const isCaptureState = state === 'capturing' || state === 'requesting';
  const showStopLabel =
    state === 'capturing' || state === 'processing' || state === 'playing' || state === 'error';

  return (
    <div className="or-voice-controls" role="region" aria-label={labels.regionLabel}>
      {/* Main voice button */}
      <div className="or-voice-controls__main">
        <Tooltip
          label={
            state === 'idle' || state === 'requesting'
              ? labels.startTooltip
              : state === 'capturing'
                ? labels.stopTooltip
                : labels.waitTooltip
          }
        >
          <Button
            type="button"
            variant={isActive ? 'danger' : 'primary'}
            size="lg"
            iconLeft={STATE_ICONS[state]}
            className={`or-voice-controls__button or-voice-controls__button--${state}`}
            onClick={isActive ? onStop : onStart}
            disabled={state === 'requesting' || state === 'processing' || state === 'error'}
            aria-pressed={isActive}
            aria-label={showStopLabel ? labels.stopLabel : labels.startLabel}
          >
            {showStopLabel ? labels.stopLabel : labels.startLabel}
          </Button>
        </Tooltip>
      </div>

      {/* Push-to-talk alternative */}
      <div className="or-voice-controls__push-to-talk">
        <Tooltip label={labels.pushToTalkTooltip}>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            iconLeft="mic"
            className={`or-voice-controls__ptt-button ${isPushToTalkActive ? 'or-voice-controls__ptt-button--active' : ''}`}
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseLeave}
            onKeyDown={handleKeyDown}
            onKeyUp={handleKeyUp}
            onTouchStart={handleMouseDown}
            onTouchEnd={handleMouseUp}
            aria-pressed={isPushToTalkActive}
            aria-label={labels.pushToTalkLabel}
            disabled={state !== 'idle'}
          >
            {labels.pushToTalkLabel}
          </Button>
        </Tooltip>
        <p className="or-caption or-voice-controls__ptt-hint">{labels.pushToTalkHint}</p>
      </div>

      {/* Mute toggles */}
      <div className="or-voice-controls__mutes">
        {onMuteInput && (
          <Tooltip label={inputMuted ? labels.unmuteInputTooltip : labels.muteInputTooltip}>
            <IconButton
              icon={inputMuted ? 'mic-off' : 'mic'}
              variant="ghost"
              size="sm"
              label={inputMuted ? labels.unmuteInputTooltip : labels.muteInputTooltip}
              onClick={() => onMuteInput(!inputMuted)}
              aria-pressed={inputMuted}
            />
          </Tooltip>
        )}
        {onMuteOutput && (
          <Tooltip label={outputMuted ? labels.unmuteOutputTooltip : labels.muteOutputTooltip}>
            <IconButton
              icon={outputMuted ? 'volume-x' : 'volume-2'}
              variant="ghost"
              size="sm"
              label={outputMuted ? labels.unmuteOutputTooltip : labels.muteOutputTooltip}
              onClick={() => onMuteOutput(!outputMuted)}
              aria-pressed={outputMuted}
            />
          </Tooltip>
        )}
        {onCaptionsToggle && (
          <Tooltip
            label={captionsEnabled ? labels.disableCaptionsTooltip : labels.enableCaptionsTooltip}
          >
            <IconButton
              icon="captions"
              variant={captionsEnabled ? 'secondary' : 'ghost'}
              size="sm"
              label={captionsEnabled ? labels.disableCaptionsTooltip : labels.enableCaptionsTooltip}
              onClick={() => onCaptionsToggle(!captionsEnabled)}
              aria-pressed={captionsEnabled}
            />
          </Tooltip>
        )}
      </div>

      {/* Status and caption display */}
      <div className="or-voice-controls__status" aria-live="polite" aria-atomic="true">
        {error && (
          <p className="or-voice-controls__error" role="alert">
            {error}
          </p>
        )}
        {caption && (
          <p className="or-voice-controls__caption" aria-live="polite">
            {caption}
          </p>
        )}
        {state !== 'idle' && !error && !caption && (
          <p className="or-voice-controls__state">{labels.states[state]}</p>
        )}
        {isCaptureState && (
          <span
            className="or-voice-controls__recording-indicator"
            aria-hidden="true"
            data-testid="recording-indicator"
          />
        )}
      </div>
    </div>
  );
}

/**
 * Minimal voice indicator for inline use (e.g., in the assistant header).
 */
export interface VoiceIndicatorProps {
  state: VoiceState;
  caption?: string;
  /** Translated strings */
  labels: {
    states: Record<VoiceState, string>;
  };
}

export function VoiceIndicator({
  state,
  caption,
  labels,
}: Readonly<VoiceIndicatorProps>): ReactElement {
  if (state === 'idle') {
    return <></>;
  }

  return (
    <div className={`or-voice-indicator or-voice-indicator--${state}`} aria-live="polite">
      <span className="or-voice-indicator__dot" aria-hidden="true" />
      <span className="or-voice-indicator__label">{labels.states[state]}</span>
      {caption && <span className="or-voice-indicator__caption">{caption}</span>}
    </div>
  );
}
// trigger
