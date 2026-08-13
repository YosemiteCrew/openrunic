import type { AgentPrincipal } from '@openrunic/agent-tools';

import { hashOf } from './hash.js';

/**
 * The audit record, and the one decision that cannot be retrofitted.
 *
 * Two findings drive the whole shape.
 *
 * **The chained event's metadata is inside the hash.** Editing or removing any
 * past field breaks every hash from that point forward, which is the intended
 * tamper-evidence property. It also means anything written there can never be
 * redacted, corrected or erased. So free text never enters it. Not a prompt,
 * not a completion, not a chart excerpt, not a name, not an embedding.
 * "Just log the prompt in metadata for debugging" is the single most likely way
 * an agent feature damages this codebase, and {@link assertAuditMetadataShape}
 * is the regression guard that stops it.
 *
 * **The agent must be in the model from the start.** The delegating human stays
 * `actorType`/`actorId`, because an access report has to answer "which human
 * saw this chart" and a report that answers "the agent" is useless. Delegation
 * is recorded as an immutable hashed `viaAgent` object carrying the run id, the
 * exact model id, the surface and the mode. Those are ids and enums, so hashing
 * them is correct and desirable: the chain can answer "which entries had an
 * agent in the loop" permanently, and no later migration can add that answer to
 * events that were already sealed.
 *
 * Free text - the rendered prompt, the completion, tool payloads - belongs in a
 * second, unchained, retention-bounded store. The chained event carries only
 * its **hash**, so you can prove the transcript you are reading is the one that
 * was produced, delete it lawfully, and prove the deletion happened.
 */

export const AGENT_MODES = ['read', 'propose', 'execute'] as const;

export type AgentMode = (typeof AGENT_MODES)[number];

export const AGENT_DECISIONS = [
  'proposed',
  'approved',
  'rejected',
  'auto',
  'refused',
  'abstained',
  'blocked_by_guardrail',
] as const;

export type AgentDecision = (typeof AGENT_DECISIONS)[number];

/** The delegation record. Ids and enums only, and therefore safe inside the hash. */
export interface ViaAgent {
  agentRunId: string;
  /** The exact model id string, not a family name. */
  model: string;
  surface: string;
  mode: AgentMode;
  /** Where inference happened, so a later review can find every remote turn. */
  endpointHost: string;
  /** Whether health data left the deployment on this turn. */
  egressed: boolean;
}

export type AuditMetadataValue = string | number | boolean | readonly string[] | ViaAgent;

export interface AgentAuditEvent {
  action: string;
  targetType: string;
  targetId?: string;
  outcome: 'success' | 'failure';
  metadata: Readonly<Record<string, AuditMetadataValue>>;
}

export interface AgentAuditSink {
  record(event: AgentAuditEvent): Promise<void> | void;
}

/**
 * Free text never enters the hashed metadata, so a value that could be a
 * sentence is refused. The bound is small on purpose: an id, a code, an enum, a
 * hash or a host fits; a chart line does not.
 */
export const MAX_METADATA_STRING = 128;

const SENTENCE = /\s{1,}\S+\s{1,}\S/;

/**
 * Refuses a metadata payload that could carry health data.
 *
 * This is the test that stops the regression six months from now, and it
 * belongs in the emitting path rather than only in a test file: a guard that
 * only runs in CI is a guard a hotfix can ship past.
 */
export function assertAuditMetadataShape(
  metadata: Readonly<Record<string, AuditMetadataValue>>
): void {
  for (const [key, value] of Object.entries(metadata)) {
    if (key === 'viaAgent') continue;

    if (typeof value === 'number' || typeof value === 'boolean') continue;

    const strings = typeof value === 'string' ? [value] : Array.isArray(value) ? value : undefined;
    if (strings === undefined) {
      throw new Error(
        `Audit metadata "${key}" is not an id, enum, number or hash. The chained event carries no free text, ever.`
      );
    }

    for (const text of strings) {
      if (text.length > MAX_METADATA_STRING) {
        throw new Error(
          `Audit metadata "${key}" is ${String(text.length)} characters. Anything written into the hash can never be redacted; store the text unchained and record its hash.`
        );
      }
      if (SENTENCE.test(text)) {
        throw new Error(
          `Audit metadata "${key}" looks like prose. The chained event carries ids, enums and hashes only.`
        );
      }
    }
  }
}

export interface TurnAuditInput {
  agentRunId: string;
  turnIndex: number;
  principal: AgentPrincipal;
  mode: AgentMode;
  decision: AgentDecision;
  modelId: string;
  endpointHost: string;
  egressed: boolean;
  promptTemplateId: string;
  promptTemplateVersion: string;
  systemPromptHash: string;
  toolManifestVersion: string;
  /** Hash of the unchained transcript row, which is what makes it provable and deletable. */
  transcriptHash: string;
  inputTokens: number;
  outputTokens: number;
  costCents: number;
  latencyMs: number;
  /** Resource ids plus versions: what makes a citation auditable and a turn reproducible. */
  retrievalSet: readonly string[];
  disclosureShown: boolean;
  outcome: 'success' | 'failure';
  /** Set only when a guardrail fired, and then it names the rule. */
  guardrailRuleId?: string;
  providerRequestId?: string;
}

