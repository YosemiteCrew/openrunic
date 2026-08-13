/**
 * Configuration, and the property that matters most: **the agent is off by
 * default**.
 *
 * With no endpoint configured, `loadAgentSubsystem` reports `disabled`, the
 * routes answer 404, the surface does not render, and every clinical workflow
 * is untouched. That is the shipped open-source state, and it is a normal
 * state, not an error one.
 *
 * The second property is named egress. A remote endpoint needs **two
 * independent settings**: the endpoint plus its credential, and a separate
 * acknowledgement naming the executed agreement and the responsible party. One
 * environment variable must not be able to start health data flowing. A remote
 * base URL without the acknowledgement is a hard failure of the agent
 * subsystem, reported loudly, with the rest of the product unaffected.
 */

import { trimTrailingSlashes } from '@openrunic/agent-tools';

/** Where data goes when a turn runs. Validated at load, recorded per turn. */
export const PHI_EGRESS_POSTURES = ['none', 'configured-baa', 'unreviewed'] as const;

export type PhiEgress = (typeof PHI_EGRESS_POSTURES)[number];

export const PROVIDER_KINDS = ['openai-compatible', 'anthropic'] as const;

export type ProviderKind = (typeof PROVIDER_KINDS)[number];

/** Names the paperwork. Free text is fine here: it is deployer-authored, and it is not health data. */
export interface EgressAcknowledgement {
  /** The executed agreement, as the deployer refers to it. */
  agreement: string;
  /** Who at the deployer is answerable for it. */
  responsibleParty: string;
}

export interface AgentModelConfig {
  providerKind: ProviderKind;
  /** Absolute origin, with no trailing slash. Never defaulted, never guessed. */
  baseUrl: string;
  modelId: string;
  apiKey?: string;
  phiEgress: PhiEgress;
  egressAcknowledgement?: EgressAcknowledgement;
}

/**
 * Server-side caps. Provider dashboards are lagging, per-account and not
 * per-tenant; they are a smoke alarm, not a control.
 */
export interface AgentBudgetConfig {
  /** Hard stop per tenant per day, in integer cents, matching the money convention. */
  dailyCostCents: number;
  monthlyCostCents: number;
  /** Soft warning to the administrator, as a fraction of the hard stop. */
  warnAtFraction: number;
  maxStepsPerTurn: number;
  maxToolCallsPerTurn: number;
  maxOutputTokens: number;
  /** Refused above this, never truncated: silent truncation hides an attack. */
  maxInputCharacters: number;
  maxTurnsPerConversation: number;
  wallClockMs: number;
}

export const DEFAULT_BUDGET: AgentBudgetConfig = {
  dailyCostCents: 2000,
  monthlyCostCents: 40_000,
  warnAtFraction: 0.7,
  maxStepsPerTurn: 5,
  maxToolCallsPerTurn: 5,
  maxOutputTokens: 2048,
  maxInputCharacters: 8000,
  maxTurnsPerConversation: 40,
  wallClockMs: 60_000,
};

export interface AgentConfig {
  model: AgentModelConfig;
  budget: AgentBudgetConfig;
  /**
   * Only ever used when the deployer configured it explicitly. A fallback with
   * a different egress posture turns an outage into a breach, so one is
   * refused at load unless it is acknowledged in its own right.
   */
  fallback?: AgentModelConfig;
}

/**
 * The three states the subsystem can be in. `misconfigured` is deliberately
 * distinct from `disabled`: the first is loud and the second is normal.
 */
export type AgentSubsystem =
  | { status: 'disabled'; reason: string }
  | { status: 'misconfigured'; reason: string }
  | { status: 'enabled'; config: AgentConfig };

