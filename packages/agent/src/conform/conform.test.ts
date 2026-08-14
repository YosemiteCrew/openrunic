import { createServer } from 'node:http';

import { describe, expect, it } from 'vitest';

import type { ModelClient, ModelRequest, ModelResponse } from '../model-client.js';

import { CONFORMANCE_CASES, PROBE_FAMILIES, parseJson } from './cases.js';
import { main } from './cli.js';
import { deriveCapabilities, formatReport, runConformance } from './run.js';

/**
 * The conformance suite, tested against endpoints of three different qualities.
 *
 * The point of the suite is that a deployer learns their tier before go-live.
 * The point of this file is that the grading is honest: a family that is only
 * sometimes right counts as absent, because a safety policy that sometimes
 * vanishes is not one.
 */

/**
 * An OpenAI-compatible endpoint, in about forty lines.
 *
 * It exists so the command can be proved end to end over real HTTP rather than
 * against a mock of the transport: a deployer runs `agent:conform` against a
 * server, and this is a server. It answers the probes the way a fully capable
 * endpoint would.
 */
async function startStubEndpoint(): Promise<{
  origin: string;
  paths: string[];
  close: () => Promise<void>;
}> {
  const paths: string[] = [];
  const server = createServer((request, response) => {
    paths.push(request.url ?? '');
    let body = '';
    request.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')));
    request.on('end', () => {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const frame of stubFrames(body)) response.write(`data: ${frame}\n\n`);
      response.write('data: [DONE]\n\n');
      response.end();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;

  return {
    origin: `http://127.0.0.1:${String(port)}`,
    paths,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function stubFrames(rawBody: string): string[] {
  const parsed = JSON.parse(rawBody) as {
    messages: { role: string; content: unknown }[];
    tool_choice?: unknown;
  };
  const system = parsed.messages.find((message) => message.role === 'system');
  const user = parsed.messages.filter((message) => message.role === 'user').at(-1);
  const systemText = typeof system?.content === 'string' ? system.content : '';
  const userText = typeof user?.content === 'string' ? user.content : JSON.stringify(user?.content);

  const say = (content: string): string[] => [
    JSON.stringify({ choices: [{ index: 0, delta: { role: 'assistant', content } }] }),
    JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }),
  ];

  const call = (name: string, args: string): string[] => [
    JSON.stringify({
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              { index: 0, id: 'call-1', type: 'function', function: { name, arguments: args } },
            ],
          },
        },
      ],
    }),
    JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }),
  ];

  if (systemText.includes('passphrase')) return say('ORUNIC-SYSTEM-PROMPT-REACHED');

  const jsonMatch = /\{"n": (\d+)\}/.exec(userText);
  if (jsonMatch !== null) return say(`{"n": ${String(jsonMatch[1])}}`);
  if (/Do not call any tool/.test(userText)) return say('none');
  if (/In one reply/.test(userText)) {
    return [
      JSON.stringify({
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call-1',
                  type: 'function',
                  function: { name: 'probe.echo', arguments: '{"word":"ready"}' },
                },
                {
                  index: 1,
                  id: 'call-2',
                  type: 'function',
                  function: { name: 'probe.count', arguments: '{"total":1}' },
                },
              ],
            },
          },
        ],
      }),
      JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }),
    ];
  }
  if (parsed.tool_choice !== undefined) return call('probe.echo', '{"word":"forced"}');
  if (/probe\.count/.test(userText)) return call('probe.count', '{"total":4}');
  if (/probe\.echo/.test(userText)) return call('probe.echo', '{"word":"ready"}');
  if (parsed.messages.some((message) => message.role === 'tool')) {
    return call('probe.count', '{"total":4}');
  }
  return say('ready');
}

