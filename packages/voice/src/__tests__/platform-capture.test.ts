import { describe, expect, it, vi } from 'vitest';
import { createPlatformCapture, platformRecognition } from '../index.js';
import type { CaptureEvent, PlatformRecognition, Recognition } from '../index.js';

/**
 * The device's own recogniser, driven through fakes.
 *
 * jsdom has no microphone, which is the same answer a browser without speech
 * recognition gives, so both halves of the API are injected and the callbacks
 * are fired by hand.
 *
 * Two cases carry the file. The first is that a browser which cannot be asked
 * whether it recognises speech **on the device** is refused rather than tried:
 * that refusal is the only thing standing between this feature and a patient's
 * spoken health question being transcribed by a third party. The second is the
 * one a browser really does produce - the same `end` for a session it was told
 * to abort as for a question said to the last word.
 */

interface Fake extends Recognition {
  started: number;
  stopped: number;
  aborted: number;
}

function recogniser(answer = 'available') {
  const built: Fake[] = [];

  const create = (): Recognition => {
    const fake: Fake = {
      lang: '',
      continuous: true,
      interimResults: false,
      processLocally: false,
      started: 0,
      stopped: 0,
      aborted: 0,
      start: () => {
        fake.started += 1;
      },
      stop: () => {
        fake.stopped += 1;
      },
      abort: () => {
        fake.aborted += 1;
      },
      onaudiostart: null,
      onresult: null,
      onerror: null,
      onend: null,
    };
    built.push(fake);
    return fake;
  };

  const available = vi.fn(async () => answer);
  return { recognition: { available, create } as PlatformRecognition, built, available };
}

/** One `result` event, shaped the way the browser shapes it: cumulative, indexed. */
function results(from: number, said: readonly (readonly [string, boolean])[]) {
  const list = said.map(([transcript, isFinal]) => ({
    isFinal,
    length: 1,
    0: { transcript },
  }));
  return { resultIndex: from, results: { ...list, length: list.length } } as never;
}

function record(port: ReturnType<typeof createPlatformCapture>) {
  const seen: CaptureEvent[] = [];
  port?.onEvent((event) => seen.push(event));
  return seen;
}

const SESSION = { id: 'session-1', language: 'en' };

describe('finding an on-device recogniser', () => {
  it('answers null where there is none, which is the server and every older browser', () => {
    expect(platformRecognition({})).toBeNull();
  });

  it('refuses a recogniser that cannot be asked whether it stays on the device', () => {
    /* The whole feature rests on this. A browser with the fifteen-year-old
       prefixed API and no `available` sends the audio to a service the vendor
       chose, and `processLocally = true` on it is an ordinary property
       assignment that reads back true and changes nothing. There is no answer to
       check, so the question is what gets checked. */
    class Prefixed {}
    expect(platformRecognition({ webkitSpeechRecognition: Prefixed as never })).toBeNull();
    expect(
      platformRecognition({
        SpeechRecognition: Object.assign(class {}, { available: 'not a function' }) as never,
      })
    ).toBeNull();
  });

  it('takes the prefixed one when it can answer, and prefers the plain name', async () => {
    /* The two doubles answer differently on purpose: `not.toBeNull()` on each
       would pass just as happily if this function always read the same field. */
    const plain = Object.assign(class {}, { available: async () => 'available' });
    const prefixed = Object.assign(class {}, { available: async () => 'unavailable' });
    const query = { langs: ['en'], processLocally: true };

    const onlyPrefixed = platformRecognition({ webkitSpeechRecognition: prefixed as never });
    await expect(onlyPrefixed?.available(query)).resolves.toBe('unavailable');

    const both = platformRecognition({
      SpeechRecognition: plain as never,
      webkitSpeechRecognition: prefixed as never,
    });
    await expect(both?.available(query)).resolves.toBe('available');
  });

  it('builds its recognitions with the constructor the browser exposed', () => {
    const built: object[] = [];
    class Local {
      constructor() {
        built.push(this);
      }
      static available = async () => 'available';
    }

    const found = platformRecognition({ SpeechRecognition: Local as never });
    expect(found?.create()).toBeInstanceOf(Local);
    expect(built).toHaveLength(1);
  });

  it('has no port to offer when there is no recogniser', () => {
    expect(createPlatformCapture(null)).toBeNull();
  });
});