/** One chained event per turn. Not one per retrieval; the tail row is per-tenant and hot. */
export function turnAuditEvent(input: TurnAuditInput): AgentAuditEvent {
  const metadata: Record<string, AuditMetadataValue> = {
    viaAgent: {
      agentRunId: input.agentRunId,
      model: input.modelId,
      surface: input.principal.surface,
      mode: input.mode,
      endpointHost: input.endpointHost,
      egressed: input.egressed,
    },
    turnIndex: input.turnIndex,
    decision: input.decision,
    purposeOfUse: input.principal.purposeOfUse,
    promptTemplateId: input.promptTemplateId,
    promptTemplateVersion: input.promptTemplateVersion,
    systemPromptHash: input.systemPromptHash,
    toolManifestVersion: input.toolManifestVersion,
    transcriptHash: input.transcriptHash,
    retrievalSet: [...input.retrievalSet],
    retrievalCount: input.retrievalSet.length,
    disclosureShown: input.disclosureShown,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    costCents: input.costCents,
    latencyMs: input.latencyMs,
    ...(input.guardrailRuleId === undefined ? {} : { guardrailRuleId: input.guardrailRuleId }),
    ...(input.providerRequestId === undefined
      ? {}
      : { providerRequestId: input.providerRequestId }),
  };

  assertAuditMetadataShape(metadata);

  return {
    action: 'agent.turn',
    targetType: 'AgentRun',
    targetId: input.agentRunId,
    outcome: input.outcome,
    metadata,
  };
}

export interface ToolCallAuditInput {
  agentRunId: string;
  principal: AgentPrincipal;
  mode: AgentMode;
  modelId: string;
  endpointHost: string;
  egressed: boolean;
  toolId: string;
  toolArgsHash: string;
  /** Ids, codes and enums only. Everything else was already filtered out. */
  argSummary: Readonly<Record<string, AuditMetadataValue>>;
  resultCount: number;
  resultIds: readonly string[];
  decision: AgentDecision;
  outcome: 'success' | 'failure';
  approverUserId?: string;
  approvedAt?: number;
  guardrailRuleId?: string;
}

/**
 * One chained event per state-changing tool call, and one per denial.
 *
 * Denials are audited as loudly as grants: a refused attempt is exactly the
 * event a breach investigation needs, and it is the one an error-path shortcut
 * drops.
 */
export function toolCallAuditEvent(input: ToolCallAuditInput): AgentAuditEvent {
  const metadata: Record<string, AuditMetadataValue> = {
    viaAgent: {
      agentRunId: input.agentRunId,
      model: input.modelId,
      surface: input.principal.surface,
      mode: input.mode,
      endpointHost: input.endpointHost,
      egressed: input.egressed,
    },
    toolId: input.toolId,
    toolArgsHash: input.toolArgsHash,
    resultCount: input.resultCount,
    resultIds: [...input.resultIds],
    decision: input.decision,
    purposeOfUse: input.principal.purposeOfUse,
    ...input.argSummary,
    ...(input.approverUserId === undefined ? {} : { approverUserId: input.approverUserId }),
    ...(input.approvedAt === undefined ? {} : { approvedAt: input.approvedAt }),
    ...(input.guardrailRuleId === undefined ? {} : { guardrailRuleId: input.guardrailRuleId }),
  };

  assertAuditMetadataShape(metadata);

  return {
    action: 'agent.toolCall',
    targetType: 'AgentToolCall',
    targetId: input.toolArgsHash,
    outcome: input.outcome,
    metadata,
  };
}

/**
 * The unchained side of the two-store design.
 *
 * Redactable, retention-bounded, erasable on request. The chained event holds
 * only {@link TranscriptRecord}'s hash, which is why deleting one of these
 * proves a deletion happened rather than hiding it.
 */
export interface TranscriptRecord {
  agentRunId: string;
  turnIndex: number;
  tenantId: string;
  renderedPrompt: string;
  completion: string;
  toolCalls: readonly { toolId: string; input: unknown; output: unknown }[];
}

export interface TranscriptStore {
  /** Returns the hash the chained event records. */
  put(record: TranscriptRecord): Promise<string> | string;
}

/**
 * The default store: retention `0`, meaning nothing is kept.
 *
 * A deployer who wants a readable transcript configures a store that keeps one.
 * Defaulting to keeping health data would be the wrong default for a product
 * whose promise is that it never phones home.
 */
export function createHashOnlyTranscriptStore(): TranscriptStore {
  return { put: (record: TranscriptRecord): string => hashOf(record) };
}

/** An in-memory store with a turn cap, for development and for the conformance runner. */
export function createMemoryTranscriptStore(limit = 50): TranscriptStore & {
  readonly records: ReadonlyMap<string, TranscriptRecord>;
} {
  const records = new Map<string, TranscriptRecord>();
  return {
    records,
    put(record: TranscriptRecord): string {
      const hash = hashOf(record);
      if (records.size >= limit) {
        const oldest = records.keys().next().value;
        if (oldest !== undefined) records.delete(oldest);
      }
      records.set(hash, record);
      return hash;
    },
  };
}
