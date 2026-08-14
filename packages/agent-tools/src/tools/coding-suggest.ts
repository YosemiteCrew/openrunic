import { z } from 'zod';

import { pending, proposalResultSchema } from '../proposal.js';
import { defineTool } from '../registry.js';

import { sourceRefSchema } from './shared.js';

/**
 * Tool 12, and it ships last of the twelve.
 *
 * The gate on shipping it is per-suggestion accept and reject logging, because
 * the failure mode here is not one wrong code. It is *systematic* upcoding: a
 * statistical signature across thousands of encounters that no single review
 * would catch. The accept/reject record is the only instrument that can see it.
 *
 * Four constraints are in the schema rather than in a prompt:
 *
 * - Every suggestion carries a source reference, so only codes backed by a
 *   cited documentation span can be proposed at all.
 * - `supportedLevel` is the level the documentation supports, and the suggested
 *   level may not exceed it.
 * - Nothing here carries money. There is no amount field, and the list is
 *   returned in code order, so nothing can be ranked by reimbursement.
 * - Suggestions from a problem list or from history alone are impossible,
 *   because a source reference into those resources is refused below.
 */

const MAX_SUGGESTIONS = 12;

/** Resources whose presence alone never supports a code. */
const UNSUPPORTED_SOURCES: readonly string[] = ['Condition', 'ProblemList', 'History'];

const suggestionSchema = z
  .strictObject({
    system: z.enum(['CPT', 'ICD-10-CM', 'HCPCS']),
    code: z.string().min(1).max(16),
    /** 1 to 5 for evaluation and management codes; 0 where levels do not apply. */
    level: z.int().min(0).max(5),
    /** The highest level the cited documentation supports. */
    supportedLevel: z.int().min(0).max(5),
    source: sourceRefSchema,
  })
  .refine((value) => value.level <= value.supportedLevel, {
    message: 'A suggestion may never exceed the level the documentation supports.',
    path: ['level'],
  })
  .refine((value) => !UNSUPPORTED_SOURCES.includes(value.source.resourceType), {
    message: 'A code must be supported by documentation, not by a problem list or history alone.',
    path: ['source', 'resourceType'],
  });

export const codingSuggest = defineTool({
  id: 'coding.suggest',
  tier: 'DRAFT',
  trustClass: 'writer',
  approval: 'always',
  requiredScopes: ['claim.write'],
  surfaces: ['staff'],
  summary: 'Suggests codes that the documentation already supports, each with its source.',
  activityLabel: 'Checking codes against the documentation',
  maxResultRows: 1,
  compartmentBound: false,
  input: z.strictObject({
    claimId: z.uuid(),
    suggestions: z.array(suggestionSchema).min(1).max(MAX_SUGGESTIONS),
  }),
  output: proposalResultSchema,

  execute(input) {
    const ordered = [...input.suggestions].sort((a, b) =>
      `${a.system}:${a.code}`.localeCompare(`${b.system}:${b.code}`)
    );

    return Promise.resolve(
      pending({
        kind: 'claim.codingSuggestion',
        effect: [
          { label: 'Claim', value: input.claimId },
          { label: 'Codes suggested', value: String(ordered.length) },
          { label: 'Codes', value: ordered.map((s) => `${s.system} ${s.code}`).join(', ') },
        ],
        affects: [{ type: 'Claim', id: input.claimId }],
        commit: {
          method: 'PATCH',
          path: `/bff/v0/claims/${input.claimId}`,
          body: {
            suggestedCodes: ordered.map((suggestion) => ({
              system: suggestion.system,
              code: suggestion.code,
              level: suggestion.level,
              source: { ...suggestion.source },
            })),
          },
        },
        derivedFromUntrusted: false,
      })
    );
  },
});
