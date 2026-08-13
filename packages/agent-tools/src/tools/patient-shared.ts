import { z } from 'zod';

import { ToolError } from '../errors.js';
import type { ToolContext } from '../registry.js';

import { recordFieldSchema, sourceRefSchema } from './shared.js';

/**
 * Vocabulary shared by every tool a patient can reach.
 *
 * It differs from `shared.ts` in exactly one way, and that difference is the
 * whole compartment story on this surface.
 *
 * A staff {@link import('./shared.js').RecordCard} carries no `patientId`,
 * because a clinician legitimately reads many charts and the row does not need
 * to say which one it came from. That also means the boundary re-check in
 * `compartment.ts` has nothing to look at: it walks a payload for keys named
 * `patientId`, and a payload with none passes trivially.
 *
 * On the patient surface that would be an empty guarantee, so **every row names
 * the chart it belongs to**. The re-check then compares that value against the
 * chart bound to the turn and aborts on a mismatch, which turns "a patient may
 * only ever reach their own chart" from a property of the endpoints we happened
 * to call into a property the runtime checks on the way out of every tool.
 *
 * The consequence worth stating plainly: a future tool granted to this surface
 * inherits the check only if its rows are {@link ownedRecordSchema}.
 * `patient-surface.test.ts` walks the grants and fails if one is not.
 */

/** One record from the reader's own chart, projected to the minimum necessary. */
export const ownedRecordSchema = z.strictObject({
  /**
   * The chart this row belongs to. Present so the boundary re-check has
   * something to check; a row that names another chart aborts the turn.
   */
  patientId: z.string().min(1).max(64),
  /** The kind of record, in the word the portal uses for it on screen. */
  type: z.string().min(1).max(64),
  id: z.string().min(1).max(64),
  /** Drawn from stored values only. The model chooses which rows to show, never what they say. */
  label: z.string().max(256),
  fields: z.array(recordFieldSchema).max(8),
  source: sourceRefSchema,
});

export type OwnedRecord = z.infer<typeof ownedRecordSchema>;

/**
 * What a patient-surface read returns.
 *
 * `total` and `shown` are both here for the same reason they are on the staff
 * shape: a reader cannot tell a complete answer from a partial one by looking at
 * it, so how much exists is part of the answer rather than a footnote. It
 * matters more here, because the reader has no clinician beside them to notice
 * that something is missing.
 */
export const ownedRetrievalSchema = z.strictObject({
  /** The query that actually ran, rendered so it can be checked. Never prose. */
  queryRan: z.string().max(512),
  total: z.int().min(0),
  shown: z.int().min(0),
  rows: z.array(ownedRecordSchema),
});

export type OwnedRetrieval = z.infer<typeof ownedRetrievalSchema>;

/**
 * Refuses to read at all unless a chart is bound to the turn.
 *
 * A patient-surface tool names no patient anywhere: the API narrows every
 * repository it hands a portal request to the chart on the caller's token, so
 * the scoping is done by middleware the browser path already exercises. What
 * the tool still needs is something to compare the answer against, and that is
 * the bound chart.
 *
 * With no chart bound there is nothing to compare against, so the tool refuses
 * before it reads rather than reading and hoping. It returns nothing, because
 * the value is never used: knowing a chart is bound is the whole point, and a
 * tool that held the identifier could pass it somewhere. The code aborts the
 * turn, because a read whose result cannot be checked is not a smaller answer,
 * it is an unchecked one.
 */
export function assertChartBound(context: ToolContext, toolId: string): void {
  if (context.principal.compartment.patientId === undefined) {
    throw new ToolError(
      'AGENT_COMPARTMENT_VIOLATION',
      `${toolId} was asked to read with no chart bound to the turn, so nothing it read back could be checked. The turn was aborted.`,
      { toolId }
    );
  }
}

/**
 * Builds the result, refusing a page larger than the tool declared.
 *
 * The cardinality check in `compartment.ts` counts a list envelope's `data`
 * array, and this shape has no `data`, so the declared cap is enforced here
 * instead of being quietly inert. Exceeding it is a scope violation rather than
 * a truncation: an API that returns more than it was asked for is a bug, and
 * silently keeping the first few rows hides it.
 */
export function ownedRetrieval(
  toolId: string,
  queryRan: string,
  total: number,
  rows: readonly OwnedRecord[],
  maxResultRows: number
): OwnedRetrieval {
  if (rows.length > maxResultRows) {
    throw new ToolError(
      'AGENT_SCOPE_DENIED',
      `${toolId} read ${String(rows.length)} rows against a declared maximum of ${String(maxResultRows)}.`,
      { toolId }
    );
  }
  return { queryRan, total, shown: rows.length, rows: [...rows] };
}

/**
 * Reads the API's list envelope, or refuses.
 *
 * A body in a shape this build does not recognise is not partially trusted: it
 * is refused, so nothing downstream has to decide which half of it was real.
 */
export function parseOwnedPage<T extends z.ZodType>(
  toolId: string,
  schema: T,
  body: unknown
): { data: z.infer<T>[]; total: number } {
  const envelope = z.object({ data: z.array(schema), page: z.object({ total: z.int().min(0) }) });
  const parsed = envelope.safeParse(body);
  if (!parsed.success) {
    throw new ToolError(
      'AGENT_TOOL_OUTPUT_INVALID',
      `${toolId} read a list the API described differently than expected.`,
      { toolId }
    );
  }
  return { data: parsed.data.data as z.infer<T>[], total: parsed.data.page.total };
}

/**
 * The day part of an instant, which is all a patient-facing row ever shows.
 *
 * A stored timestamp carries a clock reading and an offset that nobody reading
 * their own record needs, and rendering one invites a reader to draw a
 * conclusion from a minute that was really just when a clerk saved the row.
 */
export function dayOf(instant: string): string {
  return instant.slice(0, 10);
}

/**
 * Plain words for the stored status enums.
 *
 * The mapping is a table in code rather than something a model is asked to
 * translate. ADR-0004 keeps code-to-plain-language on a curated mapping, and
 * this is that mapping for the handful of statuses this surface shows. An
 * unmapped value falls through to "recorded", which says only that the row
 * exists, because inventing a gloss for a code we do not know is exactly what
 * the rule exists to stop.
 */
const PLAIN_STATUS: Readonly<Record<string, string>> = {
  ACTIVE: 'Being treated',
  RECURRENCE: 'Being treated',
  RELAPSE: 'Being treated',
  INACTIVE: 'Not being treated now',
  REMISSION: 'Not being treated now',
  RESOLVED: 'Resolved',
  COMPLETED: 'Finished',
  STOPPED: 'Stopped',
  INTENDED: 'Planned',
  NOT_TAKEN: 'Not taken',
  ON_HOLD: 'Paused',
  UNKNOWN: 'Recorded',
  ENTERED_IN_ERROR: 'Recorded by mistake',
  PROPOSED: 'Being arranged',
  PENDING: 'Being arranged',
  BOOKED: 'Booked',
  ARRIVED: 'You arrived',
  CHECKED_IN: 'You checked in',
  ROOMED: 'You were called through',
  IN_PROGRESS: 'Happening now',
  CHECKED_OUT: 'Finished',
  FULFILLED: 'Finished',
  CANCELLED: 'Cancelled',
  NOSHOW: 'Missed',
  DRAFT: 'Not sent to you yet',
  GENERATED: 'Not sent to you yet',
  SENT: 'Sent to you',
  PAID: 'Paid',
  VOID: 'Cancelled',
};

export function plainStatus(status: string): string {
  return PLAIN_STATUS[status.toUpperCase()] ?? 'Recorded';
}
