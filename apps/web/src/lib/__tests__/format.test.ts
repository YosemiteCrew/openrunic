import { appCatalogue, createTranslator, en } from '@openrunic/i18n';
import { describe, expect, it } from 'vitest';

import type { PatientName } from '@/lib/api/types';
import {
  calendarDay,
  clockTime,
  formatAge,
  formatDate,
  formatDateTime,
  formatElapsed,
  formatInitials,
  formatMoney,
  formatMrn,
  formatName,
  formatTime,
  formatVital,
  vitalState,
} from '@/lib/format';

/**
 * The three readers these formatters have to answer to.
 *
 * `spanish` is the one that matters: an assertion that passes in English and in
 * Spanish for the same reason proves nothing about either. Every conversion
 * below is checked against a Spanish string that differs from the English one,
 * or against a fallback that is asserted to *be* a fallback.
 *
 * `arabic` is not a locale this build offers a reader, and it is here for the
 * one thing only an unsupported locale can show: the count and the message are
 * two separate decisions. Every message falls back to English for it, so an
 * Arabic-Indic numeral inside an English sentence is proof the number went
 * through `formatCount` rather than through a template literal.
 */
const english = createTranslator(appCatalogue, 'en');
const spanish = createTranslator(appCatalogue, 'es');
const arabic = createTranslator(appCatalogue, 'ar-EG');

/**
 * The English words for an absent value, read out of the catalogue rather than
 * typed here. Assertions below still read as "not recorded", and changing the
 * source string changes them with it instead of leaving a file full of
 * expectations nobody notices are stale.
 */
const NOT_RECORDED = en['common.notRecorded'];

const testina: PatientName = {
  given: 'Testina',
  middle: null,
  family: 'Patientsson',
  prefix: null,
  suffix: null,
  preferred: 'Tess',
};

const exampla: PatientName = {
  given: 'Exampla',
  middle: null,
  family: 'Testperson',
  prefix: null,
  suffix: null,
  preferred: null,
};

describe('formatName', () => {
  it('prefers the preferred name over the given name', () => {
    expect(formatName(testina)).toBe('Tess Patientsson');
  });

  it('falls back to the given name when there is no preferred name', () => {
    expect(formatName(exampla)).toBe('Exampla Testperson');
  });

  it('renders family-first for sorted listings', () => {
    expect(formatName(exampla, 'listing')).toBe('Testperson, Exampla');
  });

  it('renders an initial for dense columns', () => {
    expect(formatName(exampla, 'short')).toBe('E. Testperson');
  });
});

describe('formatInitials', () => {
  it('uses the preferred name and the family name', () => {
    expect(formatInitials(testina)).toBe('TP');
  });
});

describe('formatMrn', () => {
  it('normalises to trimmed upper case', () => {
    expect(formatMrn('  or-100482 ')).toBe('OR-100482');
  });
});

describe('formatDate', () => {
  it('renders prose dates unambiguously', () => {
    expect(formatDate(english, '2026-08-12')).toBe('12 Aug 2026');
  });

  it('drops the year in dense mode', () => {
    expect(formatDate(english, '2026-08-12', 'dense')).toBe('12 Aug');
  });

  it('reads a bare date as the calendar date, never shifted by a timezone', () => {
    expect(formatDate(english, '2026-01-01')).toBe('1 Jan 2026');
  });

  it('says so rather than rendering an empty cell', () => {
    expect(formatDate(english, null)).toBe(NOT_RECORDED);
    expect(formatDate(english, 'not a date')).toBe(NOT_RECORDED);
  });

  it("names the month in the reader's language", () => {
    expect(formatDate(spanish, '2026-08-12')).toBe('12 ago 2026');
    expect(formatDate(spanish, '2026-08-12', 'dense')).toBe('12 ago');
    expect(formatDate(spanish, null)).toBe('No registrado');
  });

  it("writes the day and the year in the reader's numerals", () => {
    // Arabic has no catalogue here, so nothing about this comes from a
    // translation: the month name, the day and the year are all the runtime's,
    // and all three change. A date that named the month correctly and printed
    // Latin digits beside it would be half converted and look finished.
    expect(formatDate(arabic, '2026-08-12')).toBe('١٢ أغسطس ٢٠٢٦');
  });

  it('keeps day, month, year in that order whatever the language', () => {
    // The one language decision this file overrules. "08/12" cannot be read
    // without knowing whose convention wrote it, and on a chart that is
    // dangerous; day, named month, year cannot be misread in any of these.
    // There is no catalogue message for the frame, so this is a property of the
    // code rather than of a translation somebody could change.
    for (const reader of [english, spanish, arabic]) {
      const rendered = formatDate(reader, '2026-08-12');
      const month = new Intl.DateTimeFormat(reader.locale, {
        timeZone: 'UTC',
        month: 'short',
      }).format(new Date('2026-08-12T00:00:00.000Z'));
      const digits = new Intl.NumberFormat(reader.locale, { useGrouping: false });

      expect(rendered).toBe(`${digits.format(12)} ${month} ${digits.format(2026)}`);
    }
  });
});

