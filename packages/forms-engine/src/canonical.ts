import { createHash } from 'node:crypto';

import type { FormDefinition } from './definition.js';

/**
 * Canonicalization, freezing and content hashing: the three mechanics that make
 * "immutable once published" a property of the data rather than a promise in a
 * code review.
 */

/**
 * Returns a copy of `input` without keys whose value is `undefined`.
 *
 * Every artifact this package emits is persisted as JSON in
 * `FormDefinition.compiled` and read back by a renderer that never sees the
 * source objects. `JSON.stringify` silently drops undefined-valued keys, so an
 * object that carries them is not equal to its own round trip, and a snapshot
 * test comparing the two would pass or fail depending on which side of the
 * serializer it ran. Dropping them at build time makes the artifacts equal to
 * their round trip by construction, which is what the serializability test
 * asserts.
 */
export function dropUndefined<T extends object>(input: T): T {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) {
      output[key] = value;
    }
  }
  return output as T;
}

/**
 * Freezes a value and everything reachable from it.
 *
 * Applied to a published definition and to the serializable artifacts, so that
 * a caller who holds a published form cannot edit it in place and hand the
 * mutated object to a submission that will then be validated against something
 * nobody published. In strict mode, which every module in this package is, the
 * write throws rather than failing silently.
 *
 * Deliberately not applied to the compiled zod schema: zod builds parts of its
 * internals lazily on first parse, and freezing them would turn a validated
 * form into a runtime error on the first patient who filled one in.
 */
export function freezeDeep(value: unknown): void {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return;
  }
  Object.freeze(value);
  const record = value as Record<string, unknown>;
  for (const key of Object.getOwnPropertyNames(record)) {
    freezeDeep(record[key]);
  }
}

/**
 * Serializes a value with object keys in sorted order, so that two definitions
 * that differ only in the order an editor happened to write their JSON keys
 * hash the same. Without this, re-saving an unchanged form in a different
 * builder version would look like a content change and block republishing.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of Object.keys(record).sort()) {
    const entry = record[key];
    if (entry === undefined) {
      continue;
    }
    parts.push(`${JSON.stringify(key)}:${canonicalJson(entry)}`);
  }
  return `{${parts.join(',')}}`;
}

/**
 * The identity of a definition's content, as `sha256:<hex>`.
 *
 * This is what makes republishing a `(key, version)` pair checkable. The
 * database's unique constraint stops a second row existing; the hash is what
 * distinguishes an idempotent retry of the same publish, which must succeed,
 * from a quiet edit to a version that submissions already reference, which must
 * not. It covers the authored document only, never the compiled artifacts, so a
 * compiler improvement that emits a better render tree does not invalidate
 * every form in the estate.
 */
export function definitionContentHash(definition: FormDefinition): string {
  const payload = canonicalJson({
    key: definition.key,
    version: definition.version,
    title: definition.title,
    description: definition.description,
    bindTo: definition.bindTo,
    fields: definition.fields,
  });
  return `sha256:${createHash('sha256').update(payload).digest('hex')}`;
}
