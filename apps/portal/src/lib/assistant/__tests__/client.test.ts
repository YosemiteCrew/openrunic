import { describe, expect, it, vi } from 'vitest';
import {
  ASSISTANT_UNEXPECTED_DRAFT,
  ASSISTANT_UNREACHABLE,
  decodeFrames,
  parseAssistantCapabilities,
  parseAssistantEvent,
  probeAssistant,
  streamTurn,
} from '@/lib/assistant';
import type { AssistantEvent } from '@/lib/assistant';

/**
 * Asking whether there is an assistant, and reading one turn.
 *
 * The whole point of the probe is that it has one negative answer. Unconfigured,
 * signed out, broken and unreadable all have to come out the same way, because
 * they mean the same thing to the person holding the phone.
 */

const TRANSPORT = { baseUrl: 'https://api.example.invalid' };

const CAPABILITIES = {
  model: {
    modelId: 'a-model',
    endpointHost: 'inference.example.invalid',
    remote: true,
    dataLeavesDeployment: true,
  },
  tools: [{ id: 'record.list', tier: 'READ', summary: 'Lists your own health record.' }],
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function sseResponse(chunks: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return { ok: true, status: 200, body: stream } as unknown as Response;
}

function frame(event: Record<string, unknown>): string {
  return `event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`;
}

async function collect(events: AsyncIterable<AssistantEvent>): Promise<AssistantEvent[]> {
  const out: AssistantEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

describe('asking whether there is an assistant', () => {
  it('is enabled only when the API names the service behind it', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(jsonResponse(CAPABILITIES)));
    const availability = await probeAssistant({ ...TRANSPORT, fetchImpl });

    expect(availability).toEqual({
      status: 'enabled',
      capabilities: {
        service: {
          modelId: 'a-model',
          endpointHost: 'inference.example.invalid',
          dataLeavesDeployment: true,
        },
        capabilities: [{ id: 'record.list', summary: 'Lists your own health record.' }],
      },
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.example.invalid/bff/v0/agent/tools',
      expect.objectContaining({ headers: { accept: 'application/json' } })
    );
  });

  it.each([
    ['a 404, which is the shipped state', () => Promise.resolve(jsonResponse({}, 404))],
    ['a 401, because nobody is signed in', () => Promise.resolve(jsonResponse({}, 401))],
    ['a 500, because something is broken', () => Promise.resolve(jsonResponse({}, 500))],
    ['a dead socket', () => Promise.reject(new Error('network down'))],
    ['a body naming no service', () => Promise.resolve(jsonResponse({ tools: [] }))],
  ])('answers absent for %s', async (_case, respond) => {
    const availability = await probeAssistant({ ...TRANSPORT, fetchImpl: respond as typeof fetch });
    expect(availability).toEqual({ status: 'absent' });
  });

  it('answers absent rather than reassuring when the API declines to say where data goes', () => {
    /* The comforting sentence is the one this must never produce on no
       evidence, so a missing flag is no answer, and no answer is no assistant. */
    const withoutFlag = {
      model: { modelId: 'a-model', endpointHost: 'inference.example.invalid' },
      tools: [],
    };
    expect(parseAssistantCapabilities(withoutFlag)).toBeNull();
  });

  it('drops a capability entry it cannot read, rather than the whole response', () => {
    const parsed = parseAssistantCapabilities({
      ...CAPABILITIES,
      tools: [{ id: 'record.list', summary: 'Lists your own health record.' }, { id: 42 }],
    });
    expect(parsed?.capabilities).toHaveLength(1);
  });

  it('sends the bearer token when one is available', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(jsonResponse(CAPABILITIES)));
    await probeAssistant({ ...TRANSPORT, fetchImpl, authorization: () => 'Bearer t' });

    expect(fetchImpl).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: { accept: 'application/json', authorization: 'Bearer t' },
      })
    );
  });

  it('passes an abort signal through, so a page leaving does not leave a request open', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(jsonResponse(CAPABILITIES)));
    const controller = new AbortController();
    await probeAssistant({ ...TRANSPORT, fetchImpl }, controller.signal);

    expect(fetchImpl).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal: controller.signal })
    );
  });
});

