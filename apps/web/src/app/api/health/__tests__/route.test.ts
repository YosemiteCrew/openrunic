import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from '../route';

/*
 * These exercise the live path, so the mode is declared rather than inherited.
 *
 * The suite runs in mock mode like the rest of this app, and the route short
 * circuits there - it has no API to probe. Without this every case below would
 * pass on the mock branch and prove nothing about the probe.
 */
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, IS_MOCK_MODE: false };
});

/**
 * The three answers this route can give, and why each one matters.
 *
 * The banner it feeds says one of three things to a receptionist: nothing at
 * all, "records cannot be saved", or "cannot reach openrunic". Getting the
 * mapping wrong is not a cosmetic bug - it tells staff to keep paper notes
 * during a healthy afternoon, or tells them everything is fine while the
 * database is gone. So each status code is pinned here rather than left to the
 * component tests, which mock this route away.
 */
describe('GET /api/health', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.stubEnv('OPENRUNIC_API_INTERNAL_URL', 'http://api.test:4000');
    // The unreachable path logs the reason, which is the behaviour under test
    // in one case below and noise in the rest.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('reports ok when the API is ready', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'ok' });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('probes readiness rather than liveness, on the server-side address', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await GET();

    // /healthz would answer 200 with the database gone, which is the whole
    // failure this route exists to catch.
    expect(fetchMock).toHaveBeenCalledWith(
      'http://api.test:4000/readyz',
      expect.objectContaining({ cache: 'no-store' })
    );
  });

  it('answers 502 rather than guessing an address when no internal URL is set', async () => {
    vi.stubEnv('OPENRUNIC_API_INTERNAL_URL', '');
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const response = await GET();

    // Guessing produces a probe against a host that may not exist, which fails,
    // which lights the banner permanently - the bug this route was written to
    // remove. An unconfigured deployment cannot reach the API, and saying so is
    // the honest answer.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(response.status).toBe(502);
    expect(console.error).toHaveBeenCalled();
  });

  it('strips a trailing slash so the probe never doubles it', async () => {
    vi.stubEnv('OPENRUNIC_API_INTERNAL_URL', 'http://api.test:4000/');
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await GET();

    expect(fetchMock).toHaveBeenCalledWith('http://api.test:4000/readyz', expect.anything());
  });

  it('answers 503 when the API says it cannot serve data', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 503 })) as unknown as typeof fetch;

    const response = await GET();

    // 503 is the read-only case: the API answered, so the web tier is fine and
    // the banner must say records cannot be saved.
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ status: 'degraded', api: 503 });
  });

  it('answers 502 when the API does not answer at all', async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new Error('connect ECONNREFUSED')) as unknown as typeof fetch;

    const response = await GET();

    // 502, not 503. Collapsing the two would make the banner say "read-only"
    // during a total outage, which is both wrong and reassuring.
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ status: 'unreachable' });
  });

  it('answers 502 rather than hanging when the API never responds', async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new DOMException('The operation was aborted.', 'TimeoutError'))
      .mockName('fetch') as unknown as typeof fetch;

    const response = await GET();

    expect(response.status).toBe(502);
  });

  it('never describes the internal topology in the body', async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(
        new Error('connect ECONNREFUSED 10.0.1.7:4000')
      ) as unknown as typeof fetch;

    const response = await GET();
    const body = JSON.stringify(await response.json());

    // A connection error in a browser-readable response tells staff nothing
    // they can act on and tells everyone else where the API lives.
    expect(body).not.toContain('10.0.1.7');
    expect(body).not.toContain('ECONNREFUSED');
    expect(body).not.toContain('api.test');
  });

  it('is never cached, in either direction', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 503 })) as unknown as typeof fetch;

    const response = await GET();

    // A cached health check is not a health check.
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});

describe('in mock mode', () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('@/lib/api');
  });

  it('answers ok without probing, because there is no API to be down', async () => {
    /*
     * The defect this closes, found by looking at a screenshot rather than by a
     * test: a fixtures build has no API, so OPENRUNIC_API_INTERNAL_URL is
     * unset, the probe throws, the route answers 502 and the downtime banner
     * lights and stays lit. That is the permanently-on banner this route was
     * written to remove, reappearing in the one configuration where the
     * question is meaningless - and it is the configuration a hosted
     * demonstration runs in.
     */
    vi.resetModules();
    vi.doMock('@/lib/api', async () => {
      const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
      return { ...actual, IS_MOCK_MODE: true };
    });
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    delete process.env.OPENRUNIC_API_INTERNAL_URL;

    const route = await import('../route');
    const response = await route.GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'ok', mode: 'mock' });
    // Nothing was asked of the network. A probe here would be asking whether a
    // service this build does not use is reachable.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(response.headers.get('cache-control')).toBe('no-store');

    vi.unstubAllGlobals();
  });
});
