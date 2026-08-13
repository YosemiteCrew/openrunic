import { randomUUID } from 'node:crypto';

import {
  isToolError,
  proposalResultSchema,
  resolveTool,
  resolveTools,
  type AgentCredential,
  type AgentPrincipal,
  type AgentTool,
  type ApiClient,
  type ToolAllowlist,
  type ToolRegistry,
} from '@openrunic/agent-tools';
import { z } from 'zod';

import type { ApprovalRegistry, ApprovalToken } from './approval.js';
import {
  toolCallAuditEvent,
  turnAuditEvent,
  type AgentAuditSink,
  type AgentDecision,
  type AgentMode,
  type AuditMetadataValue,
  type TranscriptStore,
} from './audit.js';
import { costInCents, type BudgetGuard } from './budget.js';
import { createEventChannel, type EventChannel } from './channel.js';
import { DEFAULT_BUDGET, type AgentBudgetConfig } from './config.js';
import type { AgentEvent, SourceLedgerEntry } from './events.js';
import { hashOf } from './hash.js';
import type {
  ModelClient,
  ModelToolCall,
  ModelToolSpec,
  ModelTurnMessage,
} from './model-client.js';
import { planDegradation, type ModelProfile } from './model-profile.js';
import {
  PROMPT_TEMPLATE_VERSION,
  READER_TEMPLATE_ID,
  WRITER_TEMPLATE_ID,
  readerSystemPrompt,
  toolManifestVersion,
  writerSystemPrompt,
} from './prompt.js';
import { toTypedChannel } from './typed-channel.js';

/**
 * The loop, and every compliance property in the design visible in one file
 * without learning a framework's callback lifecycle. That is why it is written
 * rather than adopted.
 *
 * What it owns, in the order it enforces them:
 *
 * 1. **Budget and concurrency.** Admission happens before the provider is
 *    contacted, and one turn at a time per principal, because concurrency is
 *    how a single user turns a rate limit into a cost event.
 * 2. **The reader/writer split.** Two phases, two disjoint tool sets, two
 *    disjoint contexts. The reader may see untrusted record text and holds no
 *    state-changing tool; only ids, codes, enums, numbers and dates cross into
 *    the writer. An injection in the reader produces a wrong answer, which is
 *    bad, but it cannot produce an action, because the reader has none.
 * 3. **Deny by default.** A tool the caller was not granted was never
 *    advertised, and asking for it anyway is a guardrail block with its own
 *    audit record.
 * 4. **Approval.** Every write tool produces a proposal plus a single-use token
 *    bound by HMAC to the exact input. Nothing executes inside a turn.
 * 5. **Audit.** One chained event per turn, one per state-changing call, one
 *    per denial, with the delegating human as the actor of record and the agent
 *    recorded immutably beside them.
 */

export type TurnCaps = Pick<
  AgentBudgetConfig,
  'maxToolCallsPerTurn' | 'wallClockMs' | 'maxStepsPerTurn'
>;

export interface AgentRuntimeOptions {
  registry: ToolRegistry;
  profile: ModelProfile;
  client: ModelClient;
  api: ApiClient;
  approvals: ApprovalRegistry;
  budget: BudgetGuard;
  audit: AgentAuditSink;
  transcripts: TranscriptStore;
  allowlist?: ToolAllowlist;
  caps?: TurnCaps;
  /** Cents per million tokens, from the deployer's own contract. Zero for a local endpoint. */
  rate?: { inputCentsPerMillion: number; outputCentsPerMillion: number };
  now?: () => number;
  newId?: () => string;
}

export interface AgentTurnRequest {
  principal: AgentPrincipal;
  credential: AgentCredential;
  /** The user's own words, and the only free text the writer ever sees. */
  message: string;
  turnIndex: number;
  /**
   * `read` runs the reader alone, which is what the one-shot command surface
   * uses. `propose` additionally runs the writer, which can only ever produce a
   * proposal for a human to confirm.
   */
  mode?: Extract<AgentMode, 'read' | 'propose'>;
  agentRunId?: string;
  /** Whether the surface displayed the standing disclosure. Evidence, so it is recorded. */
  disclosureShown?: boolean;
  signal?: AbortSignal;
}