export const ENV = {
  baseUrl: 'OPENRUNIC_AGENT_BASE_URL',
  modelId: 'OPENRUNIC_AGENT_MODEL',
  apiKey: 'OPENRUNIC_AGENT_API_KEY',
  providerKind: 'OPENRUNIC_AGENT_PROVIDER',
  phiEgress: 'OPENRUNIC_AGENT_PHI_EGRESS',
  acknowledgedAgreement: 'OPENRUNIC_AGENT_PHI_EGRESS_AGREEMENT',
  acknowledgedParty: 'OPENRUNIC_AGENT_PHI_EGRESS_RESPONSIBLE_PARTY',
  dailyBudget: 'OPENRUNIC_AGENT_DAILY_BUDGET_CENTS',
  monthlyBudget: 'OPENRUNIC_AGENT_MONTHLY_BUDGET_CENTS',
  fallbackBaseUrl: 'OPENRUNIC_AGENT_FALLBACK_BASE_URL',
  fallbackModel: 'OPENRUNIC_AGENT_FALLBACK_MODEL',
  fallbackApiKey: 'OPENRUNIC_AGENT_FALLBACK_API_KEY',
  fallbackPhiEgress: 'OPENRUNIC_AGENT_FALLBACK_PHI_EGRESS',
} as const;

export type EnvSource = Readonly<Record<string, string | undefined>>;

/**
 * Reads the subsystem configuration. Total: it reports a state rather than
 * throwing, because a misconfigured assistant must not stop a clinic booking
 * appointments.
 */
export function loadAgentSubsystem(env: EnvSource): AgentSubsystem {
  const baseUrl = trimmed(env[ENV.baseUrl]);
  const modelId = trimmed(env[ENV.modelId]);

  if (baseUrl === undefined && modelId === undefined) {
    return {
      status: 'disabled',
      reason:
        'No inference endpoint is configured. This is the default, and the product is complete without one.',
    };
  }

  if (baseUrl === undefined || modelId === undefined) {
    return {
      status: 'misconfigured',
      reason: `Both ${ENV.baseUrl} and ${ENV.modelId} are required. Half a configuration is not a configuration.`,
    };
  }

  let origin: URL;
  try {
    origin = new URL(baseUrl);
  } catch {
    return { status: 'misconfigured', reason: `${ENV.baseUrl} is not a URL.` };
  }

  const providerKind = trimmed(env[ENV.providerKind]) ?? 'openai-compatible';
  if (!isProviderKind(providerKind)) {
    return {
      status: 'misconfigured',
      reason: `${ENV.providerKind} must be one of ${PROVIDER_KINDS.join(', ')}.`,
    };
  }

  const model = readModel(env, {
    baseUrl: normaliseOrigin(baseUrl),
    modelId,
    providerKind,
    local: isLocalEndpoint(origin),
    keys: {
      phiEgress: ENV.phiEgress,
      apiKey: ENV.apiKey,
      agreement: ENV.acknowledgedAgreement,
      party: ENV.acknowledgedParty,
    },
  });
  if ('reason' in model) return { status: 'misconfigured', reason: model.reason };

  const fallback = readFallback(env);
  if (fallback !== undefined && 'reason' in fallback) {
    return { status: 'misconfigured', reason: fallback.reason };
  }

  if (fallback !== undefined && fallback.phiEgress !== model.phiEgress) {
    return {
      status: 'misconfigured',
      reason:
        'The fallback endpoint has a different egress posture from the primary one. Failing over from a local endpoint to a hosted one turns an outage into a breach, so it must be configured and acknowledged as its own decision.',
    };
  }

  const daily = readInteger(env[ENV.dailyBudget], DEFAULT_BUDGET.dailyCostCents);
  const monthly = readInteger(env[ENV.monthlyBudget], DEFAULT_BUDGET.monthlyCostCents);
  if (daily === undefined || monthly === undefined) {
    return { status: 'misconfigured', reason: 'The budget values must be whole numbers of cents.' };
  }

  return {
    status: 'enabled',
    config: {
      model,
      budget: { ...DEFAULT_BUDGET, dailyCostCents: daily, monthlyCostCents: monthly },
      ...(fallback === undefined ? {} : { fallback }),
    },
  };
}

interface ModelRead {
  baseUrl: string;
  modelId: string;
  providerKind: ProviderKind;
  local: boolean;
  keys: { phiEgress: string; apiKey: string; agreement: string; party: string };
}

