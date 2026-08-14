import { describe, expect, it, vi } from 'vitest';

import { chartPatientIdFromPath, probeAssistant, streamAgentTurn } from '@/lib/agent';
import type { AgentEvent } from '@/lib/agent';
import type { ApiClientConfig } from '@/lib/api';

/**
 * The whole of the "off by default" behaviour lives in this file.
 *
 * `apps/api` mounts no agent router without a configured endpoint, so every
 * path answers 404 through the ordinary not-found handler. That 404 is the
 * shipped open-source state, not a fault, and the tests below pin the rule that
 * follows from it: the probe reports `absent` for every failure there is, so no
 * failure can ever produce a half-working affordance.
 */

const CAPABILITIES = {
  model: { modelId: 'm', endpointHost: 'h', remote: false, dataLeavesDeployment: false },
  tools: [],
};

function configWith(fetchImpl: typeof fetch): ApiClientConfig {
  return { baseUrl: 'https://api.test', fetchImpl, getToken: () => 'token-1' };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function sseResponse(events: readonly unknown[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const event of events) {
          controller.enqueue(encoder.encode(`event: e\ndata: ${JSON.stringify(event)}\n\n`));
        }
        controller.close();
      },
    }),
    { status: 200 }
  );
}

async function drain(stream: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

describe('probeAssistant', () => {
  it('asks the capabilities route and carries the bearer token', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(CAPABILITIES));

    const result = await probeAssistant(configWith(fetchImpl as unknown as typeof fetch));

    expect(result).toEqual({ status: 'enabled', capabilities: CAPABILITIES });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.test/bff/v0/agent/tools');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer token-1');
  });

  it('sends no authorization header while signed out', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(CAPABILITIES));
    await probeAssistant({
      baseUrl: 'https://api.test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).has('authorization')).toBe(false);
  });

  it.each([
    ['no agent is configured, so the route does not exist', 404],
    ['nobody is signed in', 401],
    ['the caller is refused', 403],
    ['the API itself is broken', 500],
  ])('reports absent when %s', async (_name, status) => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ title: 'no' }, status));
    expect(await probeAssistant(configWith(fetchImpl as unknown as typeof fetch))).toEqual({
      status: 'absent',
    });
  });

  it('reports absent when the request never completes', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('failed to fetch'));
    expect(await probeAssistant(configWith(fetchImpl as unknown as typeof fetch))).toEqual({
      status: 'absent',
    });
  });

  it('reports absent for a 200 this build cannot read', async () => {
    // Half a capabilities body is not half an assistant. Rendering a panel
    // whose model identity is missing would put the egress disclosure on
    // screen with nothing in it.
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ tools: [] }));
    expect(await probeAssistant(configWith(fetchImpl as unknown as typeof fetch))).toEqual({
      status: 'absent',
    });
  });

  it('passes the abort signal, so an unmount does not leave a request open', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(CAPABILITIES));
    await probeAssistant(configWith(fetchImpl as unknown as typeof fetch), controller.signal);

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBe(controller.signal);
  });
});