describe('running one turn', () => {
  it('asks to read, says the disclosure was on screen, and names the reader own chart', async () => {
    let sent = '';
    const fetchImpl = (_url: string, init?: RequestInit): Promise<Response> => {
      sent = typeof init?.body === 'string' ? init.body : '';
      return Promise.resolve(sseResponse([frame({ type: 'turn-finished', outcome: 'completed' })]));
    };

    await collect(
      streamTurn(
        { ...TRANSPORT, fetchImpl: fetchImpl as unknown as typeof fetch },
        { message: 'When am I next in?', turnIndex: 0, chartPatientId: 'chart-1' }
      )
    );

    const body: unknown = JSON.parse(sent);
    expect(body).toEqual({
      message: 'When am I next in?',
      turnIndex: 0,
      mode: 'read',
      disclosureShown: true,
      chartPatientId: 'chart-1',
    });
  });

  it('yields the events of a turn in the order they arrived', async () => {
    const fetchImpl = () =>
      Promise.resolve(
        sseResponse([
          frame({ type: 'turn-started', agentRunId: 'run-1', modelId: 'a-model' }),
          frame({ type: 'step', label: 'Reading your appointments', state: 'done' }),
          frame({ type: 'text-delta', text: 'You have one appointment booked.' }),
          frame({
            type: 'sources',
            entries: [
              {
                resourceType: 'Appointment',
                resourceId: 'appt-1',
                label: 'Follow-up',
                untrusted: false,
              },
            ],
          }),
          frame({ type: 'turn-finished', outcome: 'completed' }),
        ])
      );

    const events = await collect(
      streamTurn(
        { ...TRANSPORT, fetchImpl: fetchImpl as unknown as typeof fetch },
        { message: 'When am I next in?', turnIndex: 0, chartPatientId: 'chart-1' }
      )
    );

    expect(events).toEqual([
      { type: 'step', label: 'Reading your appointments', done: true },
      { type: 'text', text: 'You have one appointment booked.' },
      {
        type: 'sources',
        entries: [
          {
            resourceType: 'Appointment',
            resourceId: 'appt-1',
            label: 'Follow-up',
            untrusted: false,
          },
        ],
      },
      { type: 'finished', outcome: 'completed' },
    ]);
  });

  it('treats a draft change as a failure, because this page must never show one', async () => {
    const fetchImpl = () =>
      Promise.resolve(
        sseResponse([
          frame({ type: 'proposal', proposalId: 'p-1', toolId: 'x.y', proposal: { kind: 'book' } }),
          frame({ type: 'turn-finished', outcome: 'completed' }),
        ])
      );

    const events = await collect(
      streamTurn(
        { ...TRANSPORT, fetchImpl: fetchImpl as unknown as typeof fetch },
        { message: 'anything', turnIndex: 0, chartPatientId: 'chart-1' }
      )
    );

    expect(events[0]).toEqual({ type: 'failed', code: ASSISTANT_UNEXPECTED_DRAFT });
  });

  it.each([
    [
      'a refused request',
      () => Promise.resolve({ ok: false, status: 500, body: null } as unknown as Response),
    ],
    ['a dead socket', () => Promise.reject(new Error('network down'))],
  ])('settles a turn that never started, on %s', async (_case, respond) => {
    const events = await collect(
      streamTurn(
        { ...TRANSPORT, fetchImpl: respond as typeof fetch },
        { message: 'anything', turnIndex: 0, chartPatientId: 'chart-1' }
      )
    );

    expect(events).toEqual([
      { type: 'failed', code: ASSISTANT_UNREACHABLE },
      { type: 'finished', outcome: 'failed' },
    ]);
  });

  it('settles a turn whose stream died halfway', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(frame({ type: 'text-delta', text: 'Half a' })));
        controller.error(new Error('the socket went away'));
      },
    });
    const fetchImpl = () =>
      Promise.resolve({ ok: true, status: 200, body: stream } as unknown as Response);

    const events = await collect(
      streamTurn(
        { ...TRANSPORT, fetchImpl: fetchImpl as unknown as typeof fetch },
        { message: 'anything', turnIndex: 0, chartPatientId: 'chart-1' }
      )
    );

    expect(events.at(-1)).toEqual({ type: 'finished', outcome: 'failed' });
  });

  it('reports nothing when the reader is the one who stopped it', async () => {
    const controller = new AbortController();
    controller.abort();
    const stream = new ReadableStream<Uint8Array>({
      start(inner) {
        inner.error(new Error('aborted'));
      },
    });
    const fetchImpl = () =>
      Promise.resolve({ ok: true, status: 200, body: stream } as unknown as Response);

    const events = await collect(
      streamTurn(
        { ...TRANSPORT, fetchImpl: fetchImpl as unknown as typeof fetch },
        {
          message: 'anything',
          turnIndex: 0,
          chartPatientId: 'chart-1',
          signal: controller.signal,
        }
      )
    );

    expect(events).toEqual([]);
  });
});