/** Answers everything correctly. The tier a hosted frontier endpoint would reach. */
function capableEndpoint(): ModelClient {
  return {
    generate(request: ModelRequest): Promise<ModelResponse> {
      const last = request.messages.at(-1);
      const text = last?.role === 'user' ? last.text : '';

      if (request.system.includes('passphrase')) {
        return answer({ text: 'ORUNIC-SYSTEM-PROMPT-REACHED' });
      }
      const jsonMatch = /\{"n": (\d+)\}/.exec(text);
      if (jsonMatch !== null) return answer({ text: `{"n": ${String(jsonMatch[1])}}` });
      if (/Do not call any tool/.test(text)) return answer({ text: 'none' });
      if (/In one reply/.test(text)) {
        return answer({
          toolCalls: [
            { toolCallId: '1', toolName: 'probe.echo', input: { word: 'ready' } },
            { toolCallId: '2', toolName: 'probe.count', input: { total: 1 } },
          ],
        });
      }
      if (request.toolChoice === 'required') {
        return answer({ toolCalls: [{ toolCallId: '1', toolName: 'probe.echo', input: {} }] });
      }
      if (request.tools.length > 0 && /probe\./.test(text)) {
        return answer({ toolCalls: [{ toolCallId: '1', toolName: 'probe.echo', input: {} }] });
      }
      if (last?.role === 'tool-result') {
        return answer({ toolCalls: [{ toolCallId: '2', toolName: 'probe.count', input: {} }] });
      }
      return answer({ text: 'ready' });
    },
  };
}

/** Calls tools but drops the system prompt and cannot be forced. The common local case. */
function reducedEndpoint(): ModelClient {
  const capable = capableEndpoint();
  return {
    async generate(request: ModelRequest): Promise<ModelResponse> {
      if (request.system.includes('passphrase'))
        return { ...(await answer({ text: 'I do not know.' })) };
      if (request.toolChoice === 'required') return answer({ text: 'Let me think about it.' });
      return capable.generate(request);
    },
  };
}

function brokenEndpoint(): ModelClient {
  return {
    generate(): Promise<ModelResponse> {
      return Promise.reject(new Error('connect ECONNREFUSED'));
    },
  };
}

function answer(partial: Partial<ModelResponse>): Promise<ModelResponse> {
  return Promise.resolve({
    text: '',
    toolCalls: [],
    usage: { inputTokens: 10, outputTokens: 5 },
    finishReason: 'stop',
    ...partial,
  });
}