export interface ApproveRequest {
  token: ApprovalToken;
  /** The input the caller believes it is approving. Compared against the bound hash. */
  input: unknown;
  approver: AgentPrincipal;
  credential: AgentCredential;
  now?: number;
}

export type ApproveResult =
  { ok: true; committed: unknown } | { ok: false; code: string; detail: string };

interface ExecutedCall {
  call: ModelToolCall;
  output: unknown;
}

interface PhaseOutcome {
  text: string;
  executed: ExecutedCall[];
  usage: { inputTokens: number; outputTokens: number };
  aborted: boolean;
}

interface PhaseRequest {
  agentRunId: string;
  request: AgentTurnRequest;
  mode: AgentMode;
  phase: 'reader' | 'writer';
  tools: readonly AgentTool[];
  system: string;
  messages: ModelTurnMessage[];
  deadline: number;
}

/** One repair round-trip on malformed arguments, then fail closed. Never guess. */
const MAX_REPAIRS = 1;

export class AgentLoop {
  private readonly options: AgentRuntimeOptions;
  private readonly caps: TurnCaps;
  private readonly now: () => number;
  private readonly newId: () => string;

  constructor(options: AgentRuntimeOptions) {
    this.options = options;
    this.caps = options.caps ?? DEFAULT_BUDGET;
    this.now = options.now ?? ((): number => Date.now());
    this.newId = options.newId ?? ((): string => randomUUID());
  }

  /** Which tools this caller can see. Also the answer the capabilities route serves. */
  visibleTools(principal: AgentPrincipal): AgentTool[] {
    return resolveTools(this.options.registry, principal, {
      ...(this.options.allowlist === undefined ? {} : { allowlist: this.options.allowlist }),
      maxToolsExposed: this.options.profile.limits.maxToolsExposed,
    });
  }

  /** Runs one turn, emitting events as they happen rather than in a batch at the end. */
  async *run(request: AgentTurnRequest): AsyncGenerator<AgentEvent> {
    const channel = createEventChannel<AgentEvent>();
    const work = this.execute(request, channel).then(
      () => {
        channel.close();
      },
      (error: unknown) => {
        channel.fail(error);
      }
    );

    yield* channel.stream();
    await work;
  }

