import {
  createAgentRuntime,
  scriptedModel,
  type AgentAuditEvent,
  type AgentRuntime,
  type ScriptedStep,
} from '@openrunic/agent';
import type { ApiCallContext, ApiClient, ApiRequest } from '@openrunic/agent-tools';
import type { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { createAuditBridge } from '../agent/runtime.js';
import type { AppEnv } from '../context.js';

import {
  bearer,
  createTestApp,
  DEMO_FACILITY_A,
  jsonBearer,
  makePatientRow,
  seed,
  testId,
  TOKENS,
} from './support.js';

/**
 * A proposal, confirmed, all the way to a row.
 *
 * This is the one test that proves the whole shape of ADR-0005's write path:
 * the turn produces a **proposal** and writes nothing; the confirmation is a
 * fresh authenticated action by a person who independently holds the
 * permission; and the commit goes through `POST /bff/v0/appointments`, the same
 * endpoint the human interface calls, with that person's own session.
 *
 * The tools' HTTP client dispatches into this same app, so every hop runs the
 * real middleware chain.
 */

const AGENT_ENV = {
  OPENRUNIC_AGENT_BASE_URL: 'http://vllm:8000/v1',
  OPENRUNIC_AGENT_MODEL: 'a-locally-served-model',
  OPENRUNIC_AGENT_APPROVAL_SECRET: 'a-test-signing-secret-of-sufficient-length',
};

const PROVIDER_ID = testId(900);
const PATIENT_ID = testId(1);

/** Comfortably outside the envelope's lead time, whenever the suite runs. */
const START = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

const BOOKING_INPUT = {
  mode: 'book' as const,
  facilityId: DEMO_FACILITY_A,
  providerId: PROVIDER_ID,
  typeCode: 'FOLLOWUP',
  typeDisplay: 'Follow up',
  start: START,
  durationMinutes: 20,
};

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

      if (!response.ok) throw new Error(`the API answered ${String(response.status)}`);
      return response.json();
    },
  };
}

function createAgentApp(script: readonly ScriptedStep[]) {
  const holder: { app?: Hono<AppEnv> } = {};
  const bridge = createAuditBridge();

  const runtime: AgentRuntime = createAgentRuntime({
    env: AGENT_ENV,
    api: inProcessApiClient(() => {
      if (holder.app === undefined) throw new Error('the app is not built yet');
      return holder.app;
    }),
    audit: bridge.sink,
    approvalSecret: AGENT_ENV.OPENRUNIC_AGENT_APPROVAL_SECRET,
    modelClient: scriptedModel(script),
  });
  if (runtime.status !== 'enabled') throw new Error('expected an enabled runtime');

  const built = createTestApp({ agent: runtime, agentAudit: bridge });
  seed(built.dataset, 'Patient', makePatientRow({ id: PATIENT_ID }));
  holder.app = built.app;
  return built;
}

interface ProposalEvent {
  type: 'proposal';
  proposalId: string;
  toolId: string;
  approvalSignature: string;
}

async function proposeBooking(app: Hono<AppEnv>): Promise<ProposalEvent> {
  const response = await app.request('/bff/v0/agent/turns', {
    method: 'POST',
    headers: jsonBearer(TOKENS.frontDeskA),
    body: JSON.stringify({
      message: 'Book a follow up for this patient next month.',
      mode: 'propose',
      chartPatientId: PATIENT_ID,
    }),
  });

  const events = (await response.text())
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice(6)) as { type: string });

  const proposal = events.find((event): event is ProposalEvent => event.type === 'proposal');
  if (proposal === undefined) {
    throw new Error(`no proposal was emitted: ${events.map((event) => event.type).join(', ')}`);
  }
  return proposal;
}

const SCRIPT: ScriptedStep[] = [
  { text: 'I read nothing in particular.' },
  { toolCalls: [{ toolName: 'appointments.propose', input: BOOKING_INPUT }] },
];

