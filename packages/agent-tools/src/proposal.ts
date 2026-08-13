import { z } from 'zod';

import { jsonObjectSchema } from './json.js';

/**
 * A proposal is a row, not a sentence.
 *
 * The failure nobody plans for: the model emits `appointments.cancel(id=X)` and
 * writes "I'll reschedule your follow-up", and the human approves the sentence.
 * So a DRAFT tool never returns prose describing what it would do. It returns
 * this object: a typed commit descriptor plus the resources the confirmation
 * surface must **re-read from the database** before it renders anything.
 *
 * The commit descriptor names the same endpoint the human UI calls. That is
 * what keeps "the agent executed it" and "a person executed it" the same code
 * path with the same authorisation, the same tenant scoping and the same audit
 * row - the only difference being who was authenticated when it ran.
 */

/** One resource the confirmation surface re-reads before rendering the effect. */
export const resourceRefSchema = z.strictObject({
  /** Aggregate name as the API spells it, e.g. `Appointment`. */
  type: z.string().min(1),
  id: z.uuid(),
});

export type ResourceRef = z.infer<typeof resourceRefSchema>;

/**
 * The call the approver's session makes on commit. `PATCH` and `POST` only:
 * there is no delete, at any tier, under any configuration.
 */
export const commitDescriptorSchema = z.strictObject({
  method: z.enum(['POST', 'PATCH']),
  path: z.string().startsWith('/bff/v0/'),
  body: jsonObjectSchema,
});

export type CommitDescriptor = z.infer<typeof commitDescriptorSchema>;

/**
 * A field of the proposed effect, in the user's vocabulary.
 *
 * These are labels and resolved values for the operator's log, not the thing
 * the human approves against: the confirmation surface renders the effect from
 * its own fresh read of {@link ResourceRef}s and never from the model's
 * description of its own action.
 */
export const effectFieldSchema = z.strictObject({
  label: z.string().min(1),
  value: z.string(),
});

export type EffectField = z.infer<typeof effectFieldSchema>;

export const toolProposalSchema = z.strictObject({
  /** Stable kind, e.g. `appointment.book`. Drives which confirmation card renders. */
  kind: z.string().min(1),
  effect: z.array(effectFieldSchema).min(1),
  affects: z.array(resourceRefSchema),
  commit: commitDescriptorSchema,
  /**
   * True when any value in this proposal was derived from patient-authored or
   * externally sourced text. The surface then shows "Based partly on
   * patient-written text" and requires the source ledger to be expanded before
   * the commit control enables. This is the one place forced friction is
   * justified: the case is rare and the failure is adversarial rather than
   * accidental.
   */
  derivedFromUntrusted: z.boolean(),
});

export type ToolProposal = z.infer<typeof toolProposalSchema>;

/** Wraps a proposal as a DRAFT tool's output. Nothing has happened yet, and the shape says so. */
export const proposalResultSchema = z.strictObject({
  status: z.literal('pending'),
  proposal: toolProposalSchema,
});

export type ProposalResult = z.infer<typeof proposalResultSchema>;

export function pending(proposal: ToolProposal): ProposalResult {
  return { status: 'pending', proposal };
}
