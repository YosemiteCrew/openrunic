import { describe, expect, it } from 'vitest';
import {
  formatDate,
  formatDateTime,
  formatDateWithWeekday,
  formatDuration,
  formatMeasurement,
  formatMoney,
  formatMoneyWithCode,
  formatProgress,
  formatTime,
  pluralise,
} from '@/lib/format';

describe('date and time formatters', () => {
  it('formats a date, a weekday date, a time and the two together', () => {
    const iso = '2026-09-03T09:30:00.000Z';

    expect(formatDate(iso)).toBe('3 September 2026');
    expect(formatDateWithWeekday(iso)).toBe('Thursday, 3 September 2026');
    expect(formatTime(iso)).toBe('09:30');
    expect(formatDateTime(iso)).toBe('Thursday, 3 September 2026 at 09:30');
  });

  it('pins the time zone so the same instant reads the same anywhere', () => {
    // 23:30 UTC would be the next day in any eastern zone, and the previous day in some
    // western ones. Pinning to UTC is what keeps a record from disagreeing with itself.
    expect(formatDate('2026-09-03T23:30:00.000Z')).toBe('3 September 2026');
    expect(formatTime('2026-09-03T23:30:00.000Z')).toBe('23:30');
  });

  it('hands back anything that is not a date rather than printing Invalid Date', () => {
    expect(formatDate('not a date')).toBe('not a date');
    expect(formatDateWithWeekday('not a date')).toBe('not a date');
    expect(formatTime('not a date')).toBe('not a date');
    expect(formatDateTime('not a date')).toBe('not a date');
  });
});

describe('formatDuration', () => {
  it('reads minutes below the hour', () => {
    expect(formatDuration(20)).toBe('20 minutes');
  });

  it('reads whole hours without a trailing zero', () => {
    expect(formatDuration(60)).toBe('1 hour');
    expect(formatDuration(120)).toBe('2 hours');
  });

  it('reads hours and minutes together', () => {
    expect(formatDuration(90)).toBe('1 hour 30 minutes');
    expect(formatDuration(150)).toBe('2 hours 30 minutes');
  });
});

describe('money formatters', () => {
  it('renders minor units as a currency figure', () => {
    expect(formatMoney({ amountMinor: 8450, currency: 'GBP' })).toBe('£84.50');
    expect(formatMoney({ amountMinor: 0, currency: 'GBP' })).toBe('£0.00');
  });

  it('renders a credit as a positive figure, leaving the label to the caller', () => {
    // The minus sign is deliberately dropped here: a sign is easy to miss and impossible
    // to hear, so the Money component pairs the figure with the word "credit" instead.
    expect(formatMoney({ amountMinor: -1200, currency: 'GBP' })).toBe('£12.00');
  });

  it('knows the symbols it issues statements in, and degrades without one', () => {
    expect(formatMoney({ amountMinor: 100, currency: 'EUR' })).toBe('€1.00');
    expect(formatMoney({ amountMinor: 100, currency: 'USD' })).toBe('$1.00');
    expect(formatMoney({ amountMinor: 100, currency: 'ZZZ' })).toBe('1.00');
  });

  it('names the currency outright when asked', () => {
    expect(formatMoneyWithCode({ amountMinor: 8450, currency: 'GBP' })).toBe('£84.50 GBP');
  });
});

describe('wording helpers', () => {
  it('pluralises on the count', () => {
    expect(pluralise(0, 'message', 'messages')).toBe('0 messages');
    expect(pluralise(1, 'message', 'messages')).toBe('1 message');
    expect(pluralise(2, 'message', 'messages')).toBe('2 messages');
  });

  it('never renders a measurement without its unit', () => {
    expect(formatMeasurement(75, 'micrograms')).toBe('75 micrograms');
    expect(formatMeasurement(6.8, 'mIU/L')).toBe('6.8 mIU/L');
  });

  it('states progress in words', () => {
    expect(formatProgress(2, 3)).toBe('2 of 3 answered');
  });
});
