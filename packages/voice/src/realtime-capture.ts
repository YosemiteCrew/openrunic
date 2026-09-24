/**
 * A hosted realtime transcription session, as a {@link CapturePort}.
 *
 * This is the first adapter whose audio leaves the device, and the file is shaped
 * around that. Everything {@link ./platform-capture.ts} could argue away - no
 * endpoint, no credential, no agreement - is exactly what this one has, so none
 * of it is optional here:
 *
 * - **Named egress, or nothing.** ADR-0005 rule 6 wants an endpoint and a
 *   separate acknowledgement naming the executed agreement before health data
 *   may travel. {@link createRealtimeCapture} takes both, and a transport handed
 *   over without them is a thrown error at construction rather than a quiet
 *   fallback, because the failure mode of a fallback is a patient's voice going
 *   somewhere nobody named.
 * - **Transcription only.** The adapter reads transcript events and nothing
 *   else. A realtime service can also answer - in its own words, in its own
 *   voice, with tool calls - and none of that has a path out of this file: it
 *   never asks for a response, and a response that arrives anyway is dropped by
 *   the same `default` that drops an event it has never heard of. What reaches
 *   the reader is their own words in the box they type in, and what is read back
 *   to them is the assistant's source-checked answer through the readback port,
 *   never audio a model generated on its own.
 * - **Nothing about the record.** The transport is handed a language. It is not
 *   told whose chart is open, what was asked before, or who is asking; the
 *   credential it uses is the deployer's business on the server, minted after
 *   the checks the rest of the product already makes.
 *
 * The media itself - the microphone track, the codec, WebRTC or a socket, the
 * model and its identifiers - lives in the {@link RealtimeTransport} a deployer
 * supplies. This file owns only the part that has to be the same whoever
 * supplies it: which vendor events count, for which session, and when.
 *
 * The vocabulary below is the realtime transcription event set the issue for
 * this adapter points at. It is exercised here against a scripted connection,
 * not against the live service, and nothing in this repository says otherwise.
 */

import type { CaptureEvent, CaptureFailure, CapturePort, CaptureSession } from './capture.js';

/**
 * The two settings ADR-0005 rule 6 asks for, and neither can stand in for the
 * other. Blank is refused the same as absent: an empty string names nobody.
 */
export interface RealtimeEgress {
  /** Where the audio goes, as the deployer configured it. */
  endpoint: string;
  /** The executed agreement and the responsible party that cover it. */
  agreement: string;
}

/** What the transport reports that is not a vendor message. */
export interface RealtimeHandlers {
  /** The microphone track is live and audio is flowing. Not the press; the fact. */
  listening: () => void;
  /** One message off the wire, parsed. Anything at all; the adapter decides what counts. */
  message: (message: unknown) => void;
  /** The connection went away. */
  closed: () => void;
  /** The connection could not be made, or broke. */
  failed: (reason: CaptureFailure) => void;
}

/** One open session with the service. */
export interface RealtimeConnection {
  /** A client event. The only one this adapter sends is the commit that ends a question. */
  send: (message: { type: string }) => void;
  /** Closes the connection and releases the microphone. Safe to call twice. */
  close: () => void;
  /**
   * The reader pressed stop: no more audio may leave, while the connection
   * stays open for the words already sent. Optional, because a transport whose
   * media ends with the commit has nothing more to do.
   */
  mute?: () => void;
}

/**
 * The media half, supplied by a deployer.
 *
 * `open` is given the language and nothing else, for the same reason a
 * {@link CaptureSession} carries nothing else: a transport that is never told
 * whose record is open cannot widen what it sends.
 */
export interface RealtimeTransport {
  /** BCP-47 tags the configured recogniser transcribes. */
  languages: readonly string[];
  /**
   * Who decides where a question's audio ends, as the deployer configured it.
   *
   * `server`: the service detects speech and commits each stretch itself, so
   * by the time stop is pressed some of what was said may already be committed
   * and still being transcribed. `manual`: nothing is committed until this
   * adapter commits it. Stop has to know which, because a commit the service
   * did not expect either errors or is never answered.
   */
  turnDetection: 'server' | 'manual';
  open: (session: { language: string }, handlers: RealtimeHandlers) => RealtimeConnection;
}

const DELTA = 'conversation.item.input_audio_transcription.delta';
const COMPLETED = 'conversation.item.input_audio_transcription.completed';
const TRANSCRIPTION_FAILED = 'conversation.item.input_audio_transcription.failed';
const SPEECH_STARTED = 'input_audio_buffer.speech_started';
const COMMITTED = 'input_audio_buffer.committed';

/** A message as far as this adapter reads it. Everything is checked; nothing is trusted. */
interface Wire {
  type: string;
  itemId: string | null;
  text: string | null;
}

function read(message: unknown): Wire | null {
  if (typeof message !== 'object' || message === null) return null;
  const record = message as Record<string, unknown>;
  if (typeof record.type !== 'string') return null;
  const itemId = typeof record.item_id === 'string' ? record.item_id : null;
  const text =
    typeof record.delta === 'string'
      ? record.delta
      : typeof record.transcript === 'string'
        ? record.transcript
        : null;
  return { type: record.type, itemId, text };
}

function primarySubtag(tag: string): string {
  return (tag.split('-')[0] ?? '').toLowerCase();
}

function named(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim() !== '';
}

