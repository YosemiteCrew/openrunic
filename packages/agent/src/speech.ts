/**
 * Speech adapter interfaces for the agentic layer.
 *
 * These interfaces define the contract for speech-to-text and text-to-speech
 * capabilities. The actual implementation lives in adapters, so the agent
 * core remains provider-agnostic. ADR-0005's provider independence rule
 * requires that swapping a speech provider changes only adapter code and
 * deployment configuration, not workflow logic or UI.
 */

import type { AgentSurface } from '@openrunic/agent-tools';

/**
 * A speech capability that can be checked before capture begins.
 * Missing capabilities must fail explicitly rather than silently degrade.
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
  surface: AgentSurface;
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
 * Adapters implement this to provide STT/TTS capabilities. The agent core
 * never imports vendor SDKs directly; all vendor-specific code lives here.
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
 * Factory for creating speech adapters.
 * Deployers configure which factory to use.
 */
export interface SpeechAdapterFactory {
  /** Creates an adapter instance with the given configuration. */
  create(config: SpeechAdapterConfig): SpeechAdapter;
}

/**
 * Configuration for a speech adapter factory.
 */
export interface SpeechAdapterConfig {
  /** Base URL for the speech provider endpoint. */
  baseUrl: string;
  /** Authentication configuration (api key, token, etc.). Type-only; no secrets in source. */
  authConfig: Record<string, string>;
  /** Provider-specific options. */
  options?: Record<string, unknown>;
}

/**
 * No-op speech adapter for when speech is disabled or unavailable.
 * Implements the interface but produces no audio/events.
 */
export class NoOpSpeechAdapter implements SpeechAdapter {
  readonly name = 'No-op (speech disabled)';
  readonly providerId = 'noop';
  readonly capabilities = new Set<SpeechCapability>();

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- intentionally unused; required by interface
  checkCapability(_capability: SpeechCapability): CapabilityCheckResult {
    return { supported: false, reason: 'Speech is not configured' };
  }

  async startSession(
    config: SpeechSessionConfig,
    onEvent: (event: SpeechEvent) => void
  ): Promise<SpeechSessionHandle> {
    const handle: SpeechSessionHandle = {
      sessionId: config.sessionId,
      turnId: config.turnId,
      startedAt: Date.now(),
    };
    onEvent({ type: 'session-started', sessionId: config.sessionId });
    onEvent({ type: 'session-ended', sessionId: config.sessionId, reason: 'completed' });
    return handle;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- intentionally unused; required by interface
  async stopSession(
    _handle: SpeechSessionHandle,
    _reason: 'user' | 'revoked' | 'context-change'
  ): Promise<void> {
    void _handle;
    void _reason;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- intentionally unused; required by interface
  async sendAudio(_handle: SpeechSessionHandle, _audio: Uint8Array): Promise<void> {
    void _handle;
    void _audio;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- intentionally unused; required by interface
  async speak(_handle: SpeechSessionHandle, _text: string, _turnId: string): Promise<void> {
    void _handle;
    void _text;
    void _turnId;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- intentionally unused; required by interface
  async interrupt(_handle: SpeechSessionHandle, _turnId: string): Promise<void> {
    void _handle;
    void _turnId;
  }
}

/**
 * Deterministic test adapter for CI.
 * Uses synthetic audio and produces predictable events.
 */
export class DeterministicTestSpeechAdapter implements SpeechAdapter {
  readonly name = 'Deterministic test adapter';
  readonly providerId = 'test-deterministic';
  readonly capabilities = new Set<SpeechCapability>([
    'stt-streaming',
    'tts-streaming',
    'interruption-handling',
    'partial-transcripts',
  ]);

  private readonly responses: Map<string, string> = new Map();
  private readonly transcripts: Map<string, string[]> = new Map();

  constructor(
    private readonly fixtureTranscripts: Map<string, string[]> = new Map(),
    private readonly fixtureResponses: Map<string, string> = new Map()
  ) {
    this.transcripts = fixtureTranscripts;
    this.responses = fixtureResponses;
  }

  checkCapability(capability: SpeechCapability): CapabilityCheckResult {
    return { supported: this.capabilities.has(capability) };
  }

  async startSession(
    config: SpeechSessionConfig,
    onEvent: (event: SpeechEvent) => void
  ): Promise<SpeechSessionHandle> {
    const handle: SpeechSessionHandle = {
      sessionId: config.sessionId,
      turnId: config.turnId,
      startedAt: Date.now(),
    };
    onEvent({ type: 'session-started', sessionId: config.sessionId });
    onEvent({ type: 'capture-started' });
    return handle;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- intentionally unused; required by interface
  async stopSession(
    _handle: SpeechSessionHandle,
    _reason: 'user' | 'revoked' | 'context-change'
  ): Promise<void> {
    void _handle;
    void _reason;
    // Simulate session end
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- intentionally unused; required by interface
  async sendAudio(_handle: SpeechSessionHandle, _audio: Uint8Array): Promise<void> {
    void _handle;
    void _audio;
    // In test mode, we simulate receiving a transcript
    // The test controls when transcripts arrive via the fixture
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- intentionally unused; required by interface
  async speak(_handle: SpeechSessionHandle, _text: string, _turnId: string): Promise<void> {
    void _handle;
    void _text;
    void _turnId;
    // Simulate TTS chunks
    const response = this.responses.get(_text) ?? `Response to: ${_text}`;
    const chunks = this.chunkText(response);

    for (let i = 0; i < chunks.length; i++) {
      // In real adapter this would be audio bytes
      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- intentionally unused; would be audio bytes
      const audio = new TextEncoder().encode(chunks[i]);
      void audio;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- intentionally unused; required by interface
  async interrupt(_handle: SpeechSessionHandle, _turnId: string): Promise<void> {
    void _handle;
    void _turnId;
    // Simulate interruption
  }

  private chunkText(text: string): string[] {
    // Simple chunking for test purposes
    const maxChunk = 100;
    const chunks: string[] = [];
    for (let i = 0; i < text.length; i += maxChunk) {
      chunks.push(text.slice(i, i + maxChunk));
    }
    return chunks;
  }

  /**
   * Test helper: inject a transcript event.
   */
  injectTranscript(turnId: string, text: string, isFinal: boolean): SpeechEvent {
    return isFinal
      ? { type: 'transcript-final', text, turnId, sequence: 1 }
      : { type: 'transcript-partial', text, turnId, sequence: 1 };
  }
}