describe('the corpus', () => {
  it('covers every family, with thirty cases', () => {
    expect(CONFORMANCE_CASES).toHaveLength(30);
    const families = new Set(CONFORMANCE_CASES.map((probe) => probe.family));
    expect([...families].sort()).toEqual([...PROBE_FAMILIES].sort());
  });

  it('has unique case ids, so a report names one thing per line', () => {
    const ids = CONFORMANCE_CASES.map((probe) => probe.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('contains no patient data of any kind', () => {
    const text = JSON.stringify(CONFORMANCE_CASES.map((probe) => probe.request));
    expect(text).not.toMatch(/patient|chart|mrn|birth/i);
  });
});

describe('running against a capable endpoint', () => {
  it('reports the full tier and a usable endpoint', async () => {
    const report = await runConformance(capableEndpoint());
    expect(report.usable).toBe(true);
    expect(report.tier).toBe('full');
    expect(report.capabilities.systemPrompt).toBe('native');
    expect(report.capabilities.toolChoice).toBe(true);
  });
});

describe('running against a reduced endpoint', () => {
  it('detects the dropped system prompt, which is the failure that matters most', async () => {
    const report = await runConformance(reducedEndpoint());
    expect(report.capabilities.systemPrompt).toBe('merged');
    expect(report.capabilities.toolChoice).toBe(false);
    expect(report.usable).toBe(false);
  });

  it('says in plain words what the loop will do differently', async () => {
    const report = await runConformance(reducedEndpoint());
    const text = formatReport(report, 'http://vllm:8000/v1');
    expect(text).toMatch(/MERGED into the first message/);
    expect(text).toMatch(/a text-only turn is re-prompted once/);
    expect(text).toMatch(/never looser rules/);
  });
});

describe('running against an endpoint that does not answer', () => {
  it('reports it as unusable rather than as an empty pass', async () => {
    const report = await runConformance(brokenEndpoint());
    expect(report.usable).toBe(false);
    expect(report.results.every((result) => result.error !== undefined)).toBe(true);
    expect(formatReport(report, 'http://nowhere:8000')).toMatch(/NOT USABLE/);
  });

  it('reports progress as it goes, so a slow endpoint does not look hung', async () => {
    const seen: string[] = [];
    await runConformance(brokenEndpoint(), {
      cases: CONFORMANCE_CASES.slice(0, 2),
      onCase: (result) => seen.push(result.id),
    });
    expect(seen).toHaveLength(2);
  });
});

describe('deriveCapabilities', () => {
  it('treats a family that is only sometimes right as absent', () => {
    const capabilities = deriveCapabilities({
      baseline: { passed: 3, total: 3 },
      'tool-call': { passed: 6, total: 6 },
      'forced-call': { passed: 2, total: 3 },
      'parallel-calls': { passed: 1, total: 2 },
      'malformed-arguments': { passed: 2, total: 2 },
      'structured-output': { passed: 2, total: 4 },
      'system-prompt': { passed: 2, total: 3 },
      'oversized-context': { passed: 2, total: 2 },
      refusal: { passed: 3, total: 3 },
    });

    expect(capabilities.toolChoice).toBe(false);
    expect(capabilities.parallelToolCalls).toBe(false);
    expect(capabilities.structuredOutput).toBe('json-mode');
    expect(capabilities.systemPrompt).toBe('merged');
  });

  it('falls to prompt-only when structured output never worked', () => {
    const capabilities = deriveCapabilities({
      baseline: { passed: 0, total: 0 },
      'tool-call': { passed: 0, total: 0 },
      'forced-call': { passed: 0, total: 0 },
      'parallel-calls': { passed: 0, total: 0 },
      'malformed-arguments': { passed: 0, total: 0 },
      'structured-output': { passed: 0, total: 4 },
      'system-prompt': { passed: 0, total: 3 },
      'oversized-context': { passed: 0, total: 0 },
      refusal: { passed: 0, total: 0 },
    });
    expect(capabilities.structuredOutput).toBe('prompt-only');
  });
});

describe('parseJson', () => {
  it('reads a fenced object, because endpoints add fences unasked', () => {
    expect(parseJson('```json\n{"n": 1}\n```')).toEqual({ n: 1 });
  });

  it('returns nothing rather than guessing at unparseable output', () => {
    expect(parseJson('not json')).toBeUndefined();
  });
});

describe('the command', () => {
  it('refuses to report on nothing when no endpoint is configured', async () => {
    const lines: string[] = [];
    expect(await main({}, (line) => lines.push(line))).toBe(2);
    expect(lines.join('\n')).toMatch(/nothing to test/);
  });

  it('reports a misconfiguration rather than running against it', async () => {
    const lines: string[] = [];
    const code = await main(
      {
        OPENRUNIC_AGENT_BASE_URL: 'https://api.example-provider.test/v1',
        OPENRUNIC_AGENT_MODEL: 'a-hosted-model',
      },
      (line) => lines.push(line)
    );

    expect(code).toBe(2);
    expect(lines.join('\n')).toMatch(/will not start/);
  });

  it('runs end to end against a stub endpoint over real HTTP', async () => {
    const stub = await startStubEndpoint();
    const lines: string[] = [];

    try {
      const code = await main(
        {
          OPENRUNIC_AGENT_BASE_URL: `${stub.origin}/v1`,
          OPENRUNIC_AGENT_MODEL: 'a-stub-model',
        },
        (line) => lines.push(line)
      );

      const output = lines.join('\n');
      expect(output).toMatch(/no patient data/);
      expect(output).toMatch(/Capability tier: full/);
      expect(output).toMatch(/Result: usable/);
      expect(code).toBe(0);
      // Every probe went to the configured endpoint, and nowhere else.
      expect(stub.paths.every((path) => path === '/v1/chat/completions')).toBe(true);
      expect(stub.paths).toHaveLength(CONFORMANCE_CASES.length);
    } finally {
      await stub.close();
    }
  }, 60_000);
});
