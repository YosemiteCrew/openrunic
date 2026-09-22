import { describe, expect, it, vi } from 'vitest';
import { createPlatformReadback, platformSpeech } from '../index.js';
import type { PlatformSpeech } from '../index.js';

/**
 * The device's own voice, driven through fakes.
 *
 * jsdom has no synthesiser, which is the same answer a browser without speech
 * gives, so both halves of the browser API are injected and the callbacks are
 * fired by hand. The case worth the file is the last one: a browser reports the
 * same `end` for an utterance it was told to cancel as for one it read to the
 * last word.
 */

interface FakeUtterance {
  text: string;
  lang: string;
  voice: { lang: string } | null;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}

function harness(voices: readonly string[] = ['en-GB', 'es-ES']) {
  const spoken: FakeUtterance[] = [];
  const listeners = new Set<() => void>();
  const cancel = vi.fn();

  const synthesis = {
    getVoices: () => voices.map((lang) => ({ lang })),
    speak: (utterance: FakeUtterance) => {
      spoken.push(utterance);
    },
    cancel,
    addEventListener: (_type: string, listener: () => void) => {
      listeners.add(listener);
    },
    removeEventListener: (_type: string, listener: () => void) => {
      listeners.delete(listener);
    },
  };

  const speech = {
    synthesis,
    utterance: (text: string): FakeUtterance => ({
      text,
      lang: '',
      voice: null,
      onstart: null,
      onend: null,
      onerror: null,
    }),
  } as unknown as PlatformSpeech;

  return { speech, spoken, listeners, cancel };
}

const UTTERANCE = { id: 'turn-1', text: 'You owe nothing.', language: 'en' };

describe('finding the device speech', () => {
  it('answers null where there is none, which is the server and every older browser', () => {
    expect(platformSpeech({})).toBeNull();
    expect(platformSpeech({ speechSynthesis: {} as SpeechSynthesis })).toBeNull();
  });

  it('builds an utterance with the browser constructor when both halves are there', () => {
    class Utterance {
      constructor(public text: string) {}
    }

    const speech = platformSpeech({
      speechSynthesis: {} as SpeechSynthesis,
      SpeechSynthesisUtterance: Utterance as unknown as new (
        text: string
      ) => SpeechSynthesisUtterance,
    });

    expect(speech?.utterance('hello').text).toBe('hello');
  });

  it('has no port to offer when there is no speech', () => {
    expect(createPlatformReadback(null)).toBeNull();
  });
});

describe('the device voice as a port', () => {
  it('reports the languages it has voices for, and that it can be stopped', () => {
    const { speech } = harness();

    expect(createPlatformReadback(speech)?.capabilities()).toEqual({
      languages: ['en-GB', 'es-ES'],
      interruption: true,
    });
  });

  it('answers the voice list again when the browser changes its mind', () => {
    /* A browser answers "no voices" for the first moment of its life. Without
       this, readback would be permanently unavailable on a device that speaks
       perfectly well. */
    const { speech, listeners } = harness();
    const port = createPlatformReadback(speech);
    const listener = vi.fn();

    const unsubscribe = port?.onCapabilities(listener);
    expect(listeners.size).toBe(1);

    for (const registered of listeners) registered();
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe?.();
    expect(listeners.size).toBe(0);
  });

  it('clears anything already speaking rather than queueing behind it', () => {
    const { speech, spoken, cancel } = harness();

    createPlatformReadback(speech)?.speak(UTTERANCE);

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(spoken).toHaveLength(1);
    expect(spoken[0]?.text).toBe('You owe nothing.');
  });

  it('picks a voice for the language of the page rather than the device', () => {
    const { speech, spoken } = harness(['en-GB', 'es-ES']);

    createPlatformReadback(speech)?.speak({ ...UTTERANCE, language: 'es-MX' });

    expect(spoken[0]?.lang).toBe('es-MX');
    expect(spoken[0]?.voice).toEqual({ lang: 'es-ES' });
  });

  it('leaves the voice unset when it has none for that language', () => {
    const { speech, spoken } = harness(['en-GB']);

    createPlatformReadback(speech)?.speak({ ...UTTERANCE, language: 'fr' });

    expect(spoken[0]?.lang).toBe('fr');
    expect(spoken[0]?.voice).toBeNull();
  });

  it('reports the sound starting and the answer being read to the end', () => {
    const { speech, spoken } = harness();
    const emit = vi.fn();
    const port = createPlatformReadback(speech);

    port?.onEvent(emit);
    port?.speak(UTTERANCE);
    spoken[0]?.onstart?.();
    spoken[0]?.onend?.();

    expect(emit.mock.calls.map(([event]) => event)).toEqual([
      { type: 'started', id: 'turn-1' },
      { type: 'finished', id: 'turn-1' },
    ]);
  });

  it('reports a voice that could not speak as a failure', () => {
    const { speech, spoken } = harness();
    const emit = vi.fn();
    const port = createPlatformReadback(speech);

    port?.onEvent(emit);
    port?.speak(UTTERANCE);
    spoken[0]?.onerror?.();

    expect(emit).toHaveBeenCalledWith({ type: 'failed', id: 'turn-1' });
  });

  it('stops reporting to a listener that unsubscribed', () => {
    const { speech, spoken } = harness();
    const emit = vi.fn();
    const port = createPlatformReadback(speech);

    const unsubscribe = port?.onEvent(emit);
    unsubscribe?.();
    port?.speak(UTTERANCE);
    spoken[0]?.onend?.();

    expect(emit).not.toHaveBeenCalled();
  });

  it('reports nothing for an utterance it was told to cancel', () => {
    /* The browser fires `end` here, and it is the same `end` a finished answer
       fires. Passing it on would record an answer the reader stopped as one they
       heard. */
    const { speech, spoken, cancel } = harness();
    const emit = vi.fn();
    const port = createPlatformReadback(speech);

    port?.onEvent(emit);
    port?.speak(UTTERANCE);
    port?.cancel();
    spoken[0]?.onend?.();

    expect(cancel).toHaveBeenCalledTimes(2);
    expect(emit).not.toHaveBeenCalled();
  });

  it('reports nothing for an utterance a later one replaced', () => {
    const { speech, spoken } = harness();
    const heard = vi.fn();
    const port = createPlatformReadback(speech);

    port?.onEvent(heard);
    port?.speak(UTTERANCE);
    heard.mockClear();
    port?.speak({ ...UTTERANCE, id: 'turn-2' });
    heard.mockClear();
    spoken[0]?.onend?.();

    expect(heard).not.toHaveBeenCalled();
  });
});
