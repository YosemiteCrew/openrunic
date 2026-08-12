import { describe, expect, it } from 'vitest';

import { isIsoDateTime, isUuid } from './index.js';
import type { ISODateTime, UUID } from './index.js';

describe('isUuid', () => {
  it.each([
    '123e4567-e89b-12d3-a456-426614174000', // v1
    '9b2f6a2e-2f9d-4c1a-9f7a-1d2e3f4a5b6c', // v4
    '017f22e2-79b0-7cc3-98c4-dc0c0c07398f', // v7
    '9B2F6A2E-2F9D-4C1A-9F7A-1D2E3F4A5B6C', // uppercase
  ])('accepts %s', (value) => {
    expect(isUuid(value)).toBe(true);
  });

  it.each([
    '',
    'not-a-uuid',
    '00000000-0000-0000-0000-000000000000', // nil UUID — never a real record id
    '9b2f6a2e-2f9d-9c1a-9f7a-1d2e3f4a5b6c', // version nibble 9 does not exist
    '9b2f6a2e-2f9d-4c1a-0f7a-1d2e3f4a5b6c', // invalid variant nibble
    '9b2f6a2e2f9d4c1a9f7a1d2e3f4a5b6c', // missing dashes
    '9b2f6a2e-2f9d-4c1a-9f7a-1d2e3f4a5b6cd', // too long
    ' 9b2f6a2e-2f9d-4c1a-9f7a-1d2e3f4a5b6c', // leading whitespace
  ])('rejects %j', (value) => {
    expect(isUuid(value)).toBe(false);
  });

  it('narrows string to UUID', () => {
    const raw = '9b2f6a2e-2f9d-4c1a-9f7a-1d2e3f4a5b6c';
    if (isUuid(raw)) {
      // Type-level assertion: inside the guard, raw is a UUID.
      const id: UUID = raw;
      expect(id).toBe(raw);
    } else {
      expect.unreachable('expected a valid UUID');
    }
  });
});

describe('isIsoDateTime', () => {
  it.each([
    '2026-01-01T12:00:00Z',
    '2026-01-01T12:00:00.123Z',
    '2026-01-01T12:00:00.123456789Z',
    '2026-01-01T12:00:00+05:30',
    '2026-12-31T23:59:59-08:00',
    '2024-02-29T00:00:00Z', // leap day in a leap year
  ])('accepts %s', (value) => {
    expect(isIsoDateTime(value)).toBe(true);
  });

  it.each([
    '',
    '2026-01-01', // date only
    '12:00:00Z', // time only
    '2026-01-01 12:00:00Z', // space separator
    '2026-01-01T12:00:00', // no offset
    '2026-01-01T12:00Z', // missing seconds
    '2026-13-01T12:00:00Z', // month 13
    '2026-00-15T12:00:00Z', // month 0
    '2026-02-30T12:00:00Z', // February 30th
    '2023-02-29T12:00:00Z', // leap day outside a leap year
    '2026-01-00T12:00:00Z', // day 0
    '2026-01-01T25:00:00Z', // hour 25
    '2026-01-01T12:60:00Z', // minute 60
    '2026-01-01T12:00:00+25:00', // offset hour 25
    'not-a-date',
  ])('rejects %j', (value) => {
    expect(isIsoDateTime(value)).toBe(false);
  });

  it('narrows string to ISODateTime', () => {
    const raw = '2026-01-01T12:00:00Z';
    if (isIsoDateTime(raw)) {
      const at: ISODateTime = raw;
      expect(at).toBe(raw);
    } else {
      expect.unreachable('expected a valid ISO date-time');
    }
  });
});