describe('formatTime and formatDateTime', () => {
  it('renders 24-hour clinic time', () => {
    expect(formatTime(english, '2026-08-12T09:20:00.000Z')).toBe('09:20');
  });

  it('joins the date and the time', () => {
    expect(formatDateTime(english, '2026-08-12T09:20:00.000Z')).toBe('12 Aug 2026, 09:20');
    expect(formatDateTime(spanish, '2026-08-12T09:20:00.000Z')).toBe('12 ago 2026, 09:20');
  });

  it('honours an explicit clinic timezone', () => {
    expect(formatTime(english, '2026-08-12T09:20:00.000Z', 'America/New_York')).toBe('05:20');
  });
});

describe('calendarDay and clockTime', () => {
  /*
   * The two that are values rather than labels. They take no translator, and
   * they answer null rather than a sentence, because every caller compares them:
   * a day is matched against `visit.date`, and a clock is split back into
   * minutes to place a visit on the schedule grid.
   */
  it('reads the clinic day as a key, in the clinic timezone', () => {
    expect(calendarDay('2026-08-12T23:30:00.000Z')).toBe('2026-08-12');
    // 03:30 UTC on the 13th is still the 12th in New York, and the clinic's
    // calendar day is the clinic's: a visit does not move to tomorrow because
    // the server is in another zone.
    expect(calendarDay('2026-08-13T03:30:00.000Z', 'America/New_York')).toBe('2026-08-12');
    expect(calendarDay('2026-08-13T03:30:00.000Z', 'UTC')).toBe('2026-08-13');
  });

  it('reads the clock as a key, in the clinic timezone', () => {
    expect(clockTime('2026-08-12T09:20:00.000Z')).toBe('09:20');
    expect(clockTime('2026-08-13T03:30:00.000Z', 'America/New_York')).toBe('23:30');
  });

  it('answers null rather than words when there is nothing to read', () => {
    // This is the whole reason they are separate functions. As a date style
    // these returned the words "Not recorded", so two unreadable instants
    // compared equal to each other and an unreadable one compared equal to a
    // cell that genuinely said so. A key has to be a key.
    for (const nothing of [null, undefined, '', 'not a date'] as const) {
      expect(calendarDay(nothing)).toBeNull();
      expect(clockTime(nothing)).toBeNull();
    }
  });

  it('is what the display formatters are built on', () => {
    // Same instant, same timezone, two answers: the key and the label. They
    // cannot disagree, because one is computed from the other.
    const instant = '2026-08-12T09:20:00.000Z';
    expect(formatTime(english, instant)).toBe(clockTime(instant));
  });
});

