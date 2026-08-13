import { z } from 'zod';

import { pending, proposalResultSchema } from '../proposal.js';
import { defineTool } from '../registry.js';

/**
 * Tool 6. Assigns an **administrative** category to an inbox item and orders
 * the queue by service-level target.
 *
 * ADR-0004 rule 3 forbids ranking by clinical risk, and this is the feature
 * where that rule would be broken first: ordering messages by how sick the
 * patient sounds is ranking by clinical risk, whatever it is called in the UI.
 * So the vocabulary is fixed in code. The categories are administrative, the
 * ordering key is a service-level target in minutes, and the words "urgency",
 * "acuity" and "triage" appear nowhere in this tool, its labels or its schema.
 * `catalogue.vocabulary.test.ts` asserts that over the whole registry.
 *
 * Two further constraints are in the schema rather than in a review comment.
 * The tool may only move an item **up** a queue, never down, because a wrongly
 * demoted item is invisible until someone notices it is missing. And there is
 * no close, resolve or suppress: every item stays in its originating queue
 * until a human touches it.
 */

/** Administrative categories. `clinical` is a routing destination, not a severity. */
export const INBOX_CATEGORIES = ['billing', 'records', 'refill', 'scheduling', 'clinical'] as const;

export const inboxClassify = defineTool({
  id: 'inbox.classify',
  tier: 'DRAFT',
  trustClass: 'writer',
  approval: 'always',
  requiredScopes: ['task.write'],
  surfaces: ['staff'],
  summary:
    'Suggests which queue an inbox item belongs in and where it sits in that queue by service-level target.',
  activityLabel: 'Sorting the inbox',
  maxResultRows: 1,
  compartmentBound: false,
  input: z
    .strictObject({
      taskId: z.uuid(),
      category: z.enum(INBOX_CATEGORIES),
      /** Lower is earlier. The queue position the item holds now. */
      currentPosition: z.int().min(0).max(10_000),
      /** The position proposed. Must be at or above the current one. */
      proposedPosition: z.int().min(0).max(10_000),
      /** Minutes remaining against the item's service-level target. */
      slaMinutesRemaining: z.int().min(0).max(1_000_000),
    })
    .refine((value) => value.proposedPosition <= value.currentPosition, {
      message: 'An item may only be moved up a queue, never down.',
      path: ['proposedPosition'],
    }),
  output: proposalResultSchema,

  execute(input) {
    return Promise.resolve(
      pending({
        kind: 'task.ordering',
        effect: [
          { label: 'Queue', value: input.category },
          {
            label: 'Position',
            value: `${String(input.currentPosition)} to ${String(input.proposedPosition)}`,
          },
          { label: 'Minutes left on target', value: String(input.slaMinutesRemaining) },
        ],
        affects: [{ type: 'Task', id: input.taskId }],
        commit: {
          method: 'PATCH',
          path: `/bff/v0/tasks/${input.taskId}`,
          body: {
            category: input.category,
            queuePosition: input.proposedPosition,
            slaMinutesRemaining: input.slaMinutesRemaining,
          },
        },
        /**
         * An inbox item is patient-authored or externally sourced by
         * definition, so the surface always shows the untrusted-source marker
         * and requires the ledger to be expanded before the commit control
         * enables.
         */
        derivedFromUntrusted: true,
      })
    );
  },
});
