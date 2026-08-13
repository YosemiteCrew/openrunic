import { afterEach, describe, expect, it, vi } from 'vitest';

import { defaultProbe, defaultRunTurn } from '@/components/assistant';
import type { AgentEvent } from '@/lib/agent';

/**
 * How the surface reaches the API when nothing is injected. This is the path
 * production takes and the one every component test replaces, so it is the one
 * path a component test can never exercise.
 */

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('defaultProbe', () => {
  it('asks nothing at all while the app is reading fixtures', async () => {
    // `NEXT_PUBLIC_API_MODE` already says there is no API to ask. Firing a
    // request at a server that is not running would put a failed fetch in the
    // console of every demo to learn what the mode already said.
    const fetchImpl = vi.fn();
    vi.stubGlobal('fetch', fetchImpl);

    expect(await defaultProbe(new AbortController().signal)).toEqual({ status: 'absent' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('asks the API, and only the API, once the app is live', async () => {
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_API_MODE', 'live');
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'https://api.test');

    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          model: { modelId: 'm', endpointHost: 'h', remote: false, dataLeavesDeployment: false },
          tools: [],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    vi.stubGlobal('fetch', fetchImpl);

    const live = await import('@/components/assistant/transport');
    const result = await live.defaultProbe(new AbortController().signal);

    expect(result.status).toBe('enabled');
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://api.test/bff/v0/agent/tools');
  });

  it('reports absent when the live API has no agent mounted', async () => {
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_API_MODE', 'live');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 404 })));

    const live = await import('@/components/assistant/transport');
    expect(await live.defaultProbe(new AbortController().signal)).toEqual({ status: 'absent' });
  });
});

describe('defaultRunTurn', () => {
  it('streams the turn through the app own API configuration', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('failed to fetch'));
    vi.stubGlobal('fetch', fetchImpl);

    const events: AgentEvent[] = [];
    for await (const event of defaultRunTurn({ message: 'anything', turnIndex: 0 })) {
      events.push(event);
    }

    expect(fetchImpl.mock.calls[0]?.[0]).toBe('http://localhost:4000/bff/v0/agent/turns');
    expect(events.at(-1)).toMatchObject({ type: 'turn-finished', outcome: 'failed' });
  });
});
