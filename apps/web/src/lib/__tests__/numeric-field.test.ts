import { describe, expect, it } from 'vitest';

import { numericFieldValue } from '@/lib/numeric-field';

describe('numericFieldValue', () => {
  it('reads a figure the user typed', () => {
    expect(numericFieldValue('38.5')).toBe(38.5);
    expect(numericFieldValue('  12 ')).toBe(12);
    expect(numericFieldValue('-4')).toBe(-4);
  });

  it('treats an emptied field as nothing entered, which is zero', () => {
    expect(numericFieldValue('')).toBe(0);
    expect(numericFieldValue('   ')).toBe(0);
  });

  it('refuses a half-typed value rather than reporting NaN as an amount', () => {
    expect(numericFieldValue('1e')).toBeNull();
    expect(numericFieldValue('abc')).toBeNull();
    expect(numericFieldValue('12.3.4')).toBeNull();
  });

  it('refuses an infinity, which no charge line or allocation can hold', () => {
    expect(numericFieldValue('Infinity')).toBeNull();
    expect(numericFieldValue('-Infinity')).toBeNull();
  });
});