describe('formatAge', () => {
  it('reads adults in years', () => {
    expect(formatAge(english, '1987-03-14', '2026-08-12')).toBe('39 y');
  });

  it('reads infants in months', () => {
    expect(formatAge(english, '2025-11-02', '2026-08-12')).toBe('9 mo');
  });

  it('reads newborns in days', () => {
    expect(formatAge(english, '2026-08-01', '2026-08-12')).toBe('11 d');
  });

  it('refuses a birth date in the future', () => {
    expect(formatAge(english, '2027-01-01', '2026-08-12')).toBe(NOT_RECORDED);
  });

  it('gives a Spanish reader the abbreviations Spanish uses', () => {
    // "39 a" and "9 m." rather than "39 y" and "9 mo". Both differ from the
    // English, which is what makes this an assertion rather than a coincidence:
    // "11 d" is the same in both languages and would have passed unconverted.
    expect(formatAge(spanish, '1987-03-14', '2026-08-12')).toBe('39 a');
    expect(formatAge(spanish, '2025-11-02', '2026-08-12')).toBe('9 m.');
    expect(formatAge(spanish, '2027-01-01', '2026-08-12')).toBe('No registrado');
  });
});

describe('formatElapsed', () => {
  it('counts minutes inside the first hour', () => {
    expect(formatElapsed(english, '2026-08-12T09:56:00.000Z', '2026-08-12T10:20:00.000Z')).toBe(
      '24 min'
    );
  });

  it('counts hours and minutes past the hour', () => {
    expect(formatElapsed(english, '2026-08-12T08:15:00.000Z', '2026-08-12T10:20:00.000Z')).toBe(
      '2 h 05 min'
    );
  });

  it('drops the minutes on a whole hour', () => {
    expect(formatElapsed(english, '2026-08-12T08:20:00.000Z', '2026-08-12T10:20:00.000Z')).toBe(
      '2 h'
    );
  });

  it('counts days past a day', () => {
    expect(formatElapsed(english, '2026-08-09T08:20:00.000Z', '2026-08-12T10:20:00.000Z')).toBe(
      '3 d'
    );
  });

  it('does not count seconds', () => {
    expect(formatElapsed(english, '2026-08-12T10:19:40.000Z', '2026-08-12T10:20:00.000Z')).toBe(
      'just now'
    );
  });

  it('says "just now" in the reader\'s language', () => {
    // The one elapsed string that is a phrase rather than an abbreviation, and
    // therefore the one where a Spanish reader could tell.
    expect(formatElapsed(spanish, '2026-08-12T10:19:40.000Z', '2026-08-12T10:20:00.000Z')).toBe(
      'ahora mismo'
    );
  });

  it("writes the number in the reader's numerals, not only the words", () => {
    // Arabic has no catalogue here, so "min" falls back to English. The digits
    // do not, because the count goes through `formatCount` rather than into a
    // template literal - which is the whole reason that call is there.
    expect(formatElapsed(arabic, '2026-08-12T09:56:00.000Z', '2026-08-12T10:20:00.000Z')).toBe(
      '٢٤ min'
    );
  });
});

