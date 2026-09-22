/**
 * The one capture adapter this build ships: the recogniser on the device, and
 * only ever the one on the device.
 *
 * The Web Speech API has done both things under one name for fifteen years. The
 * original one sends the audio to a service the browser vendor chose, which for
 * this product is health-data egress to a third party with no endpoint to name,
 * no credential to hold and no agreement to acknowledge - exactly the thing
 * ADR-0005 rule 6 exists to stop happening by default. The recent one runs a
 * model on the device, and `processLocally` is the instruction that picks it.
 *
 * So the whole adapter turns on one question, asked before the microphone is
 * touched and asked of the browser rather than of a version table:
 *
 *   SpeechRecognition.available({ langs: [page], processLocally: true })
 *
 * **A browser that cannot answer that question is refused, not tried.** That is
 * the single load-bearing line in this file. `processLocally` is an ordinary
 * property assignment, so on a browser that has never heard of it the assignment
 * succeeds, reads back as `true`, and changes nothing: the audio goes to the
 * vendor's service and every check written against the property agrees that it
 * did not. There is no second guard here because there is no second guard that
 * could fire - the static method is the only thing on the object that a browser
 * without on-device recognition does not have. Feature-detect the question, not
 * the answer.
 *
 * Both halves are injected rather than reached for, because a test has to drive
 * a recognition through its callbacks, and because neither exists on the server
 * or under jsdom - so `null` here is the ordinary case rather than an error, and
 * it renders as no dictation at all.
 */

import { captureAvailability } from './capture';
import type { CaptureEvent, CaptureFailure, CapturePort, CaptureSession } from './capture';

/**
 * The parts of a `SpeechRecognition` this adapter uses.
 *
 * Declared here rather than taken from the DOM library because the on-device
 * half of the API is newer than the types in this toolchain, and because a
 * vendor shape that only this file knows about is the point of a port.
 */
interface RecognitionAlternative {
  readonly transcript: string;
}

interface RecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: RecognitionAlternative;
}

interface RecognitionResults {
  readonly length: number;
  readonly [index: number]: RecognitionResult;
}

interface RecognitionResultEvent {
  readonly resultIndex: number;
  readonly results: RecognitionResults;
}

interface RecognitionErrorEvent {
  readonly error: string;
}

export interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  processLocally: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onaudiostart: (() => void) | null;
  onresult: ((event: RecognitionResultEvent) => void) | null;
  onerror: ((event: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}

/** What the browser asks for when it is asked what it can do on the device. */
export interface OnDeviceQuery {
  langs: readonly string[];
  processLocally: boolean;
}

/** The two things this adapter needs, taken as values so they can be faked. */
export interface PlatformRecognition {
  /** The static availability check. Its presence is what proves on-device support exists. */
  available: (query: OnDeviceQuery) => Promise<string>;
  create: () => Recognition;
}

interface RecognitionConstructor {
  new (): Recognition;
  available?: (query: OnDeviceQuery) => Promise<string>;
}

/**
 * What a browser that can recognise speech exposes. Declared as optional rather
 * than read off `window`, because on the server and under jsdom neither is there.
 */
interface RecognitionGlobals {
  SpeechRecognition?: RecognitionConstructor;
  webkitSpeechRecognition?: RecognitionConstructor;
}

/**
 * The device's recogniser, or null where there is none that stays on the device.
 *
 * Null covers three different browsers and deliberately does not tell them
 * apart: no speech recognition at all, the vendor-prefixed one several browsers
 * still ship, and anything else whose constructor cannot be asked what it can do
 * locally. All three come to the same thing for this surface - there is no way
 * to capture here without the audio leaving - and a product that drew a disabled
 * switch for the second two would be inviting somebody to go looking for a
 * setting that would make their voice travel.
 */
export function platformRecognition(
  /* Asserted rather than declared. Unlike the synthesiser, neither name is in
     this toolchain's DOM library at all, so `globalThis` has nothing in common
     with the shape and TypeScript refuses the assignment outright. The assertion
     says what a browser may have; every field is optional and every one of them
     is checked below before it is used. */
  scope: RecognitionGlobals = globalThis as RecognitionGlobals
): PlatformRecognition | null {
  const Constructor = scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
  if (Constructor === undefined) return null;

  const { available } = Constructor;
  if (typeof available !== 'function') return null;

  return {
    available: (query) => available.call(Constructor, query),
    create: () => new Constructor(),
  };
}

/**
 * How the browser's error names read to somebody in a waiting room.
 *
 * `network` is in here with `language-not-supported` rather than with the
 * general failures, and that pairing is the interesting one: this adapter asked
 * for on-device recognition, so a network error means the browser went looking
 * for a service instead. Whatever it means to the vendor, to this product it
 * means the device would not do this without sending the audio away - which is
 * the same sentence the reader needs, and the same one they get.
 */
const FAILURES: Readonly<Record<string, CaptureFailure>> = {
  'not-allowed': 'denied',
  'service-not-allowed': 'denied',
  'no-speech': 'no-speech',
  'audio-capture': 'no-audio',
  'language-not-supported': 'off-device',
  network: 'off-device',
};

export function createPlatformCapture(
  recognition: PlatformRecognition | null = platformRecognition()
): CapturePort | null {
  if (recognition === null) return null;

  const listeners = new Set<(event: CaptureEvent) => void>();

  /**
   * The session whose events still count.
   *
   * A recogniser reports `end` for one it was told to abort, which is the same
   * event it reports for a question said to the last word, and it reports it
   * after the surface has already moved on. Dropping the record of it here is
   * what makes "aborted" and "finished" two different things at this boundary.
   *
   * The surface drops an event for a session it is not waiting on as well. That
   * is not the same guard twice: this one holds for the abort this adapter
   * performed itself, and the other holds for any adapter at all, including one
   * that never learned to stop reporting.
   */
  let live: string | null = null;
  let open: Recognition | null = null;

  const emit = (event: CaptureEvent) => {
    for (const listener of listeners) listener(event);
  };

  const close = () => {
    const current = open;
    live = null;
    open = null;
    return current;
  };

  return {
    available: async (language: string) => {
      /* `processLocally` is what makes this question the right question. Without
         it the browser answers about the service as well, and every device on
         earth says yes. */
      const answer = await recognition.available({ langs: [language], processLocally: true });
      return captureAvailability(answer);
    },

    onEvent: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    start: (session: CaptureSession) => {
      /* Replacing rather than queueing, for the same reason the voice does: two
         microphones open over one box is worse than either. */
      const previous = close();
      previous?.abort();

      const speech = recognition.create();
      speech.lang = session.language;
      speech.processLocally = true;

      /* Not a setting, and not a default being restated. `continuous` is the
         difference between one question and a microphone that stays open, and a
         microphone that stays open is the always-listening mode this issue's
         own scope puts out of bounds. It is written here so that turning it on
         is an edit somebody has to make and defend. */
      speech.continuous = false;

      /* The words appear as they are recognised. On a surface built for somebody
         who may not hear the room, seeing what was understood before pressing
         Ask is the check; and it is free, because the text is already on the
         device that produced it. */
      speech.interimResults = true;

      speech.onaudiostart = () => {
        if (live === session.id) emit({ type: 'listening', id: session.id });
      };

      speech.onresult = (event) => {
        if (live !== session.id) return;
        /* Only what arrived in this event. The list is cumulative, and reading
           it from the top would re-deliver every sentence already in the box. */
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index];
          const alternative = result?.[0];
          if (result === undefined || alternative === undefined) continue;
          emit({
            type: 'heard',
            id: session.id,
            text: alternative.transcript,
            final: result.isFinal,
          });
        }
      };

      speech.onerror = (event) => {
        if (live !== session.id) return;
        /* A cancel is the question ending, not something going wrong, so the
           `end` behind it is left to settle the session. This adapter's own
           abort never arrives here - it clears the session first - so the case
           this covers is the browser's own cancel control. */
        if (event.error === 'aborted') return;
        close();
        const reason = FAILURES[event.error] ?? 'failed';
        emit({ type: 'failed', id: session.id, reason });
      };

      speech.onend = () => {
        if (live !== session.id) return;
        close();
        emit({ type: 'ended', id: session.id });
      };

      live = session.id;
      open = speech;
      speech.start();
    },

    stop: () => {
      /* Keeps what was said: the reader finished their question and pressed the
         control, and throwing the sentence away would be this surface deciding
         they had not meant it. The session stays live until the recogniser says
         it has ended, so the last words still arrive. */
      open?.stop();
    },

    abort: () => {
      const current = close();
      current?.abort();
    },
  };
}
