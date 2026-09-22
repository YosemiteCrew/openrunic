/**
 * The one adapter this build ships: the voice already on the device.
 *
 * It is the whole reason readback can exist on a privacy-first product without
 * anybody configuring anything. ADR-0005 makes the assistant default-off
 * because asking a question sends words to an endpoint; reading the answer back
 * sends nothing anywhere, because the synthesiser is part of the operating
 * system the reader is already holding. There is no key, no host, no
 * acknowledgement and no second setting, and there is nothing here that could
 * grow one without becoming a different adapter.
 *
 * A hosted voice would be a different adapter, and it would need everything
 * ADR-0005 rule 6 asks of the model endpoint before it could ship. That is the
 * point of the port: this file is replaceable, and none of the rules about what
 * may be spoken live in it.
 *
 * Both halves of the browser API are injected rather than reached for, because
 * a test has to be able to drive an utterance through its callbacks, and
 * because neither exists on the server or under jsdom - so `null` here is the
 * ordinary case rather than an error, and it renders as no readback at all.
 */

import type { ReadbackEvent, ReadbackPort, Utterance } from './ports.js';

/** The two globals this adapter needs, taken as values so they can be faked. */
export interface PlatformSpeech {
  synthesis: SpeechSynthesis;
  /** Builds one utterance. `new SpeechSynthesisUtterance(text)` in a browser. */
  utterance: (text: string) => SpeechSynthesisUtterance;
}

/**
 * What a browser that can speak exposes. Declared as optional rather than read
 * off `window`, because on the server and under jsdom neither is there and the
 * DOM types say both always are.
 */
interface SpeechGlobals {
  speechSynthesis?: SpeechSynthesis;
  SpeechSynthesisUtterance?: new (text: string) => SpeechSynthesisUtterance;
}

/** The device's speech, or null where there is none: the server, jsdom, older browsers. */
export function platformSpeech(scope: SpeechGlobals = globalThis): PlatformSpeech | null {
  const synthesis = scope.speechSynthesis;
  const Utterance = scope.SpeechSynthesisUtterance;
  if (synthesis === undefined || Utterance === undefined) return null;
  return { synthesis, utterance: (text) => new Utterance(text) };
}

function primarySubtag(tag: string): string {
  return (tag.split('-')[0] ?? '').toLowerCase();
}

export function createPlatformReadback(
  speech: PlatformSpeech | null = platformSpeech()
): ReadbackPort | null {
  if (speech === null) return null;
  const { synthesis } = speech;

  const listeners = new Set<(event: ReadbackEvent) => void>();

  /**
   * The utterance whose events still count.
   *
   * A browser reports `end` on an utterance it was told to cancel, which is the
   * same event it reports when an answer was read in full. Dropping the record
   * of it here is what makes "cancelled" and "finished" two different things at
   * this boundary rather than one.
   *
   * The surface drops an ending for an utterance it is not waiting on as well.
   * That is not the same guard twice: this one holds for the cancel this
   * adapter performed itself, and the other holds for any adapter at all,
   * including one that never learned to stop reporting.
   */
  let live: string | null = null;

  const emit = (event: ReadbackEvent) => {
    for (const listener of listeners) listener(event);
  };

  return {
    capabilities: () => ({
      languages: synthesis.getVoices().map((voice) => voice.lang),
      interruption: true,
    }),

    onCapabilities: (listener) => {
      synthesis.addEventListener('voiceschanged', listener);
      return () => {
        synthesis.removeEventListener('voiceschanged', listener);
      };
    },

    onEvent: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    speak: (utterance: Utterance) => {
      /* Replacing rather than queueing. Two answers read over each other is
         worse than either, and a queue would keep speaking an answer the reader
         has already moved past. */
      live = null;
      synthesis.cancel();

      const spoken = speech.utterance(utterance.text);
      spoken.lang = utterance.language;

      /* A voice is chosen by language rather than left to the browser's
         default, which on several of them is the system language and not the
         page's: an English voice reading Spanish is unintelligible rather than
         merely accented. No match leaves `voice` unset, where `lang` still
         steers the default. */
      const voice = synthesis
        .getVoices()
        .find((candidate) => primarySubtag(candidate.lang) === primarySubtag(utterance.language));
      if (voice !== undefined) spoken.voice = voice;

      const ending = (type: 'finished' | 'failed') => () => {
        if (live !== utterance.id) return;
        live = null;
        emit({ type, id: utterance.id });
      };

      spoken.onstart = () => {
        if (live === utterance.id) emit({ type: 'started', id: utterance.id });
      };
      spoken.onend = ending('finished');
      spoken.onerror = ending('failed');

      live = utterance.id;
      synthesis.speak(spoken);
    },

    cancel: () => {
      live = null;
      synthesis.cancel();
    },
  };
}
