import type { AgentModelConfig } from './config.js';
import type { ExplicitLanguageModel } from './model-profile.js';
import type { ProviderFetch } from './provider.js';

/**
 * Provider registry - the provider-neutral execution boundary.
 *
 * The agent loop must never know which provider it is talking to. It only
 * ever sees an {@link ExplicitLanguageModel}. This registry lets deployers
 * register new providers without touching the agent loop, the approval flow,
 * the audit chain or any screen. A new provider is one function that returns
 * an {@link ExplicitLanguageModel} given a config and optional fetch/headers.
 *
 * Two providers ship with the product:
 * - 'openai-compatible' - any endpoint speaking the OpenAI chat completions API
 * - 'anthropic' - Anthropic's native API
 *
 * A deployer who needs Azure OpenAI, AWS Bedrock, Google Vertex, Cohere or
 * a custom gateway adds one entry here at startup and nothing else changes.
 * No workflow, permission or screen is touched.
 */

export interface ProviderFactoryOptions {
  /** Injected in tests and by the conformance runner. Never a default that phones anywhere. */
  fetch?: typeof globalThis.fetch;
  headers?: Record<string, string>;
}

export type ProviderFactory = (
  config: ProviderFactoryConfig,
  options?: ProviderFactoryOptions
) => ExplicitLanguageModel;

export interface ProviderFactoryConfig {
  providerKind: string;
  baseUrl: string;
  modelId: string;
  apiKey?: string;
  phiEgress: 'none' | 'configured-baa' | 'unreviewed';
  egressAcknowledgement?: {
    agreement: string;
    responsibleParty: string;
  };
}

/** The built-in providers. Extend this map to add custom providers. */
export const builtInProviders: Map<string, ProviderFactory> = new Map([
  ['openai-compatible', createOpenAICompatibleFactory],
  ['anthropic', createAnthropicFactory],
]);

/** Register a custom provider. Call this at startup before the agent subsystem loads. */
export function registerProvider(kind: string, factory: ProviderFactory): void {
  if (builtInProviders.has(kind)) {
    throw new Error(`Provider kind "${kind}" is already registered.`);
  }
  builtInProviders.set(kind, factory);
}

/** Resolve a provider by kind using the registry. */
export function resolveProviderFromRegistry(
  config: ProviderFactoryConfig,
  options?: ProviderFactoryOptions
): ExplicitLanguageModel {
  const factory = builtInProviders.get(config.providerKind);
  if (!factory) {
    const available = Array.from(builtInProviders.keys()).join(', ');
    throw new Error(
      `Unknown provider kind "${config.providerKind}". Available: ${available}. ` +
        `Register a custom provider with registerProvider().`
    );
  }
  return factory(config, options);
}

/** OpenAI-compatible factory (OpenAI, vLLM, Ollama, LocalAI, etc.). */
function createOpenAICompatibleFactory(
  config: ProviderFactoryConfig,
  options?: ProviderFactoryOptions
): ExplicitLanguageModel {
  const { createOpenAICompatible } = require('@ai-sdk/openai-compatible');
  const baseUrl = config.baseUrl.replace(/\/+$/, '');
  if (baseUrl === '') {
    throw new Error('resolveProvider: a base URL is required. There is no default endpoint.');
  }
  return createOpenAICompatible({
    name: 'openrunic-deployer-endpoint',
    baseURL: baseUrl,
    ...(config.apiKey === undefined ? {} : { apiKey: config.apiKey }),
    ...(options?.headers === undefined ? {} : { headers: options.headers }),
    ...(options?.fetch === undefined ? {} : { fetch: options.fetch }),
  }).chatModel(config.modelId);
}

/** Anthropic factory. */
function createAnthropicFactory(
  config: ProviderFactoryConfig,
  options?: ProviderFactoryOptions
): ExplicitLanguageModel {
  const { createAnthropic } = require('@ai-sdk/anthropic');
  const baseUrl = config.baseUrl.replace(/\/+$/, '');
  if (baseUrl === '') {
    throw new Error('resolveProvider: a base URL is required. There is no default endpoint.');
  }
  return createAnthropic({
    baseURL: baseUrl,
    apiKey: config.apiKey ?? '',
    ...(options?.headers === undefined ? {} : { headers: options.headers }),
    ...(options?.fetch === undefined ? {} : { fetch: options.fetch }),
  })(config.modelId);
}