  private async execute(request: AgentTurnRequest, out: EventChannel<AgentEvent>): Promise<void> {
    const { principal } = request;
    const agentRunId = request.agentRunId ?? this.newId();
    const mode: AgentMode = request.mode ?? 'read';
    const principalKey = `${principal.tenantId}:${principal.userId}`;
    const startedAt = this.now();

    const admission = this.options.budget.admit({
      tenantId: principal.tenantId,
      principalKey,
      characters: request.message.length,
      turnIndex: request.turnIndex,
      now: startedAt,
    });

    if (!admission.ok) {
      out.push({
        type: 'failed',
        code: admission.reason.endsWith('budget-exhausted')
          ? 'AGENT_QUOTA_EXCEEDED'
          : 'AGENT_TURN_LIMIT',
        detail: admission.detail,
      });
      await this.emitTurnAudit({
        agentRunId,
        request,
        mode,
        decision: 'refused',
        outcome: 'failure',
        usage: { inputTokens: 0, outputTokens: 0 },
        costCents: 0,
        latencyMs: 0,
        retrievalSet: [],
        transcriptHash: '',
        guardrailRuleId: admission.reason,
      });
      out.push({
        type: 'turn-finished',
        outcome: 'failed',
        usage: { inputTokens: 0, outputTokens: 0, costCents: 0 },
      });
      return;
    }

    try {
      out.push({
        type: 'turn-started',
        agentRunId,
        turnIndex: request.turnIndex,
        modelId: this.options.profile.id,
      });

      const deadline = startedAt + this.caps.wallClockMs;
      const readerTools = this.toolsFor(principal, 'reader');
      const readOutcome = await this.runPhase(
        {
          agentRunId,
          request,
          mode,
          phase: 'reader',
          tools: readerTools,
          system: readerSystemPrompt(principal, readerTools),
          messages: [{ role: 'user', text: request.message }],
          deadline,
        },
        out
      );

      const ledger = sourceLedger(readOutcome.executed);
      if (ledger.length > 0) out.push({ type: 'sources', entries: ledger });

      let usage = readOutcome.usage;
      let proposals = 0;

      if (mode === 'propose' && !readOutcome.aborted) {
        const writerTools = this.toolsFor(principal, 'writer');
        if (writerTools.length > 0) {
          // The only two things that cross this line: the user's own words, and
          // the typed projection of what the reader retrieved. No record text,
          // no reader prose, nothing that failed the filter.
          const writeOutcome = await this.runPhase(
            {
              agentRunId,
              request,
              mode,
              phase: 'writer',
              tools: writerTools,
              system: writerSystemPrompt(principal, writerTools),
              messages: [
                { role: 'user', text: request.message },
                ...typedFacts(readOutcome.executed),
              ],
              deadline,
            },
            out
          );

          usage = {
            inputTokens: usage.inputTokens + writeOutcome.usage.inputTokens,
            outputTokens: usage.outputTokens + writeOutcome.usage.outputTokens,
          };

          for (const executed of writeOutcome.executed) {
            const event = this.emitProposal(agentRunId, principal, executed);
            if (event !== undefined) {
              proposals += 1;
              out.push(event);
            } else if (isDeferred(executed.output)) {
              out.push({
                type: 'deferred',
                toolId: executed.call.toolName,
                reason: executed.output.reason,
              });
            }
          }
        }
      }

      const costCents = this.charge(principal.tenantId, usage);
      const transcriptHash = await this.options.transcripts.put({
        agentRunId,
        turnIndex: request.turnIndex,
        tenantId: principal.tenantId,
        renderedPrompt: request.message,
        completion: readOutcome.text,
        toolCalls: readOutcome.executed.map((executed) => ({
          toolId: executed.call.toolName,
          input: executed.call.input,
          output: executed.output,
        })),
      });

      await this.emitTurnAudit({
        agentRunId,
        request,
        mode,
        decision: decisionFor(readOutcome, proposals),
        outcome: readOutcome.aborted ? 'failure' : 'success',
        usage,
        costCents,
        latencyMs: this.now() - startedAt,
        retrievalSet: ledger.map((entry) => `${entry.resourceType}/${entry.resourceId}`),
        transcriptHash,
      });

      out.push({
        type: 'turn-finished',
        outcome: readOutcome.aborted ? 'failed' : 'completed',
        usage: { ...usage, costCents },
      });
    } finally {
      this.options.budget.release(principalKey);
    }
  }