describe('formatMoney', () => {
  it('renders an explicit currency', () => {
    expect(formatMoney(english, 38).text).toBe('$38.00');
  });

  it('labels a negative as a credit by default', () => {
    const money = formatMoney(english, -38);
    expect(money.text).toBe('($38.00)');
    expect(money.label).toBe('Credit');
    expect(money.negative).toBe(true);
  });

  it('lets the screen say what a negative means', () => {
    expect(formatMoney(english, -12.5, { negativeLabel: 'refund' }).label).toBe('Refund');
  });

  it('spells the amount out for assistive technology', () => {
    expect(formatMoney(english, -38).srText).toContain('credit');
  });

  it('writes the amount the way the reader writes amounts', () => {
    // Separators, decimal mark and symbol position are all the reader's, and all
    // three differ here. This is what a fixed `en-US` was costing every Spanish
    // reader on every billing screen.
    //
    // The gap before the symbol is a non-breaking space, written as an escape
    // rather than pasted in: a literal U+00A0 in a source file looks exactly
    // like a space, so the next person to touch this test would "fix" it into
    // one and spend an afternoon on why.
    expect(formatMoney(spanish, 1234.5).text).toBe('1234,50\u{a0}$');
    expect(formatMoney(english, 1234.5).text).toBe('$1,234.50');
  });

  it("says what a negative means in the reader's language", () => {
    const credit = formatMoney(spanish, -38);
    expect(credit.label).toBe('Saldo a favor');
    expect(formatMoney(spanish, -38, { negativeLabel: 'refund' }).label).toBe('Reembolso');
  });

  it('keeps the parentheses whatever the language', () => {
    // `Intl` would write a Spanish negative as "-38,00 $" if this used
    // `currencySign: 'accounting'`, and a leading minus at the end of a ledger
    // column is exactly the signal the parentheses exist to replace. The
    // brackets are this product's rule, not the reader's.
    expect(formatMoney(spanish, -38).text).toBe('(38,00\u{a0}$)');
    expect(formatMoney(english, -38).text).toBe('($38.00)');
  });

  it('speaks the whole amount as one sentence, not a lowercased label', () => {
    // `srText` used to be the spoken amount with `label.toLowerCase()` glued on.
    // The label and the spoken word are now separate messages, so a language
    // that capitalises the noun in both places can have it.
    const money = formatMoney(spanish, -38);
    expect(money.srText).toBe('38,00 dólares estadounidenses de saldo a favor');
    expect(money.srText).not.toContain(money.label ?? '');
  });

  it('does not hand one reader the formatter it built for another', () => {
    // The formatter cache used to be keyed on the options alone, so the first
    // reader to open a ledger decided how every later one saw it. Interleaved
    // deliberately: the same options, three times, in two languages.
    expect(formatMoney(english, 1234.5).text).toBe('$1,234.50');
    expect(formatMoney(spanish, 1234.5).text).toBe('1234,50\u{a0}$');
    expect(formatMoney(english, 1234.5).text).toBe('$1,234.50');
  });
});

describe('formatVital', () => {
  it('flags a value above the range, with a word not a colour', () => {
    const vital = formatVital(english, {
      label: 'Glucose',
      value: 7.4,
      unit: 'mmol/L',
      range: { low: 3.9, high: 5.8 },
    });
    expect(vital.state).toBe('danger');
    expect(vital.stateLabel).toBe('Above range');
    expect(vital.text).toBe('7.4 mmol/L, above range');
    expect(vital.rangeText).toBe('3.9 to 5.8 mmol/L');
  });

  it('flags a value below the range', () => {
    expect(
      formatVital(english, {
        label: 'Potassium',
        value: 2.9,
        unit: 'mmol/L',
        range: { low: 3.5 },
      }).stateLabel
    ).toBe('Below range');
  });

  it('reports an in-range value as success', () => {
    const vital = formatVital(english, {
      label: 'Heart rate',
      value: 68,
      unit: 'bpm',
      range: { low: 60, high: 100 },
    });
    expect(vital.state).toBe('success');
    expect(vital.stateLabel).toBe('In range');
  });

  it('never claims a range it does not have', () => {
    const vital = formatVital(english, { label: 'Weight', value: 71, unit: 'kg' });
    expect(vital.state).toBe('neutral');
    expect(vital.stateLabel).toBe('No range recorded');
    expect(vital.rangeText).toBeNull();
  });

  it('says not recorded rather than rendering a blank number', () => {
    const vital = formatVital(english, { label: 'BMI', value: null, unit: 'kg/m2' });
    expect(vital.value).toBe(NOT_RECORDED);
    expect(vital.stateLabel).toBe('Not recorded');
    expect(vital.text).toBe('BMI: Not recorded');
  });

  it('honours a requested precision', () => {
    expect(formatVital(english, { label: 'Temp', value: 37, unit: 'C', decimals: 1 }).value).toBe(
      '37.0'
    );
  });

  it('reads the reading as one sentence rather than a lowercased label', () => {
    // `text` used to be built as `${value} ${unit}, ${stateLabel.toLowerCase()}`.
    // The lowercasing is an English capitalisation rule applied to every
    // language, and the comma is English word order. Both are now inside one
    // message a translator can rewrite whole, so the sentence and the standalone
    // label are allowed to disagree about case.
    const vital = formatVital(english, {
      label: 'Glucose',
      value: 7.4,
      unit: 'mmol/L',
      range: { low: 3.9, high: 5.8 },
    });

    expect(vital.stateLabel).toBe('Above range');
    expect(vital.text).toBe('7.4 mmol/L, above range');
    expect(vital.text).not.toContain(vital.stateLabel);
  });

  it('leaves a Spanish reader in English, and says that it did', () => {
    // The `clinical.` area has no Spanish file, for the same reason `chart.` and
    // `results.` have none: a wrong range state is more dangerous than an
    // English one. What makes that a decision rather than an oversight is that
    // the translator records the fallback, so the coverage report can name it.
    const reader = createTranslator(appCatalogue, 'es');
    const vital = formatVital(reader, {
      label: 'Glucose',
      value: 7.4,
      unit: 'mmol/L',
      range: { low: 3.9, high: 5.8 },
    });

    expect(vital.stateLabel).toBe('Above range');
    expect(reader.fallbacks.map((fallback) => fallback.key)).toContain('clinical.range.above');
  });

  it('says a shared absence in Spanish, because that one is not clinical', () => {
    // The contrast with the test above. "Not recorded" lives in `common.`, is
    // translated, and reaches a Spanish reader as Spanish - so the untranslated
    // clinical words above are a deliberate gap rather than a broken lookup.
    const vital = formatVital(spanish, { label: 'BMI', value: null, unit: 'kg/m2' });
    expect(vital.value).toBe('No registrado');
    expect(vital.stateLabel).toBe('No registrado');
  });
});

