import { createV1Registry, type ApiRequest } from '@openrunic/agent-tools';
import { recordingApiClient, stubCredential, stubPrincipal } from '@openrunic/agent-tools/testing';
import { describe, expect, it } from 'vitest';

import { ApprovalRegistry } from './approval.js';
import { createMemoryTranscriptStore, type AgentAuditEvent, type AgentAuditSink } from './audit.js';
import { BudgetGuard } from './budget.js';
import { DEFAULT_BUDGET, ENV } from './config.js';
import { AGENT_ERROR_CODES } from './events.js';
import type { AgentEvent } from './events.js';
import { AgentLoop } from './loop.js';
import { createAiSdkModelClient } from './model-client.js';
import { buildModelProfile, MAXIMAL_CAPABILITIES } from './model-profile.js';
import { readerSystemPrompt, toolManifestVersion } from './prompt.js';
import { resolveProvider } from './provider.js';
import { createAgentRuntime } from './runtime.js';
import { scriptedModel, unreachableModel } from './testing/scripted-model.js';

/**
 * The branches a happy-path suite misses: message shapes the loop only produces
 * on a second step, options a deployer supplies but a test usually does not,
 * and the failure modes that arrive from outside.
 */

const SECRET = 'a-test-signing-secret-of-sufficient-length';

const LOCAL_ENV = {
  [ENV.baseUrl]: 'http://vllm:8000/v1',
  [ENV.modelId]: 'a-locally-served-model',
};

class CollectingSink implements AgentAuditSink {
  readonly events: AgentAuditEvent[] = [];
  record(event: AgentAuditEvent): void {
    this.events.push(event);
  }
}

async function drain(events: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const collected: AgentEvent[] = [];
  for await (const event of events) collected.push(event);
  return collected;
}

describe('error codes', () => {
  it('are stable and unique, because they appear in bodies and in the surface alike', () => {
    expect(new Set(AGENT_ERROR_CODES).size).toBe(AGENT_ERROR_CODES.length);
    expect(AGENT_ERROR_CODES).toContain('AGENT_NOT_CONFIGURED');
  });
});

describe('the model client message shapes', () => {
  const config = {
    providerKind: 'openai-compatible' as const,
    baseUrl: 'http://vllm:8000/v1',
    modelId: 'a-locally-served-model',
    phiEgress: 'none' as const,
  };

  it('sends an assistant tool call and its result back in the shapes the SDK expects', async () => {
    const bodies: string[] = [];
    const fetch: typeof globalThis.fetch = (_input, init) => {
      bodies.push(typeof init?.body === 'string' ? init.body : '');
      const frames = [
        'data: {"choices":[{"index":0,"delta":{"role":"assistant","content":"ok"}}]}\n\n',
        'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
        'data: [DONE]\n\n',
      ];
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          const encoder = new TextEncoder();
          for (const frame of frames) controller.enqueue(encoder.encode(frame));
          controller.close();
        },
      });
      return Promise.resolve(
        new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
      );
    };

    const resolved = resolveProvider(config, { fetch });
    const client = createAiSdkModelClient(
      buildModelProfile(resolved.model, config, { supports: MAXIMAL_CAPABILITIES })
    );

    const response = await client.generate({
      system: 'test',
      messages: [
        { role: 'user', text: 'find it' },
        { role: 'assistant-tool-call', toolCallId: 'c1', toolName: 'probe.echo', input: { a: 1 } },
        { role: 'tool-result', toolCallId: 'c1', toolName: 'probe.echo', output: undefined },
        { role: 'assistant', text: 'thinking' },
      ],
      tools: [
        {
          name: 'probe.echo',
          description: 'echo',
          parameters: { type: 'object', properties: {}, additionalProperties: false },
        },
      ],
      maxOutputTokens: 32,
      toolChoice: 'auto',
    });

    expect(response.text).toBe('ok');
    const sent = bodies[0] ?? '';
    expect(sent).toContain('tool_calls');
    expect(sent).toContain('tool');
  });

  it('passes custom headers through to the endpoint', () => {
    const resolved = resolveProvider(
      { ...config, apiKey: 'not-a-real-key' },
      { headers: { 'x-clinic': 'testina' } }
    );
    expect(resolved.baseUrl).toBe('http://vllm:8000/v1');
  });
});

describe('prompt rendering', () => {
  it('lists the tools the caller actually holds', () => {
    const tools = createV1Registry().tools.slice(0, 2);
    const prompt = readerSystemPrompt(stubPrincipal({ roleIds: ['clinician'] }), tools);
    expect(prompt).toMatch(/Available tools:/);
    expect(prompt).toMatch(/chart\.search/);
  });

  it('says "none" rather than leaving the roles line blank', () => {
    expect(readerSystemPrompt(stubPrincipal({ roleIds: [] }), [])).toMatch(/roles are: none/);
  });

  it('changes the manifest version when the tool set changes', () => {
    const registry = createV1Registry();
    expect(toolManifestVersion(registry.tools)).not.toBe(
      toolManifestVersion(registry.tools.slice(1))
    );
  });
});

