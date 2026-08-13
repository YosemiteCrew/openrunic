/**
 * The assistant wire contract, as this app reads it.
 *
 * These mirror the union `packages/agent/src/events.ts` emits and the body
 * `apps/api/src/agent/routes.ts` serves on `GET /bff/v0/agent/tools`. They are
 * declared here rather than imported: `@openrunic/agent` is a server package -
 * it reaches for `node:crypto` and carries the provider SDKs - and the browser
 * bundle must not depend on it, not even for a type.
 *
 * Drift is therefore caught at runtime rather than by the compiler.
 * {@link parseAgentEvent} validates every frame and returns null for anything
 * it does not recognise, so a server that grows an event this build has never
 * seen is ignored rather than fatal.
 */

/** Which endpoint answers, and whether asking it sends anything outside the deployment. */
export interface AgentModelIdentity {
  modelId: string;
  endpointHost: string;
  remote: boolean;
  /** True when the configured endpoint is not inside this deployment (ADR-0005 rule 6). */
  dataLeavesDeployment: boolean;
}

/** One capability this caller can reach. Deny by default: what is absent was never granted. */
export interface AgentToolSummary {
  id: string;
  tier: string;
  summary: string;
  requiredScopes: readonly string[];
  approval: string;
}

/** The capabilities response. Its presence is the only signal that the agent is on. */
export interface AgentCapabilities {
  model: AgentModelIdentity;
  tools: readonly AgentToolSummary[];
}

/** One row the turn read. The ledger says what was seen; it is what a citation points at. */
export interface AgentSource {
  resourceType: string;
  resourceId: string;
  label: string;
  /** True for patient-authored or externally sourced content. Rendered as such. */
  untrusted: boolean;
}

/** A proposed change, before any person has confirmed it. Nothing has happened yet. */
export interface AgentProposal {
  kind: string;
  effect: readonly { label: string; value: string }[];
  derivedFromUntrusted: boolean;
}

export interface AgentUsage {
  inputTokens: number;
  outputTokens: number;
  costCents: number;
}

export type AgentEvent =
  | { type: 'turn-started'; agentRunId: string; turnIndex: number; modelId: string }
  | { type: 'step'; label: string; state: 'active' | 'done'; toolId?: string }
  | { type: 'text-delta'; text: string }
  | { type: 'sources'; entries: readonly AgentSource[] }
  | { type: 'proposal'; proposalId: string; toolId: string; proposal: AgentProposal }
  | { type: 'deferred'; toolId: string; reason: string }
  | { type: 'failed'; code: string; detail: string; toolId?: string }
  | { type: 'turn-finished'; outcome: 'completed' | 'stopped' | 'failed'; usage: AgentUsage };

/**
 * The one code this app raises itself.
 *
 * Every other code in a `failed` event comes from the server's own list. This
 * one says the browser never reached openrunic at all, which is a different
 * fact from the model endpoint being down and reads differently to the person
 * waiting.
 */
export const AGENT_TRANSPORT_FAILED = 'AGENT_TRANSPORT_FAILED';

type Row = Record<string, unknown>;

