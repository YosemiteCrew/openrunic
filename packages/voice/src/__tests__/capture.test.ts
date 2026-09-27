import { describe, expect, it } from 'vitest';
import { captureAvailability } from '../index.js';

/**
 * The browser's four answers, as the three things the reader is told.
 *
 * The case worth the file is the last one. Anything this function does not
 * recognise is unavailable, so a browser that grows a fifth answer, or answers
 * something this product has never seen, leaves the microphone shut rather than
 * open. The failure it prevents is specific: an unrecognised answer read as
 * permission is a microphone opened on a device that never said it could keep
 * the sound.
 */
describe('what the on-device check means', () => {
  it('is available only when the device says it can do this now', () => {
    expect(captureAvailability('available')).toEqual({ status: 'available' });
  });

  it('separates a language pack that is missing from one that does not exist', () => {
    expect(captureAvailability('downloadable')).toEqual({
      status: 'unavailable',
      reason: 'not-installed',
    });
    expect(captureAvailability('downloading')).toEqual({
      status: 'unavailable',
      reason: 'not-installed',
    });
    expect(captureAvailability('unavailable')).toEqual({
      status: 'unavailable',
      reason: 'language',
    });
  });

  it('refuses an answer it does not recognise rather than reading it as a yes', () => {
    for (const answer of ['', 'maybe', 'AVAILABLE', 'yes']) {
      expect(captureAvailability(answer)).toEqual({ status: 'unavailable', reason: 'language' });
    }
  });
});
