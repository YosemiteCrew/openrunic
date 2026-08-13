import {
  createAgentRuntime,
  scriptedModel,
  type AgentRuntime,
  type ScriptedStep,
} from '@openrunic/agent';
import type { ApiCallContext, ApiClient, ApiRequest } from '@openrunic/agent-tools';
import type { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { createAuditBridge, loadAgentRuntime, toAgentPrincipal } from '../agent/runtime.js';
import type { AppEnv } from '../context.js';
import { PERMISSIONS } from '../policy/permissions.js';

import {
  bearer,
  createTestApp,
  DEMO_PORTAL_PATIENT,
  jsonBearer,
  makeAppointmentRow,
  seed,
  seedPatients,
  testId,
  TOKENS,
  UNPRIVILEGED_TOKEN,
} from './support.js';

/**
 * The assistant surface, and the state the product ships in.
 *
 * The first suite is the one that matters most: with no model configured the
 * agent routes do not exist, every other route behaves identically, and the
 * whole suite passes. That is ADR-0005's agent-disabled guarantee, expressed as
 * a test rather than as an intention.
 *
 * Where the agent is enabled below, its tools are given an {@link ApiClient}
 * that dispatches into **this same Hono app**. So an agent-initiated read runs
 * the real middleware chain - authentication, tenant scope, policy, the audit
 * collector - exactly as a browser request does. A test double that answered
 * without the chain would be testing a second authorisation implementation,
 * which is the thing ADR-0005 exists to prevent.
 */

const LOCAL_ENV = {
  OPENRUNIC_AGENT_BASE_URL: 'http://vllm:8000/v1',
  OPENRUNIC_AGENT_MODEL: 'a-locally-served-model',
  OPENRUNIC_AGENT_APPROVAL_SECRET: 'a-test-signing-secret-of-sufficient-length',
};

/** Dispatches a tool's HTTP call into the app under test, credential and all. */
function inProcessApiClient(getApp: () => Hono<AppEnv>): ApiClient {
  return {
    async call(request: ApiRequest, context: ApiCallContext): Promise<unknown> {
      const query =
        request.query === undefined
          ? ''
          : `?${Object.entries(request.query)
              .filter(([, value]) => value !== undefined)
              .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
              .join('&')}`;

      const response = await getApp().request(`${request.path}${query}`, {
        method: request.method,
        headers: {
          authorization: context.credential.authorization,
          'x-openrunic-tenant': context.principal.tenantId,
          ...(request.body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
      });

      if (!response.ok) {
        throw new Error(`the API answered ${String(response.status)}`);
      }
      return response.json();
    },
  };
}

interface EnabledApp {
  app: Hono<AppEnv>;
  sink: ReturnType<typeof createTestApp>['sink'];
  dataset: ReturnType<typeof createTestApp>['dataset'];
}

function createAgentApp(script: readonly ScriptedStep[]): EnabledApp {
  const holder: { app?: Hono<AppEnv> } = {};
  const bridge = createAuditBridge();

  const runtime: AgentRuntime = createAgentRuntime({
    env: LOCAL_ENV,
    api: inProcessApiClient(() => {
      if (holder.app === undefined) throw new Error('the app is not built yet');
      return holder.app;
    }),
    audit: bridge.sink,
    approvalSecret: LOCAL_ENV.OPENRUNIC_AGENT_APPROVAL_SECRET,
    modelClient: scriptedModel(script),
  });

  if (runtime.status !== 'enabled')
    throw new Error(`expected an enabled runtime: ${runtime.status}`);

  const built = createTestApp({ agent: runtime, agentAudit: bridge });
  holder.app = built.app;
  return { app: built.app, sink: built.sink, dataset: built.dataset };
}

async function readStream(response: Response): Promise<Record<string, unknown>[]> {
  const text = await response.text();
  return text
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>);
}

describe('with no model configured', () => {
  it('does not serve the assistant capabilities at all', async () => {
    const { app } = createTestApp({ agent: { status: 'disabled', reason: 'no model' } });
    const response = await app.request('/bff/v0/agent/tools', {
      headers: bearer(TOKENS.clinicianA),
    });

    // 404, not 403. A 403 would confirm the feature exists.
    expect(response.status).toBe(404);
  });

  it('does not serve a turn, an approval or a rejection', async () => {
    const { app } = createTestApp({ agent: { status: 'disabled', reason: 'no model' } });

    for (const path of [
      '/bff/v0/agent/turns',
      `/bff/v0/agent/proposals/${testId(1)}/approve`,
      `/bff/v0/agent/proposals/${testId(1)}/reject`,
    ]) {
      const response = await app.request(path, {
        method: 'POST',
        headers: jsonBearer(TOKENS.clinicianA),
        body: '{}',
      });
      expect(response.status, path).toBe(404);
    }
  });

  it('leaves the clinical routes exactly as they were', async () => {
    const { app, dataset } = createTestApp({ agent: { status: 'disabled', reason: 'no model' } });
    seedPatients(dataset, 3);

    const response = await app.request('/bff/v0/patients', { headers: bearer(TOKENS.clinicianA) });
    expect(response.status).toBe(200);
  });

  it('keeps the assistant out of the published specification', async () => {
    const { app } = createTestApp({ agent: { status: 'disabled', reason: 'no model' } });
    const document = (await (await app.request('/openapi.json')).json()) as {
      paths: Record<string, unknown>;
    };

    expect(Object.keys(document.paths).some((path) => path.includes('/agent/'))).toBe(false);
  });

  it('is what the environment produces by default', () => {
    expect(loadAgentRuntime({ env: {} }).status).toBe('disabled');
  });

  it('refuses to enable without a signing secret for confirmations', () => {
    const reasons: string[] = [];
    const runtime = loadAgentRuntime({
      env: {
        OPENRUNIC_AGENT_BASE_URL: 'http://vllm:8000/v1',
        OPENRUNIC_AGENT_MODEL: 'a-locally-served-model',
      },
      onMisconfigured: (reason) => reasons.push(reason),
    });

    expect(runtime.status).toBe('misconfigured');
    expect(reasons[0]).toMatch(/required to sign confirmations/);
  });

  it('reports a misconfigured endpoint rather than throwing at startup', () => {
    const reasons: string[] = [];
    const runtime = loadAgentRuntime({
      env: {
        OPENRUNIC_AGENT_BASE_URL: 'https://api.example-provider.test/v1',
        OPENRUNIC_AGENT_MODEL: 'a-hosted-model',
        OPENRUNIC_AGENT_APPROVAL_SECRET: 'a-test-signing-secret-of-sufficient-length',
      },
      onMisconfigured: (reason) => reasons.push(reason),
    });

    expect(runtime.status).toBe('misconfigured');
    expect(reasons[0]).toMatch(/nothing else is affected/);
  });
});

describe('listing capabilities', () => {
  it('returns what this caller can reach, and names the model behind it', async () => {
    const { app } = createAgentApp([]);
    const response = await app.request('/bff/v0/agent/tools', {
      headers: bearer(TOKENS.clinicianA),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      model: { modelId: string; dataLeavesDeployment: boolean };
      tools: { id: string }[];
    };

    expect(body.model).toEqual({
      modelId: 'a-locally-served-model',
      endpointHost: 'vllm:8000',
      remote: false,
      dataLeavesDeployment: false,
    });
    expect(body.tools.map((tool) => tool.id)).toContain('chart.search');
    expect(body.tools.map((tool) => tool.id)).not.toContain('coding.suggest');
  });

  it('returns an empty list rather than a refusal for a role that holds nothing', async () => {
    const { app } = createAgentApp([]);
    const response = await app.request('/bff/v0/agent/tools', {
      headers: bearer(UNPRIVILEGED_TOKEN),
    });

    expect(response.status).toBe(200);
    expect(((await response.json()) as { tools: unknown[] }).tools).toEqual([]);
  });

  it('needs a bearer token like everything else', async () => {
    const { app } = createAgentApp([]);
    expect((await app.request('/bff/v0/agent/tools')).status).toBe(401);
  });

  it('documents itself once it exists', async () => {
    const { app } = createAgentApp([]);
    const document = (await (await app.request('/openapi.json')).json()) as {
      paths: Record<string, unknown>;
    };
    expect(document.paths['/bff/v0/agent/tools']).toBeDefined();
  });
});

describe('running a turn', () => {
  it('streams events, and reaches the chart through the real middleware chain', async () => {
    const { app, dataset, sink } = createAgentApp([
      { toolCalls: [{ toolName: 'chart.search', input: { resource: 'patient' } }] },
      { text: 'Three patients match.' },
    ]);
    seedPatients(dataset, 3);

    const response = await app.request('/bff/v0/agent/turns', {
      method: 'POST',
      headers: jsonBearer(TOKENS.clinicianA),
      body: JSON.stringify({ message: 'Who is on the list?' }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/text\/event-stream/);

    const events = await readStream(response);
    expect(events.map((event) => event.type)).toContain('turn-started');
    expect(events.map((event) => event.type)).toContain('sources');
    expect(events.at(-1)).toMatchObject({ type: 'turn-finished', outcome: 'completed' });

    // The read went through the ordinary path, so it produced the ordinary
    // batched read event, attributed to the clinician.
    expect(sink.events.some((entry) => entry.event.action === 'phi.read')).toBe(true);
  });

  it('records the turn against the human, with the agent beside them', async () => {
    const { app, dataset, sink } = createAgentApp([{ text: 'Nothing to add.' }]);
    seedPatients(dataset, 1);

    await app.request('/bff/v0/agent/turns', {
      method: 'POST',
      headers: jsonBearer(TOKENS.clinicianA),
      body: JSON.stringify({ message: 'Anything new?' }),
    });

    const turn = sink.events.find((entry) => entry.event.action === 'agent.turn')?.event;
    expect(turn).toBeDefined();
    // The delegating human is the actor of record, so an access report still
    // answers "which human saw this chart".
    expect(turn?.actorType).toBe('user');
    expect(turn?.metadata['viaAgent']).toMatchObject({
      model: 'a-locally-served-model',
      surface: 'staff',
      mode: 'read',
    });
  });

  it('refuses a message longer than a turn allows, rather than truncating it', async () => {
    const { app } = createAgentApp([{ text: 'unreachable' }]);
    const response = await app.request('/bff/v0/agent/turns', {
      method: 'POST',
      headers: jsonBearer(TOKENS.clinicianA),
      body: JSON.stringify({ message: 'x'.repeat(9000) }),
    });

    expect(response.status).toBe(422);
  });

  it('needs a bearer token', async () => {
    const { app } = createAgentApp([]);
    const response = await app.request('/bff/v0/agent/turns', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'hello' }),
    });
    expect(response.status).toBe(401);
  });

  it('answers a portal turn from the chart on the token, not the one the body named', async () => {
    const { app, dataset } = createAgentApp([
      { toolCalls: [{ toolName: 'visits.list', input: { when: 'upcoming' } }] },
      { text: 'You have one appointment booked.' },
    ]);
    seedPatients(dataset, 1);
    seed(
      dataset,
      'Appointment',
      makeAppointmentRow({
        patientId: DEMO_PORTAL_PATIENT,
        /* Relative to the real clock, because the capability computes its own
           window from `Date.now()` rather than being told one. A fixed date
           would quietly stop being upcoming. */
        start: new Date(Date.now() + 86_400_000),
        end: new Date(Date.now() + 88_200_000),
      })
    );

    const response = await app.request('/bff/v0/agent/turns', {
      method: 'POST',
      headers: jsonBearer(TOKENS.portalA),
      // Somebody else's chart, which is what a tampered client would send.
      body: JSON.stringify({ message: 'When am I next in?', chartPatientId: testId(700) }),
    });

    const events = await readStream(response);

    /* The compartment came from the token, so the reader's own appointment
       matches it and the boundary re-check passes. Had the body been believed,
       the turn would have been bound to a chart this API never answers for, and
       the reader's own row would have aborted it on the way out. */
    expect(events.find((event) => event.type === 'failed')).toBeUndefined();
    expect(events.find((event) => event.type === 'sources')).toMatchObject({
      entries: [{ resourceType: 'Appointment' }],
    });
    expect(events.at(-1)).toMatchObject({ type: 'turn-finished', outcome: 'completed' });
  });
});

describe('confirming a proposal', () => {
  it('refuses a confirmation that was never issued', async () => {
    const { app } = createAgentApp([]);
    const response = await app.request(`/bff/v0/agent/proposals/${testId(1)}/approve`, {
      method: 'POST',
      headers: jsonBearer(TOKENS.frontDeskA),
      body: JSON.stringify({ signature: 'a'.repeat(64), input: {} }),
    });

    expect(response.status).toBe(409);
    const body = (await response.json()) as { title: string };
    expect(body.title).toBe('AGENT_APPROVAL_INVALID');
  });

  it('records the refusal, because a denial is the event an investigation needs', async () => {
    const { app, sink } = createAgentApp([]);
    await app.request(`/bff/v0/agent/proposals/${testId(1)}/approve`, {
      method: 'POST',
      headers: jsonBearer(TOKENS.frontDeskA),
      body: JSON.stringify({ signature: 'a'.repeat(64), input: {} }),
    });

    expect(
      sink.events.some(
        (entry) =>
          entry.event.action === 'agent.toolCall' &&
          entry.event.metadata['decision'] === 'blocked_by_guardrail'
      )
    ).toBe(true);
  });

  it('reports an unknown proposal as absent when discarding it', async () => {
    const { app } = createAgentApp([]);
    const response = await app.request(`/bff/v0/agent/proposals/${testId(1)}/reject`, {
      method: 'POST',
      headers: jsonBearer(TOKENS.clinicianA),
    });
    expect(response.status).toBe(404);
  });

  it('rejects an id that is not a UUID rather than looking it up', async () => {
    const { app } = createAgentApp([]);
    const response = await app.request('/bff/v0/agent/proposals/not-an-id/reject', {
      method: 'POST',
      headers: jsonBearer(TOKENS.clinicianA),
    });
    expect(response.status).toBe(400);
  });
});

describe('the principal handed to the loop', () => {
  it('carries only the permissions the human independently holds', () => {
    const principal = toAgentPrincipal({
      subject: testId(900),
      tenantId: testId(1),
      actorType: 'user',
      roles: ['biller'],
      facilityIds: [],
      // The broad grant a real billing token carries, deliberately wider than
      // the one role above. The assertion that `encounter.write` is absent
      // therefore shows the loop's capabilities are resolved from the role by
      // the policy layer, rather than being the token's own breadth carried
      // across.
      scopes: ['user/*.read', 'user/*.write'],
      purposeOfUse: 'HPAYMT',
    });

    expect(principal.surface).toBe('staff');
    expect(principal.scopes).toContain('claim.write');
    expect(principal.scopes).not.toContain('encounter.write');
    expect(principal.compartment).toEqual({});
  });

  it('puts a portal caller on the patient surface, which is granted nothing', () => {
    const principal = toAgentPrincipal({
      subject: testId(1),
      tenantId: testId(1),
      actorType: 'patient',
      roles: [],
      facilityIds: [],
      // The scope set a portal launch issues. It grants reads at the FHIR
      // boundary and still buys nothing here, because the surface is decided
      // by who the actor is rather than by what the token asked for.
      scopes: ['patient/*.read', 'launch/patient'],
      purposeOfUse: 'TREAT',
    });
    expect(principal.surface).toBe('patient');
  });

  it('carries the open chart, which can only narrow what a tool may return', () => {
    const principal = toAgentPrincipal(
      {
        subject: testId(900),
        tenantId: testId(1),
        actorType: 'user',
        roles: ['clinician'],
        facilityIds: [],
        // Chart-wide by the token's own account. That the compartment below is
        // still one patient is the narrowing this test is named for.
        scopes: ['user/*.read', 'user/*.write'],
        purposeOfUse: 'TREAT',
      },
      testId(5)
    );
    expect(principal.compartment).toEqual({ patientId: testId(5) });
  });

  it('binds a token that names its own chart to that chart, and reads no chart from the request', () => {
    const portal = {
      subject: testId(1),
      tenantId: testId(1),
      actorType: 'patient' as const,
      roles: ['patient-portal'],
      facilityIds: [],
      scopes: ['patient/*.read', 'launch/patient'],
      // The launch context on a portal token. It is the only chart the
      // repositories behind this session will answer for, so it is the only
      // chart a capability may be asked to check its rows against.
      compartmentPatientId: testId(1),
      purposeOfUse: 'TREAT',
    };

    // With a chart named in the request, and with none: the same answer, which
    // is the point. ADR-0006 gives this surface no way to change chart.
    expect(toAgentPrincipal(portal, testId(7)).compartment).toEqual({ patientId: testId(1) });
    expect(toAgentPrincipal(portal).compartment).toEqual({ patientId: testId(1) });

    // The rule is the token's, not the surface's: a staff session launched
    // against one chart is bound by its token in exactly the same way.
    const confinedStaff = toAgentPrincipal(
      { ...portal, actorType: 'user', roles: ['clinician'] },
      testId(7)
    );
    expect(confinedStaff.surface).toBe('staff');
    expect(confinedStaff.compartment).toEqual({ patientId: testId(1) });
  });
});

describe('the scopes the catalogue names', () => {
  it('are permissions this API actually has, except the ones tracked as pending', async () => {
    const { createV1Registry } = await import('@openrunic/agent-tools');

    /**
     * `audit.query` is declared by the catalogue but is not yet a permission
     * here, and `/bff/v0/audit-events` is not yet a route. No principal can
     * hold it, so the tool is invisible to every caller: deny-by-default
     * working as designed rather than a gap being hidden. It becomes reachable
     * the day the platform grows both, with no change to the registry.
     */
    const PENDING: readonly string[] = ['audit.query'];
    const known = new Set<string>([...PERMISSIONS, ...PENDING]);

    for (const tool of createV1Registry().tools) {
      for (const scope of tool.requiredScopes) {
        expect(known.has(scope), `${tool.id} needs ${scope}`).toBe(true);
      }
    }
  });
});
