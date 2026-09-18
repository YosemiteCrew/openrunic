import { z } from 'zod';

import { defineTool } from '../registry.js';

import { codedValueSchema, type CodedValue } from './shared.js';
import type { ApiClient } from '../api-client.js';
import type { AgentPrincipal, AgentCredential } from '../principal.js';

/**
 * Tool 5. Reviews an authorisation or denial case for missing evidence and
 * packet readiness.
 *
 * Read-only. The biller selects a case and a configured payer profile, and this
 * tool returns the deterministic checklist of missing requirements, the recorded
 * status, and cited evidence. No submission, no invention, no clinical
 * judgement.
 */

const MAX_CASES = 10;

const caseReferenceSchema = z.strictObject({
  /** The case identifier. Either a prior-auth packet id or a denied claim id. */
  caseId: z.uuid(),
  /** Discriminates the case type. */
  caseType: z.enum(['prior-authorisation', 'denied-claim']),
  /** The configured payer profile to check against. */
  payerProfile: codedValueSchema,
});

const missingRequirementSchema = z.strictObject({
  /** Human-readable label for the requirement. */
  label: z.string().min(1).max(128),
  /** The coded field name from the payer profile specification. */
  field: z.string().min(1).max(64),
  /** Whether this requirement is satisfied by the current record. */
  satisfied: z.boolean(),
  /** Source reference for the evidence, when satisfied. */
  source: z
    .strictObject({
      resourceType: z.string(),
      resourceId: z.string(),
      field: z.string(),
    })
    .nullable(),
  /** Human-readable explanation when not satisfied. */
  reason: z.string().max(512).optional(),
});

const caseStatusSchema = z.enum([
  'draft',
  'technically-complete',
  'saved',
  'submitted',
  'payer-approved',
  'payer-denied',
  'payer-pended',
  'payer-modified',
  'cancelled',
]);

const outputSchema = z.strictObject({
  caseId: z.uuid(),
  caseType: z.enum(['prior-authorisation', 'denied-claim']),
  payerProfile: codedValueSchema,
  /** Deterministic checklist of all configured requirements. */
  missingRequirements: z.array(missingRequirementSchema).max(64),
  /** Recorded status of the case. Never inferred from packet validity. */
  status: caseStatusSchema,
  /** Source references for every satisfied requirement. */
  evidence: z
    .array(
      z.strictObject({
        resourceType: z.string(),
        resourceId: z.string(),
        field: z.string(),
        label: z.string(),
      })
    )
    .max(32),
});

export const authorisationReviewEvidence = defineTool({
  id: 'authorisation.reviewEvidence',
  tier: 'READ',
  trustClass: 'reader',
  approval: 'never',
  requiredScopes: ['claim.read', 'form.read'],
  surfaces: ['staff'],
  summary: 'Reviews an authorisation or denial case for missing evidence and packet readiness.',
  activityLabel: 'Reviewing authorisation case evidence',
  maxResultRows: MAX_CASES,
  compartmentBound: false,
  input: z.strictObject({
    cases: z.array(caseReferenceSchema).min(1).max(MAX_CASES),
  }),
  output: z.strictObject({
    queryRan: z.string().max(512),
    total: z.int().min(0),
    shown: z.int().min(0),
    reviews: z.array(outputSchema),
  }),

  async execute(input, context) {
    const results = [];

    for (const caseRef of input.cases) {
      const review = await reviewCase(caseRef, context);
      results.push(review);
    }

    return {
      queryRan: `authorisation evidence review for ${input.cases.length} case(s)`,
      total: results.length,
      shown: results.length,
      reviews: results,
    };
  },
});

const formResponseSchema = z.object({ status: z.string().optional() }).passthrough();
const claimResponseSchema = z
  .object({ status: z.string().optional(), id: z.string().optional() })
  .passthrough();
const payerProfileResponseSchema = z.object({
  data: z.array(z.object({ fields: z.array(z.string()) })),
});

