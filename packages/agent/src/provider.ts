import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

import { trimTrailingSlashes } from '@openrunic/agent-tools';
import type { AgentModelConfig } from './config.js';
import type { ExplicitLanguageModel } from './model-profile.js';

/**
 * Provider resolution, and the one trap this package exists to avoid.
 *
 * `ai` accepts a bare model name and, when given one, resolves it through a
 * hosted routing gateway. In a self-hosted, privacy-first EMR that is a silent
 * health-data egress path nobody configured, arriving as one innocuous line of
 * code. Three defences, all of them required:
 *
 * 1. **Types.** {@link ExplicitLanguageModel} removes the string form.
 * 2. **Lint.** `eslint.config.mjs` refuses a literal in a `model` position and
 *    refuses to import the gateway package at all.
 * 3. **Test.** `provider.test.ts` drives a real call through a recording
 *    `fetch` and asserts the URL contacted starts with the configured base URL.
 *    The first two catch a mistake; the third catches the dependency changing
 *    its mind.
 *
 * There is no default base URL, no default provider and no trial key anywhere
 * in this file. The two zero-paperwork configurations openrunic ships are a
 * local OpenAI-compatible endpoint, and nothing.
 */

/** The subset of `fetch` a provider needs. Structurally satisfied by the global one. */
export type ProviderFetch = typeof globalThis.fetch;

export interface ResolvedProvider {
  model: ExplicitLanguageModel;
  /** Echoed back so a caller can assert it, which is exactly what the test does. */
  baseUrl: string;
  modelId: string;
}

export interface ResolveProviderOptions {
  /** Injected in tests and by the conformance runner. Never a default that phones anywhere. */
  fetch?: ProviderFetch;
  headers?: Record<string, string>;
}

export function resolveProvider(
  config: AgentModelConfig,
  options: ResolveProviderOptions = {}
): ResolvedProvider {
  const baseUrl = trimTrailingSlashes(config.baseUrl);
  if (baseUrl === '') {
    throw new Error('resolveProvider: a base URL is required. There is no default endpoint.');
  }

  const model =
    config.providerKind === 'anthropic'
      ? createAnthropic({
          baseURL: baseUrl,
          apiKey: config.apiKey ?? '',
          ...(options.headers === undefined ? {} : { headers: options.headers }),
          ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
        })(config.modelId)
      : createOpenAICompatible({
          // Names the endpoint as the deployer's, not as a vendor's, in every
          // error message the SDK produces.
          name: 'openrunic-deployer-endpoint',
          baseURL: baseUrl,
          ...(config.apiKey === undefined ? {} : { apiKey: config.apiKey }),
          ...(options.headers === undefined ? {} : { headers: options.headers }),
          ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
        }).chatModel(config.modelId);

  return { model: assertExplicitModel(model), baseUrl, modelId: config.modelId };
}

/**
 * Runtime half of the ban.
 *
 * Types stop this at compile time and lint stops it at review time; this stops
 * it when a value arrives from somewhere neither of those saw, such as a
 * deployer's own extension module.
 */
export function assertExplicitModel(model: unknown): ExplicitLanguageModel {
  if (typeof model === 'string') {
    throw new Error(
      'A bare model string routes through a hosted gateway, which is health-data egress nobody configured. Build an explicit provider with an explicit base URL.'
    );
  }
  if (typeof model !== 'object' || model === null) {
    throw new Error('resolveProvider: expected a language model instance.');
  }
  return model as ExplicitLanguageModel;
}
