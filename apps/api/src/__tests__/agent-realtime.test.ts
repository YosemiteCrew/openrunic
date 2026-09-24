import type { AgentRuntime } from '@openrunic/agent';
import { describe, expect, it, vi } from 'vitest';

import {
  loadRealtimeSubsystem,
  REALTIME_ENV,
  type MintedRealtimeSession,
  type RealtimeConfig,
  type RealtimeMintRequest,
  type RealtimeSessionMinter,
} from '../agent/realtime.js';
import { loadAgentRuntime } from '../agent/runtime.js';

import {
  createTestApp,
  DEMO_PORTAL_PATIENT,
  FIXED_NOW,
  jsonBearer,
  seedCareRelationship,
  seedPatients,
  SUBJECTS,
  testId,
  TOKENS,
} from './support.js';

/**
 * The session route for hosted dictation (#583): who may be handed a realtime
 * credential, for what, and for how long.
 *
 * The minter below is a recording double. It is the deployer's code in a real
 * deployment, so what matters here is what it is TOLD - the request type has
 * no field for a person, a chart or a tool, and these tests pin that the route
 * does not smuggle one in by another name.
 */

const PATH = '/bff/v0/agent/realtime/sessions';

const ENV = {
  [REALTIME_ENV.endpoint]: 'wss://speech.example.test/v1/realtime',
  [REALTIME_ENV.agreement]: 'Synthetic test agreement, not a real contract',
  [REALTIME_ENV.responsibleParty]: 'A fictional privacy officer',
  [REALTIME_ENV.languages]: 'en-US, es',
};

const AGENT: AgentRuntime = loadAgentRuntime({
  env: {
    OPENRUNIC_AGENT_BASE_URL: 'http://vllm:8000/v1',
    OPENRUNIC_AGENT_MODEL: 'a-locally-served-model',
    OPENRUNIC_AGENT_APPROVAL_SECRET: 'a-test-signing-secret-of-sufficient-length',
  },
});

function config(overrides: Partial<RealtimeConfig> = {}): RealtimeConfig {
  const loaded = loadRealtimeSubsystem(ENV);
  if (loaded.status !== 'enabled') throw new Error(`expected enabled: ${loaded.reason}`);
  return { ...loaded.config, ...overrides };
}

interface Recorder extends RealtimeSessionMinter {
  calls: RealtimeMintRequest[];
}

function recorder(
  answer: (request: RealtimeMintRequest) => Promise<MintedRealtimeSession> = (request) =>
    Promise.resolve({
      credential: 'synthetic-ephemeral-session-value',
      expiresAt: new Date(FIXED_NOW.getTime() + request.expiresInSeconds * 1000),
    })
): Recorder {
  const calls: RealtimeMintRequest[] = [];
  return {
    calls,
    mint: (request) => {
      calls.push(request);
      return answer(request);
    },
  };
}

function build(
  minter: RealtimeSessionMinter = recorder(),
  overrides: Partial<RealtimeConfig> = {},
  agent: AgentRuntime = AGENT
) {
  return createTestApp({
    agent,
    realtime: { minter, subsystem: { status: 'enabled', config: config(overrides) } },
  });
}

async function post(
  app: ReturnType<typeof build>['app'],
  token: string,
  body: unknown
): Promise<Response> {
  return await app.request(PATH, {
    method: 'POST',
    headers: jsonBearer(token),
    body: JSON.stringify(body),
  });
}

