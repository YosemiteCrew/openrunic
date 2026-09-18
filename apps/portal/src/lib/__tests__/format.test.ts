import { appCatalogue, createTranslator } from '@openrunic/i18n';
import { describe, expect, it } from 'vitest';

import {
  documentKind,
  formatDate,
  formatDateTime,
  formatDateWithWeekday,
  formatDuration,
  formatFileSize,
  formatMeasurement,
  formatMoney,
  formatMoneyWithCode,
  formatProgress,
  formatTime,
} from '@/lib/format';

/**
 * The two readers these formatters have to answer to.
 *
 * Spanish is the one that matters. Every assertion below that only holds in
 * English proves nothing about a formatter that used to pin `en-GB`: it would
 * have passed before this change too. What the Spanish half asserts is that the
 * reader's language reaches the numbers, which is the whole subject.
 */
const english = createTranslator(appCatalogue, 'en');
const spanish = createTranslator(appCatalogue, 'es');

describe('date and time formatters', () => {
  const iso = '2026-09-03T09:30:00.000Z';

  it('formats a date, a weekday date, a time and the two together', () => {
    expect(formatDate(english, iso)).toBe('September 3, 2026');
    expect(formatDateWithWeekday(english, iso)).toBe('Thursday, September 3, 2026');
    expect(formatTime(english, iso)).toBe('09:30');
    expect(formatDateTime(english, iso)).toBe('Thursday, September 3, 2026 at 09:30');
  });

  it('writes the date the way the reader writes dates, particles and all', () => {
    /*
     * The reason `Intl` owns the order here rather than a `{day} {month} {year}`
     * frame: Spanish wants the two `de`s, and a frame cannot put them there.
     * `apps/web` composes instead, and says why - a dense date on a chart has a
     * safety constraint this page does not.
     */
    expect(formatDate(spanish, iso)).toBe('3 de septiembre de 2026');
    expect(formatDateWithWeekday(spanish, iso)).toBe('jueves, 3 de septiembre de 2026');
  });

  it('joins the date and the time with a word the reader would use', () => {
    // "at" is not the same word in every language, and does not sit in the same
    // place, so the join is a message rather than a template literal.
    expect(formatDateTime(spanish, iso)).toBe('jueves, 3 de septiembre de 2026 a las 09:30');
  });

  it('keeps the clock 24-hour whatever the locale would choose', () => {
    // A clinic day crosses noon and am/pm doubles the reading. The digits are
    // still the reader's; the cycle is not.
    expect(formatTime(english, '2026-09-03T14:05:00.000Z')).toBe('14:05');
    expect(formatTime(spanish, '2026-09-03T14:05:00.000Z')).toBe('14:05');
  });

  it('pins the time zone so the same instant reads the same anywhere', () => {
    // 23:30 UTC would be the next day in any eastern zone, and the previous day
    // in some western ones. Pinning to UTC is what keeps a record from
    // disagreeing with itself. It is the one thing here that is not the
    // reader's.
    expect(formatDate(english, '2026-09-03T23:30:00.000Z')).toBe('September 3, 2026');
    expect(formatTime(english, '2026-09-03T23:30:00.000Z')).toBe('23:30');
  });

  it('hands back anything that is not a date rather than printing Invalid Date', () => {
    expect(formatDate(english, 'not a date')).toBe('not a date');
    expect(formatDateWithWeekday(english, 'not a date')).toBe('not a date');
    expect(formatTime(english, 'not a date')).toBe('not a date');
    expect(formatDateTime(english, 'not a date')).toBe('not a date');
  });
});

describe('formatDuration', () => {
  it('reads minutes below the hour', () => {
    expect(formatDuration(english, 20)).toBe('20 minutes');
  });

  it('reads whole hours without a trailing zero', () => {
    expect(formatDuration(english, 60)).toBe('1 hour');
    expect(formatDuration(english, 120)).toBe('2 hours');
  });

  it('reads hours and minutes together', () => {
    expect(formatDuration(english, 90)).toBe('1 hour 30 minutes');
    expect(formatDuration(english, 150)).toBe('2 hours 30 minutes');
  });

  it('picks the singular with the reader’s rules rather than with n === 1', () => {
    // This was `hours === 1 ? '1 hour' : ...`, which is English's rule. Spanish
    // agrees with it, which is why the assertion below is the Spanish words
    // rather than the Spanish plural: what changed is where the rule comes from.
    expect(formatDuration(spanish, 20)).toBe('20 minutos');
    expect(formatDuration(spanish, 60)).toBe('1 hora');
    expect(formatDuration(spanish, 120)).toBe('2 horas');
    // The joiner is the translator's too: Spanish wants a conjunction where
    // English wants a space.
    expect(formatDuration(spanish, 90)).toBe('1 hora y 30 minutos');
  });
});

