/**
 * A seeded pseudo-random generator, written out rather than depended on.
 *
 * Every mock in this package must produce byte-identical output for the same
 * seed and the same call sequence, because that is what lets a demo script, a
 * CI seam loop and a developer's laptop all assert on the same fixtures.
 * `Math.random` cannot promise that, a dependency could change its algorithm in
 * a patch release, and forty lines of arithmetic can promise it forever.
 */

/**
 * Mulberry32: a 32-bit generator with a period of 2^32, chosen because it is
 * short enough to audit at a glance and good enough for fixtures. It is not a
 * cryptographic generator and nothing in this package may treat it as one.
 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/**
 * A lowercase hex string of exactly `length` characters. Used to mint the
 * opaque references a partner would return, so fixtures look like production
 * data without ever being derived from it.
 */
export function randomHex(next: () => number, length: number): string {
  let out = '';
  while (out.length < length) {
    out += Math.floor(next() * 0x1_0000)
      .toString(16)
      .padStart(4, '0');
  }
  return out.slice(0, length);
}

/**
 * Picks one item from a non-empty list. The tuple type is what makes the return
 * non-optional: a caller cannot hand this an empty catalogue and then wonder
 * why a fixture came back undefined.
 */
export function randomPick<T>(next: () => number, items: readonly [T, ...T[]]): T {
  return items[Math.floor(next() * items.length)] ?? items[0];
}

/** An integer in `[0, maxExclusive)`. Deterministic for a given generator state. */
export function randomInt(next: () => number, maxExclusive: number): number {
  return Math.floor(next() * maxExclusive);
}