describe('vitalState', () => {
  it('answers what is out of range without being told a language', () => {
    // The results list flags and sorts on this before it renders anything. It
    // used to build a whole formatted vital and read one field off it, which
    // meant deciding what was abnormal required first deciding what language to
    // say so in.
    expect(vitalState(7.4, { low: 3.9, high: 5.8 })).toBe('danger');
    expect(vitalState(2.9, { low: 3.5 })).toBe('danger');
    expect(vitalState(68, { low: 60, high: 100 })).toBe('success');
    expect(vitalState(71)).toBe('neutral');
  });

  it('calls nothing recorded neutral rather than abnormal', () => {
    expect(vitalState(null, { low: 3.9, high: 5.8 })).toBe('neutral');
    expect(vitalState(undefined)).toBe('neutral');
    expect(vitalState(Number.NaN, { low: 1 })).toBe('neutral');
  });

  it('agrees with the tone formatVital reports', () => {
    // Two entry points to one decision. They are the same code today; this
    // refuses a future where one of them grows a rule the other does not.
    const input = { label: 'Glucose', value: 7.4, unit: 'mmol/L', range: { low: 3.9, high: 5.8 } };
    expect(vitalState(input.value, input.range)).toBe(formatVital(english, input).state);
  });
});

/*
 * Absent, malformed and out-of-order inputs.
 *
 * These are the states a formatter meets in a real chart: a date of birth that
 * was never captured, a discharge time the interface sent as an empty string, a
 * wait timer whose start is later than "now" because two clocks disagree.
 * Every one of them has to read as "not recorded", because a formatter that
 * renders "NaN" or "Invalid Date" into a chart is worse than one that admits it
 * has nothing.
 */
describe('the shared absence', () => {
  /*
   * There is no `NOT_RECORDED` constant any more. Every formatter that has
   * nothing to render asks the catalogue, so the words are written once and a
   * Spanish reader gets Spanish ones. `NOT_RECORDED` below is a local constant
   * in this file, read out of the catalogue rather than typed again, so a test
   * cannot go on asserting English after somebody changes the source string.
   */
  it('reaches a Spanish reader in Spanish', () => {
    expect(spanish('common.notRecorded')).toBe('No registrado');
  });

  it('is the same words from every formatter that has nothing', () => {
    // One absence, said the same way in every column. A patient row used to be
    // able to show a formatter's own spelling beside the catalogue's.
    expect(formatDate(spanish, null)).toBe('No registrado');
    expect(formatTime(spanish, null)).toBe('No registrado');
    expect(formatDateTime(spanish, null)).toBe('No registrado');
    expect(formatAge(spanish, null)).toBe('No registrado');
    expect(formatElapsed(spanish, null)).toBe('No registrado');
    expect(formatVital(spanish, { label: 'BMI', value: null, unit: 'kg/m2' }).value).toBe(
      'No registrado'
    );
  });
});

