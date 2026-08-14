import { describe, expect, it } from 'vitest';

import { fromHl7, hl7Date, hl7Instant, readableDate } from './time.js';
import { CcdaError } from './xml/errors.js';

/**
 * HL7 timestamps carry their precision in their length, and losing that
 * precision is how a date of birth moves a day. These are the cases where the
 * two formats disagree about what a value means.
 */

describe('writing', () => {
  it('writes an instant in UTC with an explicit offset', () => {
    expect(hl7Instant('2026-08-14T09:30:00.000Z')).toBe('20260814093000+0000');
  });

  it('converts an offset instant to UTC rather than writing the local wall clock', () => {
    expect(hl7Instant('2026-08-14T09:30:00+05:30')).toBe('20260814040000+0000');
  });

  it('pads a year, month and day that need it', () => {
    expect(hl7Instant('0999-01-02T03:04:05Z')).toBe('09990102030405+0000');
  });

  it('writes a date as a date, with no time attached', () => {
    expect(hl7Date('1994-03-02')).toBe('19940302');
  });

  it('refuses what it cannot write rather than emitting NaN', () => {
    expect(() => hl7Instant('not a date')).toThrow(CcdaError);
    expect(() => hl7Date('March 2nd')).toThrow(CcdaError);
  });
});

describe('reading', () => {
  it('reads a full instant back', () => {
    expect(fromHl7('20260814093000+0000')).toBe('2026-08-14T09:30:00.000Z');
  });

  it('applies the offset the value carries', () => {
    expect(fromHl7('20260814093000+0530')).toBe('2026-08-14T04:00:00.000Z');
    expect(fromHl7('20260814093000-0500')).toBe('2026-08-14T14:30:00.000Z');
  });

  it('accepts Z as an offset, which generators do write', () => {
    expect(fromHl7('20260814093000Z')).toBe('2026-08-14T09:30:00.000Z');
  });

  it('ignores fractional seconds rather than failing on them', () => {
    expect(fromHl7('20260814093000.123+0000')).toBe('2026-08-14T09:30:00.000Z');
  });

  /**
   * The whole reason this file exists. A date-precision value read as an instant
   * moves the day for anybody not on UTC, and a date of birth that moves is one
   * that stops matching the patient on the other side.
   */
  it('keeps a date-precision value as a date', () => {
    expect(fromHl7('19940302')).toBe('1994-03-02');
    expect(fromHl7('202608')).toBe('2026-08-01');
    expect(fromHl7('2026')).toBe('2026-01-01');
  });

  it('treats an absent or blank value as absent', () => {
    expect(fromHl7(undefined)).toBeUndefined();
    expect(fromHl7('   ')).toBeUndefined();
  });

  it('refuses a value it cannot read', () => {
    expect(() => fromHl7('yesterday')).toThrow(CcdaError);
    expect(() => fromHl7('202608141')).toThrow(CcdaError);
  });

  it('refuses a value whose fields are out of range', () => {
    expect(() => fromHl7('20261345000000+0000')).toThrow(/out of range/);
  });
});

describe('what a person is shown', () => {
  it('shows a date as a date', () => {
    expect(readableDate('1994-03-02')).toBe('1994-03-02');
    expect(readableDate('2026-08-14T09:30:00.000Z')).toBe('2026-08-14');
  });

  it('shows nothing for nothing', () => {
    expect(readableDate(undefined)).toBe('');
    expect(readableDate('')).toBe('');
  });

  /**
   * A reader can make something of "sometime in 2019" and nothing of a blank,
   * so a value the codec cannot parse is shown as it arrived.
   */
  it('shows an unparseable value as it arrived, rather than inventing a date', () => {
    // `new Date` reads this as the last day of 2018. A narrative showing a
    // clinician a date nobody recorded is worse than one showing them the text
    // somebody did.
    expect(readableDate('sometime in 2019')).toBe('sometime in 2019');
    expect(readableDate('19940302')).toBe('19940302');
    expect(readableDate('2026-13-45')).toBe('2026-13-45');
  });
});
