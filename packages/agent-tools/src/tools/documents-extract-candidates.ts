import { z } from 'zod';

import { pending, proposalResultSchema } from '../proposal.js';
import { defineTool } from '../registry.js';

import { codedValueSchema, sourceRefSchema } from './shared.js';

/**
 * Tool 10. Pre-highlights candidate values from an imported outside record so a
 * human can reconcile them field by field.
 *
 * This is exactly what ADR-0004 already specified for extraction: a model may
 * pre-highlight candidates for a human; it never commits on their behalf. Each
 * candidate carries the source span it came from, so the confirmation surface
 * can put the document text beside the value rather than asking someone to
 * trust a list.
 *
 * The tool performs no read. The reader has already read the document; what
 * crosses into this writer is coded values, dates and source references, and
 * never the document text itself.
 */

const MAX_CANDIDATES = 40;

const candidateSchema = z.strictObject({
  concept: codedValueSchema,
  /** Numeric result, when the concept has one. Never a range the model inferred. */
  value: z.string().max(64).optional(),
  unit: z.string().max(32).optional(),
  effectiveDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD.')
    .optional(),
  /** Where in the document it came from. Required: a candidate without one is a guess. */
  source: sourceRefSchema,
});

export const documentsExtractCandidates = defineTool({
  id: 'documents.extractCandidates',
  tier: 'DRAFT',
  trustClass: 'writer',
  approval: 'always',
  requiredScopes: ['encounter.write'],
  surfaces: ['staff'],
  summary:
    'Highlights candidate values found in an imported record so a person can confirm each one.',
  activityLabel: 'Marking up an imported record',
  maxResultRows: 1,
  compartmentBound: true,
  input: z.strictObject({
    encounterId: z.uuid(),
    documentId: z.uuid(),
    candidates: z.array(candidateSchema).min(1).max(MAX_CANDIDATES),
  }),
  output: proposalResultSchema,

  execute(input) {
    return Promise.resolve(
      pending({
        kind: 'encounter.reconciliation',
        effect: [
          { label: 'Source document', value: input.documentId },
          { label: 'Candidates for review', value: String(input.candidates.length) },
          {
            label: 'Candidates with a value',
            value: String(input.candidates.filter((c) => c.value !== undefined).length),
          },
        ],
        affects: [{ type: 'Encounter', id: input.encounterId }],
        commit: {
          method: 'POST',
          path: '/bff/v0/encounters',
          body: {
            kind: 'reconciliation',
            status: 'pending',
            encounterId: input.encounterId,
            documentId: input.documentId,
            candidates: input.candidates.map((candidate) => ({
              concept: { ...candidate.concept },
              ...(candidate.value === undefined ? {} : { value: candidate.value }),
              ...(candidate.unit === undefined ? {} : { unit: candidate.unit }),
              ...(candidate.effectiveDate === undefined
                ? {}
                : { effectiveDate: candidate.effectiveDate }),
              source: { ...candidate.source },
            })),
          },
        },
        /** An outside record is externally sourced by definition. */
        derivedFromUntrusted: true,
      })
    );
  },
});