  /** One phase: model, tool calls, model again, until it stops asking or a cap fires. */
  private async runPhase(
    phase: PhaseRequest,
    out: EventChannel<AgentEvent>
  ): Promise<PhaseOutcome> {
    const { profile } = this.options;
    const plan = planDegradation(profile);
    const specs = phase.tools.map(toModelToolSpec);
    const messages = [...phase.messages];
    const executed: ExecutedCall[] = [];

    let text = '';
    let inputTokens = 0;
    let outputTokens = 0;
    let repairs = 0;
    let textOnlyRetries = 0;
    let toolCallCount = 0;

    for (
      let step = 0;
      step < Math.min(profile.limits.maxSteps, this.caps.maxStepsPerTurn);
      step += 1
    ) {
      if (this.now() > phase.deadline) {
        out.push({
          type: 'failed',
          code: 'AGENT_TURN_LIMIT',
          detail: 'The assistant ran past the time a turn is allowed and was stopped.',
        });
        return { text, executed, usage: { inputTokens, outputTokens }, aborted: true };
      }

      const response = await this.options.client.generate(
        {
          system: phase.system,
          messages,
          tools: specs,
          maxOutputTokens: profile.limits.maxOutputTokens,
          // Only ever requested where the profile says the endpoint honours it.
          // A loop that relies on a forced call degrades silently on a
          // compatibility layer that drops the parameter.
          ...(profile.supports.toolChoice && phase.phase === 'writer' && step === 0
            ? { toolChoice: 'required' as const }
            : {}),
        },
        {
          ...(phase.request.signal === undefined ? {} : { signal: phase.request.signal }),
          // Prose streams. Structured output does not: a half-rendered sentence
          // is harmless, a half-rendered medication list is a misreading hazard.
          ...(phase.phase === 'reader'
            ? {
                onTextDelta: (delta: string): void => {
                  out.push({ type: 'text-delta', text: delta });
                },
              }
            : {}),
        }
      );

      inputTokens += response.usage.inputTokens;
      outputTokens += response.usage.outputTokens;
      if (response.text !== '') text = response.text;

      if (response.toolCalls.length === 0) {
        if (
          phase.phase === 'writer' &&
          plan.tolerateTextOnlyTurn &&
          textOnlyRetries < 1 &&
          executed.length === 0
        ) {
          // The endpoint cannot be told to call a tool, so a text-only turn is
          // expected rather than exceptional. Re-prompt once, then stop.
          textOnlyRetries += 1;
          messages.push({
            role: 'user',
            text: 'Reply by calling one of the available tools, or say plainly that no change is needed.',
          });
          continue;
        }
        break;
      }

      toolCallCount += response.toolCalls.length;
      if (toolCallCount > this.caps.maxToolCallsPerTurn) {
        out.push({
          type: 'failed',
          code: 'AGENT_TURN_LIMIT',
          detail: 'The assistant asked for more steps than a turn allows and was stopped.',
        });
        return { text, executed, usage: { inputTokens, outputTokens }, aborted: true };
      }

      for (const call of response.toolCalls) {
        const tool = resolveTool(this.options.registry, phase.request.principal, call.toolName, {
          ...(this.options.allowlist === undefined ? {} : { allowlist: this.options.allowlist }),
          trustClass: phase.phase,
        });

        if (tool === undefined) {
          // Deny by default. This tool was never advertised to this caller on
          // this surface, so asking for it is a guardrail event.
          out.push({
            type: 'failed',
            code: 'AGENT_SCOPE_DENIED',
            detail: 'The assistant asked for a capability it does not have here.',
            toolId: call.toolName,
          });
          await this.emitToolAudit(phase, call, 'blocked_by_guardrail', 'failure', {
            guardrailRuleId: 'tool-not-granted',
          });
          messages.push(toolResultMessage(call, { error: 'unknown tool' }));
          continue;
        }

        out.push({ type: 'step', label: tool.activityLabel, state: 'active', toolId: tool.id });

        try {
          const output = await tool.run(call.input, {
            principal: phase.request.principal,
            credential: phase.request.credential,
            api: this.options.api,
            ...(phase.request.signal === undefined ? {} : { signal: phase.request.signal }),
          });

          executed.push({ call, output });
          out.push({ type: 'step', label: tool.activityLabel, state: 'done', toolId: tool.id });
          await this.emitToolAudit(
            phase,
            call,
            tool.sideEffect === 'write' ? 'proposed' : 'auto',
            'success',
            { resultIds: resultIdsOf(output) }
          );
          messages.push(toolResultMessage(call, output));
        } catch (error) {
          const code = isToolError(error) ? error.code : 'AGENT_TOOL_FAILED';

          if (isToolError(error) && error.abortsTurn) {
            // A row from another organisation, or outside the open chart. The
            // turn stops. It is never filtered out and carried on with, because
            // a silent filter hides the bug that produced it.
            out.push({ type: 'failed', code, detail: error.message, toolId: tool.id });
            await this.emitToolAudit(phase, call, 'blocked_by_guardrail', 'failure', {
              guardrailRuleId: 'compartment',
            });
            return { text, executed, usage: { inputTokens, outputTokens }, aborted: true };
          }

          if (code === 'AGENT_TOOL_INPUT_INVALID' && repairs < MAX_REPAIRS) {
            repairs += 1;
            messages.push(
              toolResultMessage(call, {
                error: 'invalid arguments',
                detail: 'The arguments did not match the schema. One more attempt is allowed.',
              })
            );
            continue;
          }

          out.push({
            type: 'failed',
            code,
            detail: isToolError(error) ? error.message : 'That step could not be completed.',
            toolId: tool.id,
          });
          await this.emitToolAudit(phase, call, 'refused', 'failure', {});
          messages.push(toolResultMessage(call, { error: 'failed' }));
        }
      }
    }

    return { text, executed, usage: { inputTokens, outputTokens }, aborted: false };
  }