describe('when the route exists', () => {
  it('does not exist while the assistant is off, even with a minter and a configuration', async () => {
    const { app } = build(recorder(), {}, { status: 'disabled', reason: 'no model' });
    expect((await post(app, TOKENS.clinicianA, { language: 'en-US' })).status).toBe(404);
  });

  it('does not exist without a minter', async () => {
    const { app } = createTestApp({ agent: AGENT });
    expect((await post(app, TOKENS.clinicianA, { language: 'en-US' })).status).toBe(404);
  });

  it('does not exist when the configuration is incomplete', async () => {
    const { app } = createTestApp({
      agent: AGENT,
      realtime: { minter: recorder(), subsystem: loadRealtimeSubsystem({}) },
    });
    expect((await post(app, TOKENS.clinicianA, { language: 'en-US' })).status).toBe(404);
  });

  it('reports a misconfiguration loudly and stays unmounted', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const { app } = createTestApp({
        agent: AGENT,
        realtime: {
          minter: recorder(),
          subsystem: { status: 'misconfigured', reason: 'no agreement named' },
        },
      });
      expect((await post(app, TOKENS.clinicianA, { language: 'en-US' })).status).toBe(404);
      expect(error).toHaveBeenCalledWith(expect.stringContaining('no agreement named'));
    } finally {
      error.mockRestore();
    }
  });

  it('reads the environment when no configuration is supplied', async () => {
    // The process environment names no endpoint in CI, so the default is absent.
    const { app } = createTestApp({ agent: AGENT, realtime: { minter: recorder() } });
    expect((await post(app, TOKENS.clinicianA, { language: 'en-US' })).status).toBe(404);
  });

  it('is documented only once it exists', async () => {
    const on = (await (await build().app.request('/openapi.json')).json()) as {
      paths: Record<string, unknown>;
    };
    const off = (await (
      await createTestApp({ agent: AGENT }).app.request('/openapi.json')
    ).json()) as {
      paths: Record<string, unknown>;
    };
    expect(Object.keys(on.paths)).toContain(PATH);
    expect(Object.keys(off.paths)).not.toContain(PATH);
  });
});

describe('advertising dictation to the surfaces', () => {
  async function tools(app: ReturnType<typeof build>['app'], token: string) {
    const response = await app.request('/bff/v0/agent/tools', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(200);
    return (await response.json()) as Record<string, unknown>;
  }

  it('names the endpoint, the agreement, the languages and the turn detection', async () => {
    const body = await tools(build(recorder(), { turnDetection: 'manual' }).app, TOKENS.clinicianA);
    expect(body.dictation).toEqual({
      endpoint: ENV[REALTIME_ENV.endpoint],
      agreement: ENV[REALTIME_ENV.agreement],
      languages: ['en-US', 'es'],
      turnDetection: 'manual',
    });
  });

  it('tells a portal caller the same', async () => {
    const body = await tools(build().app, TOKENS.portalA);
    expect(body.dictation).toMatchObject({ endpoint: ENV[REALTIME_ENV.endpoint] });
  });

  it('says nothing about dictation when none is configured', async () => {
    const body = await tools(createTestApp({ agent: AGENT }).app, TOKENS.clinicianA);
    expect(body).not.toHaveProperty('dictation');
  });

  it('says nothing about dictation when the configuration is incomplete', async () => {
    const { app } = createTestApp({
      agent: AGENT,
      realtime: { minter: recorder(), subsystem: loadRealtimeSubsystem({}) },
    });
    expect(await tools(app, TOKENS.clinicianA)).not.toHaveProperty('dictation');
  });
});

describe('minting a session', () => {
  it('hands back a short-lived credential and what the capture adapter needs', async () => {
    const minter = recorder();
    const response = await post(build(minter).app, TOKENS.clinicianA, { language: 'en-GB' });

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      endpoint: ENV[REALTIME_ENV.endpoint],
      credential: 'synthetic-ephemeral-session-value',
      expiresAt: new Date(FIXED_NOW.getTime() + 60_000).toISOString(),
      language: 'en-US',
      turnDetection: 'server',
      agreement: ENV[REALTIME_ENV.agreement],
    });
  });

  it('tells the minter a language, a surface and a lifetime, and nothing else', async () => {
    const minter = recorder();
    const { app, dataset } = build(minter, { maxTtlSeconds: 45 });
    seedPatients(dataset, 1);
    seedCareRelationship(dataset, { patientId: testId(1), providerId: SUBJECTS.clinicianA });

    await post(app, TOKENS.clinicianA, { language: 'es-MX', chartPatientId: testId(1) });

    // Exact equality, so a subject, a chart or a tool list added to the request
    // under any name is a failure here rather than a quiet widening.
    expect(minter.calls).toEqual([{ language: 'es', surface: 'staff', expiresInSeconds: 45 }]);
  });

  it('puts a portal caller on the patient surface', async () => {
    const minter = recorder();
    await post(build(minter).app, TOKENS.portalA, { language: 'en-US' });
    expect(minter.calls.map((call) => call.surface)).toEqual(['patient']);
  });

  it('records the session against the human, without the credential', async () => {
    const { app, sink } = build();
    await post(app, TOKENS.clinicianA, { language: 'en-US' });

    const event = sink.events.find(
      (entry) => entry.event.action === 'agent.realtimeSession'
    )?.event;
    expect(event).toMatchObject({ outcome: 'success', actorType: 'user' });
    expect(event?.metadata).toMatchObject({
      language: 'en-US',
      surface: 'staff',
      expiresAt: new Date(FIXED_NOW.getTime() + 60_000).toISOString(),
    });
    expect(JSON.stringify(sink.events.map((entry) => entry.event.metadata))).not.toContain(
      'synthetic-ephemeral-session-value'
    );
  });

  it('needs a bearer token', async () => {
    const response = await build().app.request(PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ language: 'en-US' }),
    });
    expect(response.status).toBe(401);
  });
});

