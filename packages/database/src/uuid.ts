import { randomFillSync } from 'node:crypto';

/**
 * UUIDv7 (RFC 9562 section 5.7) generated in application code.
 *
 * Every primary key in the schema is one of these, minted here rather than by
 * Postgres. That is deliberate: the application knows a row's id before the
 * insert, so it can build a whole aggregate - encounter, note, charges, claim
 * lines - in memory and write it in one transaction without round-tripping for
 * generated keys, and it can reference the id in an AuditEvent written in the
 * same transaction. One canonical scheme, no serial columns, no dual keying.
 *
 * Layout, most significant bit first:
 *
 *   | 48 bits unix_ts_ms | 4 bits version (7) | 12 bits counter |
 *   | 2 bits variant (0b10) | 62 bits random |
 *
 * The 12-bit field the RFC calls `rand_a` is used here as a dedicated
 * per-millisecond counter (the RFC's "monotonic random" method 1). Ids minted
 * by one generator are therefore strictly increasing even inside a single
 * millisecond, so `ORDER BY id` is insertion order and B-tree inserts stay at
 * the right edge of the index.
 */

const VERSION = 0x70;
const VARIANT = 0x80;
const MAX_COUNTER = 0xfff;
/** 48 bits of milliseconds, which runs out in the year 10889. */
const MAX_TIMESTAMP_MS = 0xffffffffffff;

const UUIDV7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface Uuidv7Options {
  /** Millisecond clock. Defaults to `Date.now`. */
  now?: () => number;
  /** Random source. Defaults to `node:crypto`. Must return `size` bytes. */
  randomBytes?: (size: number) => Uint8Array;
}

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, '0');
  }
  return `${out.slice(0, 8)}-${out.slice(8, 12)}-${out.slice(12, 16)}-${out.slice(16, 20)}-${out.slice(20)}`;
}

/**
 * Builds an independent UUIDv7 generator with injectable time and randomness.
 *
 * Injection exists so seeds and tests can be deterministic: pass a fixed clock
 * and a seeded byte source and the same run produces the same ids every time.
 * Application code should use the shared {@link uuidv7} instead.
 */
export function createUuidv7(options: Uuidv7Options = {}): () => string {
  const now = options.now ?? Date.now;
  const randomBytes =
    options.randomBytes ?? ((size: number) => randomFillSync(new Uint8Array(size)));

  let lastTimestamp = -1;
  let counter = 0;

  return function next(): string {
    const observed = now();
    if (!Number.isInteger(observed) || observed < 0 || observed > MAX_TIMESTAMP_MS) {
      throw new RangeError(`uuidv7: clock returned an unusable millisecond value: ${observed}`);
    }

    if (observed > lastTimestamp) {
      lastTimestamp = observed;
      counter = 0;
    } else {
      // Same millisecond, or a clock that jumped backwards. Either way we keep
      // the last timestamp and advance the counter, so ids never go backwards.
      counter += 1;
      if (counter > MAX_COUNTER) {
        lastTimestamp += 1;
        counter = 0;
      }
    }
    const timestamp = lastTimestamp;

    const random = randomBytes(8);
    if (random.length < 8) {
      throw new Error(`uuidv7: random source returned ${random.length} bytes, expected 8`);
    }

    const bytes = new Uint8Array(16);
    const high = Math.floor(timestamp / 0x100000000);
    const low = timestamp % 0x100000000;
    bytes[0] = (high >>> 8) & 0xff;
    bytes[1] = high & 0xff;
    bytes[2] = (low >>> 24) & 0xff;
    bytes[3] = (low >>> 16) & 0xff;
    bytes[4] = (low >>> 8) & 0xff;
    bytes[5] = low & 0xff;
    bytes[6] = VERSION | ((counter >>> 8) & 0x0f);
    bytes[7] = counter & 0xff;
    bytes.set(random.subarray(0, 8), 8);
    bytes[8] = VARIANT | ((bytes[8] ?? 0) & 0x3f);

    return toHex(bytes);
  };
}

/** The process-wide UUIDv7 generator. Use this for every new row id. */
export const uuidv7 = createUuidv7();

/** True when `value` is a canonical lowercase UUID with version 7 and the RFC variant. */
export function isUuidv7(value: string): boolean {
  return UUIDV7_PATTERN.test(value);
}

/**
 * Reads the embedded millisecond timestamp back out of a UUIDv7.
 *
 * Useful for coarse "when was this created" checks without loading the row,
 * and for the audit chain's ordering sanity checks. Throws on anything that is
 * not a UUIDv7, because a silent 0 would be worse than a failure.
 */
export function uuidv7Timestamp(value: string): number {
  if (!isUuidv7(value)) {
    throw new TypeError(`uuidv7Timestamp: not a UUIDv7: ${value}`);
  }
  return Number.parseInt(value.slice(0, 8) + value.slice(9, 13), 16);
}
