import type { LanguageModel } from 'ai';

import type { AgentModelConfig, PhiEgress } from './config.js';

/**
 * One loop, many models.
 *
 * The portability floor is an OpenAI-shaped chat completions route, which every
 * common local server and most hosted vendors expose. That is a claim about URL
 * shape, not about behaviour. What actually varies is forced tool choice,
 * parallel tool calls, the structured-output mechanism, whether the system
 * prompt survives, the context window and the streaming granularity - and a
 * dropped system prompt is a silent safety-policy failure, which is the one
 * failure this design cannot afford.
 *
 * So the loop is written once against the maximal contract, and where a
 * capability is missing a **named, tested fallback** fires. Never a quietly
 * weaker prompt.
 */

/**
 * A model, with the bare-string form removed.
 *
 * `ai`'s own `LanguageModel` type admits a plain string, and a plain string is
 * resolved through a hosted routing gateway. This alias is the type-level half
 * of the ban; `provider.ts` holds the runtime half and `provider.test.ts` holds
 * the proof.
 */
export type ExplicitLanguageModel = Exclude<LanguageModel, string>;

export interface ModelCapabilities {
  /** Can a specific tool call be forced? Several compatibility layers omit this entirely. */
  toolChoice: boolean;
  parallelToolCalls: boolean;
  /**
   * - `strict` uses native constrained decoding.
   * - `json-mode` puts the schema in the prompt, parses, allows exactly one repair retry.
   * - `prompt-only` does the same and then fails closed to the deterministic path
   *   rather than guessing.
   */
  structuredOutput: 'strict' | 'json-mode' | 'prompt-only';
  systemPrompt: 'native' | 'merged';
  reasoning: boolean;
}

export interface ModelLimits {
  /**
   * Small local models degrade badly past roughly ten tools, and the set is
   * role-scoped anyway, so this is an accuracy win and a security win at once.
   */
  maxToolsExposed: number;
  maxSteps: number;
  maxOutputTokens: number;
}

export interface ModelProfile {
  id: string;
  /** An explicit instance. Never a bare string; see {@link ExplicitLanguageModel}. */
  provider: ExplicitLanguageModel;
  /** The endpoint actually contacted, recorded per turn and asserted by test. */
  baseUrl: string;
  contextWindow: number;
  supports: ModelCapabilities;
  limits: ModelLimits;
  /** First-class, validated at config load, recorded in the audit chain. */
  phiEgress: PhiEgress;
}

/** The maximal contract. A profile that meets all of it needs no fallback anywhere. */
export const MAXIMAL_CAPABILITIES: ModelCapabilities = {
  toolChoice: true,
  parallelToolCalls: true,
  structuredOutput: 'strict',
  systemPrompt: 'native',
  reasoning: false,
};

/**
 * The floor a deployer gets before the conformance suite has told them
 * anything. Deliberately pessimistic: assuming a capability the endpoint does
 * not have is how a safety property quietly stops being enforced.
 */
export const CONSERVATIVE_CAPABILITIES: ModelCapabilities = {
  toolChoice: false,
  parallelToolCalls: false,
  structuredOutput: 'prompt-only',
  systemPrompt: 'merged',
  reasoning: false,
};

export const DEFAULT_LIMITS: ModelLimits = {
  maxToolsExposed: 10,
  maxSteps: 5,
  maxOutputTokens: 2048,
};

/** The capability tier a deployer is in, as the conformance suite reports it. */
export const CAPABILITY_TIERS = ['full', 'reduced', 'minimal'] as const;

export type CapabilityTier = (typeof CAPABILITY_TIERS)[number];

/**
 * Grades a profile. This is the sentence the conformance runner prints, and it
 * is what makes "any model" a testable promise rather than a marketing line.
 */
export function capabilityTier(supports: ModelCapabilities): CapabilityTier {
  if (supports.structuredOutput === 'strict' && supports.systemPrompt === 'native') {
    return supports.toolChoice ? 'full' : 'reduced';
  }
  if (supports.structuredOutput === 'json-mode' && supports.systemPrompt === 'native') {
    return 'reduced';
  }
  return 'minimal';
}

/**
 * What the loop must do differently on this profile.
 *
 * The first invariant of the design is that capability degradation **never
 * weakens a safety property**. A weaker model gets fewer tools and more
 * confirmations; it never gets looser approval gating, because approval is
 * enforced in the loop and never by prompting. Nothing in this function can
 * change an approval policy, and there is no field here that could.
 */
export interface DegradationPlan {
  /** Put the schema in the prompt, because the endpoint cannot constrain decoding. */
  describeSchemaInPrompt: boolean;
  /** One repair round-trip, then fail closed to the deterministic path. */
  repairAttempts: number;
  /** Merge the system prompt into the first user message, because it would be dropped. */
  mergeSystemPrompt: boolean;
  /** Tolerate a text-only turn and re-prompt once, because a call cannot be forced. */
  tolerateTextOnlyTurn: boolean;
  /** Fail closed rather than guessing at a structured answer. */
  failClosedOnStructuredOutput: boolean;
  maxToolsExposed: number;
}

export function planDegradation(profile: ModelProfile): DegradationPlan {
  const { supports } = profile;
  return {
    describeSchemaInPrompt: supports.structuredOutput !== 'strict',
    repairAttempts: supports.structuredOutput === 'strict' ? 0 : 1,
    mergeSystemPrompt: supports.systemPrompt === 'merged',
    tolerateTextOnlyTurn: !supports.toolChoice,
    failClosedOnStructuredOutput: supports.structuredOutput === 'prompt-only',
    maxToolsExposed: profile.limits.maxToolsExposed,
  };
}

export interface BuildProfileOptions {
  id?: string;
  contextWindow?: number;
  supports?: Partial<ModelCapabilities>;
  limits?: Partial<ModelLimits>;
}

/** Assembles a profile from a resolved provider and a deployer's declared config. */
export function buildModelProfile(
  provider: ExplicitLanguageModel,
  config: AgentModelConfig,
  options: BuildProfileOptions = {}
): ModelProfile {
  return {
    id: options.id ?? config.modelId,
    provider,
    baseUrl: config.baseUrl,
    contextWindow: options.contextWindow ?? 32_768,
    supports: { ...CONSERVATIVE_CAPABILITIES, ...options.supports },
    limits: { ...DEFAULT_LIMITS, ...options.limits },
    phiEgress: config.phiEgress,
  };
}
