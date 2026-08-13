import { describe, expect, it } from 'vitest';

import type { AgentModelConfig } from './config.js';
import { createAiSdkModelClient } from './model-client.js';
import { buildModelProfile } from './model-profile.js';
import { assertExplicitModel, resolveProvider } from './provider.js';

/**
 * The base-URL assertion, which is the reason this file exists.
 *
 * `ai` accepts a bare model name and resolves it through a hosted routing
 * gateway. In a self-hosted EMR that is health-data egress nobody configured,
 * and it would arrive as one innocuous line of code. Types and lint catch the
 * mistake; this catches the dependency changing its mind, because it drives a
 * real call through a recording `fetch` and asserts the URL that was contacted.
 *
 * If this test ever fails, do not relax it. A request going anywhere other than
 * the configured endpoint is a breach, not a test problem.
 */

const LOCAL: AgentModelConfig = {
  providerKind: 'openai-compatible',
  baseUrl: 'http://vllm.clinic.internal:8000/v1',
  modelId: 'a-locally-served-model',
  phiEgress: 'none',
};

interface Recorded {
  urls: string[];
  fetch: typeof globalThis.fetch;
}

/** Answers with a valid OpenAI-shaped streaming response and records the URL. */
function recordingFetch(): Recorded {
  const urls: string[] = [];
  const fetch: typeof globalThis.fetch = (input) => {
    urls.push(typeof input === 'string' ? input : input.toString());
    const chunks = [
      'data: {"id":"1","object":"chat.completion.chunk","created":1,"model":"a-locally-served-model","choices":[{"index":0,"delta":{"role":"assistant","content":"ready"},"finish_reason":null}]}\n\n',
      'data: {"id":"1","object":"chat.completion.chunk","created":1,"model":"a-locally-served-model","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":11,"completion_tokens":2}}\n\n',
      'data: [DONE]\n\n',
    ];

    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    });

    return Promise.resolve(
      new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    );
  };

  return { urls, fetch };
}

describe('resolveProvider', () => {
  it('contacts the configured base URL and nothing else', async () => {
    const recorder = recordingFetch();
    const resolved = resolveProvider(LOCAL, { fetch: recorder.fetch });
    const client = createAiSdkModelClient(buildModelProfile(resolved.model, LOCAL));

    const response = await client.generate({
      system: 'test',
      messages: [{ role: 'user', text: 'hello' }],
      tools: [],
      maxOutputTokens: 16,
    });

    expect(response.text).toBe('ready');
    expect(recorder.urls).toHaveLength(1);
    expect(recorder.urls[0]).toBe('http://vllm.clinic.internal:8000/v1/chat/completions');
  });

  it('never contacts a hosted gateway host', async () => {
    const recorder = recordingFetch();
    const resolved = resolveProvider(LOCAL, { fetch: recorder.fetch });
    const client = createAiSdkModelClient(buildModelProfile(resolved.model, LOCAL));

    await client.generate({
      system: 'test',
      messages: [{ role: 'user', text: 'hello' }],
      tools: [],
      maxOutputTokens: 16,
    });

    for (const url of recorder.urls) {
      expect(new URL(url).host).toBe('vllm.clinic.internal:8000');
    }
  });

  it('echoes back the base URL it resolved, so a caller can assert it', () => {
    const resolved = resolveProvider(LOCAL);
    expect(resolved.baseUrl).toBe('http://vllm.clinic.internal:8000/v1');
    expect(resolved.modelId).toBe('a-locally-served-model');
  });

  it('strips a trailing slash rather than producing a double slash', () => {
    expect(resolveProvider({ ...LOCAL, baseUrl: 'http://box:8000/v1/' }).baseUrl).toBe(
      'http://box:8000/v1'
    );
  });

  it('refuses an empty base URL, because there is no default endpoint', () => {
    expect(() => resolveProvider({ ...LOCAL, baseUrl: '' })).toThrow(/no default endpoint/);
  });

  it('builds an explicit instance for the native provider path too', () => {
    const resolved = resolveProvider({
      ...LOCAL,
      providerKind: 'anthropic',
      baseUrl: 'https://api.example-provider.test',
      apiKey: 'not-a-real-key',
      phiEgress: 'configured-baa',
    });
    expect(typeof resolved.model).toBe('object');
  });
});

describe('assertExplicitModel', () => {
  it('refuses a bare model string', () => {
    expect(() => assertExplicitModel('some-model')).toThrow(/hosted gateway/);
  });

  it('refuses a value that is not a model at all', () => {
    expect(() => assertExplicitModel(null)).toThrow(/language model instance/);
    expect(() => assertExplicitModel(42)).toThrow(/language model instance/);
  });

  it('accepts an instance', () => {
    const resolved = resolveProvider(LOCAL);
    expect(assertExplicitModel(resolved.model)).toBe(resolved.model);
  });
});
