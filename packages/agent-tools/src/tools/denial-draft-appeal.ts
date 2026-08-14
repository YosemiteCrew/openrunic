import { z } from 'zod';

import { pending, proposalResultSchema } from '../proposal.js';
import { defineTool } from '../registry.js';

import { authoredText, sourceRefSchema } from './shared.js';

/**
 * Tool 3. Drafts an appeal letter into `pending`.
 *
 * A human sends it. There is no send control anywhere in the agent surface and
 * no outbound-communication tool in the registry, so "never auto-submit" is a
 * property of the code rather than a rule someone has to remember.
 *
 * Note what crosses into this writer: a claim id, a reason code, and typed
 * source references. The narrative is authored by the model, which is
 * documentation support; it is never text the model read back out of a chart or
 * a patient message.
 */

const MAX_NARRATIVE = 4000;

export const denialDraftAppeal = defineTool({
  id: 'denial.draftAppeal',
  tier: 'DRAFT',
  trustClass: 'writer',
  approval: 'always',
  requiredScopes: ['claim.write'],
  surfaces: ['staff'],
  summary: 'Drafts an appeal letter for a denied claim. A person reviews and sends it.',
  activityLabel: 'Drafting an appeal',
  maxResultRows: 1,
  compartmentBound: false,
  input: z.strictObject({
    claimId: z.uuid(),
    denialReasonCode: z.string().min(1).max(32),
    /** Rows the argument rests on. Every one is resolved before the draft renders. */
    citations: z.array(sourceRefSchema).min(1).max(12),
    narrative: authoredText(MAX_NARRATIVE),
  }),
  output: proposalResultSchema,

  execute(input) {
    return Promise.resolve(
      pending({
        kind: 'claim.appeal',
        effect: [
          { label: 'Claim', value: input.claimId },
          { label: 'Denial reason', value: input.denialReasonCode },
          { label: 'Cited rows', value: String(input.citations.length) },
        ],
        affects: [{ type: 'Claim', id: input.claimId }],
        commit: {
          method: 'POST',
          path: '/bff/v0/claims',
          body: {
            kind: 'appeal',
            claimId: input.claimId,
            denialReasonCode: input.denialReasonCode,
            status: 'draft',
            narrative: input.narrative,
            citations: input.citations.map((citation) => ({ ...citation })),
          },
        },
        derivedFromUntrusted: false,
      })
    );
  },
});
