/**
 * `@openrunic/agent`: the loop, and the policy layer that is the reason it is
 * written rather than adopted.
 *
 * Two properties define this package. **The agent is off by default**: with no
 * endpoint configured the product is complete, the routes answer 404 and the
 * surface does not render. And **a bare model string is never permitted**: a
 * provider instance is always constructed with an explicit base URL, banned by
 * lint and asserted by test, because the SDK otherwise routes an unqualified
 * model name through a hosted gateway, which is health-data egress nobody
 * configured.
 */

export { APPROVAL_FAILURES, APPROVAL_TTL_MS, ApprovalRegistry } from './approval.js';
export type {
  ApprovalFailure,
  ApprovalToken,
  ApprovalVerdict,
  PendingProposal,
  RegisterRequest,
} from './approval.js';

export {
  AGENT_DECISIONS,
  AGENT_MODES,
  MAX_METADATA_STRING,
  assertAuditMetadataShape,
  createHashOnlyTranscriptStore,
  createMemoryTranscriptStore,
  toolCallAuditEvent,
  turnAuditEvent,
} from './audit.js';
export type {
  AgentAuditEvent,
  AgentAuditSink,
  AgentDecision,
  AgentMode,
  AuditMetadataValue,
  ToolCallAuditInput,
  TranscriptRecord,
  TranscriptStore,
  TurnAuditInput,
  ViaAgent,
} from './audit.js';

export { BUDGET_REFUSALS, BudgetGuard, costInCents } from './budget.js';
export type { BudgetRefusal, BudgetVerdict } from './budget.js';

export { createEventChannel } from './channel.js';
export type { EventChannel } from './channel.js';

export {
  DEFAULT_BUDGET,
  ENV,
  PHI_EGRESS_POSTURES,
  PROVIDER_KINDS,
  isLocalEndpoint,
  loadAgentSubsystem,
} from './config.js';
export type {
  AgentBudgetConfig,
  AgentConfig,
  AgentModelConfig,
  AgentSubsystem,
  EgressAcknowledgement,
  EnvSource,
  PhiEgress,
  ProviderKind,
} from './config.js';

export { AGENT_ERROR_CODES } from './events.js';
export type { AgentErrorCode, AgentEvent, SourceLedgerEntry } from './events.js';

export { canonicalJson, hashOf } from './hash.js';

export { AgentLoop, sourceLedger, typedFacts } from './loop.js';
export type {
  AgentRuntimeOptions,
  AgentTurnRequest,
  ApproveRequest,
  ApproveResult,
  TurnCaps,
} from './loop.js';

export { createAiSdkModelClient } from './model-client.js';
export type {
  ModelCallOptions,
  ModelClient,
  ModelRequest,
  ModelResponse,
  ModelToolCall,
  ModelToolSpec,
  ModelTurnMessage,
  ModelUsage,
} from './model-client.js';

export {
  CAPABILITY_TIERS,
  CONSERVATIVE_CAPABILITIES,
  DEFAULT_LIMITS,
  MAXIMAL_CAPABILITIES,
  buildModelProfile,
  capabilityTier,
  planDegradation,
} from './model-profile.js';
export type {
  BuildProfileOptions,
  CapabilityTier,
  DegradationPlan,
  ExplicitLanguageModel,
  ModelCapabilities,
  ModelLimits,
  ModelProfile,
} from './model-profile.js';

export {
  PROMPT_TEMPLATE_VERSION,
  READER_TEMPLATE_ID,
  WRITER_TEMPLATE_ID,
  readerSystemPrompt,
  toolManifestVersion,
  writerSystemPrompt,
} from './prompt.js';

export { assertExplicitModel, resolveProvider } from './provider.js';
export type { ProviderFetch, ResolveProviderOptions, ResolvedProvider } from './provider.js';

export { agentIdentity, createAgentRuntime } from './runtime.js';
export type { AgentIdentity, AgentRuntime, CreateAgentRuntimeOptions } from './runtime.js';

export { droppedFieldCount, isTypedToken, toTypedChannel } from './typed-channel.js';

export { CONFORMANCE_CASES, PROBE_FAMILIES, PROBE_TOOLS, parseJson } from './conform/cases.js';
export type { ConformCase, ProbeFamily } from './conform/cases.js';
export { deriveCapabilities, formatReport, runConformance } from './conform/run.js';
export type { CaseResult, ConformReport, RunConformanceOptions } from './conform/run.js';

export {
  compliantAttackerModel,
  scriptedModel,
  unreachableModel,
} from './testing/scripted-model.js';
export type { ScriptedModel, ScriptedStep } from './testing/scripted-model.js';
