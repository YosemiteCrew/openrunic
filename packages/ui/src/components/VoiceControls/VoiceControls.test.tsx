import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { VoiceControls, VoiceIndicator } from './VoiceControls.js';
import type { VoiceIndicatorProps } from './VoiceControls.js';

const defaultLabels = {
  regionLabel: 'Voice controls',
  startLabel: 'Start',
  stopLabel: 'Stop',
  startTooltip: 'Start voice input',
  stopTooltip: 'Stop voice input',
  waitTooltip: 'Please wait',
  pushToTalkLabel: 'Push to talk',
  pushToTalkTooltip: 'Hold to talk, release to send',
  pushToTalkHint: 'Hold to talk, release to send',
  muteInputTooltip: 'Mute microphone',
  unmuteInputTooltip: 'Unmute microphone',
  muteOutputTooltip: 'Mute playback',
  unmuteOutputTooltip: 'Unmute playback',
  enableCaptionsTooltip: 'Enable captions',
  disableCaptionsTooltip: 'Disable captions',
  unavailableMessage: 'Voice not available',
  states: {
    idle: 'Idle',
    requesting: 'Requesting...',
    capturing: 'Listening...',
    processing: 'Processing...',
    playing: 'Speaking...',
    error: 'Error',
  },
};

const defaultProps = {
  state: 'idle' as const,
  onStart: vi.fn(),
  onStop: vi.fn(),
  available: true,
  labels: defaultLabels,
};