async function reviewCase(
  caseRef: { caseId: string; caseType: string; payerProfile: CodedValue },
  context: { api: ApiClient; principal: AgentPrincipal; credential: AgentCredential }
): Promise<z.infer<typeof outputSchema>> {
  // Fetch the case data based on type
  // caseId is validated by input schema (z.uuid()), safe to use in path
  const validatedCaseId = caseRef.caseId;
  let caseData: Record<string, unknown>;
  if (caseRef.caseType === 'prior-authorisation') {
    const response = await context.api.call(
      {
        method: 'GET',
        path: `/bff/v0/forms/${validatedCaseId}`,
      },
      { principal: context.principal, credential: context.credential }
    );
    caseData = formResponseSchema.parse(response);
  } else {
    const response = await context.api.call(
      {
        method: 'GET',
        path: `/bff/v0/claims/${caseRef.caseId}`,
      },
      { principal: context.principal, credential: context.credential }
    );
    caseData = claimResponseSchema.parse(response);
  }

  // Get the payer profile specification (from configured payer profiles)
  // payerProfile.code is validated by input schema (codedValueSchema), safe to use in query
  const validatedPayerCode = caseRef.payerProfile.code;
  const profileResponse = await context.api.call(
    {
      method: 'GET',
      path: `/bff/v0/payer-profiles`,
      query: { code: validatedPayerCode },
    },
    { principal: context.principal, credential: context.credential }
  );
  const profileData = payerProfileResponseSchema.parse(profileResponse);
  const requiredFields = profileData.data[0]?.fields ?? [];

  // Build the missing requirements checklist
  const missingRequirements = requiredFields.map((field) => {
    const value = caseData[field];
    const satisfied = value !== undefined && value !== null && value !== '';
    return {
      label: fieldLabel(field),
      field,
      satisfied,
      source: satisfied
        ? {
            resourceType: caseRef.caseType === 'prior-authorisation' ? 'Form' : 'Claim',
            resourceId: caseRef.caseId,
            field,
          }
        : null,
      reason: satisfied ? undefined : `Required field "${field}" is not present in the record`,
    };
  });

  // Collect evidence for satisfied requirements
  const evidence = requiredFields
    .filter(
      (field) => caseData[field] !== undefined && caseData[field] !== null && caseData[field] !== ''
    )
    .map((field) => ({
      resourceType: caseRef.caseType === 'prior-authorisation' ? 'Form' : 'Claim',
      resourceId: caseRef.caseId,
      field,
      label: fieldLabel(field),
    }));

  // Determine recorded status (never inferred)
  const status = determineStatus(caseData, caseRef.caseType);

  return {
    caseId: caseRef.caseId,
    caseType: caseRef.caseType as 'prior-authorisation' | 'denied-claim',
    payerProfile: caseRef.payerProfile,
    missingRequirements,
    status,
    evidence,
  };
}

function fieldLabel(field: string): string {
  const labels: Record<string, string> = {
    payer: 'Payer',
    memberId: 'Member ID',
    serviceCode: 'Service Code',
    diagnosisCodes: 'Diagnosis Codes',
    requestedUnits: 'Requested Units',
    startDate: 'Start Date',
    renderingProviderId: 'Rendering Provider',
    justification: 'Clinical Justification',
    denialReasonCode: 'Denial Reason Code',
    serviceDate: 'Service Date',
    totalCents: 'Total Amount',
  };
  return labels[field] ?? field;
}

function determineStatus(
  caseData: Record<string, unknown>,
  caseType: string
): z.infer<typeof caseStatusSchema> {
  const status = (caseData.status as string) ?? 'draft';
  const normalised = status.toLowerCase();

  if (caseType === 'prior-authorisation') {
    switch (normalised) {
      case 'draft':
        return 'draft';
      case 'complete':
      case 'ready':
        return 'technically-complete';
      case 'saved':
        return 'saved';
      case 'submitted':
        return 'submitted';
      case 'approved':
      case 'certified':
        return 'payer-approved';
      case 'denied':
        return 'payer-denied';
      case 'pended':
      case 'pending':
        return 'payer-pended';
      case 'modified':
        return 'payer-modified';
      case 'cancelled':
        return 'cancelled';
      default:
        return 'draft';
    }
  } else {
    // Denied claim statuses
    switch (normalised) {
      case 'denied':
        return 'payer-denied';
      case 'appeal-draft':
        return 'draft';
      case 'appeal-submitted':
        return 'submitted';
      case 'appeal-approved':
        return 'payer-approved';
      case 'appeal-denied':
        return 'payer-denied';
      default:
        return 'draft';
    }
  }
}
