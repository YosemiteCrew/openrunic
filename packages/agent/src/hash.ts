import { createHash } from 'node:crypto';

/**
 * Canonical JSON and one hash function, so that two things that are equal hash
 * equally.
 *
 * The audit chain in `packages/database` already canonicalises before hashing,
 * and everything here has to agree with that discipline: key order must not
 * change a hash, or an approval token would stop matching its own proposal the
 * first time a field was reordered.
 */

/** Deterministic JSON: object keys sorted, no whitespace, `undefined` dropped. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalise(value));
}

function canonicalise(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalise);
  if (typeof value !== 'object' || value === null) return value;

  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) {
    if (source[key] === undefined) continue;
    result[key] = canonicalise(source[key]);
  }
  return result;
}

/** SHA-256 of the canonical form, hex. */
export function hashOf(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}