describe('runtime options a deployer supplies', () => {
  it('accepts a narrowed registry, a narrowed allowlist, a store, a rate and a clock', () => {
    const subject = createAgentRuntime({
      env: LOCAL_ENV,
      api: recordingApiClient(),
      audit: new CollectingSink(),
      approvalSecret: SECRET,
      registry: createV1Registry(),
      allowlist: { staff: { clinician: ['chart.search'] }, patient: {} },
      transcripts: createMemoryTranscriptStore(),
      rate: { inputCentsPerMillion: 100, outputCentsPerMillion: 500 },
      now: () => 1_700_000_000_000,
      modelClient: scriptedModel([{ text: 'ready' }]),
      profile: { supports: MAXIMAL_CAPABILITIES },
    });

    expect(subject.status).toBe('enabled');
    const tools =
      subject.status === 'enabled'
        ? subject.loop.visibleTools(
            stubPrincipal({ roleIds: ['clinician'], scopes: ['patient.read'] })
          )
        : [];
    expect(tools.map((tool) => tool.id)).toEqual(['chart.search']);
  });

  it('builds a real client when none is injected, without contacting anything', () => {
    const subject = createAgentRuntime({
      env: LOCAL_ENV,
      api: recordingApiClient(),
      audit: new CollectingSink(),
      approvalSecret: SECRET,
    });
    expect(subject.status).toBe('enabled');
  });
});

describe('a turn against an endpoint that is not answering', () => {
  it('surfaces the failure rather than hanging or half-succeeding', async () => {
    const runtime = createAgentRuntime({
      env: LOCAL_ENV,
      api: recordingApiClient(),
      audit: new CollectingSink(),
      approvalSecret: SECRET,
      modelClient: unreachableModel(),
    });
    if (runtime.status !== 'enabled') throw new Error('expected an enabled runtime');

    await expect(
      drain(
        runtime.loop.run({
          principal: stubPrincipal({ roleIds: ['clinician'], scopes: ['patient.read'] }),
          credential: stubCredential(),
          message: 'Find them.',
          turnIndex: 0,
        })
      )
    ).rejects.toThrow(/ECONNREFUSED/);
  });
});

describe('a propose turn for a caller who holds no write tool', () => {
  it('runs the reader and stops there, rather than inventing a writing phase', async () => {
    const audit = new CollectingSink();
    const runtime = createAgentRuntime({
      env: LOCAL_ENV,
      api: recordingApiClient(),
      audit,
      approvalSecret: SECRET,
      modelClient: scriptedModel([{ text: 'Nothing to change.' }]),
    });
    if (runtime.status !== 'enabled') throw new Error('expected an enabled runtime');

    const events = await drain(
      runtime.loop.run({
        // A read-only role holds nothing on the staff surface, so the writing
        // phase has no tools and is skipped entirely.
        principal: stubPrincipal({ roleIds: ['read-only'], scopes: ['patient.read'] }),
        credential: stubCredential(),
        message: 'Change something.',
        turnIndex: 0,
        mode: 'propose',
        disclosureShown: false,
      })
    );

    expect(events.some((event) => event.type === 'proposal')).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: 'turn-finished', outcome: 'completed' });
    const turn = audit.events.find((event) => event.action === 'agent.turn');
    expect(turn?.metadata['disclosureShown']).toBe(false);
  });
});

describe('an approval whose commit is refused upstream', () => {
  it('reports the failure and records it, rather than claiming a save', async () => {
    const audit = new CollectingSink();
    const approvals = new ApprovalRegistry(SECRET);
    const loop = new AgentLoop({
      registry: createV1Registry(),
      profile: buildModelProfile(
        {} as never,
        {
          providerKind: 'openai-compatible',
          baseUrl: 'not-a-url',
          modelId: 'a-locally-served-model',
          phiEgress: 'none',
        },
        { supports: MAXIMAL_CAPABILITIES }
      ),
      client: scriptedModel([]),
      api: {
        call: (request: ApiRequest) =>
          request.method === 'GET'
            ? Promise.resolve({ data: [], page: { total: 0 } })
            : Promise.reject(new Error('the claims API is not implemented yet')),
      },
      approvals,
      budget: new BudgetGuard(DEFAULT_BUDGET),
      audit,
      transcripts: createMemoryTranscriptStore(),
    });

    const principal = stubPrincipal({ roleIds: ['biller'], scopes: ['claim.write'] });
    const input = { claimId: '018f2b40-0000-7000-8000-00000000d001' };
    const { token } = approvals.register({
      agentRunId: 'run-1',
      principal,
      toolId: 'coding.suggest',
      input,
      proposal: {
        kind: 'claim.codingSuggestion',
        effect: [{ label: 'Codes suggested', value: '1' }],
        affects: [],
        commit: { method: 'PATCH', path: '/bff/v0/claims/abc', body: {} },
        derivedFromUntrusted: false,
      },
      requiredScopes: ['claim.write'],
    });

    const result = await loop.approve({
      token,
      input,
      approver: principal,
      credential: stubCredential(),
    });

    expect(result).toMatchObject({ ok: false, code: 'AGENT_TOOL_FAILED' });
    expect(
      audit.events.some(
        (event) => event.metadata['decision'] === 'approved' && event.outcome === 'failure'
      )
    ).toBe(true);
    // A base URL that is not a URL still yields an audit record, with the host
    // named as unknown rather than the event being dropped.
    expect((audit.events[0]?.metadata['viaAgent'] as { endpointHost: string }).endpointHost).toBe(
      'unknown'
    );
  });
});