  /**
   * Approves a pending proposal and commits it through the same endpoint the
   * human interface calls, with the **approver's** credential.
   *
   * The verification is the control. The token is bound to the exact input, so
   * an approved call cannot be replayed with different arguments; it is single
   * use, so a re-proposal needs a fresh confirmation; and the approver must
   * independently hold the permission, inside the same organisation. A model is
   * never an approver, because a model never holds a session.
   */
  async approve(request: ApproveRequest): Promise<ApproveResult> {
    const verdict = this.options.approvals.approve({
      token: request.token,
      input: request.input,
      approver: request.approver,
      ...(request.now === undefined ? {} : { now: request.now }),
    });

    if (!verdict.ok) {
      await this.options.audit.record(
        toolCallAuditEvent({
          agentRunId: 'unattributed',
          principal: request.approver,
          mode: 'execute',
          modelId: this.options.profile.id,
          endpointHost: hostOf(this.options.profile.baseUrl),
          egressed: this.options.profile.phiEgress !== 'none',
          toolId: 'agent.approval',
          toolArgsHash: hashOf(request.input),
          argSummary: {},
          resultCount: 0,
          resultIds: [],
          decision: 'blocked_by_guardrail',
          outcome: 'failure',
          guardrailRuleId: verdict.reason,
        })
      );
      return {
        ok: false,
        code: 'AGENT_APPROVAL_INVALID',
        detail: `That confirmation is no longer valid (${verdict.reason}). Ask for it again.`,
      };
    }

    const { commit } = verdict.proposal.proposal;
    const approvedAt = request.now ?? this.now();
    const shared = {
      agentRunId: verdict.proposal.agentRunId,
      principal: request.approver,
      mode: 'execute' as const,
      modelId: this.options.profile.id,
      endpointHost: hostOf(this.options.profile.baseUrl),
      egressed: this.options.profile.phiEgress !== 'none',
      toolId: verdict.proposal.toolId,
      toolArgsHash: verdict.proposal.inputHash,
      argSummary: { proposalKind: verdict.proposal.proposal.kind },
      decision: 'approved' as const,
      approverUserId: request.approver.userId,
      approvedAt,
    };

    try {
      const committed = await this.options.api.call(
        { method: commit.method, path: commit.path, body: commit.body },
        { principal: request.approver, credential: request.credential }
      );

      await this.options.audit.record(
        toolCallAuditEvent({
          ...shared,
          resultCount: 1,
          resultIds: verdict.proposal.proposal.affects.map((ref) => ref.id),
          outcome: 'success',
        })
      );
      return { ok: true, committed };
    } catch (error) {
      await this.options.audit.record(
        toolCallAuditEvent({ ...shared, resultCount: 0, resultIds: [], outcome: 'failure' })
      );
      return {
        ok: false,
        code: 'AGENT_TOOL_FAILED',
        detail: isToolError(error) ? error.message : 'The change could not be saved.',
      };
    }
  }

