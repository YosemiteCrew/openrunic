import { describe, expect, it } from 'vitest';

import type { PatientName } from '@/lib/api/types';
import {
  NOT_RECORDED,
  formatAge,
  formatCount,
  formatDate,
  formatDateTime,
  formatElapsed,
  formatEnumLabel,
  formatInitials,
  formatMoney,
  formatMrn,
  formatName,
  formatTime,
  formatVital,
  pluralise,
} from '@/lib/format';

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
    expect(formatDate('2026-08-12')).toBe('12 Aug 2026');
  });

  it('drops the year in dense mode', () => {
    expect(formatDate('2026-08-12', 'dense')).toBe('12 Aug');
  });

  it('renders iso for machine-facing surfaces', () => {
    expect(formatDate('2026-08-12T23:30:00.000Z', 'iso')).toBe('2026-08-12');
  });

  it('reads a bare date as the calendar date, never shifted by a timezone', () => {
    expect(formatDate('2026-01-01')).toBe('1 Jan 2026');
  });

  it('says so rather than rendering an empty cell', () => {
    expect(formatDate(null)).toBe(NOT_RECORDED);
    expect(formatDate('not a date')).toBe(NOT_RECORDED);
  });
});

describe('formatTime and formatDateTime', () => {
  it('renders 24-hour clinic time', () => {
    expect(formatTime('2026-08-12T09:20:00.000Z')).toBe('09:20');
  });

  it('joins the date and the time', () => {
    expect(formatDateTime('2026-08-12T09:20:00.000Z')).toBe('12 Aug 2026, 09:20');
  });

  it('honours an explicit clinic timezone', () => {
    expect(formatTime('2026-08-12T09:20:00.000Z', 'America/New_York')).toBe('05:20');
  });
});

describe('formatAge', () => {
  it('reads adults in years', () => {
    expect(formatAge('1987-03-14', '2026-08-12')).toBe('39 y');
  });

  it('reads infants in months', () => {
    expect(formatAge('2025-11-02', '2026-08-12')).toBe('9 mo');
  });

  it('reads newborns in days', () => {
    expect(formatAge('2026-08-01', '2026-08-12')).toBe('11 d');
  });

  it('refuses a birth date in the future', () => {
    expect(formatAge('2027-01-01', '2026-08-12')).toBe(NOT_RECORDED);
  });
});

describe('formatElapsed', () => {
  it('counts minutes inside the first hour', () => {
    expect(formatElapsed('2026-08-12T09:56:00.000Z', '2026-08-12T10:20:00.000Z')).toBe('24 min');
  });

  it('counts hours and minutes past the hour', () => {
    expect(formatElapsed('2026-08-12T08:15:00.000Z', '2026-08-12T10:20:00.000Z')).toBe(
      '2 h 05 min'
    );
  });

  it('drops the minutes on a whole hour', () => {
    expect(formatElapsed('2026-08-12T08:20:00.000Z', '2026-08-12T10:20:00.000Z')).toBe('2 h');
  });

  it('counts days past a day', () => {
    expect(formatElapsed('2026-08-09T08:20:00.000Z', '2026-08-12T10:20:00.000Z')).toBe('3 d');
  });

  it('does not count seconds', () => {
    expect(formatElapsed('2026-08-12T10:19:40.000Z', '2026-08-12T10:20:00.000Z')).toBe('just now');
  });
});

describe('formatMoney', () => {
  it('renders an explicit currency', () => {
    expect(formatMoney(38).text).toBe('$38.00');
  });

  it('labels a negative as a credit by default', () => {
    const money = formatMoney(-38);
    expect(money.text).toBe('($38.00)');
    expect(money.label).toBe('Credit');
    expect(money.negative).toBe(true);
  });

  it('lets the screen say what a negative means', () => {
    expect(formatMoney(-12.5, { negativeLabel: 'Refund' }).label).toBe('Refund');
  });

  it('spells the amount out for assistive technology', () => {
    expect(formatMoney(-38).srText).toContain('credit');
  });
});