describe('what a client may ask for', () => {
  it.each([
    ['tools', { tools: [{ type: 'function', name: 'orders.create' }] }],
    ['instructions', { instructions: 'Answer the patient yourself.' }],
    ['a model', { model: 'something-larger' }],
    ['audio output', { modalities: ['audio', 'text'] }],
    ['a subject', { subject: SUBJECTS.billerA }],
  ])('refuses a request for %s rather than ignoring it', async (_label, extra) => {
    const minter = recorder();
    const response = await post(build(minter).app, TOKENS.clinicianA, {
      language: 'en-US',
      ...extra,
    });
    expect(response.status).toBe(422);
    expect(minter.calls).toEqual([]);
  });

  it('refuses a language the configured service does not transcribe', async () => {
    const minter = recorder();
    const response = await post(build(minter).app, TOKENS.clinicianA, { language: 'fr-FR' });
    expect(response.status).toBe(422);
    expect(minter.calls).toEqual([]);
  });
});

describe('the chart check', () => {
  it('passes a chart the clinician has a care relationship with, and records the access', async () => {
    const { app, dataset, sink } = build();
    seedPatients(dataset, 1);
    seedCareRelationship(dataset, { patientId: testId(1), providerId: SUBJECTS.clinicianA });

    const response = await post(app, TOKENS.clinicianA, {
      language: 'en-US',
      chartPatientId: testId(1),
    });
    expect(response.status).toBe(200);
    expect(sink.events.map((entry) => entry.event.action)).toContain('chart.access');
    expect(
      sink.events.find((entry) => entry.event.action === 'agent.realtimeSession')?.event.patientId
    ).toBe(testId(1));
  });

  it('refuses a chart with no care relationship as absent, and mints nothing', async () => {
    const minter = recorder();
    const { app, dataset } = build(minter);
    seedPatients(dataset, 1);

    const response = await post(app, TOKENS.clinicianA, {
      language: 'en-US',
      chartPatientId: testId(1),
    });
    expect(response.status).toBe(404);
    expect(minter.calls).toEqual([]);
  });

  it('refuses a named chart for a role that cannot open charts', async () => {
    const minter = recorder();
    const { app, dataset } = build(minter);
    seedPatients(dataset, 1);
    // A relationship, so the only thing refusing this is the missing permission.
    seedCareRelationship(dataset, { patientId: testId(1), providerId: testId(78) });

    const response = await post(app, TOKENS.auditorA, {
      language: 'en-US',
      chartPatientId: testId(1),
    });
    expect(response.status).toBe(404);
    expect(minter.calls).toEqual([]);
  });

  it('passes a portal caller naming its own chart', async () => {
    const response = await post(build().app, TOKENS.portalA, {
      language: 'en-US',
      chartPatientId: DEMO_PORTAL_PATIENT,
    });
    expect(response.status).toBe(200);
  });

  it('refuses a portal caller naming another chart, rather than correcting it', async () => {
    const minter = recorder();
    const response = await post(build(minter).app, TOKENS.portalA, {
      language: 'en-US',
      chartPatientId: testId(700),
    });
    expect(response.status).toBe(404);
    expect(minter.calls).toEqual([]);
  });
});

