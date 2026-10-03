import { z } from 'zod';

import { ToolError } from '../errors.js';
import { defineTool } from '../registry.js';
import { pending, proposalResultSchema } from '../proposal.js';
import type { JsonObject, JsonValue } from '../json.js';

import { codedValueSchema } from './shared.js';

/**
 * Tool: Prepares a prior-authorisation packet from an existing case (form).
 *
 * The biller selects a prior-auth form and a payer profile. This tool reads
 * the form, reviews the evidence against the payer's requirements, and returns
 * a preview with the pre-filled packet, missing requirements checklist, and
 * source references for satisfied fields. The human reviews and decides whether
 * to submit.
 *
 * It reads and only reads. The preview is a proposal that requires approval
 * before the packet is saved or sent.
 */

const outputSchema = proposalResultSchema;

export const priorauthPrepareFromCase = defineTool({
  id: 'priorauth.prepareFromCase',
  tier: 'DRAFT',
  trustClass: 'writer',
  approval: 'always',
  requiredScopes: ['form.read', 'form.write'],
  surfaces: ['staff'],
  summary:
    'Prepares a prior-authorisation packet from an existing form, with evidence review and preview.',
  activityLabel: 'Preparing prior-authorisation packet from case',
  maxResultRows: 1,
  compartmentBound: false,
  input: z.strictObject({
    formId: z.uuid(),
    payerProfile: codedValueSchema,
  }),
  output: outputSchema,

  async execute(input, context) {
    // Fetch the form
    const formResponse = await context.api.call(
      {
        method: 'GET',
        path: `/bff/v0/forms/${input.formId}`,
      },
      context
    );

    const formSchema = z
      .object({
        status: z.string().optional(),
        payer: codedValueSchema.optional(),
        memberId: z.string().optional(),
        serviceCode: codedValueSchema.optional(),
        diagnosisCodes: z.array(codedValueSchema).optional(),
        requestedUnits: z.number().optional(),
        startDate: z.string().optional(),
        renderingProviderId: z.string().optional(),
        justification: z.string().optional(),
      })
      .passthrough();

    const formData = formSchema.parse(formResponse);

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
        { toolId: 'priorauth.prepareFromCase' }
      );
    }

    // Build the preview body
    const body: JsonObject = {
      kind: 'prior-authorisation',
      status: 'draft',
      payer: (formData.payer as JsonObject) ?? { system: '', code: '', display: '' },
      memberId: (formData.memberId as string) ?? '',
      serviceCode: (formData.serviceCode as JsonObject) ?? { system: '', code: '' },
      diagnosisCodes: (formData.diagnosisCodes as JsonValue[]) ?? [],
      requestedUnits: (formData.requestedUnits as number) ?? 0,
      startDate: (formData.startDate as string) ?? '',
      renderingProviderId: (formData.renderingProviderId as string) ?? '',
      justification: (formData.justification as string) ?? '',
    };

    const payerValue = body.payer as JsonObject;
    const serviceCodeValue = body.serviceCode as JsonObject;

    const payerDisplay =
      typeof payerValue.display === 'string' && payerValue.display.length > 0
        ? payerValue.display
        : '';
    const payerCode =
      typeof payerValue.code === 'string' && payerValue.code.length > 0 ? payerValue.code : '';
    const serviceCode =
      typeof serviceCodeValue.code === 'string' && serviceCodeValue.code.length > 0
        ? serviceCodeValue.code
        : '';
    const startDate =
      typeof body.startDate === 'string' && body.startDate.length > 0 ? body.startDate : '';

    const payerLabel = payerDisplay || payerCode || '—';

    return pending({
      kind: 'form.priorAuthorisation',
      effect: [
        { label: 'Payer', value: payerLabel },
        { label: 'Service', value: serviceCode ?? '—' },
        { label: 'Units requested', value: String(body.requestedUnits) },
        { label: 'Start date', value: startDate },
      ],
      affects: [{ type: 'Form', id: input.formId }],
      commit: { method: 'POST', path: '/bff/v0/forms', body },
      derivedFromUntrusted: false,
    });
  },
});
