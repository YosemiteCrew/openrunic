import { z } from 'zod';

import { ToolError } from '../errors.js';
import { pending, proposalResultSchema } from '../proposal.js';
import { defineTool, type ToolContext } from '../registry.js';

import { deferred, deferredResultSchema, sourceRefSchema, type SourceRef } from './shared.js';

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
 * - `supportedLevel` is the level the caller says the documentation supports,
 *   and the suggested level may not exceed it.
 * - Nothing here carries money. There is no amount field, and the list is
 *   returned in code order, so nothing can be ranked by reimbursement.
 * - Suggestions from a problem list or from history alone are impossible,
 *   because a source reference into those resources is refused below.
 *
 * ## Why the second constraint is not on its own a check
 *
 * `level` and `supportedLevel` arrive in the same tool call, so the refine that
 * relates them compares two halves of one claim. It catches a caller that
 * contradicts itself and nothing else: a caller that says level 5 is supported
 * by documentation that supports level 3 passes it, and the number that made
 * the suggestion legal was supplied by the thing being checked.
 *
 * So the level a *refusal* is measured against is never read off the
 * suggestion. It is computed by a {@link CodingLevelRules} the deployment
 * supplies, which reads what the citation names and answers the highest level
 * that documentation supports. The field relationship stays where it was, in
 * front of this: it is cheap, it is the shape the accept and reject record
 * needs, and two checks that fail differently are worth more than one.
 *
 * ## Why the rule set is a port and not a table in this file
 *
 * Level criteria for evaluation and management codes are published content this
 * project does not redistribute, for the reason recorded in
 * `packages/pricing/src/fee-schedule.ts` for fee schedules and in
 * `packages/quality/src/measure.ts` for measure value sets. A table written
 * here would be criteria authored here, and a plausible wrong level is worse
 * than an absent one because it looks authoritative.
 *
 * The port also owns the read. What supports a level is a documentation
 * element, and the note is a block list whose shape storage deliberately does
 * not own, so the rule set is read against a structure only the deployment that
 * holds both can name. It is handed the caller's own {@link ToolContext} and
 * reads with the caller's own credential, exactly as a READ tool does.
 *
 * ## What happens when nothing is loaded
 *
 * The suggestion is deferred to a coder, naming what was missing. It does not
 * fall through to the caller's number, because a level nothing checked looks
 * exactly like a level something checked - which is the whole defect above.
 * `packages/quality` takes the same position for the same reason: a measure
 * whose value sets are not loaded reports that it cannot be computed rather
 * than reporting a rate built from a partial code list.
 *
 * Suggestions at level 0 - the systems and codes where levels do not apply -
 * are unaffected and need no rule set. They are the majority of what this tool
 * proposes, so an unconfigured deployment keeps a useful tool rather than a
 * silent one.
 */

const MAX_SUGGESTIONS = 12;

/** Resources whose presence alone never supports a code. */
const UNSUPPORTED_SOURCES: readonly string[] = ['Condition', 'ProblemList', 'History'];

const CODE_SYSTEMS = ['CPT', 'ICD-10-CM', 'HCPCS'] as const;

/** A code system this tool may propose in. */
export type CodeSystem = (typeof CODE_SYSTEMS)[number];

/** A suggestion as the rule set is asked about it: the code, and where it is claimed from. */
export interface CodingCitation {
  readonly system: CodeSystem;
  readonly code: string;
  readonly source: SourceRef;
}

/**
 * What the documentation supports, or why that cannot be said.
 *
 * There is no third answer and no default. A citation that does not resolve is
 * `computed: false`, never level 0: "the documentation supports nothing" and
 * "nobody could find the documentation" are different facts, and only one of
 * them is about the record.
 */
export type SupportedLevel =
  | { readonly computed: true; readonly level: number }
  | { readonly computed: false; readonly missing: string };

/** The deployment-supplied criteria. Public logic here, licensed content there. */
export interface CodingLevelRules {
  /**
   * The highest level the cited documentation supports.
   *
   * `context` carries the caller's credential, so the read this makes is the
   * read the caller could have made and no wider.
   */
  supportedLevelFor(citation: CodingCitation, context: ToolContext): Promise<SupportedLevel>;
}

/**
 * The rule set's answer, parsed rather than trusted.
 *
 * It is deployment code rather than a wire, but it is still the one input that
 * decides a refusal, and an answer this tool cannot read must not become a
 * pass. `missing` is bounded so the deferral it lands in stays inside the 256
 * characters `deferredResultSchema` allows.
 */
const supportedLevelSchema = z.union([
  z.strictObject({ computed: z.literal(true), level: z.int().min(0).max(5) }),
  z.strictObject({ computed: z.literal(false), missing: z.string().min(1).max(160) }),
]);

const suggestionSchema = z
  .strictObject({
    system: z.enum(CODE_SYSTEMS),
    code: z.string().min(1).max(16),
    /** 1 to 5 for evaluation and management codes; 0 where levels do not apply. */
    level: z.int().min(0).max(5),
    /** The level the caller claims the documentation supports. Recorded; not the check. */
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

export function createCodingSuggest(rules?: CodingLevelRules) {
  return defineTool({
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
    output: z.union([proposalResultSchema, deferredResultSchema]),

    async execute(input, context) {
      const ordered = [...input.suggestions].sort((a, b) =>
        `${a.system}:${a.code}`.localeCompare(`${b.system}:${b.code}`)
      );

      /* Walked in code order rather than the order the model happened to emit,
         so which suggestion a deferral names is a property of the call and not
         of how the list arrived. */
      for (const suggestion of ordered) {
        if (suggestion.level === 0) continue;

        const named = `${suggestion.system} ${suggestion.code}`;
        if (rules === undefined) {
          return deferred(
            `No coding level rule set is loaded, so level ${String(suggestion.level)} on ${named} is unchecked. Send this to a coder.`
          );
        }

        const answer = supportedLevelSchema.safeParse(
          await rules.supportedLevelFor(
            { system: suggestion.system, code: suggestion.code, source: suggestion.source },
            context
          )
        );
        if (!answer.success) {
          throw new ToolError(
            'AGENT_TOOL_FAILED',
            'The coding level rule set answered in a shape this tool cannot read.',
            { toolId: 'coding.suggest' }
          );
        }

        if (!answer.data.computed) {
          return deferred(
            `The level on ${named} cannot be computed: ${answer.data.missing}. Send this to a coder.`
          );
        }
        if (suggestion.level > answer.data.level) {
          return deferred(
            `${named} is claimed at level ${String(suggestion.level)}; the documentation supports level ${String(answer.data.level)}. Send this to a coder.`
          );
        }
      }

      return pending({
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
      });
    },
  });
}

/**
 * The catalogue instance, with no rule set.
 *
 * A deployment that holds the criteria builds its own with
 * {@link createCodingSuggest} and registers that one instead.
 */
export const codingSuggest = createCodingSuggest();
