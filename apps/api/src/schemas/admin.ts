import { z } from 'zod';

import { paginationQueryFields, windowQueryFields, listResponseSchema } from './pagination.js';

/**
 * THE ADMINISTRATIVE WORKLIST.
 *
 * The two sources are read through their own doors - an open task through
 * `task.read`, an outstanding referral through `order.read` - and the worklist
 * is a rendering of both. A caller who holds the task door but not the order
 * door still gets the task half; the referral half is withheld rather than
 * shown empty, because an empty list reads as "all caught up" and that is a
 * statement the caller's permission does not entitle it to make.
 *
 * Everything here is computed on read. `overdue` compares the due date against
 * the clock handed to the route, never against a stored snapshot, so the list
 * cannot go stale the way a persisted worklist does.
 *
 * A worklist entry has one source. `source` keeps the two kinds of work apart
 * while `id` stays namespaced enough that the router can open either one, and
 * `href` is the caller-facing link to the source's own workflow.
 */

/** Which door the entry came in through, and which workflow `href` opens. */
export const worklistSourceSchema = z.enum(['task', 'referral']);

export type WorklistSource = z.infer<typeof worklistSourceSchema>;

/**
 * The named owner of one entry.
 *
 * `userId` and `teamKey` are both nullable AND both present, so a task owned
 * by a person and a referral owned by the referring clinician are the same
 * shape, and a row nobody can point at says so with nulls rather than by
 * omitting the field.
 */
const worklistOwnerSchema = z.strictObject({
  userId: z.uuid().nullable(),
  teamKey: z.string().nullable(),
});

export const worklistEntrySchema = z.strictObject({
  source: worklistSourceSchema,
  id: z.uuid(),
  patientId: z.uuid().nullable(),
  /** The work, in one line: the task's title or the referral's specialty. */
  title: z.string(),
  /** The source's status, verbatim, so the chip renders the caller's words. */
  status: z.string(),
  /** The named owner, or explicit nulls when work is nobody's yet. */
  owner: worklistOwnerSchema,
  /**
   * When the work is due. A referral carries no due date in this model, so it
   * is null here - an explicit absence, not a value hidden.
   */
  dueAt: z.string().nullable(),
  /**
   * Computed at read against the route's clock: `dueAt < now`. Null due dates
   * are never overdue.
   */
  overdue: z.boolean(),
  /** What has to happen before the owner can finish it. A task is not blocked. */
  blockedBy: z.string().nullable(),
  /** Link to the source's own workflow, so the worklist is never where it ends. */
  href: z.string(),
});

export type WorklistEntry = z.infer<typeof worklistEntrySchema>;

export const worklistQuerySchema = z.strictObject({
  ...paginationQueryFields,
  ...windowQueryFields,
});

export type WorklistQuery = z.infer<typeof worklistQuerySchema>;

/**
 * Which of the two sources this caller was not shown.
 *
 * Present whenever a requested source is withheld, so the client can distinguish
 * "nothing outstanding" from "you may not see this". The array names the source
 * only - no row ids, no counts - because the point of the marker is to say the
 * view is partial, not to leak what is hidden behind the permission.
 */
export const worklistWithheldSchema = z.strictObject({
  sources: z.array(worklistSourceSchema),
});

/**
 * Which of the two sources had more outstanding work than the route read.
 *
 * The worklist is a merged, re-sorted list, so it cannot be paged at the
 * sources: an entry's position depends on rows from the other source, which
 * means assembling one page means reading both trays. Reading them without a
 * bound makes a queue route a way to ask for every row in the practice, so the
 * read is capped - and a cap has to be said out loud, because `total` counts
 * what was assembled and would otherwise describe a partial tray as the whole
 * one. A source named here has work past the end of this list.
 *
 * Distinct from `withheld`, which means the caller may not see a source at all.
 * Withheld is about permission; truncated is about how much of a tray one page
 * assembly can reach. The array names the source only, and no count, for the
 * same reason `withheld` does: the marker exists to say the view is partial.
 */
export const worklistTruncatedSchema = z.strictObject({
  sources: z.array(worklistSourceSchema),
});

/** The envelope: one page of entries plus the withheld and truncated markers. */
export const worklistResponseSchema = listResponseSchema(worklistEntrySchema).extend({
  withheld: worklistWithheldSchema,
  truncated: worklistTruncatedSchema,
});

export type WorklistResponse = z.infer<typeof worklistResponseSchema>;
