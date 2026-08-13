import {
  createV1Registry,
  type ApiClient,
  type ToolAllowlist,
  type ToolRegistry,
} from '@openrunic/agent-tools';

import { ApprovalRegistry } from './approval.js';
import {
  createHashOnlyTranscriptStore,
  type AgentAuditSink,
  type TranscriptStore,
} from './audit.js';
import { BudgetGuard } from './budget.js';
import { loadAgentSubsystem, type AgentSubsystem, type EnvSource } from './config.js';
import { AgentLoop } from './loop.js';
import { createAiSdkModelClient, type ModelClient } from './model-client.js';
import { buildModelProfile, type BuildProfileOptions, type ModelProfile } from './model-profile.js';
import { resolveProvider, type ProviderFetch } from './provider.js';

/**
 * Wiring, and the shape of "absent" when nothing is configured.
 *
 * `disabled` is the default open-source state and it is a **normal** state: the
 * routes answer 404 rather than 403, because a 403 tells an attacker the
 * feature exists, and because the honest thing to say about a feature nobody
 * installed is that it is not there. `misconfigured` is loud, and it is the
 * state a remote endpoint without its egress acknowledgement lands in.
 *
 * Both leave the rest of the product completely untouched. That is the whole
 * bargain in ADR-0005: a third-party model outage, an exhausted budget or a
 * botched configuration costs a clinic its assistant and nothing else.
 */

export type AgentRuntime =
  | { status: 'disabled'; reason: string }
  | { status: 'misconfigured'; reason: string }
  | { status: 'enabled'; loop: AgentLoop; profile: ModelProfile; subsystem: AgentSubsystem };

export interface CreateAgentRuntimeOptions {
  env: EnvSource;
  /** The HTTP client tools use. Always carries the end user's own credential. */
  api: ApiClient;
  audit: AgentAuditSink;
  /** At least 32 characters. Approval tokens are signed with it. */
  approvalSecret: string;
  registry?: ToolRegistry;
  allowlist?: ToolAllowlist;
  transcripts?: TranscriptStore;
  /** Injected by tests and by the conformance runner. Never defaulted to anything remote. */
  fetch?: ProviderFetch;
  modelClient?: ModelClient;
  profile?: BuildProfileOptions;
  rate?: { inputCentsPerMillion: number; outputCentsPerMillion: number };
  now?: () => number;
}

export function createAgentRuntime(options: CreateAgentRuntimeOptions): AgentRuntime {
  const subsystem = loadAgentSubsystem(options.env);
  if (subsystem.status !== 'enabled') return subsystem;

  const { config } = subsystem;
  const resolved = resolveProvider(config.model, {
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });

  const profile = buildModelProfile(resolved.model, config.model, options.profile ?? {});
  const loop = new AgentLoop({
    registry: options.registry ?? createV1Registry(),
    profile,
    client: options.modelClient ?? createAiSdkModelClient(profile),
    api: options.api,
    approvals: new ApprovalRegistry(options.approvalSecret),
    budget: new BudgetGuard(config.budget),
    audit: options.audit,
    transcripts: options.transcripts ?? createHashOnlyTranscriptStore(),
    caps: config.budget,
    ...(options.allowlist === undefined ? {} : { allowlist: options.allowlist }),
    ...(options.rate === undefined ? {} : { rate: options.rate }),
    ...(options.now === undefined ? {} : { now: options.now }),
  });

  return { status: 'enabled', loop, profile, subsystem };
}

/**
 * What the surface is told about the model.
 *
 * Provider, model, whether it is remote, and **whether data leaves the
 * deployment**. Shown in the assistant surface rather than buried in an admin
 * screen: it is the information duty, it is trust, and it is the restated
 * no-telemetry promise made visible.
 */
export interface AgentIdentity {
  modelId: string;
  endpointHost: string;
  remote: boolean;
  dataLeavesDeployment: boolean;
  agreement?: string;
}

export function agentIdentity(
  runtime: Extract<AgentRuntime, { status: 'enabled' }>
): AgentIdentity {
  const { model } =
    runtime.subsystem.status === 'enabled' ? runtime.subsystem.config : { model: undefined };

  const host = safeHost(runtime.profile.baseUrl);
  return {
    modelId: runtime.profile.id,
    endpointHost: host,
    remote: runtime.profile.phiEgress !== 'none',
    dataLeavesDeployment: runtime.profile.phiEgress !== 'none',
    ...(model?.egressAcknowledgement === undefined
      ? {}
      : { agreement: model.egressAcknowledgement.agreement }),
  };
}

function safeHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return 'unknown';
  }
}
