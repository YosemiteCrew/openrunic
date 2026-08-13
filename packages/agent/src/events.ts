import type { ToolProposal } from '@openrunic/agent-tools';

/**
 * What a turn emits, as it happens.
 *
 * Three rules are encoded in this union rather than in a component.
 *
 * **Prose streams; structured output does not.** There is a `text-delta` event
 * and there is no `proposal-delta`. A half-rendered sentence is harmless; a
 * half-rendered medication table is a misreading hazard.
 *
 * **Tool activity streams eagerly**, as named steps in the user's vocabulary
 * rather than call signatures. It is the cheapest perceived-latency win
 * available and it doubles as a transparency affordance.
 *
 * **Model reasoning is never emitted.** There is no event for it. Rendering a
 * model's deliberation about a patient to a clinician is, in substance,
 * presenting clinical reasoning for reliance, which is the framing ADR-0004
 * stays outside. Show actions, never deliberation.
 */

/** One row the turn saw. The ledger says what was read; citations say what was used. */
export interface SourceLedgerEntry {
  resourceType: string;
  resourceId: string;
  label: string;
  /** True for patient-authored or externally sourced content. */
  untrusted: boolean;
}

export type AgentEvent =
  | { type: 'turn-started'; agentRunId: string; turnIndex: number; modelId: string }
  | { type: 'step'; label: string; state: 'active' | 'done'; toolId?: string }
  | { type: 'text-delta'; text: string }
  | { type: 'sources'; entries: readonly SourceLedgerEntry[] }
  | {
      type: 'proposal';
      proposalId: string;
      toolId: string;
      proposal: ToolProposal;
      /** Opaque to the client, and required to approve. */
      approvalSignature: string;
    }
  | { type: 'deferred'; toolId: string; reason: string }
  | { type: 'failed'; code: string; detail: string; toolId?: string }
  | {
      type: 'turn-finished';
      outcome: 'completed' | 'stopped' | 'failed';
      usage: { inputTokens: number; outputTokens: number; costCents: number };
    };

/** Stable machine codes. They appear in the JSON body and in the rendered surface alike. */
export const AGENT_ERROR_CODES = [
  'AGENT_NOT_CONFIGURED',
  'AGENT_UPSTREAM_UNREACHABLE',
  'AGENT_RESPONSE_INVALID',
  'AGENT_TOOL_FAILED',
  'AGENT_SCOPE_DENIED',
  'AGENT_QUOTA_EXCEEDED',
  'AGENT_TURN_LIMIT',
  'AGENT_COMPARTMENT_VIOLATION',
  'AGENT_APPROVAL_REQUIRED',
  'AGENT_APPROVAL_INVALID',
] as const;

export type AgentErrorCode = (typeof AGENT_ERROR_CODES)[number];
