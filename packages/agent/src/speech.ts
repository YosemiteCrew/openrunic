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
 *
 * SECURITY NOTE: This configuration combines a patient identifier (chartId)
 * with audio capture settings. Implementations MUST ensure:
 * - Audio data is encrypted in transit (TLS 1.2+) and at rest
 * - Audio data containing PHI is never logged or persisted without encryption
 * - Access to audio streams is scoped to the authenticated user and chartId
 * - Session termination revokes access and clears queued audio (ADR-0005)
 * - The chartId is for LOCAL access control only; NOT transmitted to speech provider.
 */
export interface SpeechSessionConfig {
  /** Product-owned session ID, never a vendor session ID. */
  sessionId: string;
  /** Product-owned turn ID within the session. */
  turnId: string;
  /** The surface this session belongs to (staff/patient). */
  surface: AgentSurface;
  /** The chart/patient this session is scoped to. Used for access control and audit. */
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
 *
 * SECURITY REQUIREMENTS for implementations (HIPAA-compliant PHI handling):
 * - All audio data (input and output) MUST be encrypted in transit (TLS 1.2+)
 * - Audio data containing PHI MUST NOT be logged, persisted, or cached unencrypted
 * - The adapter MUST validate that the caller has access to the chartId in SpeechSessionConfig
 * - Session termination (stopSession, interrupt) MUST immediately revoke access and clear buffers
 * - Implementations MUST support the 'revoked' session end reason for logout/context-change
 * - Vendor API keys/credentials MUST be injected at runtime, never hardcoded
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
   * The config.chartId identifies the patient record; adapter MUST enforce access control.
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
   * The audio buffer may contain PHI (patient speech); implementations MUST encrypt in transit.
   */
  sendAudio(handle: SpeechSessionHandle, audio: Uint8Array): Promise<void>;

  /**
   * Requests TTS for the given text.
   * The text must be source-validated before this is called (ADR-0005 rule 8).
   * The text may contain PHI; implementations MUST encrypt in transit and not log.
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
  /** Authentication configuration (api key, token, etc.). Type-only; no secrets in source.
   *  Injected at runtime via environment/config, never hardcoded. */
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

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- part of the interface; a no-op adapter supports nothing
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

  async stopSession(
    _handle: SpeechSessionHandle,
    _reason: 'user' | 'revoked' | 'context-change'
  ): Promise<void> {
    void _handle;
    void _reason;
  }

  async sendAudio(_handle: SpeechSessionHandle, _audio: Uint8Array): Promise<void> {
    void _handle;
    void _audio;
  }

  async speak(_handle: SpeechSessionHandle, _text: string, _turnId: string): Promise<void> {
    void _handle;
    void _text;
    void _turnId;
  }

  async interrupt(_handle: SpeechSessionHandle, _turnId: string): Promise<void> {
    void _handle;
    void _turnId;
  }
}

/**
 * Deterministic test adapter for CI.
 *
 * `startSession` is the only point an adapter is handed an event callback, so
 * an adapter that does not keep it can emit nothing afterwards. This one keeps
 * one sink per open session: without that, `speak` chunked and encoded a
 * response and then dropped every chunk, and the fixture transcripts handed to
 * the constructor were never read by anything.
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

  /**
   * Each open session, keyed by its product-owned id: the callback to emit on,
   * and how many fixture transcript lines it has already played back. One entry
   * rather than two maps, so the sink and the cursor cannot disagree about
   * whether a session is open.
   */
  private readonly sessions = new Map<
    string,
    { readonly emit: (event: SpeechEvent) => void; delivered: number }
  >();

  constructor(
    /** Transcript lines to play back per turn id, in order. */
    private readonly transcripts: Map<string, string[]> = new Map(),
    /** Spoken response per requested text; anything unlisted gets a stub. */
    private readonly responses: Map<string, string> = new Map()
  ) {}

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
    this.sessions.set(config.sessionId, { emit: onEvent, delivered: 0 });
    onEvent({ type: 'session-started', sessionId: config.sessionId });
    onEvent({ type: 'capture-started' });
    return handle;
  }

  async stopSession(
    handle: SpeechSessionHandle,
    reason: 'user' | 'revoked' | 'context-change'
  ): Promise<void> {
    const session = this.sessions.get(handle.sessionId);
    // Dropped before emitting, so a sink that re-enters cannot be served twice.
    this.sessions.delete(handle.sessionId);
    if (!session) return;
    const { emit } = session;
    emit({ type: 'capture-stopped', reason: reason === 'user' ? 'user' : 'revoked' });
    emit({
      type: 'session-ended',
      sessionId: handle.sessionId,
      // ADR-0005 keeps these apart: a clinician stopping is not the same fact
      // as a logout or a context change revoking the session under them.
      reason: reason === 'user' ? 'stopped' : 'revoked',
    });
  }

  /**
   * The fixture is the input here, not the bytes: a deterministic adapter that
   * transcribed real audio would not be deterministic. Each call plays back the
   * next line configured for this turn, the last one as the final transcript.
   */
  async sendAudio(handle: SpeechSessionHandle, _audio: Uint8Array): Promise<void> {
    void _audio;
    const session = this.sessions.get(handle.sessionId);
    if (!session) return;
    const lines = this.transcripts.get(handle.turnId) ?? [];
    const index = session.delivered;
    const line = lines[index];
    if (line === undefined) return;
    session.delivered = index + 1;
    const sequence = index + 1;
    session.emit(
      index === lines.length - 1
        ? { type: 'transcript-final', text: line, turnId: handle.turnId, sequence }
        : { type: 'transcript-partial', text: line, turnId: handle.turnId, sequence }
    );
  }

  async speak(handle: SpeechSessionHandle, text: string, turnId: string): Promise<void> {
    const session = this.sessions.get(handle.sessionId);
    if (!session) return;
    const { emit } = session;
    const response = this.responses.get(text) ?? `Response to: ${text}`;
    const chunks = this.chunkText(response);
    emit({ type: 'tts-started', turnId, text: response });
    chunks.forEach((chunk, index) => {
      emit({
        type: 'tts-chunk',
        audio: new TextEncoder().encode(chunk),
        turnId,
        sequence: index + 1,
        isLast: index === chunks.length - 1,
      });
    });
    emit({ type: 'tts-finished', turnId });
  }

  async interrupt(handle: SpeechSessionHandle, turnId: string): Promise<void> {
    this.sessions
      .get(handle.sessionId)
      ?.emit({ type: 'interruption-received', turnId, timestamp: Date.now() });
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
}