function readModel(env: EnvSource, read: ModelRead): AgentModelConfig | { reason: string } {
  const declared = trimmed(env[read.keys.phiEgress]);
  const apiKey = trimmed(env[read.keys.apiKey]);
  const agreement = trimmed(env[read.keys.agreement]);
  const party = trimmed(env[read.keys.party]);

  if (declared !== undefined && !isPhiEgress(declared)) {
    return { reason: `${read.keys.phiEgress} must be one of ${PHI_EGRESS_POSTURES.join(', ')}.` };
  }

  const phiEgress: PhiEgress = declared ?? (read.local ? 'none' : 'unreviewed');

  if (phiEgress === 'unreviewed') {
    return {
      reason: `${read.baseUrl} is not on this deployment's own network, so it must declare ${read.keys.phiEgress}=configured-baa and name the agreement. The agent subsystem will not start; nothing else is affected.`,
    };
  }

  if (phiEgress === 'none' && !read.local) {
    return {
      reason: `${read.keys.phiEgress}=none claims data never leaves the deployment, but ${read.baseUrl} is not on this deployment's own network.`,
    };
  }

  if (phiEgress === 'configured-baa' && (agreement === undefined || party === undefined)) {
    return {
      reason: `Sending health data to ${read.baseUrl} requires ${read.keys.agreement} and ${read.keys.party}. One variable must not be able to start health data flowing.`,
    };
  }

  return {
    providerKind: read.providerKind,
    baseUrl: read.baseUrl,
    modelId: read.modelId,
    ...(apiKey === undefined ? {} : { apiKey }),
    phiEgress,
    ...(agreement === undefined || party === undefined
      ? {}
      : { egressAcknowledgement: { agreement, responsibleParty: party } }),
  };
}

function readFallback(env: EnvSource): AgentModelConfig | { reason: string } | undefined {
  const baseUrl = trimmed(env[ENV.fallbackBaseUrl]);
  const modelId = trimmed(env[ENV.fallbackModel]);
  if (baseUrl === undefined && modelId === undefined) return undefined;
  if (baseUrl === undefined || modelId === undefined) {
    return { reason: `Both ${ENV.fallbackBaseUrl} and ${ENV.fallbackModel} are required.` };
  }

  let origin: URL;
  try {
    origin = new URL(baseUrl);
  } catch {
    return { reason: `${ENV.fallbackBaseUrl} is not a URL.` };
  }

  return readModel(env, {
    baseUrl: normaliseOrigin(baseUrl),
    modelId,
    providerKind: 'openai-compatible',
    local: isLocalEndpoint(origin),
    keys: {
      phiEgress: ENV.fallbackPhiEgress,
      apiKey: ENV.fallbackApiKey,
      agreement: ENV.acknowledgedAgreement,
      party: ENV.acknowledgedParty,
    },
  });
}

/**
 * Whether the endpoint is on the deployment's own network.
 *
 * Deliberately conservative: anything this cannot prove is local is treated as
 * remote, which means the deployer has to make the egress statement explicitly.
 * Guessing in the other direction would let a public endpoint inherit the
 * no-paperwork posture.
 */
export function isLocalEndpoint(url: URL): boolean {
  const host = url.hostname.toLowerCase();

  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]') {
    return true;
  }
  // A bare label with no dot is a container or service name on a private
  // network, which is how a compose deployment addresses its own sidecar.
  if (!host.includes('.') && !host.includes(':')) return true;
  if (host.endsWith('.local') || host.endsWith('.internal')) return true;

  const parts = host.split('.').map((part) => Number.parseInt(part, 10));
  if (parts.length === 4 && parts.every((part) => Number.isInteger(part))) {
    const [a = -1, b = -1] = parts;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
  }

  return false;
}

function normaliseOrigin(value: string): string {
  return trimTrailingSlashes(value);
}

function trimmed(value: string | undefined): string | undefined {
  const text = value?.trim() ?? '';
  return text === '' ? undefined : text;
}

function readInteger(value: string | undefined, fallback: number): number | undefined {
  const text = trimmed(value);
  if (text === undefined) return fallback;
  const parsed = Number.parseInt(text, 10);
  return Number.isInteger(parsed) && parsed >= 0 && String(parsed) === text ? parsed : undefined;
}

function isPhiEgress(value: string): value is PhiEgress {
  return (PHI_EGRESS_POSTURES as readonly string[]).includes(value);
}

function isProviderKind(value: string): value is ProviderKind {
  return (PROVIDER_KINDS as readonly string[]).includes(value);
}
