import type { JsonValue } from '@openrunic/agent-tools';

/**
 * The typed channel between the reader and the writer.
 *
 * The reader may ingest untrusted content: note text, patient message bodies,
 * document text, observation comments. The evidence on prompt injection in
 * clinical settings is bad enough that detection cannot be the control - a
 * published benchmark measured a leading guard model at 0.40 recall, falling
 * further under adaptive attack, because most clinical threats are fluent,
 * legitimate-looking requests that carry no attack signal.
 *
 * So the defence is structural. The reader holds no state-changing tool, and
 * only **ids, codes, enums, numbers and dates** cross into the writer. This
 * filter is that boundary, in code. Prose does not cross. Nothing here inspects
 * content for malice, because inspecting content for malice does not work.
 *
 * The existing data model helps: coded values are already stored as `code` plus
 * `codeSystem` strings, so most of what the writer legitimately needs already
 * survives the filter unchanged.
 */

/** Ids, codes and enums: no whitespace, bounded, from a conservative alphabet. */
const TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,127}$/;

/** `YYYY-MM-DD` and ISO instants, which contain characters the token pattern allows anyway. */
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}(?:T[\d:.]+(?:Z|[+-]\d{2}:\d{2}))?$/;

const MAX_DEPTH = 8;
const MAX_ARRAY = 100;

/**
 * True when a string is a value rather than a sentence.
 *
 * Whitespace is the discriminator, and that is deliberate: a payload
 * sophisticated enough to carry an instruction inside a single unbroken token
 * has a very small budget to work with, and it still cannot reach a tool it was
 * never granted.
 */
export function isTypedToken(value: string): boolean {
  return DATE_PATTERN.test(value) || TOKEN_PATTERN.test(value);
}

/**
 * Projects a reader result down to what may reach the writer.
 *
 * Returns `undefined` for a value that carries nothing typed, so a caller can
 * tell "filtered to nothing" from "an empty object was there all along".
 */
export function toTypedChannel(value: unknown, depth = 0): JsonValue | undefined {
  if (depth > MAX_DEPTH) return undefined;

  if (value === null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return isTypedToken(value) ? value : undefined;

  if (Array.isArray(value)) {
    const items = value
      .slice(0, MAX_ARRAY)
      .map((item) => toTypedChannel(item, depth + 1))
      .filter((item): item is JsonValue => item !== undefined);
    return items.length === 0 ? undefined : items;
  }

  if (typeof value === 'object') {
    // Object.create(null) for the same reason as canonicalJson in
    // packages/database/src/audit.ts: assigning a "__proto__" key to a plain
    // object literal sets the prototype instead of creating a property, so the
    // field disappears from the result rather than being carried through it.
    // Here the payload is on its way to a model, and a field that silently
    // vanishes between what was recorded and what was sent is the kind of gap
    // nobody finds by reading either side.
    const result: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
    for (const [key, child] of Object.entries(value)) {
      const kept = toTypedChannel(child, depth + 1);
      if (kept !== undefined) result[key] = kept;
    }
    return Object.keys(result).length === 0 ? undefined : result;
  }

  return undefined;
}

/**
 * How much a value lost on the way through, for the operator's step disclosure.
 *
 * Worth surfacing rather than hiding: a writer step that dropped a great deal
 * is a step whose inputs were mostly prose, and that is the shape of a turn a
 * reviewer should look at.
 */
export function droppedFieldCount(value: unknown): number {
  let dropped = 0;
  const walk = (node: unknown, depth: number): void => {
    if (depth > MAX_DEPTH) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    if (typeof node !== 'object' || node === null) return;
    for (const [, child] of Object.entries(node)) {
      if (typeof child === 'string' && !isTypedToken(child)) dropped += 1;
      else walk(child, depth + 1);
    }
  };
  walk(value, 0);
  return dropped;
}
