import { z } from 'zod';

import { pending, proposalResultSchema } from '../proposal.js';
import { defineTool } from '../registry.js';

import { authoredText } from './shared.js';

/**
 * Tool 11. Drafts a reply to a patient message into `pending`.
 *
 * Draft only, always reviewed, and there is no send. The disclosure exemption
 * for communications read and reviewed by a licensed provider is conditioned on
 * that review, so auto-send would forfeit it; and the agent holds no
 * outbound-communication tool in any case. The draft lands as a task in a human
 * queue, and the human sends it from the normal compose surface. The agent
 * never learns whether it was sent.
 *
 * The claim this feature is allowed to make is reduced cognitive load. It is
 * not allowed to claim time saved: the closest published study found no
 * objective time saving, and the docs say so.
 */

const MAX_BODY = 4000;

export const messagesDraftReply = defineTool({
  id: 'messages.draftReply',
  tier: 'DRAFT',
  trustClass: 'writer',
  approval: 'always',
  requiredScopes: ['task.write'],
  surfaces: ['staff'],
  summary: 'Drafts a reply to a patient message for a clinician to review and send.',
  activityLabel: 'Drafting a reply',
  maxResultRows: 1,
  compartmentBound: true,
  input: z.strictObject({
    threadId: z.uuid(),
    body: authoredText(MAX_BODY),
    /**
     * Always true in practice: a reply is a reply to something a patient wrote.
     * It is an explicit field rather than a constant so the marker travels with
     * the proposal into the audit record and the surface.
     */
    derivedFromPatientText: z.boolean(),
  }),
  output: proposalResultSchema,

  execute(input) {
    return Promise.resolve(
      pending({
        kind: 'message.replyDraft',
        effect: [
          { label: 'Thread', value: input.threadId },
          { label: 'Characters drafted', value: String(input.body.length) },
          { label: 'Status', value: 'unsent draft' },
        ],
        affects: [],
        commit: {
          method: 'POST',
          path: '/bff/v0/tasks',
          body: {
            kind: 'message-reply-draft',
            status: 'awaiting-review',
            threadId: input.threadId,
            body: input.body,
          },
        },
        derivedFromUntrusted: input.derivedFromPatientText,
      })
    );
  },
});