export function createRealtimeCapture(
  transport: RealtimeTransport | null,
  egress: RealtimeEgress | null
): CapturePort | null {
  if (transport === null) return null;
  if (!named(egress?.endpoint) || !named(egress?.agreement)) {
    throw new Error(
      'A hosted recogniser sends audio off the device. Configure its endpoint and the acknowledgement naming the executed agreement (ADR-0005 rule 6) before enabling it.'
    );
  }

  const listeners = new Set<(event: CaptureEvent) => void>();

  /* The same guard the on-device adapter keeps, for the same reason: a
     connection told to go away can still deliver what it had in flight, and
     that must not land in whatever the reader is doing now. */
  let live: string | null = null;
  let open: RealtimeConnection | null = null;
  let stopping = false;
  /* Stop sent a commit and the service has not yet said which item it made. */
  let awaitingCommit = false;
  /* Per vendor item: the words so far, whether the service has committed it,
     and whether it has already settled. `pending` is every item the service has
     told us about that has not settled - the words stop must wait for. A
     duplicate or late event for a settled item is dropped rather than put in
     the box twice. */
  let partial = new Map<string, string>();
  let pending = new Set<string>();
  let committed = new Set<string>();
  let settled = new Set<string>();

  const emit = (event: CaptureEvent) => {
    for (const listener of listeners) listener(event);
  };

  const close = () => {
    const current = open;
    live = null;
    open = null;
    stopping = false;
    awaitingCommit = false;
    partial = new Map();
    pending = new Set();
    committed = new Set();
    settled = new Set();
    current?.close();
  };

  const finish = (id: string, event: CaptureEvent) => {
    close();
    emit(event);
  };

  /**
   * After stop, the question is over once every item the service knows about
   * has settled and the commit stop sent (if it sent one) has been answered -
   * not on the first transcript that happens to arrive, which with server-side
   * turn detection can be an earlier stretch while a later one is in flight.
   */
  const settleIfDone = (id: string) => {
    if (stopping && !awaitingCommit && pending.size === 0) finish(id, { type: 'ended', id });
  };

  const track = (itemId: string) => {
    if (!settled.has(itemId)) pending.add(itemId);
  };

  const onMessage = (id: string, message: unknown) => {
    if (live !== id) return;
    const wire = read(message);
    if (wire === null) return;

    switch (wire.type) {
      case DELTA: {
        if (wire.itemId === null || wire.text === null || settled.has(wire.itemId)) return;
        track(wire.itemId);
        const text = (partial.get(wire.itemId) ?? '') + wire.text;
        partial.set(wire.itemId, text);
        emit({ type: 'heard', id, text, final: false });
        return;
      }
      case COMPLETED: {
        if (wire.itemId === null || wire.text === null || settled.has(wire.itemId)) return;
        settled.add(wire.itemId);
        pending.delete(wire.itemId);
        partial.delete(wire.itemId);
        emit({ type: 'heard', id, text: wire.text, final: true });
        settleIfDone(id);
        return;
      }
      case SPEECH_STARTED:
        if (wire.itemId !== null) track(wire.itemId);
        return;
      case COMMITTED:
        if (wire.itemId === null) return;
        track(wire.itemId);
        committed.add(wire.itemId);
        awaitingCommit = false;
        settleIfDone(id);
        return;
      case TRANSCRIPTION_FAILED:
      case 'error':
        finish(id, { type: 'failed', id, reason: 'failed' });
        return;
      default:
        /* Everything else, deliberately: session bookkeeping, speech detection,
           and anything the service says in reply - its text, its audio, its
           tool calls. None of it is the reader's words. */
        return;
    }
  };

  return {
    available: async (language: string) => {
      const wanted = primarySubtag(language);
      const speaks = transport.languages.some((tag) => primarySubtag(tag) === wanted);
      return speaks ? { status: 'available' } : { status: 'unavailable', reason: 'language' };
    },

    onEvent: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    start: (session: CaptureSession) => {
      close();
      live = session.id;
      try {
        const connection = transport.open(
          { language: session.language },
          {
            listening: () => {
              if (live === session.id) emit({ type: 'listening', id: session.id });
            },
            message: (message) => onMessage(session.id, message),
            closed: () => {
              if (live === session.id) finish(session.id, { type: 'ended', id: session.id });
            },
            failed: (reason) => {
              if (live === session.id)
                finish(session.id, { type: 'failed', id: session.id, reason });
            },
          }
        );
        /* A transport can fail inside `open` itself, before it has handed the
           connection back. That session is already over, so what it returned
           is closed rather than kept as the one that is live. */
        if (live === session.id) open = connection;
        else connection.close();
      } catch {
        /* A transport that cannot even begin is a failure the reader is told
           about, not an exception thrown through their button press - once:
           a transport that reported the failure before throwing has already
           said it. */
        if (live === session.id)
          finish(session.id, { type: 'failed', id: session.id, reason: 'failed' });
      }
    },

    stop: () => {
      /* Keeps what was said: the session stays live until every stretch the
         reader spoke has been transcribed.

         A commit is sent only when there is audio the service has not
         committed itself. Under manual turn detection that is always. Under
         server turn detection it is only while speech it has seen start is
         still uncommitted: once everything is committed, the buffer is empty,
         and a commit on an empty buffer is an error that would end a
         dictation that worked as a failure. */
      if (open === null || stopping) return;
      stopping = true;
      /* Stop means the microphone is off now, not once the service has caught
         up: anything said after the press is not part of the question. */
      open.mute?.();
      const uncommitted =
        transport.turnDetection === 'manual' ||
        [...pending].some((itemId) => !committed.has(itemId));
      if (uncommitted) {
        awaitingCommit = true;
        open.send({ type: 'input_audio_buffer.commit' });
      }
      if (live !== null) settleIfDone(live);
    },

    abort: () => {
      close();
    },
  };
}
