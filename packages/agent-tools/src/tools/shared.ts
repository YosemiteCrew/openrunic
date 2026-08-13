import { z } from 'zod';

/**
 * Vocabulary shared by every tool in the catalogue.
 *
 * Two things live here rather than being restated per tool. The **source
 * reference**, because a claim without a resolvable one is dropped by the
 * renderer and the commit control stays disabled while any block contains one -
 * that is enforcement, not a disclaimer. And the **record card**, because a
 * READ tool returns records rather than prose, and a uniform card is what lets
 * one resolver check every citation in a turn.
 */

/** Points at a row and a field. The unit the sourceRef resolver checks. */
export const sourceRefSchema = z.strictObject({
  resourceType: z.string().min(1).max(64),
  resourceId: z.string().min(1).max(64),
  /** The field the value was read from, so a reviewer can look at the same place. */
  field: z.string().min(1).max(64),
});

export type SourceRef = z.infer<typeof sourceRefSchema>;

/** One field of a record, already projected down to the minimum necessary. */
export const recordFieldSchema = z.strictObject({
  name: z.string().min(1).max(64),
  value: z.string().max(512),
});

/**
 * A record, as a tool returns it.
 *
 * `label` is drawn from stored values only. Nothing on this card is authored by
 * the model; the model chooses which cards to show and in what order, never
 * what they say.
 */
export const recordCardSchema = z.strictObject({
  type: z.string().min(1).max(64),
  id: z.string().min(1).max(64),
  label: z.string().max(256),
  fields: z.array(recordFieldSchema).max(24),
  source: sourceRefSchema,
});

export type RecordCard = z.infer<typeof recordCardSchema>;

/**
 * The shape of a retrieval answer.
 *
 * `total` and `shown` are both present on purpose. A clinician cannot tell a
 * complete answer from an incomplete one by looking at it, so the count of what
 * exists is part of the answer, not a footnote.
 */
export const retrievalResultSchema = z.strictObject({
  /** The query that actually ran, rendered so a human can check it. Never prose. */
  queryRan: z.string().max(512),
  total: z.int().min(0),
  shown: z.int().min(0),
  rows: z.array(recordCardSchema),
});

export type RetrievalResult = z.infer<typeof retrievalResultSchema>;

/** When a proposal falls outside its policy envelope it degrades to a staff request. */
export const deferredResultSchema = z.strictObject({
  status: z.literal('deferred'),
  /** Names the envelope rule that was not met, in the caller's vocabulary. */
  reason: z.string().min(1).max(256),
});

export type DeferredResult = z.infer<typeof deferredResultSchema>;

export function deferred(reason: string): DeferredResult {
  return { status: 'deferred', reason };
}

/** The API's list envelope. Parsed rather than trusted, like anything else off a wire. */
export function apiListSchema<T extends z.ZodType>(item: T) {
  return z.object({
    data: z.array(item),
    page: z.object({ total: z.int().min(0) }),
  });
}

/** `YYYY-MM-DD`. A date of birth has no time and no timezone. */
export const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD.');

/** An instant, as the API renders one. */
export const instantSchema = z.iso.datetime();

/**
 * A coded value. The clinical channel into a writer is codes, never prose, and
 * the stored model already carries `code` plus `codeSystem`, so the typed
 * channel largely exists in the data already.
 */
export const codedValueSchema = z.strictObject({
  system: z.string().min(1).max(64),
  code: z.string().min(1).max(64),
  display: z.string().max(160).optional(),
});

export type CodedValue = z.infer<typeof codedValueSchema>;

/** Free text a model authored, bounded. Never free text a tool read back. */
export function authoredText(maxLength: number) {
  return z.string().min(1).max(maxLength);
}