describe('streamAgentTurn', () => {
  it('runs the turn in read mode and yields the events in order', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        sseResponse([
          { type: 'turn-started', agentRunId: 'r', turnIndex: 0, modelId: 'm' },
          { type: 'text-delta', text: 'Two visits.' },
          { type: 'nonsense' },
          { type: 'turn-finished', outcome: 'completed', usage: {} },
        ])
      );

    const events = await drain(
      streamAgentTurn(configWith(fetchImpl as unknown as typeof fetch), {
        message: 'how many visits',
        turnIndex: 0,
        chartPatientId: '0192f1a0-0000-7000-8000-00000000p001',
      })
    );

    expect(events.map((event) => event.type)).toEqual([
      'turn-started',
      'text-delta',
      'turn-finished',
    ]);

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.test/bff/v0/agent/turns');
    expect(JSON.parse(String(init.body))).toEqual({
      message: 'how many visits',
      turnIndex: 0,
      mode: 'read',
      disclosureShown: true,
      chartPatientId: '0192f1a0-0000-7000-8000-00000000p001',
    });
  });

  it('skips a frame whose payload is not JSON rather than ending the turn', async () => {
    const encoder = new TextEncoder();
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode('data: not json at all\n\n'));
            controller.enqueue(
              encoder.encode('data: {"type":"text-delta","text":"Two visits."}\n\n')
            );
            controller.close();
          },
        }),
        { status: 200 }
      )
    );

    const events = await drain(
      streamAgentTurn(configWith(fetchImpl as unknown as typeof fetch), {
        message: 'anything',
        turnIndex: 0,
      })
    );

    expect(events).toEqual([{ type: 'text-delta', text: 'Two visits.' }]);
  });

  it('omits the chart entirely when no chart is open', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(sseResponse([]));
    await drain(
      streamAgentTurn(configWith(fetchImpl as unknown as typeof fetch), {
        message: 'anything',
        turnIndex: 1,
      })
    );

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).not.toHaveProperty('chartPatientId');
  });

  it('ends a refused request the same way the loop ends every branch of its own', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ title: 'gone' }, 404));

    const events = await drain(
      streamAgentTurn(configWith(fetchImpl as unknown as typeof fetch), {
        message: 'anything',
        turnIndex: 0,
      })
    );

    expect(events).toEqual([
      {
        type: 'failed',
        code: 'AGENT_TRANSPORT_FAILED',
        detail: 'openrunic could not reach the assistant.',
      },
      {
        type: 'turn-finished',
        outcome: 'failed',
        usage: { inputTokens: 0, outputTokens: 0, costCents: 0 },
      },
    ]);
  });

  it('ends the same way when the request never completes', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('failed to fetch'));
    const events = await drain(
      streamAgentTurn(configWith(fetchImpl as unknown as typeof fetch), {
        message: 'anything',
        turnIndex: 0,
      })
    );
    expect(events.at(-1)).toMatchObject({ type: 'turn-finished', outcome: 'failed' });
  });

  it('reports a socket that dies halfway through an answer', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(diesAfterOneDelta(), { status: 200 }));

    const events = await drain(
      streamAgentTurn(configWith(fetchImpl as unknown as typeof fetch), {
        message: 'anything',
        turnIndex: 0,
      })
    );

    expect(events.map((event) => event.type)).toEqual(['text-delta', 'failed', 'turn-finished']);
  });

  it('reports nothing when the caller stopped the turn itself', async () => {
    // Stopping is a decision, not a fault, so it produces no failure line. The
    // surface settles the partial answer on its own.
    const controller = new AbortController();
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        diesAfterOneDelta(() => controller.abort()),
        { status: 200 }
      )
    );

    const events = await drain(
      streamAgentTurn(configWith(fetchImpl as unknown as typeof fetch), {
        message: 'anything',
        turnIndex: 0,
        signal: controller.signal,
      })
    );

    expect(events.map((event) => event.type)).toEqual(['text-delta']);
  });
});

/** One usable delta, then the socket goes. `onDeath` runs just before it does. */
function diesAfterOneDelta(onDeath: () => void = () => {}): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let delivered = false;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (!delivered) {
        delivered = true;
        controller.enqueue(encoder.encode('data: {"type":"text-delta","text":"Two vi"}\n\n'));
        return;
      }
      onDeath();
      controller.error(new Error('socket died'));
    },
  });
}

describe('chartPatientIdFromPath', () => {
  it('reads the chart a clinician has open', () => {
    expect(chartPatientIdFromPath('/patients/0192f1a0-0000-7000-8000-00000000f001')).toBe(
      '0192f1a0-0000-7000-8000-00000000f001'
    );
    expect(chartPatientIdFromPath('/patients/0192f1a0-0000-7000-8000-00000000f001/insurance')).toBe(
      '0192f1a0-0000-7000-8000-00000000f001'
    );
  });

  it.each([
    ['the patient list', '/patients'],
    ['registration', '/patients/new'],
    // An encounter id is not a patient id, and sending it would name a chart
    // that does not resolve.
    ['an encounter', '/encounters/0192f1a0-0000-7000-8000-00000000f001'],
    ['no route at all', null],
  ])('sends no chart from %s', (_name, pathname) => {
    expect(chartPatientIdFromPath(pathname)).toBeUndefined();
  });
});
