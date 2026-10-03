import { z } from 'zod';

import { ToolError } from '../errors.js';
import { defineTool } from '../registry.js';
import { pending, proposalResultSchema } from '../proposal.js';
import type { JsonObject } from '../json.js';

import { codedValueSchema } from './shared.js';

/**
 * Tool: Prepares a denial appeal from an existing denied claim.
 *
 * The biller selects a denied claim and this tool reads the claim, reviews
 * the evidence against the payer's requirements, and returns a preview with
 * the pre-filled appeal, missing requirements checklist, and source references
 * for satisfied fields. The human reviews and decides whether to submit.
 *
 * It reads and only reads. The preview is a proposal that requires approval
 * before the appeal is saved or sent.
 */

const outputSchema = proposalResultSchema;

export const denialPrepareAppealFromCase = defineTool({
  id: 'denial.prepareAppealFromCase',
  tier: 'DRAFT',
  trustClass: 'writer',
  approval: 'always',
  requiredScopes: ['claim.read', 'claim.write'],
  surfaces: ['staff'],
  summary: 'Prepares a denial appeal from an existing claim, with evidence review and preview.',
  activityLabel: 'Preparing denial appeal from case',
  maxResultRows: 1,
  compartmentBound: false,
  input: z.strictObject({
    claimId: z.uuid(),
    denialReasonCode: z.string().min(1).max(32),
    payerProfile: codedValueSchema,
  }),
  output: outputSchema,

  async execute(input, context) {
    // Fetch the claim
    const claimResponse = await context.api.call(
      {
        method: 'GET',
        path: `/bff/v0/claims/${input.claimId}`,
      },
      context
    );

    const claimSchema = z
      .object({
        id: z.string().optional(),
        status: z.string().optional(),
        denialReasonCode: z.string().optional(),
        serviceDate: z.string().optional(),
        totalCents: z.number().optional(),
        narrative: z.string().optional(),
      })
      .passthrough();

    const claimData = claimSchema.parse(claimResponse);

    // Fetch the payer profile
    const profileResponse = await context.api.call(
      {
        method: 'GET',
        path: '/bff/v0/payer-profiles',
        query: { code: input.payerProfile.code },
      },
      context
    );

    const profileSchema = z.object({
      data: z.array(z.object({ fields: z.array(z.string()) })),
    });
    const profileData = profileSchema.parse(profileResponse);
    const payerProfile = profileData.data[0];
    if (!payerProfile) {
      throw new ToolError(
        'AGENT_TOOL_FAILED',
        `Payer profile "${input.payerProfile.code}" not found.`,
        { toolId: 'denial.prepareAppealFromCase' }
      );
    }
    const claimRecord = claimData as Record<string, unknown>;
    const isPresent = (field: string): boolean => {
      const value = claimRecord[field];
      return value !== undefined && value !== null && value !== '';
    };
    const satisfied = payerProfile.fields.filter(isPresent);
    const missing = payerProfile.fields.filter((field) => !isPresent(field));

    // Build the preview body
    const body: JsonObject = {
      kind: 'appeal',
      claimId: input.claimId,
      denialReasonCode: input.denialReasonCode,
      status: 'draft',
      narrative: (claimData.narrative as string) ?? '',
      citations: satisfied.map((field) => ({ field, reference: `Claim/${input.claimId}` })),
    };

    return pending({
      kind: 'claim.appeal',
      effect: [
        { label: 'Claim', value: input.claimId },
        { label: 'Denial reason', value: input.denialReasonCode },
        {
          label: 'Requirements met',
          value: `${satisfied.length} of ${payerProfile.fields.length}`,
        },
        { label: 'Missing', value: missing.length > 0 ? missing.join(', ') : '—' },
      ],
      affects: [{ type: 'Claim', id: input.claimId }],
      commit: {
        method: 'POST',
        path: '/bff/v0/claims',
        body,
      },
      derivedFromUntrusted: false,
    });
  },
});
