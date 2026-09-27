/**
 * A hosted text-to-speech service, as a {@link ReadbackPort}.
 *
 * The mirror of {@link ./realtime-capture.ts}: the last stage of the chained
 * route, where the assistant's answer is already written and checked and a
 * service turns that text into sound. {@link ./platform.ts} can argue that it
 * sends nothing anywhere; this one sends the words of an answer to a service, so
 * none of what that file does without is optional here:
 *
 * - **Named egress, or nothing.** ADR-0005 rule 6 wants an endpoint and a
 *   separate acknowledgement naming the executed agreement before health data
 *   may travel. {@link createHostedReadback} takes both, and a synthesiser
 *   handed over without them is a thrown error at construction rather than a
 *   quiet fallback to the device, or from it.
 * - **The words on the screen, and nothing else.** The synthesiser is handed
 *   the text and its language. It is not handed the turn id, the record, the
 *   question or who is asking, so it has nothing to widen what is spoken with.
 *   What it reads is the source-checked answer the surface already rendered,
 *   never text a model produced for the voice alone.
 *
 * The media - the request, the codec, the audio element, the credential -
 * lives in the {@link HostedSynthesiser} a deployer supplies. This file owns
 * only the part that has to be the same whoever supplies it: which report
 * belongs to the answer being read now.
 *
 * It is exercised against a scripted synthesiser only, not a live service.
 */

import type { ReadbackEvent, ReadbackPort, Utterance } from './ports.js';

/**
 * The two settings ADR-0005 rule 6 asks for. Neither stands in for the other,
 * and blank is refused the same as absent: an empty string names nobody.
 */
export interface HostedReadbackEgress {
  /** Where the text goes, as the deployer configured it. */
  endpoint: string;
  /** The executed agreement and the responsible party that cover it. */
  agreement: string;
}

/** What a synthesiser reports about the one playback it was handed them for. */
export interface PlaybackHandlers {
  /** Sound is coming out. Not the request; the fact. */
  started: () => void;
  /** The whole answer was played. */
  finished: () => void;
  /** It could not be fetched or played. */
  failed: () => void;
}

/** One answer being played. */
export interface Playback {
  /** Stops the sound and abandons anything still being fetched. Safe to call twice. */
  stop: () => void;
}

/** The media half, supplied by a deployer. */
export interface HostedSynthesiser {
  /** BCP-47 tags the configured voice speaks. */
  languages: readonly string[];
  play: (speech: { text: string; language: string }, handlers: PlaybackHandlers) => Playback;
}

function named(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim() !== '';
}

export function createHostedReadback(
  synthesiser: HostedSynthesiser | null,
  egress: HostedReadbackEgress | null
): ReadbackPort | null {
  if (synthesiser === null) return null;
  if (!named(egress?.endpoint) || !named(egress?.agreement)) {
    throw new Error(
      'A hosted voice sends the answer off the device. Configure its endpoint and the acknowledgement naming the executed agreement (ADR-0005 rule 6) before enabling it.'
    );
  }

  const listeners = new Set<(event: ReadbackEvent) => void>();

  /* The utterance whose reports still count. A playback told to stop can still
     say it finished - an audio element fires `ended` on a source that was
     cleared - and that must not read as an answer heard to the end. */
  let live: string | null = null;
  let playing: Playback | null = null;

  const emit = (event: ReadbackEvent) => {
    for (const listener of listeners) listener(event);
  };

  const halt = () => {
    live = null;
    const current = playing;
    playing = null;
    current?.stop();
  };

  const settle = (id: string, type: 'finished' | 'failed') => {
    if (live !== id) return;
    live = null;
    playing = null;
    emit({ type, id });
  };

  return {
    capabilities: () => ({ languages: synthesiser.languages, interruption: true }),
    /* The configured voice is fixed for the life of the page, so its answer
       never changes and there is nothing to subscribe to. */
    onCapabilities: () => () => undefined,
    onEvent: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    speak: (utterance: Utterance) => {
      halt();
      const { id } = utterance;
      live = id;
      try {
        const playback = synthesiser.play(
          { text: utterance.text, language: utterance.language },
          {
            started: () => {
              if (live === id) emit({ type: 'started', id });
            },
            finished: () => settle(id, 'finished'),
            failed: () => settle(id, 'failed'),
          }
        );
        /* A synthesiser can settle inside `play`, before it has handed the
           playback back. That answer is already over, so what it returned is
           stopped rather than kept as the one playing. */
        if (live === id) playing = playback;
        else playback.stop();
      } catch {
        /* A synthesiser that cannot even begin is a sentence on screen, not an
           exception thrown through the reader's switch. */
        settle(id, 'failed');
      }
    },
    cancel: halt,
  };
}
