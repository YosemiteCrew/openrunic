import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { VoiceControls } from '@/components/assistant/VoiceControls';

// Mock SpeechRecognition at the top level
const MockSpeechRecognition = vi.hoisted(() => {
  return class {
    lang = '';
    interimResults = false;
    continuous = false;
    onstart: (() => void) | null = null;
    onend: (() => void) | null = null;
    onerror: ((event: { error: string }) => void) | null = null;
    onresult: ((event: unknown) => void) | null = null;
    start = vi.fn();
    stop = vi.fn();
  };
});

vi.stubGlobal('SpeechRecognition', MockSpeechRecognition);
vi.stubGlobal('webkitSpeechRecognition', undefined);

describe('VoiceControls', () => {
  const defaultProps = {
    value: '',
    onChange: vi.fn(),
    onSubmit: vi.fn(),
    answering: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the microphone button when voice is supported', () => {
    render(<VoiceControls {...defaultProps} />);

    const micButton = screen.getByRole('button', { name: 'Start voice input' });
    expect(micButton).toBeInTheDocument();
    expect(micButton).not.toBeDisabled();
  });

  it('shows typed alternative hint', () => {
    render(<VoiceControls {...defaultProps} />);

    expect(screen.getByText('Or type your question instead')).toBeInTheDocument();
  });

  it('disables microphone button when answering', () => {
    render(<VoiceControls {...defaultProps} answering={true} />);

    const micButton = screen.getByRole('button', { name: 'Start voice input' });
    expect(micButton).toBeDisabled();
  });

  it('shows unsupported message when SpeechRecognition is not available', () => {
    vi.stubGlobal('SpeechRecognition', undefined);
    vi.stubGlobal('webkitSpeechRecognition', undefined);

    render(<VoiceControls {...defaultProps} />);

    expect(screen.getByText('Voice input is not supported in this browser.')).toBeInTheDocument();
  });
});