describe('formatVital', () => {
  it('flags a value above the range, with a word not a colour', () => {
    const vital = formatVital({
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
      formatVital({ label: 'Potassium', value: 2.9, unit: 'mmol/L', range: { low: 3.5 } })
        .stateLabel
    ).toBe('Below range');
  });

  it('reports an in-range value as success', () => {
    const vital = formatVital({
      label: 'Heart rate',
      value: 68,
      unit: 'bpm',
      range: { low: 60, high: 100 },
    });
    expect(vital.state).toBe('success');
    expect(vital.stateLabel).toBe('In range');
  });

  it('never claims a range it does not have', () => {
    const vital = formatVital({ label: 'Weight', value: 71, unit: 'kg' });
    expect(vital.state).toBe('neutral');
    expect(vital.stateLabel).toBe('No range recorded');
    expect(vital.rangeText).toBeNull();
  });

  it('says not recorded rather than rendering a blank number', () => {
    const vital = formatVital({ label: 'BMI', value: null, unit: 'kg/m2' });
    expect(vital.value).toBe(NOT_RECORDED);
    expect(vital.stateLabel).toBe('Not recorded');
  });

  it('honours a requested precision', () => {
    expect(formatVital({ label: 'Temp', value: 37, unit: 'C', decimals: 1 }).value).toBe('37.0');
  });
});

describe('formatEnumLabel', () => {
  it('turns a schema enum into sentence case', () => {
    expect(formatEnumLabel('CHECKED_IN')).toBe('Checked in');
    expect(formatEnumLabel('NOSHOW')).toBe('Noshow');
    expect(formatEnumLabel('')).toBe('');
  });
});

describe('pluralise', () => {
  it('uses the singular for exactly one and the plural for anything else', () => {
    expect(pluralise(1, 'note')).toBe('note');
    expect(pluralise(0, 'note')).toBe('notes');
    expect(pluralise(4, 'note')).toBe('notes');
  });

  it('takes an explicit plural when the sentence changes shape around it', () => {
    expect(pluralise(1, 'error blocks', 'errors block')).toBe('error blocks');
    expect(pluralise(3, 'error blocks', 'errors block')).toBe('errors block');
  });
});

describe('formatCount', () => {
  it('renders the number with the noun that agrees with it', () => {
    expect(formatCount(1, 'claim')).toBe('1 claim');
    expect(formatCount(0, 'claim')).toBe('0 claims');
    expect(formatCount(12, 'claim')).toBe('12 claims');
  });

  it('carries an explicit plural through', () => {
    expect(formatCount(2, 'coverage')).toBe('2 coverages');
    expect(formatCount(2, 'error blocks', 'errors block')).toBe('2 errors block');
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
describe('the date and time formatters, with nothing to format', () => {
  const nothing = [null, undefined, ''] as const;

  it.each(nothing)('formatTime says not recorded for %p', (value) => {
    expect(formatTime(value)).toBe(NOT_RECORDED);
  });

  it.each(nothing)('formatDateTime says not recorded for %p', (value) => {
    expect(formatDateTime(value)).toBe(NOT_RECORDED);
  });

  it.each(nothing)('formatAge says not recorded for %p', (value) => {
    expect(formatAge(value)).toBe(NOT_RECORDED);
  });

  it.each(nothing)('formatElapsed says not recorded for %p', (value) => {
    expect(formatElapsed(value)).toBe(NOT_RECORDED);
  });

  it('refuses an unparseable timestamp rather than rendering Invalid Date', () => {
    expect(formatDate('not a date')).toBe(NOT_RECORDED);
    expect(formatTime('not a date')).toBe(NOT_RECORDED);
    expect(formatDateTime('not a date')).toBe(NOT_RECORDED);
    expect(formatAge('1990-13-45')).toBe(NOT_RECORDED);
    expect(formatElapsed('not a date', '2026-08-12T10:00:00.000Z')).toBe(NOT_RECORDED);
    expect(formatElapsed('2026-08-12T10:00:00.000Z', new Date('not a date'))).toBe(NOT_RECORDED);
  });

  it('refuses a start in the future rather than counting backwards', () => {
    // Two clocks disagreeing is common; a wait timer reading "-3 min" is not
    // something a flow board should ever show.
    expect(formatElapsed('2026-08-12T10:05:00.000Z', new Date('2026-08-12T10:00:00.000Z'))).toBe(
      NOT_RECORDED
    );
  });

  it('measures against the wall clock when no as-of instant is given', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

    expect(formatElapsed(twoHoursAgo)).toBe('2 h');
    // Someone born today is zero days old, not "not recorded".
    expect(formatAge(new Date().toISOString())).toBe('0 d');
  });

  it('names every month rather than leaving a gap for December', () => {
    // The month lookup is one-based; an off-by-one would silently blank the
    // last month of the year on every prose date in the product.
    const months = Array.from({ length: 12 }, (_, index) =>
      formatDate(`2026-${String(index + 1).padStart(2, '0')}-15`)
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

    expect(formatDate(lateEvening, 'iso', 'America/New_York')).toBe('2026-08-12');
    expect(formatTime(lateEvening, 'America/New_York')).toBe('23:30');
    expect(formatDate(lateEvening, 'iso', 'UTC')).toBe('2026-08-13');
  });
});
