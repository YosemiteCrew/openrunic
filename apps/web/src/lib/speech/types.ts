/**
 * Speech types for the client-side assistant.
 *
 * These mirror the server-side types from @openrunic/agent but are kept
 * separate to avoid depending on the server package in the browser bundle.
 */

/**
 * A speech capability that can be checked before capture begins.
 */
export type SpeechCapability =
  | 'realtime-streaming'
  | 'stt-streaming'
  | 'tts-streaming'
  | 'interruption-handling'
  | 'language-detection'
  | 'partial-transcripts';

/**
 * The result of a capability check.
 */
export interface CapabilityCheckResult {
  /** Whether the capability is supported by this adapter. */
  supported: boolean;
  /** Human-readable reason when unsupported, for disclosure. */
  reason?: string;
}

/**
 * Audio format configuration.
 */
export interface AudioFormat {
  /** Sample rate in Hz (e.g., 16000, 24000, 48000). */
  sampleRate: number;
  /** Number of channels (1 = mono, 2 = stereo). */
  channels: number;
  /** Encoding format. */
  encoding: 'pcm16' | 'opus' | 'mp3' | 'wav';
}

/**
 * Configuration for a speech session.
 */
export interface SpeechSessionConfig {
  /** Product-owned session ID, never a vendor session ID. */
  sessionId: string;
  /** Product-owned turn ID within the session. */
  turnId: string;
  /** The surface this session belongs to (staff/patient). */
  surface: 'staff' | 'patient';
  /** The chart/patient this session is scoped to. */
  chartId: string;
  /** Input audio format from the client. */
  inputFormat: AudioFormat;
  /** Desired output audio format for TTS. */
  outputFormat: AudioFormat;
  /** Language code (BCP 47). */
  language: string;
  /** Voice identifier for TTS (provider-specific). */
  voiceId?: string;
  /** Whether to enable partial/final transcript events. */
  enablePartialTranscripts: boolean;
  /** Whether the adapter supports interruption. */
  supportsInterruption: boolean;
}

/**
 * A speech event from the adapter.
 */
export type SpeechEvent =
  | { type: 'session-started'; sessionId: string }
  | {
      type: 'session-ended';
      sessionId: string;
      reason: 'completed' | 'stopped' | 'error' | 'revoked';
    }
  | { type: 'capture-started' }
  | { type: 'capture-stopped'; reason: 'user' | 'vad' | 'timeout' | 'interrupt' | 'revoked' }
  | { type: 'transcript-partial'; text: string; turnId: string; sequence: number }
  | {
      type: 'transcript-final';
      text: string;
      turnId: string;
      sequence: number;
      confidence?: number;
    }
  | { type: 'tts-started'; turnId: string; text: string }
  | { type: 'tts-chunk'; audio: Uint8Array; turnId: string; sequence: number; isLast: boolean }
  | { type: 'tts-finished'; turnId: string }
  | { type: 'interruption-received'; turnId: string; timestamp: number }
  | { type: 'error'; code: string; message: string; recoverable: boolean; turnId?: string };

/**
 * Speech adapter interface.
 *
 * Adapters implement this to provide STT/TTS capabilities.
 */
export interface SpeechAdapter {
  /** Human-readable name for logging and capability disclosure. */
  readonly name: string;

  /** Vendor/provider identifier (e.g., 'openai-realtime', 'azure-speech', 'elevenlabs-tts'). */
  readonly providerId: string;

  /** Capabilities this adapter supports. */
  readonly capabilities: ReadonlySet<SpeechCapability>;

  /**
   * Checks whether a capability is supported.
   * Must be called before starting capture/playback.
   */
  checkCapability(capability: SpeechCapability): CapabilityCheckResult;

  /**
   * Starts a speech session.
   * Returns an async iterator of speech events.
   * The adapter must validate permissions and scope before yielding any audio.
   */
  startSession(
    config: SpeechSessionConfig,
    onEvent: (event: SpeechEvent) => void
  ): Promise<SpeechSessionHandle>;

  /**
   * Stops the current session gracefully.
   * Flushes playback, rejects late results, clears queued audio.
   */
  stopSession(
    handle: SpeechSessionHandle,
    reason: 'user' | 'revoked' | 'context-change'
  ): Promise<void>;

  /**
   * Sends audio data for STT processing.
   */
  sendAudio(handle: SpeechSessionHandle, audio: Uint8Array): Promise<void>;

  /**
   * Requests TTS for the given text.
   * The text must be source-validated before this is called (ADR-0005 rule 8).
   */
  speak(handle: SpeechSessionHandle, text: string, turnId: string): Promise<void>;

  /**
   * Interrupts current playback and rejects late chunks.
   */
  interrupt(handle: SpeechSessionHandle, turnId: string): Promise<void>;
}

/**
 * Opaque handle for an active speech session.
 */
export interface SpeechSessionHandle {
  readonly sessionId: string;
  readonly turnId: string;
  readonly startedAt: number;
}

/**
 * Speech session state for the assistant.
 */
export type AssistantSpeechState =
  'idle' | 'initializing' | 'capturing' | 'processing' | 'playing' | 'error';

export interface UseSpeechOptions {
  /** Speech adapter instance (injected for testing, defaults to no-op) */
  adapter?: SpeechAdapter;
  /** Adapter configuration (used if adapter not provided) */
  adapterConfig?: SpeechAdapterConfig;
  /** Surface this session belongs to */
  surface: 'staff' | 'patient';
  /** Chart/patient ID this session is scoped to */
  chartId: string;
  /** Session ID */
  sessionId: string;
  /** Called when a transcript is received (final) */
  onTranscript?: (text: string) => void;
  /** Called when speech state changes */
  onStateChange?: (state: AssistantSpeechState) => void;
  /** Called when an error occurs */
  onError?: (error: string) => void;
  /** Language code */
  language?: string;
  /** Voice ID for TTS */
  voiceId?: string;
}

export interface SpeechAdapterConfig {
  /** Base URL for the speech provider endpoint. */
  baseUrl: string;
  /** Authentication configuration (api key, token, etc.). Type-only; no secrets in source. */
  authConfig: Record<string, string>;
  /** Provider-specific options. */
  options?: Record<string, unknown>;
}
