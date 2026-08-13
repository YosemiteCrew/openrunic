import { z } from 'zod';

import { ToolError } from '../errors.js';
import { defineTool } from '../registry.js';

import { apiListSchema, recordCardSchema } from './shared.js';

/**
 * Tool 2. Classifies a denied claim by its reason code and assembles the
 * evidence set a human will work from.
 *
 * Read-only, and deliberately a money problem rather than a medicine problem:
 * the payer is an adversarial reviewer who catches errors, the patient is not
 * in the failure path, and the classification is a lookup over a published code
 * list rather than a judgement.
 *
 * The categories below are administrative. There is no clinical category and no
 * ordering by how sick anyone is; ADR-0004 rule 3 forbids ranking by clinical
 * risk, and a denial worklist is exactly where that rule would be quietly
 * broken.
 */

const MAX_ROWS = 20;

/** Reason-code prefix to administrative category. Data, so a deployer can extend it. */
const CATEGORY_BY_PREFIX: ReadonlyArray<readonly [string, string]> = [
  ['CO-4', 'coding-modifier'],
  ['CO-11', 'coding-diagnosis'],
  ['CO-16', 'missing-information'],
  ['CO-18', 'duplicate'],
  ['CO-29', 'timely-filing'],
  ['CO-45', 'contractual-adjustment'],
  ['CO-97', 'bundling'],
  ['PR-1', 'patient-deductible'],
  ['PR-2', 'patient-coinsurance'],
  ['PR-3', 'patient-copay'],
];

const claimRowSchema = z.object({
  id: z.string(),
  status: z.string(),
  denialReasonCode: z.string().nullable().optional(),
  serviceDate: z.string().optional(),
  totalCents: z.number().optional(),
});

const outputSchema = z.strictObject({
  queryRan: z.string().max(512),
  total: z.int().min(0),
  shown: z.int().min(0),
  rows: z.array(
    z.strictObject({
      claim: recordCardSchema,
      /** Administrative category, from the code list. Never a clinical judgement. */
      category: z.string().min(1).max(64),
      /** What a human needs in front of them to work this denial. */
      evidence: z.array(z.strictObject({ resourceType: z.string(), field: z.string() })).max(8),
    })
  ),
});

export const denialTriage = defineTool({
  id: 'denial.triage',
  tier: 'READ',
  trustClass: 'reader',
  approval: 'never',
  requiredScopes: ['claim.read'],
  surfaces: ['staff'],
  summary: 'Groups denied claims by their reason code and lists what each one needs.',
  activityLabel: 'Reading denied claims',
  maxResultRows: MAX_ROWS,
  compartmentBound: false,
  input: z.strictObject({
    reasonCode: z.string().min(1).max(32).optional(),
    from: z.iso.datetime().optional(),
    to: z.iso.datetime().optional(),
  }),
  output: outputSchema,

  async execute(input, context) {
    const body = await context.api.call(
      {
        method: 'GET',
        path: '/bff/v0/claims',
        query: {
          pageSize: MAX_ROWS,
          status: 'denied',
          ...(input.reasonCode === undefined ? {} : { denialReasonCode: input.reasonCode }),
          ...(input.from === undefined ? {} : { from: input.from }),
          ...(input.to === undefined ? {} : { to: input.to }),
        },
      },
      context
    );

    const parsed = apiListSchema(claimRowSchema).safeParse(body);
    if (!parsed.success) {
      throw new ToolError(
        'AGENT_TOOL_OUTPUT_INVALID',
        'denial.triage read a claim list the API described differently than expected.',
        { toolId: 'denial.triage' }
      );
    }

    return {
      queryRan: `claim status=denied${input.reasonCode === undefined ? '' : ` reason=${input.reasonCode}`}`,
      total: parsed.data.page.total,
      shown: parsed.data.data.length,
      rows: parsed.data.data.map((row) => ({
        claim: {
          type: 'Claim',
          id: row.id,
          label: row.denialReasonCode ?? 'denied',
          fields: [
            { name: 'Status', value: row.status },
            { name: 'Reason code', value: row.denialReasonCode ?? 'not recorded' },
            { name: 'Service date', value: row.serviceDate ?? 'not recorded' },
          ],
          source: { resourceType: 'Claim', resourceId: row.id, field: 'denialReasonCode' },
        },
        category: categorise(row.denialReasonCode ?? ''),
        evidence: evidenceFor(categorise(row.denialReasonCode ?? '')),
      })),
    };
  },
});

export function categorise(reasonCode: string): string {
  const match = CATEGORY_BY_PREFIX.find(([prefix]) => reasonCode.startsWith(prefix));
  return match?.[1] ?? 'uncategorised';
}

function evidenceFor(category: string): { resourceType: string; field: string }[] {
  if (category.startsWith('coding')) {
    return [
      { resourceType: 'Encounter', field: 'documentation' },
      { resourceType: 'Claim', field: 'lines' },
    ];
  }
  if (category === 'missing-information') {
    return [
      { resourceType: 'Patient', field: 'coverage' },
      { resourceType: 'Claim', field: 'attachments' },
    ];
  }
  if (category === 'timely-filing') {
    return [{ resourceType: 'Claim', field: 'submittedAt' }];
  }
  return [{ resourceType: 'Claim', field: 'lines' }];
}
