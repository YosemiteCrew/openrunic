import { describe, expect, it } from 'vitest';

import { createUuidv7, isUuidv7, uuidv7, uuidv7Timestamp } from './uuid.js';

/** A fixed byte source so generated ids are reproducible in assertions. */
function fixedBytes(fill: number): (size: number) => Uint8Array {
  return (size: number) => new Uint8Array(size).fill(fill);
}

/** A deterministic PRNG byte source (mulberry32), for ordering tests. */
function seededBytes(seed: number): (size: number) => Uint8Array {
  let state = seed >>> 0;
  return (size: number) => {
    const out = new Uint8Array(size);
    for (let index = 0; index < size; index += 1) {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      out[index] = ((t ^ (t >>> 14)) >>> 0) & 0xff;
    }
    return out;
  };
}

describe('uuidv7', () => {
  it('produces a canonical version 7, RFC variant UUID', () => {
    const id = uuidv7();
    expect(id).toHaveLength(36);
    expect(isUuidv7(id)).toBe(true);
    expect(id[14]).toBe('7');
    expect('89ab').toContain(id[19]);
  });

  it('encodes the supplied millisecond timestamp in the first 48 bits', () => {
    const timestamp = 1_776_000_000_000;
    const next = createUuidv7({ now: () => timestamp, randomBytes: fixedBytes(0) });
    expect(uuidv7Timestamp(next())).toBe(timestamp);
  });

  it('is deterministic given a fixed clock and a fixed random source', () => {
    const options = { now: () => 1_776_000_000_000, randomBytes: fixedBytes(0xab) };
    const a = createUuidv7(options);
    const b = createUuidv7(options);
    expect([a(), a(), a()]).toStrictEqual([b(), b(), b()]);
  });

  it('increments the counter, not the timestamp, inside one millisecond', () => {
    const next = createUuidv7({ now: () => 1_776_000_000_000, randomBytes: fixedBytes(0) });
    const first = next();
    const second = next();
    expect(uuidv7Timestamp(second)).toBe(uuidv7Timestamp(first));
    expect(second > first).toBe(true);
  });

  it('sorts lexicographically in generation order across milliseconds', () => {
    let clock = 1_776_000_000_000;
    const next = createUuidv7({ now: () => clock, randomBytes: seededBytes(7) });
    const ids: string[] = [];
    for (let index = 0; index < 200; index += 1) {
      if (index % 3 === 0) clock += 1;
      ids.push(next());
    }
    expect([...ids].sort()).toStrictEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('borrows a millisecond when the counter overflows', () => {
    const timestamp = 1_776_000_000_000;
    const next = createUuidv7({ now: () => timestamp, randomBytes: fixedBytes(0) });
    let last = next();
    // 4096 counter values, so the 4098th id must have rolled into the next ms.
    for (let index = 0; index < 4096; index += 1) {
      const id = next();
      expect(id > last).toBe(true);
      last = id;
    }
    expect(uuidv7Timestamp(last)).toBe(timestamp + 1);
  });

  it('never goes backwards when the clock does', () => {
    const clocks = [1_776_000_000_500, 1_776_000_000_100, 1_776_000_000_100];
    let index = 0;
    const next = createUuidv7({
      now: () => clocks[index++] ?? 0,
      randomBytes: fixedBytes(0),
    });
    const ids = [next(), next(), next()];
    expect([...ids].sort()).toStrictEqual(ids);
    expect(ids.every((id) => uuidv7Timestamp(id) === 1_776_000_000_500)).toBe(true);
  });

  it('rejects a clock outside the encodable range', () => {
    expect(() => createUuidv7({ now: () => -1 })()).toThrow(RangeError);
    expect(() => createUuidv7({ now: () => 1.5 })()).toThrow(RangeError);
    expect(() => createUuidv7({ now: () => 2 ** 49 })()).toThrow(RangeError);
  });

  it('rejects a random source that returns too few bytes', () => {
    const next = createUuidv7({ now: () => 1, randomBytes: () => new Uint8Array(4) });
    expect(() => next()).toThrow(/expected 8/);
  });
});

describe('isUuidv7', () => {
  it('accepts a generated id', () => {
    expect(isUuidv7(uuidv7())).toBe(true);
  });

  it.each([
    ['a version 4 uuid', 'f47ac10b-58cc-4372-a567-0e02b2c3d479'],
    ['a bad variant nibble', '018f0000-0000-7000-0000-000000000000'],
    ['uppercase hex', '018F0000-0000-7000-8000-000000000000'],
    ['no dashes', '018f000000007000800000000000 0000'.replace(' ', '')],
    ['empty', ''],
    ['not hex', '018f0000-0000-7000-8000-00000000000g'],
  ])('rejects %s', (_label, value) => {
    expect(isUuidv7(value)).toBe(false);
  });
});

describe('uuidv7Timestamp', () => {
  it('round-trips several timestamps', () => {
    for (const timestamp of [0, 1, 1_000, 1_776_000_000_000, 0xffffffffffff]) {
      const next = createUuidv7({ now: () => timestamp, randomBytes: fixedBytes(0) });
      expect(uuidv7Timestamp(next())).toBe(timestamp);
    }
  });

  it('throws rather than returning zero for a non-v7 uuid', () => {
    expect(() => uuidv7Timestamp('f47ac10b-58cc-4372-a567-0e02b2c3d479')).toThrow(TypeError);
  });
});