describe('a minter that misbehaves', () => {
  it.each([
    ['one that outlives the ceiling', 61_000],
    ['one already expired', 0],
    ['one that expired before it was issued', -1_000],
  ])('does not pass on %s', async (_label, lifetimeMs) => {
    const minter = recorder(() =>
      Promise.resolve({
        credential: 'synthetic-ephemeral-session-value',
        expiresAt: new Date(FIXED_NOW.getTime() + lifetimeMs),
      })
    );
    const response = await post(build(minter).app, TOKENS.clinicianA, { language: 'en-US' });
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain('synthetic-ephemeral-session-value');
  });

  it('does not pass on one whose expiry is not a date', async () => {
    const minter = recorder(() =>
      Promise.resolve({
        credential: 'synthetic-ephemeral-session-value',
        expiresAt: new Date(Number.NaN),
      })
    );
    const response = await post(build(minter).app, TOKENS.clinicianA, { language: 'en-US' });
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain('synthetic-ephemeral-session-value');
  });

  it('passes on one exactly at the ceiling', async () => {
    const minter = recorder(() =>
      Promise.resolve({
        credential: 'synthetic-ephemeral-session-value',
        expiresAt: new Date(FIXED_NOW.getTime() + 60_000),
      })
    );
    expect((await post(build(minter).app, TOKENS.clinicianA, { language: 'en-US' })).status).toBe(
      200
    );
  });

  it('does not pass on an empty credential', async () => {
    const minter = recorder(() =>
      Promise.resolve({ credential: '', expiresAt: new Date(FIXED_NOW.getTime() + 30_000) })
    );
    expect((await post(build(minter).app, TOKENS.clinicianA, { language: 'en-US' })).status).toBe(
      502
    );
  });

  it('does not pass on the vendor error', async () => {
    const minter = recorder(() => Promise.reject(new Error('account acct-synthetic over quota')));
    const response = await post(build(minter).app, TOKENS.clinicianA, { language: 'en-US' });
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain('acct-synthetic');
  });
});

