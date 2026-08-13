import { describe, expect, it } from 'vitest';

import type { PatientName } from '@/lib/api/types';
import {
  NOT_RECORDED,
  formatAge,
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
} from '@/lib/format';

const testina: PatientName = {
  given: 'Testina',
  middle: null,
  family: 'Patientsson',
  prefix: null,
  suffix: null,
  preferred: 'Tess',
};

const marek: PatientName = {
  given: 'Marek',
  middle: null,
  family: 'Oyelaran',
  prefix: null,
  suffix: null,
  preferred: null,
};

describe('formatName', () => {
  it('prefers the preferred name over the given name', () => {
    expect(formatName(testina)).toBe('Tess Patientsson');
  });

  it('falls back to the given name when there is no preferred name', () => {
    expect(formatName(marek)).toBe('Marek Oyelaran');
  });

  it('renders family-first for sorted listings', () => {
    expect(formatName(marek, 'listing')).toBe('Oyelaran, Marek');
  });

  it('renders an initial for dense columns', () => {
    expect(formatName(marek, 'short')).toBe('M. Oyelaran');
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
