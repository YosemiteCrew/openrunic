import { describe, expect, it } from 'vitest';

import { formatType, isWidening, parseType } from './types.js';

const widening = (from: string, to: string): boolean => isWidening(parseType(from), parseType(to));

describe('parseType', () => {
  it('normalises aliases to their canonical Postgres name', () => {
    expect(parseType('integer').base).toBe('INT4');
    expect(parseType('BIGINT').base).toBe('INT8');
    expect(parseType('character varying(20)').base).toBe('VARCHAR');
    expect(parseType('decimal(10,2)').base).toBe('NUMERIC');
    expect(parseType('timestamp with time zone').base).toBe('TIMESTAMPTZ');
    expect(parseType('double precision').base).toBe('FLOAT8');
  });

  it('splits out precision arguments', () => {
    expect(parseType('NUMERIC(10,2)').params).toEqual([10, 2]);
    expect(parseType('VARCHAR(255)').params).toEqual([255]);
    expect(parseType('TEXT').params).toEqual([]);
  });

  it('keeps array types distinct from their element type', () => {
    expect(parseType('TEXT[]').base).toBe('TEXT[]');
    expect(parseType('integer[]').base).toBe('INT4[]');
  });
});

describe('isWidening', () => {
  it('treats an unchanged type as safe', () => {
    expect(widening('TEXT', 'TEXT')).toBe(true);
    expect(widening('NUMERIC(10,2)', 'NUMERIC(10,2)')).toBe(true);
  });

  it('accepts growing string lengths and rejects shrinking ones', () => {
    expect(widening('VARCHAR(50)', 'VARCHAR(100)')).toBe(true);
    expect(widening('VARCHAR(100)', 'VARCHAR(50)')).toBe(false);
  });

  it('accepts dropping a length limit but not adding one', () => {
    expect(widening('VARCHAR(50)', 'VARCHAR')).toBe(true);
    expect(widening('VARCHAR(50)', 'TEXT')).toBe(true);
    expect(widening('TEXT', 'VARCHAR(50)')).toBe(false);
  });

  it('walks the integer ladder upwards only', () => {
    expect(widening('SMALLINT', 'INTEGER')).toBe(true);
    expect(widening('INTEGER', 'BIGINT')).toBe(true);
    expect(widening('BIGINT', 'INTEGER')).toBe(false);
    expect(widening('SMALLINT', 'BIGINT')).toBe(true);
  });

  it('walks the float ladder upwards only', () => {
    expect(widening('REAL', 'DOUBLE PRECISION')).toBe(true);
    expect(widening('DOUBLE PRECISION', 'REAL')).toBe(false);
  });

  it('requires the integral part of a numeric to survive, not just the precision', () => {
    // 10,2 holds eight integral digits; 11,4 holds only seven. Precision grew,
    // so a naive comparison calls this safe. It is not.
    expect(widening('NUMERIC(10,2)', 'NUMERIC(11,4)')).toBe(false);
    expect(widening('NUMERIC(10,2)', 'NUMERIC(12,4)')).toBe(true);
    expect(widening('NUMERIC(10,2)', 'NUMERIC(10,1)')).toBe(false);
  });

  it('rejects changes between unrelated families', () => {
    expect(widening('TEXT', 'INTEGER')).toBe(false);
    expect(widening('INTEGER', 'TEXT')).toBe(false);
    expect(widening('TIMESTAMP', 'TIMESTAMPTZ')).toBe(false);
    expect(widening('BIGINT', 'NUMERIC(20,0)')).toBe(false);
  });
});

describe('formatType', () => {
  it('renders the precision back, because it is usually the whole story', () => {
    expect(formatType(parseType('varchar(64)'))).toBe('VARCHAR(64)');
    expect(formatType(parseType('decimal(10,2)'))).toBe('NUMERIC(10,2)');
  });

  it('omits empty parentheses for an unparameterised type', () => {
    expect(formatType(parseType('text'))).toBe('TEXT');
  });
});