  /** Rejection is an outcome, audited as loudly as an approval. */
  async reject(proposalId: string, principal: AgentPrincipal): Promise<boolean> {
    const proposal = this.options.approvals.reject(proposalId);
    if (proposal === undefined) return false;

    await this.options.audit.record(
      toolCallAuditEvent({
        agentRunId: proposal.agentRunId,
        principal,
        mode: 'propose',
        modelId: this.options.profile.id,
        endpointHost: hostOf(this.options.profile.baseUrl),
        egressed: this.options.profile.phiEgress !== 'none',
        toolId: proposal.toolId,
        toolArgsHash: proposal.inputHash,
        argSummary: { proposalKind: proposal.proposal.kind },
        resultCount: 0,
        resultIds: [],
        decision: 'rejected',
        outcome: 'success',
        approverUserId: principal.userId,
      })
    );
    return true;
  }

  private toolsFor(principal: AgentPrincipal, trustClass: 'reader' | 'writer'): AgentTool[] {
    return resolveTools(this.options.registry, principal, {
      ...(this.options.allowlist === undefined ? {} : { allowlist: this.options.allowlist }),
      trustClass,
      maxToolsExposed: this.options.profile.limits.maxToolsExposed,
    });
  }

  private emitProposal(
    agentRunId: string,
    principal: AgentPrincipal,
    executed: ExecutedCall
  ): AgentEvent | undefined {
    const parsed = proposalResultSchema.safeParse(executed.output);
    if (!parsed.success) return undefined;

    const tool = this.options.registry.byId(executed.call.toolName);
    const { proposal, token } = this.options.approvals.register({
      agentRunId,
      principal,
      toolId: executed.call.toolName,
      input: executed.call.input,
      proposal: parsed.data.proposal,
      requiredScopes: tool?.requiredScopes ?? [],
      now: this.now(),
    });

    return {
      type: 'proposal',
      proposalId: proposal.proposalId,
      toolId: executed.call.toolName,
      proposal: parsed.data.proposal,
      approvalSignature: token.signature,
    };
  }

  private charge(tenantId: string, usage: { inputTokens: number; outputTokens: number }): number {
    const rate = this.options.rate ?? { inputCentsPerMillion: 0, outputCentsPerMillion: 0 };
    const cents = costInCents(usage, rate);
    this.options.budget.charge(tenantId, cents, this.now());
    return cents;
  }

  private async emitToolAudit(
    phase: Pick<PhaseRequest, 'agentRunId' | 'request' | 'mode'>,
    call: ModelToolCall,
    decision: AgentDecision,
    outcome: 'success' | 'failure',
    extra: { guardrailRuleId?: string; resultIds?: readonly string[] }
  ): Promise<void> {
    const argSummary: Record<string, AuditMetadataValue> = {};
    await this.options.audit.record(
      toolCallAuditEvent({
        agentRunId: phase.agentRunId,
        principal: phase.request.principal,
        mode: phase.mode,
        modelId: this.options.profile.id,
        endpointHost: hostOf(this.options.profile.baseUrl),
        egressed: this.options.profile.phiEgress !== 'none',
        toolId: call.toolName,
        toolArgsHash: hashOf(call.input),
        argSummary,
        resultCount: extra.resultIds?.length ?? 0,
        resultIds: extra.resultIds ?? [],
        decision,
        outcome,
        ...(extra.guardrailRuleId === undefined ? {} : { guardrailRuleId: extra.guardrailRuleId }),
      })
    );
  }