describe('a proposal, end to end', () => {
  it('writes nothing until a person confirms it', async () => {
    const { app, dataset } = createAgentApp(SCRIPT);
    const proposal = await proposeBooking(app);

    expect(proposal.toolId).toBe('appointments.propose');
    expect(dataset.table('Appointment')).toHaveLength(0);
  });

  it('commits through the endpoint the human interface uses', async () => {
    const { app, dataset, sink } = createAgentApp(SCRIPT);
    const proposal = await proposeBooking(app);

    const response = await app.request(`/bff/v0/agent/proposals/${proposal.proposalId}/approve`, {
      method: 'POST',
      headers: jsonBearer(TOKENS.frontDeskA),
      body: JSON.stringify({ signature: proposal.approvalSignature, input: BOOKING_INPUT }),
    });

    expect(response.status).toBe(200);
    expect(dataset.table('Appointment')).toHaveLength(1);
    expect(dataset.table('Appointment')[0]).toMatchObject({
      patientId: PATIENT_ID,
      typeCode: 'FOLLOWUP',
      // The person who confirmed it is the one who booked it; that the
      // assistant drafted it lives in the audit chain's delegation field.
      createdVia: 'STAFF',
    });

    const approval = sink.events.find(
      (entry) => entry.event.metadata['decision'] === 'approved'
    )?.event;
    expect(approval?.outcome).toBe('success');
    expect(approval?.metadata['approverUserId']).toBeDefined();
  });

  it('refuses the same confirmation a second time', async () => {
    const { app, dataset } = createAgentApp(SCRIPT);
    const proposal = await proposeBooking(app);
    const body = JSON.stringify({
      signature: proposal.approvalSignature,
      input: BOOKING_INPUT,
    });

    const first = await app.request(`/bff/v0/agent/proposals/${proposal.proposalId}/approve`, {
      method: 'POST',
      headers: jsonBearer(TOKENS.frontDeskA),
      body,
    });
    const second = await app.request(`/bff/v0/agent/proposals/${proposal.proposalId}/approve`, {
      method: 'POST',
      headers: jsonBearer(TOKENS.frontDeskA),
      body,
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(dataset.table('Appointment')).toHaveLength(1);
  });

  it('refuses a confirmation whose input was swapped after it was shown', async () => {
    const { app, dataset } = createAgentApp(SCRIPT);
    const proposal = await proposeBooking(app);

    const response = await app.request(`/bff/v0/agent/proposals/${proposal.proposalId}/approve`, {
      method: 'POST',
      headers: jsonBearer(TOKENS.frontDeskA),
      body: JSON.stringify({
        signature: proposal.approvalSignature,
        // Same shape, longer appointment. This is the attack the binding exists
        // for: the sentence a human read described twenty minutes.
        input: { ...BOOKING_INPUT, durationMinutes: 120 },
      }),
    });

    expect(response.status).toBe(409);
    expect(dataset.table('Appointment')).toHaveLength(0);
  });

  it('refuses a confirmation from someone who does not hold the permission', async () => {
    const { app, dataset } = createAgentApp(SCRIPT);
    const proposal = await proposeBooking(app);

    const response = await app.request(`/bff/v0/agent/proposals/${proposal.proposalId}/approve`, {
      method: 'POST',
      headers: jsonBearer(TOKENS.billerA),
      body: JSON.stringify({ signature: proposal.approvalSignature, input: BOOKING_INPUT }),
    });

    expect(response.status).toBe(409);
    expect(dataset.table('Appointment')).toHaveLength(0);
  });

  it('refuses a confirmation from another organisation', async () => {
    const { app, dataset } = createAgentApp(SCRIPT);
    const proposal = await proposeBooking(app);

    const response = await app.request(`/bff/v0/agent/proposals/${proposal.proposalId}/approve`, {
      method: 'POST',
      headers: jsonBearer(TOKENS.clinicianB),
      body: JSON.stringify({ signature: proposal.approvalSignature, input: BOOKING_INPUT }),
    });

    expect(response.status).toBe(409);
    expect(dataset.table('Appointment')).toHaveLength(0);
  });

  it('discards a proposal, and records the discard', async () => {
    const { app, dataset, sink } = createAgentApp(SCRIPT);
    const proposal = await proposeBooking(app);

    const response = await app.request(`/bff/v0/agent/proposals/${proposal.proposalId}/reject`, {
      method: 'POST',
      headers: jsonBearer(TOKENS.frontDeskA),
    });

    expect(response.status).toBe(204);
    expect(dataset.table('Appointment')).toHaveLength(0);
    expect(sink.events.some((entry) => entry.event.metadata['decision'] === 'rejected')).toBe(true);

    // Once discarded, the confirmation cannot be used.
    const approval = await app.request(`/bff/v0/agent/proposals/${proposal.proposalId}/approve`, {
      method: 'POST',
      headers: jsonBearer(TOKENS.frontDeskA),
      body: JSON.stringify({ signature: proposal.approvalSignature, input: BOOKING_INPUT }),
    });
    expect(approval.status).toBe(409);
  });

  it('needs a bearer token to confirm or to discard', async () => {
    const { app } = createAgentApp(SCRIPT);
    const proposal = await proposeBooking(app);

    for (const suffix of ['approve', 'reject']) {
      const response = await app.request(
        `/bff/v0/agent/proposals/${proposal.proposalId}/${suffix}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ signature: proposal.approvalSignature, input: BOOKING_INPUT }),
        }
      );
      expect(response.status, suffix).toBe(401);
    }
  });

  it('reports a commit the API refuses, rather than claiming a save', async () => {
    const { app, dataset } = createAgentApp([
      { text: 'read nothing' },
      {
        toolCalls: [
          {
            toolName: 'appointments.propose',
            // A provider id that no facility grant covers is still a
            // well-formed proposal; the API is what refuses it on commit.
            input: { ...BOOKING_INPUT, facilityId: testId(777) },
          },
        ],
      },
    ]);
    const proposal = await proposeBooking(app);

    const response = await app.request(`/bff/v0/agent/proposals/${proposal.proposalId}/approve`, {
      method: 'POST',
      headers: jsonBearer(TOKENS.frontDeskA),
      body: JSON.stringify({
        signature: proposal.approvalSignature,
        input: { ...BOOKING_INPUT, facilityId: testId(777) },
      }),
    });

    expect(response.status).toBe(409);
    expect(dataset.table('Appointment')).toHaveLength(0);
  });
});

describe('an audit event with no request in scope', () => {
  it('is reported rather than written under a fabricated actor', async () => {
    const orphans: AgentAuditEvent[] = [];
    const bridge = createAuditBridge((event) => orphans.push(event));

    await bridge.sink.record({
      action: 'agent.turn',
      targetType: 'AgentRun',
      outcome: 'success',
      metadata: {},
    });

    expect(orphans).toHaveLength(1);
    expect(orphans[0]?.action).toBe('agent.turn');
  });
});

describe('the tools list', () => {
  it('reports an unparseable endpoint host as unknown rather than failing', async () => {
    const holder: { app?: Hono<AppEnv> } = {};
    const bridge = createAuditBridge();
    const runtime = createAgentRuntime({
      env: { ...AGENT_ENV, OPENRUNIC_AGENT_BASE_URL: 'http://vllm:8000' },
      api: inProcessApiClient(() => {
        if (holder.app === undefined) throw new Error('the app is not built yet');
        return holder.app;
      }),
      audit: bridge.sink,
      approvalSecret: AGENT_ENV.OPENRUNIC_AGENT_APPROVAL_SECRET,
      modelClient: scriptedModel([]),
      profile: { id: 'a-locally-served-model' },
    });
    if (runtime.status !== 'enabled') throw new Error('expected an enabled runtime');

    const built = createTestApp({ agent: runtime, agentAudit: bridge });
    holder.app = built.app;

    const body = (await (
      await built.app.request('/bff/v0/agent/tools', { headers: bearer(TOKENS.clinicianA) })
    ).json()) as { model: { endpointHost: string } };

    expect(body.model.endpointHost).toBe('vllm:8000');
  });
});