describe('asking what the device can do before opening anything', () => {
  it('asks about this page language and about the device specifically', async () => {
    const { recognition, available } = recogniser();

    await createPlatformCapture(recognition)?.available('es');

    expect(available).toHaveBeenCalledWith({ langs: ['es'], processLocally: true });
  });

  it('passes the browser answer through as the reader-facing one', async () => {
    const { recognition } = recogniser('downloadable');

    await expect(createPlatformCapture(recognition)?.available('en')).resolves.toEqual({
      status: 'unavailable',
      reason: 'not-installed',
    });
  });
});

describe('one question', () => {
  it('opens the microphone on the page language, locally, and for one question only', () => {
    const { recognition, built } = recogniser();

    createPlatformCapture(recognition)?.start(SESSION);

    expect(built).toHaveLength(1);
    expect(built[0]).toMatchObject({
      lang: 'en',
      processLocally: true,
      continuous: false,
      interimResults: true,
      started: 1,
    });
  });

  it('says it is listening when audio starts, not when it was asked for', () => {
    const { recognition, built } = recogniser();
    const port = createPlatformCapture(recognition);
    const seen = record(port);

    port?.start(SESSION);
    expect(seen).toEqual([]);

    built[0]?.onaudiostart?.();
    expect(seen).toEqual([{ type: 'listening', id: 'session-1' }]);
  });

  it('reports only the words this event brought, marked settled or not', () => {
    const { recognition, built } = recogniser();
    const port = createPlatformCapture(recognition);
    const seen = record(port);

    port?.start(SESSION);
    built[0]?.onresult?.(results(0, [['when is my', false]]));
    built[0]?.onresult?.(results(0, [['when is my appointment', true]]));
    /* The list is cumulative. A second question arrives at index 1, and reading
       from the top would deliver the first one into the box a second time. */
    built[0]?.onresult?.(
      results(1, [
        ['when is my appointment', true],
        ['and what do I owe', true],
      ])
    );

    expect(seen).toEqual([
      { type: 'heard', id: 'session-1', text: 'when is my', final: false },
      { type: 'heard', id: 'session-1', text: 'when is my appointment', final: true },
      { type: 'heard', id: 'session-1', text: 'and what do I owe', final: true },
    ]);
  });

  it('survives a result event that promises more than it delivers', () => {
    const { recognition, built } = recogniser();
    const port = createPlatformCapture(recognition);
    const seen = record(port);

    port?.start(SESSION);
    /* A length of three with one entry in it. Malformed, and the cost of
       believing the count is a crash on the surface a patient is looking at. */
    built[0]?.onresult?.({
      resultIndex: 0,
      results: { 0: { isFinal: true, length: 1, 0: { transcript: 'what do I owe' } }, length: 3 },
    } as never);

    expect(seen).toEqual([{ type: 'heard', id: 'session-1', text: 'what do I owe', final: true }]);
  });

  it('ends when the recogniser ends', () => {
    const { recognition, built } = recogniser();
    const port = createPlatformCapture(recognition);
    const seen = record(port);

    port?.start(SESSION);
    built[0]?.onend?.();

    expect(seen).toEqual([{ type: 'ended', id: 'session-1' }]);
  });
});