  private async emitTurnAudit(input: {
    agentRunId: string;
    request: AgentTurnRequest;
    mode: AgentMode;
    decision: AgentDecision;
    outcome: 'success' | 'failure';
    usage: { inputTokens: number; outputTokens: number };
    costCents: number;
    latencyMs: number;
    retrievalSet: readonly string[];
    transcriptHash: string;
    guardrailRuleId?: string;
  }): Promise<void> {
    const { principal } = input.request;
    const readTools = this.toolsFor(principal, 'reader');
    const writeTools = this.toolsFor(principal, 'writer');
    const proposing = input.mode === 'propose';

    await this.options.audit.record(
      turnAuditEvent({
        agentRunId: input.agentRunId,
        turnIndex: input.request.turnIndex,
        principal,
        mode: input.mode,
        decision: input.decision,
        modelId: this.options.profile.id,
        endpointHost: hostOf(this.options.profile.baseUrl),
        egressed: this.options.profile.phiEgress !== 'none',
        promptTemplateId: proposing ? WRITER_TEMPLATE_ID : READER_TEMPLATE_ID,
        promptTemplateVersion: PROMPT_TEMPLATE_VERSION,
        systemPromptHash: hashOf(
          proposing
            ? writerSystemPrompt(principal, writeTools)
            : readerSystemPrompt(principal, readTools)
        ),
        toolManifestVersion: toolManifestVersion([...readTools, ...writeTools]),
        transcriptHash: input.transcriptHash,
        inputTokens: input.usage.inputTokens,
        outputTokens: input.usage.outputTokens,
        costCents: input.costCents,
        latencyMs: input.latencyMs,
        retrievalSet: input.retrievalSet,
        disclosureShown: input.request.disclosureShown ?? true,
        outcome: input.outcome,
        ...(input.guardrailRuleId === undefined ? {} : { guardrailRuleId: input.guardrailRuleId }),
      })
    );
  }
}

function isDeferred(value: unknown): value is { status: 'deferred'; reason: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { status?: unknown }).status === 'deferred'
  );
}

function toModelToolSpec(tool: AgentTool): ModelToolSpec {
  return {
    name: tool.id,
    description: tool.summary,
    parameters: z.toJSONSchema(tool.inputSchema, { io: 'input', unrepresentable: 'any' }),
  };
}

function toolResultMessage(call: ModelToolCall, output: unknown): ModelTurnMessage {
  return {
    role: 'tool-result',
    toolCallId: call.toolCallId,
    toolName: call.toolName,
    output,
  };
}

/**
 * What the turn saw, which is a different question from what it cited. The gap
 * between the two is where omission errors live, and omission is the dominant
 * failure mode of summarising a chart.
 */
export function sourceLedger(executed: readonly ExecutedCall[]): SourceLedgerEntry[] {
  const entries: SourceLedgerEntry[] = [];
  for (const { output } of executed) {
    const parsed = ledgerShape.safeParse(output);
    if (!parsed.success) continue;
    for (const row of parsed.data.rows) {
      entries.push({
        resourceType: row.source.resourceType,
        resourceId: row.source.resourceId,
        label: row.label,
        untrusted: UNTRUSTED_RESOURCES.includes(row.source.resourceType),
      });
    }
  }
  return entries;
}

const ledgerShape = z.object({
  rows: z.array(
    z.object({
      label: z.string(),
      source: z.object({ resourceType: z.string(), resourceId: z.string() }),
    })
  ),
});

/** Content a patient or an outside party authored. Marked, and never trusted. */
const UNTRUSTED_RESOURCES: readonly string[] = [
  'Message',
  'Document',
  'ClinicalNote',
  'Observation',
];

function resultIdsOf(output: unknown): string[] {
  const parsed = ledgerShape.safeParse(output);
  return parsed.success ? parsed.data.rows.map((row) => row.source.resourceId) : [];
}

/**
 * The typed channel, as messages.
 *
 * Everything the reader retrieved, projected down to ids, codes, enums,
 * numbers and dates. Prose does not survive, which is what makes the
 * reader/writer split structural rather than a matter of instruction.
 */
export function typedFacts(executed: readonly ExecutedCall[]): ModelTurnMessage[] {
  const facts = executed
    .map((entry) => toTypedChannel(entry.output))
    .filter((value) => value !== undefined);

  if (facts.length === 0) return [];
  return [
    {
      role: 'user',
      text: `Values read from the record, already checked. Use only these:\n${JSON.stringify(facts)}`,
    },
  ];
}

function decisionFor(outcome: PhaseOutcome, proposals: number): AgentDecision {
  if (outcome.aborted) return 'blocked_by_guardrail';
  if (proposals > 0) return 'proposed';
  if (outcome.executed.length === 0) return 'abstained';
  return 'auto';
}

function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return 'unknown';
  }
}