describe('the date and time formatters, with nothing to format', () => {
  const nothing = [null, undefined, ''] as const;

  it.each(nothing)('formatTime says not recorded for %p', (value) => {
    expect(formatTime(english, value)).toBe(NOT_RECORDED);
  });

  it.each(nothing)('formatDateTime says not recorded for %p', (value) => {
    expect(formatDateTime(english, value)).toBe(NOT_RECORDED);
  });

  it.each(nothing)('formatAge says not recorded for %p', (value) => {
    expect(formatAge(english, value)).toBe(NOT_RECORDED);
  });

  it.each(nothing)('formatElapsed says not recorded for %p', (value) => {
    expect(formatElapsed(english, value)).toBe(NOT_RECORDED);
  });

  it('refuses an unparseable timestamp rather than rendering Invalid Date', () => {
    expect(formatDate(english, 'not a date')).toBe(NOT_RECORDED);
    expect(formatTime(english, 'not a date')).toBe(NOT_RECORDED);
    expect(formatDateTime(english, 'not a date')).toBe(NOT_RECORDED);
    expect(formatAge(english, '1990-13-45')).toBe(NOT_RECORDED);
    expect(formatElapsed(english, 'not a date', '2026-08-12T10:00:00.000Z')).toBe(NOT_RECORDED);
    expect(formatElapsed(english, '2026-08-12T10:00:00.000Z', new Date('not a date'))).toBe(
      NOT_RECORDED
    );
  });

  it('refuses a start in the future rather than counting backwards', () => {
    // Two clocks disagreeing is common; a wait timer reading "-3 min" is not
    // something a flow board should ever show.
    expect(
      formatElapsed(english, '2026-08-12T10:05:00.000Z', new Date('2026-08-12T10:00:00.000Z'))
    ).toBe(NOT_RECORDED);
  });

  it('measures against the wall clock when no as-of instant is given', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

    expect(formatElapsed(english, twoHoursAgo)).toBe('2 h');
    // Someone born today is zero days old, not "not recorded".
    expect(formatAge(english, new Date().toISOString())).toBe('0 d');
  });

  it('names every month rather than leaving a gap for December', () => {
    // This guarded a hand-written twelve-entry table with a one-based lookup,
    // where an off-by-one would silently blank December on every prose date in
    // the product. The table is gone and `Intl` owns the names now, so what is
    // left to guard is that every month still comes back with a word in it.
    const months = Array.from({ length: 12 }, (_, index) =>
      formatDate(english, `2026-${String(index + 1).padStart(2, '0')}-15`)
    );

    expect(months).toEqual([
      '15 Jan 2026',
      '15 Feb 2026',
      '15 Mar 2026',
      '15 Apr 2026',
      '15 May 2026',
      '15 Jun 2026',
      '15 Jul 2026',
      '15 Aug 2026',
      '15 Sep 2026',
      '15 Oct 2026',
      '15 Nov 2026',
      '15 Dec 2026',
    ]);
    expect(months.every((month) => !month.includes('  '))).toBe(true);
  });

  it('reads a date the same way either side of a timezone boundary', () => {
    // 23:30 in New York on the 12th is 03:30 UTC on the 13th. The clinic's
    // calendar day is the clinic's, so a visit does not move to tomorrow when
    // the server happens to be in another zone.
    const lateEvening = '2026-08-13T03:30:00.000Z';

    expect(formatDate(english, lateEvening, 'prose', 'America/New_York')).toBe('12 Aug 2026');
    expect(formatTime(english, lateEvening, 'America/New_York')).toBe('23:30');
    expect(formatDate(english, lateEvening, 'prose', 'UTC')).toBe('13 Aug 2026');
  });
});
