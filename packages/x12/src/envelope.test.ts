import { describe, expect, it } from 'vitest';

import {
  createControlNumberSource,
  formatInterchangeControlNumber,
  formatTransactionControlNumber,
  validateControlNumbers,
} from './control.js';
import { DEFAULT_DELIMITERS, detectDelimiters, validateDelimiters } from './delimiters.js';
import { formatX12Error } from './errors.js';
import {
  formatAmount,
  formatDate6,
  formatDate8,
  formatTime4,
  padRight,
  parseAmount,
  parseDate8,
  parseNumber,
} from './format.js';
import {
  componentAt,
  isEmptyAt,
  locate,
  readSegments,
  segment,
  simpleAt,
  writeSegment,
} from './segments.js';
import { readFixture } from './__fixtures__/index.js';
import { expectErr, expectOk } from './test-support/result.js';

const AT = { segmentIndex: 4, segmentTag: 'CLP', elementPosition: 3 } as const;

describe('delimiters', () => {
  it('reads all four separators out of a real ISA header', () => {
    const delimiters = expectOk(detectDelimiters(readFixture('837p-single-line.edi')));
    expect(delimiters).toEqual(DEFAULT_DELIMITERS);
  });

  it('rejects an empty document', () => {
    expect(expectErr(detectDelimiters('')).kind).toBe('empty_input');
  });

  it('rejects a document that does not start with ISA', () => {
    expect(expectErr(detectDelimiters('GS*HC*A*B~')).kind).toBe('malformed_envelope');
  });

  it('rejects a truncated ISA rather than guessing separators', () => {
    const error = expectErr(detectDelimiters(readFixture('malformed-truncated-isa.edi')));
    expect(error.kind).toBe('malformed_envelope');
    expect(formatX12Error(error)).toContain('60 characters');
  });

  it('honours a partner that uses non-default separators', () => {
    const exotic = readFixture('837p-single-line.edi')
      .replaceAll('*', '|')
      .replaceAll('~', "'")
      .replace('|:', '|+');
    const delimiters = expectOk(detectDelimiters(exotic));
    expect(delimiters).toEqual({
      element: '|',
      repetition: '^',
      component: '+',
      segment: "'",
    });
  });

  it.each(['element', 'component', 'repetition', 'segment'] as const)(
    'rejects a %s delimiter that is not exactly one character',
    (name) => {
      const error = expectErr(validateDelimiters({ ...DEFAULT_DELIMITERS, [name]: '' }));
      expect(error.kind).toBe('malformed_envelope');
      expect(error.message).toContain(name);
    }
  );

  it('rejects colliding delimiters, which cannot be tokenized unambiguously', () => {
    const error = expectErr(validateDelimiters({ ...DEFAULT_DELIMITERS, segment: '*' }));
    expect(error.message).toContain('four distinct characters');
  });
});

describe('segments', () => {
  const claim = segment('CLM', 'CLM1', '148', '', '', ['11', 'B', '1'], 'Y');

  it('reads simple elements by their one-based position', () => {
    expect(simpleAt(claim, 1)).toBe('CLM1');
    expect(simpleAt(claim, 2)).toBe('148');
  });

  it('reads an absent element as empty rather than undefined', () => {
    expect(simpleAt(claim, 99)).toBe('');
    expect(isEmptyAt(claim, 3)).toBe(true);
    expect(isEmptyAt(claim, 1)).toBe(false);
  });

  it('reads a composite position simply by taking its first component', () => {
    expect(simpleAt(claim, 5)).toBe('11');
  });

  it('reads components of a composite element', () => {
    expect(componentAt(claim, 5, 3)).toBe('1');
    expect(componentAt(claim, 5, 9)).toBe('');
    expect(componentAt(claim, 1, 1)).toBe('CLM1');
    expect(componentAt(claim, 1, 2)).toBe('');
    expect(componentAt(claim, 99, 1)).toBe('');
  });

  it('drops trailing empty elements when serializing, which several payers require', () => {
    expect(writeSegment(segment('REF', 'F8', 'ABC', '', ''), DEFAULT_DELIMITERS)).toBe(
      'REF*F8*ABC~'
    );
  });

  it('keeps interior empty elements, because positions carry meaning', () => {
    expect(writeSegment(claim, DEFAULT_DELIMITERS)).toBe('CLM*CLM1*148***11:B:1*Y~');
  });

  it('tokenizes a pretty-printed document as if it were one line', () => {
    const raw = readFixture('999-accepted.edi');
    expect(readSegments(raw.replaceAll('~', '~\n'), DEFAULT_DELIMITERS)).toEqual(
      readSegments(raw, DEFAULT_DELIMITERS)
    );
  });

  it('preserves the space padding inside a fixed-width ISA', () => {
    const [isa] = readSegments(readFixture('837p-single-line.edi'), DEFAULT_DELIMITERS);
    expect(simpleAt(isa ?? segment('X'), 6)).toBe('CEDARHOLLOW    ');
  });

  it('reads a composite that carries no components as empty', () => {
    expect(simpleAt(segment('SVC', []), 1)).toBe('');
  });

  it('builds error locations with and without an element position', () => {
    expect(locate(claim, 7)).toEqual({ segmentIndex: 7, segmentTag: 'CLM' });
    expect(locate(claim, 7, 2)).toEqual({
      segmentIndex: 7,
      segmentTag: 'CLM',
      elementPosition: 2,
    });
  });
});

