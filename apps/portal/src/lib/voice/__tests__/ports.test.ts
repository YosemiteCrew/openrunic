import { describe, expect, it, vi } from 'vitest';
import { readbackAvailability } from '@/lib/voice';
import type { ReadbackCapabilities, ReadbackPort } from '@/lib/voice';

/**
 * The question asked before anything is spoken.
 *
 * "Can this device speak the language this page is in" has three wrong answers
 * and they read differently to the person holding the phone, so they are three
 * values rather than one boolean.
 */

function portWith(languages: readonly string[]): ReadbackPort {
  const capabilities: ReadbackCapabilities = { languages, interruption: true };
  return {
    capabilities: () => capabilities,
    subscribe: () => () => undefined,
    speak: vi.fn(),
    cancel: vi.fn(),
  };
}

describe('whether this page can be read aloud', () => {
  it('has no adapter at all on the server and in a browser without speech', () => {
    expect(readbackAvailability(null, 'en')).toEqual({
      status: 'unavailable',
      reason: 'no-adapter',
    });
  });

  it('separates speech with no voices from no speech', () => {
    /* A device that has a synthesiser and no voices installed is a state the
       reader can do something about, so it is not folded into "absent". */
    expect(readbackAvailability(portWith([]), 'en')).toEqual({
      status: 'unavailable',
      reason: 'no-voice',
    });
  });

  it('refuses to read a page in a language it has no voice for', () => {
    expect(readbackAvailability(portWith(['en-GB', 'en-US']), 'es')).toEqual({
      status: 'unavailable',
      reason: 'language',
    });
  });

  it('accepts a voice from another region of the same language', () => {
    /* Refusing `es-MX` for a page in `es` would leave most of the world silent
       over a region code, and the words are the record's either way. */
    expect(readbackAvailability(portWith(['es-MX']), 'es')).toEqual({ status: 'available' });
  });

  it('matches whatever case the device writes its tags in', () => {
    expect(readbackAvailability(portWith(['EN-gb']), 'en')).toEqual({ status: 'available' });
  });
});