describe('the daily ceiling', () => {
  it('refuses once a practice has spent its sessions, and records the refusal', async () => {
    const minter = recorder();
    const { app, sink } = build(minter, { dailySessions: 2 });

    const statuses: number[] = [];
    for (let index = 0; index < 3; index += 1) {
      statuses.push((await post(app, TOKENS.clinicianA, { language: 'en-US' })).status);
    }

    expect(statuses).toEqual([200, 200, 409]);
    expect(minter.calls).toHaveLength(2);
    expect(
      sink.events.find(
        (entry) =>
          entry.event.action === 'agent.realtimeSession' && entry.event.outcome === 'failure'
      )?.event.metadata
    ).toMatchObject({ reason: 'daily-session-budget-exhausted' });
  });

  it('holds under parallel requests while the vendor is slow', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const minter = recorder(async (request) => {
      await gate;
      return {
        credential: 'synthetic-ephemeral-session-value',
        expiresAt: new Date(FIXED_NOW.getTime() + request.expiresInSeconds * 1000),
      };
    });
    const { app } = build(minter, { dailySessions: 1 });

    const pending = Array.from({ length: 10 }, () =>
      post(app, TOKENS.clinicianA, { language: 'en-US' })
    );
    // Every request is past its checks and waiting on the vendor, or refused.
    await new Promise((resolve) => setTimeout(resolve, 50));
    release();
    const statuses = (await Promise.all(pending)).map((response) => response.status);

    expect(statuses.filter((status) => status === 200)).toHaveLength(1);
    expect(statuses.filter((status) => status === 409)).toHaveLength(9);
    expect(minter.calls).toHaveLength(1);
  });

  it('gives back a slot whose credential it refused to pass on', async () => {
    let expired = true;
    const minter = recorder((request) =>
      Promise.resolve({
        credential: 'synthetic-ephemeral-session-value',
        expiresAt: new Date(FIXED_NOW.getTime() + (expired ? 0 : request.expiresInSeconds * 1000)),
      })
    );
    const { app } = build(minter, { dailySessions: 1 });

    expect((await post(app, TOKENS.clinicianA, { language: 'en-US' })).status).toBe(502);
    expired = false;
    expect((await post(app, TOKENS.clinicianA, { language: 'en-US' })).status).toBe(200);
  });

  it('does not give a slot taken yesterday back to today', async () => {
    let now = FIXED_NOW;
    let failFirst: (error: Error) => void = () => undefined;
    const first = new Promise<MintedRealtimeSession>((_resolve, reject) => {
      failFirst = reject;
    });
    let calls = 0;
    const minter = recorder((request) => {
      calls += 1;
      if (calls === 1) return first;
      return Promise.resolve({
        credential: 'synthetic-ephemeral-session-value',
        expiresAt: new Date(now.getTime() + request.expiresInSeconds * 1000),
      });
    });
    const { app } = createTestApp({
      agent: AGENT,
      now: () => now,
      realtime: { minter, subsystem: { status: 'enabled', config: config({ dailySessions: 1 }) } },
    });

    // Yesterday's request takes its slot and waits on the vendor past midnight.
    const straddling = post(app, TOKENS.clinicianA, { language: 'en-US' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    now = new Date(FIXED_NOW.getTime() + 86_400_000);
    // Today's only slot is taken.
    expect((await post(app, TOKENS.clinicianA, { language: 'en-US' })).status).toBe(200);
    // Yesterday's mint fails; its slot must not come back as one of today's.
    failFirst(new Error('down'));
    expect((await straddling).status).toBe(502);
    expect((await post(app, TOKENS.clinicianA, { language: 'en-US' })).status).toBe(409);
  });

  it('spends nothing on a session the vendor failed to issue', async () => {
    let fail = true;
    const minter = recorder((request) => {
      if (fail) return Promise.reject(new Error('down'));
      return Promise.resolve({
        credential: 'synthetic-ephemeral-session-value',
        expiresAt: new Date(FIXED_NOW.getTime() + request.expiresInSeconds * 1000),
      });
    });
    const { app } = build(minter, { dailySessions: 1 });

    expect((await post(app, TOKENS.clinicianA, { language: 'en-US' })).status).toBe(502);
    fail = false;
    expect((await post(app, TOKENS.clinicianA, { language: 'en-US' })).status).toBe(200);
  });

  it('starts again the next day', async () => {
    let now = FIXED_NOW;
    const minter = recorder((request) =>
      Promise.resolve({
        credential: 'synthetic-ephemeral-session-value',
        expiresAt: new Date(now.getTime() + request.expiresInSeconds * 1000),
      })
    );
    const { app } = createTestApp({
      agent: AGENT,
      now: () => now,
      realtime: { minter, subsystem: { status: 'enabled', config: config({ dailySessions: 1 }) } },
    });

    expect((await post(app, TOKENS.clinicianA, { language: 'en-US' })).status).toBe(200);
    expect((await post(app, TOKENS.clinicianA, { language: 'en-US' })).status).toBe(409);
    now = new Date(FIXED_NOW.getTime() + 86_400_000);
    expect((await post(app, TOKENS.clinicianA, { language: 'en-US' })).status).toBe(200);
  });

  it('counts each practice separately', async () => {
    const { app } = build(recorder(), { dailySessions: 1 });
    expect((await post(app, TOKENS.clinicianA, { language: 'en-US' })).status).toBe(200);
    expect((await post(app, TOKENS.clinicianB, { language: 'en-US' })).status).toBe(200);
  });
});

describe('reading the configuration', () => {
  it('is disabled by default', () => {
    expect(loadRealtimeSubsystem({}).status).toBe('disabled');
  });

  it('reads a complete configuration, with its defaults', () => {
    expect(loadRealtimeSubsystem(ENV)).toEqual({
      status: 'enabled',
      config: {
        endpoint: ENV[REALTIME_ENV.endpoint],
        agreement: ENV[REALTIME_ENV.agreement],
        responsibleParty: ENV[REALTIME_ENV.responsibleParty],
        languages: ['en-US', 'es'],
        turnDetection: 'server',
        maxTtlSeconds: 60,
        dailySessions: 500,
      },
    });
  });

  it('reads the optional settings when given', () => {
    const loaded = loadRealtimeSubsystem({
      ...ENV,
      [REALTIME_ENV.turnDetection]: 'manual',
      [REALTIME_ENV.maxTtlSeconds]: '600',
      [REALTIME_ENV.dailySessions]: '12',
    });
    expect(loaded).toMatchObject({
      status: 'enabled',
      config: { turnDetection: 'manual', maxTtlSeconds: 600, dailySessions: 12 },
    });
  });

  it.each([
    ['an endpoint that is not a URL', { [REALTIME_ENV.endpoint]: 'not a url' }, 'is not a URL'],
    [
      'an endpoint in the clear',
      { [REALTIME_ENV.endpoint]: 'ws://speech.example.test' },
      'https or wss',
    ],
    ['no agreement', { [REALTIME_ENV.agreement]: ' ' }, REALTIME_ENV.agreement],
    [
      'no responsible party',
      { [REALTIME_ENV.responsibleParty]: '' },
      REALTIME_ENV.responsibleParty,
    ],
    ['no languages', { [REALTIME_ENV.languages]: ' , ' }, REALTIME_ENV.languages],
    ['languages left unset', { [REALTIME_ENV.languages]: undefined }, REALTIME_ENV.languages],
    ['an unknown turn detection', { [REALTIME_ENV.turnDetection]: 'auto' }, 'server or manual'],
    ['a lifetime past the ceiling', { [REALTIME_ENV.maxTtlSeconds]: '601' }, 'from 1 to 600'],
    ['a zero lifetime', { [REALTIME_ENV.maxTtlSeconds]: '0' }, 'from 1 to 600'],
    ['a fractional lifetime', { [REALTIME_ENV.maxTtlSeconds]: '1.5' }, 'from 1 to 600'],
    ['a zero allowance', { [REALTIME_ENV.dailySessions]: '0' }, 'positive whole number'],
  ])('refuses %s', (_label, overrides, reason) => {
    const loaded = loadRealtimeSubsystem({ ...ENV, ...overrides });
    expect(loaded.status).toBe('misconfigured');
    expect(loaded.status === 'misconfigured' ? loaded.reason : '').toContain(reason);
  });

  it('accepts an https endpoint as well as wss', () => {
    expect(
      loadRealtimeSubsystem({ ...ENV, [REALTIME_ENV.endpoint]: 'https://speech.example.test' })
        .status
    ).toBe('enabled');
  });
});