describe('reading the stream', () => {
  it('holds a frame back until it is complete', () => {
    expect(decodeFrames('data: {"type":"text-delta"')).toEqual({
      payloads: [],
      rest: 'data: {"type":"text-delta"',
    });
  });

  it('reads frames whatever the line endings', () => {
    expect(decodeFrames('data: one\r\n\r\ndata: two\r\n\r\n').payloads).toEqual(['one', 'two']);
  });

  it('ignores a keep-alive that carries no data', () => {
    expect(decodeFrames(': keep-alive\n\ndata: one\n\n').payloads).toEqual(['one']);
  });

  it('still reads a last frame that arrived without its blank line', async () => {
    const fetchImpl = () =>
      Promise.resolve(
        sseResponse([`data: ${JSON.stringify({ type: 'turn-finished', outcome: 'completed' })}\n`])
      );

    const events = await collect(
      streamTurn(
        { ...TRANSPORT, fetchImpl: fetchImpl as unknown as typeof fetch },
        { message: 'anything', turnIndex: 0, chartPatientId: 'chart-1' }
      )
    );

    expect(events).toEqual([{ type: 'finished', outcome: 'completed' }]);
  });

  it('ignores a frame this build cannot read rather than failing the turn', () => {
    expect(parseAssistantEvent('not an object')).toBeNull();
    expect(parseAssistantEvent({ type: 'something-new' })).toBeNull();
    expect(parseAssistantEvent({ type: 'text-delta' })).toBeNull();
    expect(parseAssistantEvent({ type: 'sources' })).toBeNull();
    expect(parseAssistantEvent({ type: 'step' })).toBeNull();
    expect(parseAssistantEvent({ type: 'failed' })).toBeNull();
    expect(parseAssistantEvent({ type: 'deferred' })).toBeNull();
    expect(parseAssistantEvent({ type: 'turn-started', agentRunId: 'r', modelId: 'm' })).toBeNull();
    expect(parseAssistantEvent({})).toBeNull();
  });

  it('drops a source entry it cannot read but keeps the ones it can', () => {
    expect(
      parseAssistantEvent({
        type: 'sources',
        entries: [
          { resourceType: 'Bill', resourceId: 'b-1', label: 'A bill' },
          { resourceId: 'b-2' },
        ],
      })
    ).toEqual({
      type: 'sources',
      entries: [{ resourceType: 'Bill', resourceId: 'b-1', label: 'A bill', untrusted: false }],
    });
  });

  it('reads a turn that ended any way other than completed as failed', () => {
    expect(parseAssistantEvent({ type: 'turn-finished', outcome: 'stopped' })).toEqual({
      type: 'finished',
      outcome: 'failed',
    });
  });

  it('ignores a payload that is not JSON at all', async () => {
    const fetchImpl = () =>
      Promise.resolve(
        sseResponse([
          'data: not json at all\n\n',
          frame({ type: 'turn-finished', outcome: 'completed' }),
        ])
      );

    const events = await collect(
      streamTurn(
        { ...TRANSPORT, fetchImpl: fetchImpl as unknown as typeof fetch },
        { message: 'anything', turnIndex: 0, chartPatientId: 'chart-1' }
      )
    );

    expect(events).toEqual([{ type: 'finished', outcome: 'completed' }]);
  });
});