describe('money and dates', () => {
  it('renders whole dollars without a decimal point', () => {
    expect(formatAmount(14_800)).toBe('148');
    expect(formatAmount(0)).toBe('0');
  });

  it('renders partial dollars without insignificant trailing zeros', () => {
    expect(formatAmount(33_150)).toBe('331.5');
    expect(formatAmount(12_345)).toBe('123.45');
    expect(formatAmount(5)).toBe('0.05');
  });

  it('keeps the sign, because reversals and recoupments are genuinely negative', () => {
    expect(formatAmount(-7_400)).toBe('-74');
    expect(formatAmount(-1_205)).toBe('-12.05');
  });

  it('round-trips every amount it writes', () => {
    for (const cents of [0, 5, 50, 148, 14_800, 33_150, -7_400, -1_205, 999_999_99]) {
      expect(expectOk(parseAmount(formatAmount(cents), AT))).toBe(cents);
    }
  });

  it('rounds half away from zero rather than truncating a half cent', () => {
    expect(expectOk(parseAmount('12.005', AT))).toBe(1_201);
    expect(expectOk(parseAmount('-12.005', AT))).toBe(-1_201);
  });

  it('fails rather than reading a non-amount as zero', () => {
    for (const value of ['', 'abc', '12.3.4', '1,200']) {
      expect(expectErr(parseAmount(value, AT)).kind).toBe('invalid_element');
    }
  });

  it('reads plain numeric elements', () => {
    expect(expectOk(parseNumber('3', AT))).toBe(3);
    expect(expectOk(parseNumber('-1.5', AT))).toBe(-1.5);
    expect(expectErr(parseNumber('n/a', AT)).kind).toBe('invalid_element');
  });

  it('formats dates and times in UTC, so a clinic timezone cannot shift a service date', () => {
    const instant = new Date('2026-03-16T23:45:00.000Z');
    expect(formatDate8(instant)).toBe('20260316');
    expect(formatDate6(instant)).toBe('260316');
    expect(formatTime4(instant)).toBe('2345');
  });

  it('reads a D8 date as a calendar string, never a Date', () => {
    expect(expectOk(parseDate8('20260312', AT))).toBe('2026-03-12');
  });

  it('rejects a malformed or impossible date', () => {
    for (const value of ['2026031', '', 'CCYYMMDD', '20261301', '20260300']) {
      expect(expectErr(parseDate8(value, AT)).kind).toBe('invalid_element');
    }
  });

  it('pads and truncates fixed-width fields', () => {
    expect(padRight('AB', 5)).toBe('AB   ');
    expect(padRight('ABCDEF', 3)).toBe('ABC');
  });
});

describe('control numbers', () => {
  it('accepts numbers inside the wire ranges', () => {
    expect(
      expectOk(validateControlNumbers({ interchange: 1, group: 1, transactionStart: 1 })).group
    ).toBe(1);
  });

  it('rejects zero, which is almost always an uninitialized counter', () => {
    const error = expectErr(
      validateControlNumbers({ interchange: 0, group: 1, transactionStart: 1 })
    );
    expect(error.kind).toBe('encode_precondition');
  });

  it('rejects values that will not fit the wire field', () => {
    expect(
      expectErr(
        validateControlNumbers({ interchange: 1_000_000_000, group: 1, transactionStart: 1 })
      ).kind
    ).toBe('encode_precondition');
    expect(
      expectErr(validateControlNumbers({ interchange: 1, group: 1.5, transactionStart: 1 })).kind
    ).toBe('encode_precondition');
    expect(
      expectErr(validateControlNumbers({ interchange: 1, group: 1, transactionStart: -3 })).kind
    ).toBe('encode_precondition');
  });

  it('pads ISA13 to nine digits and ST02 to four', () => {
    expect(formatInterchangeControlNumber(42)).toBe('000000042');
    expect(formatTransactionControlNumber(42)).toBe('0042');
    expect(formatTransactionControlNumber(123_456)).toBe('123456');
  });

  it('allocates ascending control numbers from a starting point', () => {
    const source = createControlNumberSource(7);
    expect(source.next()).toBe(7);
    expect(source.next()).toBe(8);
    expect(source.current).toBe(8);
    expect(createControlNumberSource().next()).toBe(1);
  });
});

describe('error rendering', () => {
  it('names the kind, the location and the message', () => {
    expect(
      formatX12Error({
        kind: 'invalid_element',
        message: 'expected a monetary amount',
        at: AT,
        value: 'x',
        expected: 'a monetary amount',
      })
    ).toBe('[invalid_element] (03 of segment CLP #4) expected a monetary amount');
  });

  it('renders an error that carries no location', () => {
    expect(formatX12Error({ kind: 'empty_input', message: 'the interchange is empty' })).toBe(
      '[empty_input] the interchange is empty'
    );
  });

  it('renders a location whose segment could not be identified', () => {
    expect(
      formatX12Error({
        kind: 'malformed_envelope',
        message: 'broken',
        at: { segmentIndex: 0, segmentTag: '' },
      })
    ).toBe('[malformed_envelope] (segment ? #0) broken');
  });
});