describe('money formatters', () => {
  it('renders minor units as a currency figure', () => {
    expect(formatMoney(english, { amountMinor: 8450, currency: 'GBP' })).toBe('£84.50');
    expect(formatMoney(english, { amountMinor: 0, currency: 'GBP' })).toBe('£0.00');
  });

  it('renders a credit as a positive figure, leaving the label to the caller', () => {
    // The minus sign is deliberately dropped here: a sign is easy to miss and
    // impossible to hear, so the Money component pairs the figure with the word
    // "credit" instead.
    expect(formatMoney(english, { amountMinor: -1200, currency: 'GBP' })).toBe('£12.00');
  });

  it('never renders an amount without saying what currency it is', () => {
    /*
     * This is the assertion that replaced a test of the bug. `formatMoney` held
     * a three-entry table of symbols and fell back to an empty string, and the
     * old test pinned that as correct: `currency: 'ZZZ'` was expected to render
     * `1.00`, described as degrading. A bare number on a page asking somebody to
     * pay is not a degradation, it is the defect `apps/web` names outright - *a
     * bare number on a billing screen is a defect*.
     *
     * `Intl` has every currency and falls back to the code rather than to
     * nothing.
     */
    expect(formatMoney(english, { amountMinor: 100, currency: 'EUR' })).toBe('€1.00');
    expect(formatMoney(english, { amountMinor: 100, currency: 'USD' })).toBe('$1.00');
    // Non-breaking space, as an escape: a literal U+00A0 looks exactly like one.
    expect(formatMoney(english, { amountMinor: 100, currency: 'ZZZ' })).toBe('ZZZ\u{a0}1.00');
    expect(formatMoney(english, { amountMinor: 100, currency: 'ZZZ' })).toContain('ZZZ');
  });

  it('puts the symbol where the reader expects it', () => {
    // The old implementation always wrote the symbol first, which is wrong in
    // most of the languages this is now translated into. The gap before it is a
    // non-breaking space, written as an escape because a literal U+00A0 in a
    // source file looks exactly like a space.
    expect(formatMoney(spanish, { amountMinor: 8450, currency: 'GBP' })).toBe('84,50\u{a0}£');
  });

  it('names the currency outright when asked', () => {
    expect(formatMoneyWithCode(english, { amountMinor: 8450, currency: 'GBP' })).toBe('£84.50 GBP');
  });
});

describe('wording helpers', () => {
  it('never renders a measurement without its unit', () => {
    // The unit arrives from the record already named, so only the number is the
    // reader's.
    expect(formatMeasurement(english, 75, 'micrograms')).toBe('75 micrograms');
    expect(formatMeasurement(english, 6.8, 'mIU/L')).toBe('6.8 mIU/L');
  });

  it('states progress in the reader’s words', () => {
    expect(formatProgress(english, 2, 3)).toBe('2 of 3 answered');
    expect(formatProgress(spanish, 2, 3)).toBe('2 de 3 respondidas');
  });
});

/**
 * A document's badge used to carry what the API composed - the stored media type and the
 * stored byte count - into an `.or-badge`, which is `white-space: nowrap` because a status
 * pill is the size of its text. The Word document type alone is 71 characters with nothing a
 * browser may break after, so one ordinary file widened the page (#507).
 *
 * These are the two halves of the replacement: a label from a closed set, and a size written
 * for a reader rather than in bytes.
 */
describe('documentKind', () => {
  it('names the types worth naming', () => {
    expect(documentKind('application/pdf')).toBe('pdf');
    expect(
      documentKind('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    ).toBe('document');
    expect(documentKind('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe(
      'spreadsheet'
    );
  });

  it('falls to a family for anything the table does not hold', () => {
    expect(documentKind('image/heic')).toBe('image');
    expect(documentKind('text/csv')).toBe('text');
  });

  it('answers with a kind and never with its input', () => {
    // The whole point of the mapping: a media type the practice starts storing tomorrow
    // reaches the badge as a short word, so the label is bounded by construction rather
    // than because the fixture that was measured happened to be short.
    const unknown = 'application/vnd.ms-outlook';
    expect(documentKind(unknown)).toBe('other');
    expect(documentKind('M'.repeat(256))).toBe('other');
  });

  it('reads a media type by its essence, not by its bytes', () => {
    // Parameters and case are not part of the identity. A stored
    // `TEXT/PLAIN; charset=utf-8` is the same type as `text/plain`, and answering `other`
    // for it would be the mapping quietly not working on real stored values.
    expect(documentKind('TEXT/PLAIN; charset=utf-8')).toBe('text');
    expect(documentKind('Application/PDF')).toBe('pdf');
  });
});

describe('formatFileSize', () => {
  it('climbs a tier at a thousand and writes at most one decimal', () => {
    expect(formatFileSize(english, 512)).toBe('512 bytes');
    expect(formatFileSize(english, 20_480)).toBe('20.5 kB');
    expect(formatFileSize(english, 2_400_000)).toBe('2.4 MB');
    expect(formatFileSize(english, 1_200_000_000)).toBe('1.2 GB');
  });

  it('stops climbing rather than reaching for a unit it does not have', () => {
    // The tiers end at gigabytes, so a larger file has to stay in gigabytes. Walking off
    // the end of the array would format against `undefined` and throw on a page that is
    // only trying to say how big a letter is.
    expect(formatFileSize(english, 4_000_000_000_000)).toBe('4,000 GB');
  });

  it('is the reader’s number, not en-GB’s', () => {
    expect(formatFileSize(spanish, 20_480)).toBe('20,5 kB');
    expect(formatFileSize(spanish, 2_400_000)).toBe('2,4 MB');
  });

  it('writes bytes long and everything above them short, for a reason Intl decides', () => {
    // This is the exemption in `sizeFormatter`, asserted rather than argued. CLDR's short
    // form for `byte` in English is the singular noun, so a `short` byte tier would render
    // `512 byte` on a patient's page; `kB` and `MB` are symbols and are right at any count.
    // If CLDR ever changes that, this fails here rather than in front of a reader.
    const shortByte = new Intl.NumberFormat('en', {
      style: 'unit',
      unit: 'byte',
      unitDisplay: 'short',
    });
    expect(shortByte.format(512)).toBe('512 byte');
    expect(formatFileSize(english, 512)).toBe('512 bytes');
  });

  it('never writes a negative size', () => {
    expect(formatFileSize(english, -1)).toBe('0 bytes');
  });
});