describe('VoiceControls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders start button when idle', () => {
    render(<VoiceControls {...defaultProps} />);
    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument();
  });

  it('shows unavailable message when not available', () => {
    render(<VoiceControls {...defaultProps} available={false} />);
    expect(screen.getByText('Voice not available')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start' })).not.toBeInTheDocument();
  });

  it('calls onStart when start button clicked', () => {
    render(<VoiceControls {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(defaultProps.onStart).toHaveBeenCalledTimes(1);
  });

  it('shows stop button when capturing', () => {
    render(<VoiceControls {...defaultProps} state="capturing" />);
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start' })).not.toBeInTheDocument();
  });

  it('calls onStop when stop button clicked', () => {
    render(<VoiceControls {...defaultProps} state="capturing" />);
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(defaultProps.onStop).toHaveBeenCalledTimes(1);
  });

  it('disables buttons during requesting state', () => {
    render(<VoiceControls {...defaultProps} state="requesting" />);
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();
  });

  it('disables buttons during processing state', () => {
    render(<VoiceControls {...defaultProps} state="processing" />);
    expect(screen.getByRole('button', { name: 'Stop' })).toBeDisabled();
  });

  it('shows push-to-talk button', () => {
    render(<VoiceControls {...defaultProps} />);
    expect(screen.getByRole('button', { name: 'Push to talk' })).toBeInTheDocument();
  });

  it('activates push-to-talk on mouse down', () => {
    render(<VoiceControls {...defaultProps} />);
    const pttButton = screen.getByRole('button', { name: 'Push to talk' });
    fireEvent.mouseDown(pttButton);
    expect(defaultProps.onStart).toHaveBeenCalledTimes(1);
  });

  it('deactivates push-to-talk on mouse up', () => {
    render(<VoiceControls {...defaultProps} />);
    const pttButton = screen.getByRole('button', { name: 'Push to talk' });
    fireEvent.mouseDown(pttButton);
    fireEvent.mouseUp(pttButton);
    expect(defaultProps.onStop).toHaveBeenCalledTimes(1);
  });

  it('activates push-to-talk on key down (Space)', () => {
    render(<VoiceControls {...defaultProps} />);
    const pttButton = screen.getByRole('button', { name: 'Push to talk' });
    fireEvent.keyDown(pttButton, { key: ' ' });
    expect(defaultProps.onStart).toHaveBeenCalledTimes(1);
  });

  it('activates push-to-talk on key down (Enter)', () => {
    render(<VoiceControls {...defaultProps} />);
    const pttButton = screen.getByRole('button', { name: 'Push to talk' });
    fireEvent.keyDown(pttButton, { key: 'Enter' });
    expect(defaultProps.onStart).toHaveBeenCalledTimes(1);
  });

  it('deactivates push-to-talk on key up (Space)', () => {
    render(<VoiceControls {...defaultProps} />);
    const pttButton = screen.getByRole('button', { name: 'Push to talk' });
    fireEvent.keyDown(pttButton, { key: ' ' });
    fireEvent.keyUp(pttButton, { key: ' ' });
    expect(defaultProps.onStop).toHaveBeenCalledTimes(1);
  });

  it('deactivates push-to-talk on key up (Enter)', () => {
    render(<VoiceControls {...defaultProps} />);
    const pttButton = screen.getByRole('button', { name: 'Push to talk' });
    fireEvent.keyDown(pttButton, { key: 'Enter' });
    fireEvent.keyUp(pttButton, { key: 'Enter' });
    expect(defaultProps.onStop).toHaveBeenCalledTimes(1);
  });

  it('deactivates push-to-talk on mouse leave', () => {
    render(<VoiceControls {...defaultProps} />);
    const pttButton = screen.getByRole('button', { name: 'Push to talk' });
    fireEvent.mouseDown(pttButton);
    fireEvent.mouseLeave(pttButton);
    expect(defaultProps.onStop).toHaveBeenCalledTimes(1);
  });

  it('activates push-to-talk on touch start', () => {
    render(<VoiceControls {...defaultProps} />);
    const pttButton = screen.getByRole('button', { name: 'Push to talk' });
    fireEvent.touchStart(pttButton);
    expect(defaultProps.onStart).toHaveBeenCalledTimes(1);
  });

  it('deactivates push-to-talk on touch end', () => {
    render(<VoiceControls {...defaultProps} />);
    const pttButton = screen.getByRole('button', { name: 'Push to talk' });
    fireEvent.touchStart(pttButton);
    fireEvent.touchEnd(pttButton);
    expect(defaultProps.onStop).toHaveBeenCalledTimes(1);
  });

  it('does not activate push-to-talk on other keys', () => {
    render(<VoiceControls {...defaultProps} />);
    const pttButton = screen.getByRole('button', { name: 'Push to talk' });
    fireEvent.keyDown(pttButton, { key: 'a' });
    expect(defaultProps.onStart).not.toHaveBeenCalled();
  });

  it('shows mute input button when onMuteInput provided', () => {
    const onMuteInput = vi.fn();
    render(<VoiceControls {...defaultProps} onMuteInput={onMuteInput} />);
    expect(screen.getByRole('button', { name: 'Mute microphone' })).toBeInTheDocument();
  });

  it('toggles input mute state', () => {
    const onMuteInput = vi.fn();
    render(<VoiceControls {...defaultProps} onMuteInput={onMuteInput} inputMuted={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mute microphone' }));
    expect(onMuteInput).toHaveBeenCalledWith(true);
  });

  it('shows mute output button when onMuteOutput provided', () => {
    const onMuteOutput = vi.fn();
    render(<VoiceControls {...defaultProps} onMuteOutput={onMuteOutput} />);
    expect(screen.getByRole('button', { name: 'Mute playback' })).toBeInTheDocument();
  });

  it('shows captions toggle when onCaptionsToggle provided', () => {
    const onCaptionsToggle = vi.fn();
    render(
      <VoiceControls
        {...defaultProps}
        onCaptionsToggle={onCaptionsToggle}
        captionsEnabled={false}
      />
    );
    expect(screen.getByRole('button', { name: 'Enable captions' })).toBeInTheDocument();
  });

  it('toggles output mute state', () => {
    const onMuteOutput = vi.fn();
    render(<VoiceControls {...defaultProps} onMuteOutput={onMuteOutput} outputMuted={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mute playback' }));
    expect(onMuteOutput).toHaveBeenCalledWith(true);
  });

  it('toggles captions state', () => {
    const onCaptionsToggle = vi.fn();
    render(
      <VoiceControls
        {...defaultProps}
        onCaptionsToggle={onCaptionsToggle}
        captionsEnabled={false}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Enable captions' }));
    expect(onCaptionsToggle).toHaveBeenCalledWith(true);
  });

  it('shows stop button when processing', () => {
    render(<VoiceControls {...defaultProps} state="processing" />);
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
  });

  it('shows stop button when playing', () => {
    render(<VoiceControls {...defaultProps} state="playing" />);
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
  });

  it('shows error state button as disabled', () => {
    render(<VoiceControls {...defaultProps} state="error" />);
    expect(screen.getByRole('button', { name: 'Stop' })).toBeDisabled();
  });

  it('disables push-to-talk when not idle', () => {
    render(<VoiceControls {...defaultProps} state="capturing" />);
    expect(screen.getByRole('button', { name: 'Push to talk' })).toBeDisabled();
  });

  it('displays state label when no caption or error', () => {
    render(<VoiceControls {...defaultProps} state="capturing" />);
    expect(screen.getByText('Listening...')).toBeInTheDocument();
  });

  it('hides mute output button when onMuteOutput not provided', () => {
    render(<VoiceControls {...defaultProps} onMuteInput={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Mute playback' })).not.toBeInTheDocument();
  });

  it('hides captions toggle when onCaptionsToggle not provided', () => {
    render(<VoiceControls {...defaultProps} onMuteInput={vi.fn()} onMuteOutput={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Enable captions' })).not.toBeInTheDocument();
  });

  it('shows recording indicator when requesting', () => {
    render(<VoiceControls {...defaultProps} state="requesting" />);
    const indicator = screen.getByTestId('recording-indicator');
    expect(indicator).toBeInTheDocument();
  });

  it('shows state label in error state', () => {
    render(<VoiceControls {...defaultProps} state="error" />);
    expect(screen.getByText('Error')).toBeInTheDocument();
  });

  it('shows correct tooltip on main button in each state', () => {
    const { rerender } = render(<VoiceControls {...defaultProps} />);
    // Idle state - main button tooltip
    expect(screen.getByRole('tooltip', { name: 'Start voice input' })).toHaveTextContent(
      'Start voice input'
    );

    // Capturing state - main button tooltip
    rerender(<VoiceControls {...defaultProps} state="capturing" />);
    expect(screen.getByRole('tooltip', { name: 'Stop voice input' })).toHaveTextContent(
      'Stop voice input'
    );

    // Processing state - main button tooltip
    rerender(<VoiceControls {...defaultProps} state="processing" />);
    expect(screen.getByRole('tooltip', { name: 'Please wait' })).toHaveTextContent('Please wait');
  });

  it('shows correct icon class in each state', () => {
    const { rerender } = render(<VoiceControls {...defaultProps} />);
    const button = screen.getByRole('button', { name: 'Start' });
    expect(button).toHaveClass('or-voice-controls__button--idle');

    rerender(<VoiceControls {...defaultProps} state="capturing" />);
    expect(screen.getByRole('button', { name: 'Stop' })).toHaveClass(
      'or-voice-controls__button--capturing'
    );

    rerender(<VoiceControls {...defaultProps} state="processing" />);
    expect(screen.getByRole('button', { name: 'Stop' })).toHaveClass(
      'or-voice-controls__button--processing'
    );

    rerender(<VoiceControls {...defaultProps} state="playing" />);
    expect(screen.getByRole('button', { name: 'Stop' })).toHaveClass(
      'or-voice-controls__button--playing'
    );

    rerender(<VoiceControls {...defaultProps} state="error" />);
    expect(screen.getByRole('button', { name: 'Stop' })).toHaveClass(
      'or-voice-controls__button--error'
    );
  });

  it('displays error message', () => {
    render(<VoiceControls {...defaultProps} error="Microphone access denied" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Microphone access denied');
  });

  it('displays caption text', () => {
    render(<VoiceControls {...defaultProps} caption="Listening for your question..." />);
    expect(screen.getByText('Listening for your question...')).toBeInTheDocument();
  });

  it('shows recording indicator when capturing', () => {
    render(<VoiceControls {...defaultProps} state="capturing" />);
    const indicator = screen.getByTestId('recording-indicator');
    expect(indicator).toBeInTheDocument();
  });
});

describe('VoiceIndicator', () => {
  it('renders nothing when idle', () => {
    render(<VoiceIndicator state="idle" labels={{ states: defaultLabels.states }} />);
    expect(screen.queryByText('Idle')).not.toBeInTheDocument();
  });

  it('shows state label when active', () => {
    render(<VoiceIndicator state="capturing" labels={{ states: defaultLabels.states }} />);
    expect(screen.getByText('Listening...')).toBeInTheDocument();
  });

  it('shows caption when provided', () => {
    render(
      <VoiceIndicator
        state="playing"
        caption="Reading evidence..."
        labels={{ states: defaultLabels.states }}
      />
    );
    expect(screen.getByText('Speaking...')).toBeInTheDocument();
    expect(screen.getByText('Reading evidence...')).toBeInTheDocument();
  });

  it('shows each state correctly', () => {
    const states: Array<VoiceIndicatorProps['state']> = [
      'requesting',
      'capturing',
      'processing',
      'playing',
      'error',
    ];
    for (const state of states) {
      const { unmount } = render(
        <VoiceIndicator state={state} labels={{ states: defaultLabels.states }} />
      );
      expect(screen.getByText(defaultLabels.states[state])).toBeInTheDocument();
      unmount();
    }
  });
});