describe('what the reader is told when nothing was heard', () => {
  const cases = [
    ['not-allowed', 'denied'],
    ['service-not-allowed', 'denied'],
    ['no-speech', 'no-speech'],
    ['audio-capture', 'no-audio'],
    ['language-not-supported', 'off-device'],
    /* The pairing worth the row. This adapter asked for on-device recognition,
       so a network error means the browser went looking for a service - which to
       this product is the same fact as a language it cannot do locally. */
    ['network', 'off-device'],
    ['something-new', 'failed'],
  ] as const;

  it.each(cases)('reads %s as %s', (error, reason) => {
    const { recognition, built } = recogniser();
    const port = createPlatformCapture(recognition);
    const seen = record(port);

    port?.start(SESSION);
    built[0]?.onerror?.({ error });

    expect(seen).toEqual([{ type: 'failed', id: 'session-1', reason }]);
  });

  it('reads a cancel as an ending rather than as something going wrong', () => {
    const { recognition, built } = recogniser();
    const port = createPlatformCapture(recognition);
    const seen = record(port);

    /* Not this adapter's own abort - that one clears the session first, so it
       never reaches the error handler at all. This is the browser cancelling on
       its own, which several of them offer as a control of their own, and to the
       reader it is the question ending rather than a failure to explain. */
    port?.start(SESSION);
    built[0]?.onerror?.({ error: 'aborted' });
    built[0]?.onend?.();

    expect(seen).toEqual([{ type: 'ended', id: 'session-1' }]);
  });

  it('says nothing at all about an abort it performed itself', () => {
    const { recognition, built } = recogniser();
    const port = createPlatformCapture(recognition);
    const seen = record(port);

    port?.start(SESSION);
    port?.abort();
    built[0]?.onerror?.({ error: 'aborted' });

    expect(seen).toEqual([]);
    expect(built[0]?.aborted).toBe(1);
  });

  it('reports the failure once, and not an ending behind it', () => {
    const { recognition, built } = recogniser();
    const port = createPlatformCapture(recognition);
    const seen = record(port);

    port?.start(SESSION);
    built[0]?.onerror?.({ error: 'not-allowed' });
    /* A browser fires `end` after `error`, every time. */
    built[0]?.onend?.();

    expect(seen).toEqual([{ type: 'failed', id: 'session-1', reason: 'denied' }]);
  });
});

describe('a session that is over', () => {
  it('drops the ending for one it was told to abort', () => {
    const { recognition, built } = recogniser();
    const port = createPlatformCapture(recognition);
    const seen = record(port);

    port?.start(SESSION);
    port?.abort();
    built[0]?.onend?.();

    expect(seen).toEqual([]);
  });

  it('drops audio starting on a recognition it has already replaced', () => {
    const { recognition, built } = recogniser();
    const port = createPlatformCapture(recognition);
    const seen = record(port);

    port?.start(SESSION);
    port?.start({ id: 'session-2', language: 'en' });
    built[0]?.onaudiostart?.();

    expect(seen).toEqual([]);
  });

  it('drops a last result that arrives after the abort', () => {
    const { recognition, built } = recogniser();
    const port = createPlatformCapture(recognition);
    const seen = record(port);

    port?.start(SESSION);
    port?.abort();
    built[0]?.onresult?.(results(0, [['my address is', true]]));

    expect(seen).toEqual([]);
  });

  it('keeps the last words when the reader stopped rather than left', () => {
    const { recognition, built } = recogniser();
    const port = createPlatformCapture(recognition);
    const seen = record(port);

    port?.start(SESSION);
    port?.stop();
    /* Stopping is "I have finished the question", so the recogniser is still
       the one this surface is waiting on and its final result still counts. */
    built[0]?.onresult?.(results(0, [['what do I owe', true]]));
    built[0]?.onend?.();

    expect(built[0]?.stopped).toBe(1);
    expect(seen).toEqual([
      { type: 'heard', id: 'session-1', text: 'what do I owe', final: true },
      { type: 'ended', id: 'session-1' },
    ]);
  });

  it('closes the old microphone when a second one is opened', () => {
    const { recognition, built } = recogniser();
    const port = createPlatformCapture(recognition);
    const seen = record(port);

    port?.start(SESSION);
    port?.start({ id: 'session-2', language: 'en' });
    built[0]?.onresult?.(results(0, [['the first question', true]]));
    built[1]?.onaudiostart?.();

    expect(built[0]?.aborted).toBe(1);
    expect(seen).toEqual([{ type: 'listening', id: 'session-2' }]);
  });

  it('stops reporting to a listener that has unsubscribed', () => {
    const { recognition, built } = recogniser();
    const port = createPlatformCapture(recognition);
    const seen: CaptureEvent[] = [];
    const unsubscribe = port?.onEvent((event) => seen.push(event));

    port?.start(SESSION);
    built[0]?.onaudiostart?.();
    unsubscribe?.();
    built[0]?.onend?.();

    expect(seen).toEqual([{ type: 'listening', id: 'session-1' }]);
  });

  it('is safe to abort when nothing is open', () => {
    const { recognition } = recogniser();
    const port = createPlatformCapture(recognition);

    expect(() => {
      port?.abort();
      port?.stop();
    }).not.toThrow();
  });
});