function isRow(value: unknown): value is Row {
  return typeof value === 'object' && value !== null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function optionalToolId(value: unknown): { toolId?: string } {
  const toolId = str(value);
  return toolId === null ? {} : { toolId };
}

function parseSource(value: unknown): AgentSource | null {
  if (!isRow(value)) return null;
  const resourceType = str(value.resourceType);
  const resourceId = str(value.resourceId);
  const label = str(value.label);
  if (resourceType === null || resourceId === null || label === null) return null;
  return { resourceType, resourceId, label, untrusted: value.untrusted === true };
}

function parseEffect(value: unknown): { label: string; value: string }[] {
  if (!Array.isArray(value)) return [];
  const fields: { label: string; value: string }[] = [];
  for (const entry of value) {
    if (!isRow(entry)) continue;
    const label = str(entry.label);
    const text = str(entry.value);
    if (label !== null && text !== null) fields.push({ label, value: text });
  }
  return fields;
}

/**
 * One parser per event, keyed by its own type.
 *
 * A table rather than a switch so an unknown type is a missing key - the same
 * "ignore it" answer as a malformed known one - instead of a default branch
 * that has to be remembered.
 */
const PARSERS: Record<string, (row: Row) => AgentEvent | null> = {
  'turn-started': (row) => {
    const agentRunId = str(row.agentRunId);
    const modelId = str(row.modelId);
    if (agentRunId === null || modelId === null) return null;
    return { type: 'turn-started', agentRunId, modelId, turnIndex: num(row.turnIndex) };
  },
  step: (row) => {
    const label = str(row.label);
    if (label === null) return null;
    return {
      type: 'step',
      label,
      state: row.state === 'done' ? 'done' : 'active',
      ...optionalToolId(row.toolId),
    };
  },
  'text-delta': (row) => {
    const text = str(row.text);
    return text === null ? null : { type: 'text-delta', text };
  },
  sources: (row) => {
    if (!Array.isArray(row.entries)) return null;
    const entries = row.entries
      .map(parseSource)
      .filter((entry): entry is AgentSource => entry !== null);
    return { type: 'sources', entries };
  },
  proposal: (row) => {
    const proposalId = str(row.proposalId);
    const toolId = str(row.toolId);
    if (proposalId === null || toolId === null || !isRow(row.proposal)) return null;
    const kind = str(row.proposal.kind);
    if (kind === null) return null;
    return {
      type: 'proposal',
      proposalId,
      toolId,
      proposal: {
        kind,
        effect: parseEffect(row.proposal.effect),
        derivedFromUntrusted: row.proposal.derivedFromUntrusted === true,
      },
    };
  },
  deferred: (row) => {
    const toolId = str(row.toolId);
    const reason = str(row.reason);
    if (toolId === null || reason === null) return null;
    return { type: 'deferred', toolId, reason };
  },
  failed: (row) => {
    const code = str(row.code);
    const detail = str(row.detail);
    if (code === null || detail === null) return null;
    return { type: 'failed', code, detail, ...optionalToolId(row.toolId) };
  },
  'turn-finished': (row) => {
    const usage = isRow(row.usage) ? row.usage : {};
    return {
      type: 'turn-finished',
      outcome: row.outcome === 'completed' ? 'completed' : 'failed',
      usage: {
        inputTokens: num(usage.inputTokens),
        outputTokens: num(usage.outputTokens),
        costCents: num(usage.costCents),
      },
    };
  },
};

/** Narrows one decoded SSE frame. Returns null for anything this build cannot use. */
export function parseAgentEvent(value: unknown): AgentEvent | null {
  if (!isRow(value)) return null;
  const type = str(value.type);
  if (type === null) return null;
  return PARSERS[type]?.(value) ?? null;
}

function parseTool(value: unknown): AgentToolSummary | null {
  if (!isRow(value)) return null;
  const id = str(value.id);
  const summary = str(value.summary);
  if (id === null || summary === null) return null;
  return {
    id,
    summary,
    tier: str(value.tier) ?? 'READ',
    approval: str(value.approval) ?? 'always',
    requiredScopes: Array.isArray(value.requiredScopes)
      ? value.requiredScopes.filter((scope): scope is string => typeof scope === 'string')
      : [],
  };
}

/**
 * Narrows the capabilities body.
 *
 * A body that does not carry a model identity is not a usable assistant, so it
 * reads as absent rather than as a half-configured one. The surface then
 * renders nothing, which is the state ADR-0005 asks for when there is any doubt.
 */
export function parseAgentCapabilities(value: unknown): AgentCapabilities | null {
  if (!isRow(value) || !isRow(value.model)) return null;
  const modelId = str(value.model.modelId);
  const endpointHost = str(value.model.endpointHost);
  if (modelId === null || endpointHost === null) return null;

  return {
    model: {
      modelId,
      endpointHost,
      remote: value.model.remote === true,
      dataLeavesDeployment: value.model.dataLeavesDeployment === true,
    },
    tools: Array.isArray(value.tools)
      ? value.tools.map(parseTool).filter((tool): tool is AgentToolSummary => tool !== null)
      : [],
  };
}
