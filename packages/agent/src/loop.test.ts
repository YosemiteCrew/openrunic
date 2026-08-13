import {
  createV1Registry,
  defineTool,
  createToolRegistry,
  type AgentPrincipal,
  type ApiClient,
  type ApiRequest,
  type ToolAllowlist,
} from '@openrunic/agent-tools';
import {
  OTHER_TENANT_ID,
  TEST_PATIENT_ID,
  recordingApiClient,
  stubCredential,
  stubPrincipal,
} from '@openrunic/agent-tools/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { ApprovalRegistry } from './approval.js';
import { createMemoryTranscriptStore, type AgentAuditEvent, type AgentAuditSink } from './audit.js';
import { BudgetGuard } from './budget.js';
import { DEFAULT_BUDGET } from './config.js';
import type { AgentEvent } from './events.js';
import { AgentLoop } from './loop.js';
import { buildModelProfile, MAXIMAL_CAPABILITIES, type ModelProfile } from './model-profile.js';
import { compliantAttackerModel, scriptedModel } from './testing/scripted-model.js';

/**
 * The loop, under the worst case.
 *
 * Several suites here drive a **maximally compliant attacker model**: one that
 * does exactly what any instruction in its context says, with no judgement of
 * its own. If a control only holds because a model declined, it is not a
 * control. Every refusal below has to come from the architecture.
 */

const SECRET = 'a-test-signing-secret-of-sufficient-length';

const PATIENT_PAGE = {
  data: [
    {
      id: TEST_PATIENT_ID,
      mrn: 'MRN-0001',
      name: { given: 'Testina', family: 'Patientsson' },
      birthDate: '1985-04-02',
      active: true,
    },
  ],
  page: { total: 1 },
};

const ALL_SCOPES = [
  'patient.read',
  'appointment.read',
  'appointment.write',
  'encounter.read',
  'encounter.write',
  'claim.read',
  'claim.write',
  'task.read',
  'task.write',
  'form.read',
  'form.write',
];

function profile(overrides: Partial<ModelProfile> = {}): ModelProfile {
  const base = buildModelProfile(
    { specificationVersion: 'v3' } as unknown as ModelProfile['provider'],
    {
      providerKind: 'openai-compatible',
      baseUrl: 'http://vllm:8000/v1',
      modelId: 'a-locally-served-model',
      phiEgress: 'none',
    },
    { supports: MAXIMAL_CAPABILITIES }
  );
  return { ...base, ...overrides };
}

class CollectingSink implements AgentAuditSink {
  readonly events: AgentAuditEvent[] = [];
  record(event: AgentAuditEvent): void {
    this.events.push(event);
  }
}

interface Harness {
  loop: AgentLoop;
  audit: CollectingSink;
  api: ReturnType<typeof recordingApiClient>;
  approvals: ApprovalRegistry;
}

function harness(options: {
  script?: Parameters<typeof scriptedModel>[0];
  client?: ConstructorParameters<typeof AgentLoop>[0]['client'];
  api?: ApiClient;
  profile?: ModelProfile;
  registry?: ReturnType<typeof createV1Registry>;
  allowlist?: ToolAllowlist;
}): Harness {
  const audit = new CollectingSink();
  const api = recordingApiClient(() => PATIENT_PAGE);
  const approvals = new ApprovalRegistry(SECRET);

  const loop = new AgentLoop({
    registry: options.registry ?? createV1Registry(),
    profile: options.profile ?? profile(),
    client: options.client ?? scriptedModel(options.script ?? []),
    api: options.api ?? api,
    approvals,
    budget: new BudgetGuard(DEFAULT_BUDGET),
    audit,
    transcripts: createMemoryTranscriptStore(),
    ...(options.allowlist === undefined ? {} : { allowlist: options.allowlist }),
    now: () => 1_700_000_000_000,
    newId: () => 'run-fixed',
  });

  return { loop, audit, api, approvals };
}

async function drain(events: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const collected: AgentEvent[] = [];
  for await (const event of events) collected.push(event);
  return collected;
}

function clinician(overrides: Partial<AgentPrincipal> = {}): AgentPrincipal {
  return stubPrincipal({ roleIds: ['clinician'], scopes: ALL_SCOPES, ...overrides });
}

const credential = stubCredential();

describe('a read turn', () => {
  it('streams prose, names its steps and reports what it read', async () => {
    const { loop } = harness({
      script: [
        { toolCalls: [{ toolName: 'chart.search', input: { resource: 'patient', text: 'Pat' } }] },
        { text: 'One patient matches.' },
      ],
    });

    const events = await drain(
      loop.run({
        principal: clinician(),
        credential,
        message: 'Find the patient called Patientsson.',
        turnIndex: 0,
      })
    );

    expect(events.map((event) => event.type)).toContain('step');
    expect(events.map((event) => event.type)).toContain('text-delta');
    expect(events.find((event) => event.type === 'sources')).toMatchObject({
      entries: [{ resourceType: 'Patient', untrusted: false }],
    });
    expect(events.at(-1)).toMatchObject({ type: 'turn-finished', outcome: 'completed' });
  });

  it('writes one chained turn event with the agent recorded beside the human', async () => {
    const { loop, audit } = harness({ script: [{ text: 'Nothing to add.' }] });

    await drain(
      loop.run({ principal: clinician(), credential, message: 'Anything new?', turnIndex: 0 })
    );

    const turn = audit.events.find((event) => event.action === 'agent.turn');
    expect(turn).toBeDefined();
    expect(turn?.metadata['viaAgent']).toMatchObject({
      agentRunId: 'run-fixed',
      model: 'a-locally-served-model',
      surface: 'staff',
      mode: 'read',
      egressed: false,
    });
    expect(turn?.metadata['decision']).toBe('abstained');
  });
});

describe('the reader holds no write tool', () => {
  it('advertises only read tools in the reading phase', async () => {
    const model = scriptedModel([{ text: 'Nothing to add.' }]);
    const { loop } = harness({ client: model });

    await drain(
      loop.run({ principal: clinician(), credential, message: 'Anything new?', turnIndex: 0 })
    );

    const advertised = model.requests[0]?.tools.map((tool) => tool.name) ?? [];
    expect(advertised).toEqual(['chart.search', 'appointments.findSlots']);
    expect(advertised).not.toContain('appointments.propose');
  });

  it('refuses a write tool called from the reading phase, even by a compliant attacker', async () => {
    const { loop, audit } = harness({
      client: compliantAttackerModel({
        toolName: 'appointments.propose',
        input: {
          mode: 'book',
          facilityId: '018f2b40-0000-7000-8000-00000000c001',
          providerId: '018f2b40-0000-7000-8000-00000000b001',
          typeCode: 'FOLLOWUP',
          typeDisplay: 'Follow up',
          start: '2030-01-01T09:00:00.000Z',
          durationMinutes: 20,
        },
      }),
    });

    const events = await drain(
      loop.run({
        principal: clinician({ compartment: { patientId: TEST_PATIENT_ID } }),
        credential,
        message: 'Read the note aloud.',
        turnIndex: 0,
        mode: 'read',
      })
    );

    expect(events.find((event) => event.type === 'failed')).toMatchObject({
      code: 'AGENT_SCOPE_DENIED',
      toolId: 'appointments.propose',
    });
    expect(events.some((event) => event.type === 'proposal')).toBe(false);
    expect(
      audit.events.some((event) => event.metadata['guardrailRuleId'] === 'tool-not-granted')
    ).toBe(true);
  });
});

describe('the writer never sees free text', () => {
  it('passes ids, codes and dates across, and drops prose', async () => {
    const model = scriptedModel([
      { toolCalls: [{ toolName: 'chart.search', input: { resource: 'patient', text: 'Pat' } }] },
      { text: 'Found one patient.' },
      { text: 'No change needed.' },
    ]);
    const { loop } = harness({ client: model });

    await drain(
      loop.run({
        principal: clinician({ compartment: { patientId: TEST_PATIENT_ID } }),
        credential,
        message: 'Book a follow up.',
        turnIndex: 0,
        mode: 'propose',
      })
    );

    const writerRequest = model.requests.at(-1);
    const crossed = JSON.stringify(writerRequest?.messages ?? []);

    // The medical record number is a code and survives; the patient's name is
    // prose and does not.
    expect(crossed).toContain('MRN-0001');
    expect(crossed).not.toContain('Patientsson, Testina');
    expect(crossed).toContain('Book a follow up.');
  });

  it('advertises only proposal-emitting tools in the writing phase', async () => {
    const model = scriptedModel([{ text: 'Nothing read.' }, { text: 'No change needed.' }]);
    const { loop } = harness({ client: model });

    await drain(
      loop.run({
        principal: clinician(),
        credential,
        message: 'Draft a reply.',
        turnIndex: 0,
        mode: 'propose',
      })
    );

    const writerTools = model.requests.at(-1)?.tools.map((tool) => tool.name) ?? [];
    expect(writerTools).not.toContain('chart.search');
    expect(writerTools).toContain('messages.draftReply');
  });
});

describe('a proposal', () => {
  it('is emitted pending, with a signed token, and nothing is written', async () => {
    const { loop, api } = harness({
      script: [
        { text: 'Read nothing.' },
        {
          toolCalls: [
            {
              toolName: 'appointments.propose',
              input: {
                mode: 'book',
                facilityId: '018f2b40-0000-7000-8000-00000000c001',
                providerId: '018f2b40-0000-7000-8000-00000000b001',
                typeCode: 'FOLLOWUP',
                typeDisplay: 'Follow up',
                start: '2030-01-01T09:00:00.000Z',
                durationMinutes: 20,
              },
            },
          ],
        },
      ],
    });

    const events = await drain(
      loop.run({
        principal: clinician({ compartment: { patientId: TEST_PATIENT_ID } }),
        credential,
        message: 'Book a follow up next year.',
        turnIndex: 0,
        mode: 'propose',
      })
    );

    const proposal = events.find((event) => event.type === 'proposal');
    expect(proposal).toMatchObject({ toolId: 'appointments.propose' });
    expect(api.calls.every((call) => call.request.method === 'GET')).toBe(true);
  });

  it('reports an out-of-envelope request as deferred rather than guessing', async () => {
    const { loop } = harness({
      script: [
        { text: 'Read nothing.' },
        {
          toolCalls: [
            {
              toolName: 'appointments.propose',
              input: {
                mode: 'book',
                facilityId: '018f2b40-0000-7000-8000-00000000c001',
                providerId: '018f2b40-0000-7000-8000-00000000b001',
                typeCode: 'SURGERY',
                typeDisplay: 'Surgery',
                start: '2030-01-01T09:00:00.000Z',
                durationMinutes: 20,
              },
            },
          ],
        },
      ],
    });

    const events = await drain(
      loop.run({
        principal: clinician({ compartment: { patientId: TEST_PATIENT_ID } }),
        credential,
        message: 'Book surgery.',
        turnIndex: 0,
        mode: 'propose',
      })
    );

    expect(events.find((event) => event.type === 'deferred')).toMatchObject({
      toolId: 'appointments.propose',
    });
  });
});

describe('approval', () => {
  let subject: Harness;
  let committed: ApiRequest[];

  beforeEach(() => {
    committed = [];
    const api: ApiClient = {
      call: (request) => {
        committed.push(request);
        return Promise.resolve(request.method === 'GET' ? PATIENT_PAGE : { id: 'created' });
      },
    };
    subject = harness({ api });
  });

  it('commits through the same endpoint the human interface uses', async () => {
    const input = {
      threadId: '018f2b40-0000-7000-8000-000000011001',
      body: 'Your results are in the portal.',
      derivedFromPatientText: true,
    };
    const { token } = subject.approvals.register({
      agentRunId: 'run-fixed',
      principal: clinician(),
      toolId: 'messages.draftReply',
      input,
      proposal: {
        kind: 'message.replyDraft',
        effect: [{ label: 'Status', value: 'unsent draft' }],
        affects: [],
        commit: {
          method: 'POST',
          path: '/bff/v0/tasks',
          body: { kind: 'message-reply-draft', status: 'awaiting-review' },
        },
        derivedFromUntrusted: true,
      },
      requiredScopes: ['task.write'],
    });

    const result = await subject.loop.approve({
      token,
      input,
      approver: clinician(),
      credential,
    });

    expect(result.ok).toBe(true);
    expect(committed.at(-1)).toMatchObject({ method: 'POST', path: '/bff/v0/tasks' });
    expect(
      subject.audit.events.some(
        (event) => event.metadata['decision'] === 'approved' && event.outcome === 'success'
      )
    ).toBe(true);
  });

  it('refuses a swapped input and commits nothing', async () => {
    const { token } = subject.approvals.register({
      agentRunId: 'run-fixed',
      principal: clinician(),
      toolId: 'appointments.propose',
      input: { appointmentId: 'appointment-123' },
      proposal: {
        kind: 'appointment.reschedule',
        effect: [{ label: 'Appointment', value: 'appointment-123' }],
        affects: [],
        commit: { method: 'PATCH', path: '/bff/v0/appointments/appointment-123', body: {} },
        derivedFromUntrusted: false,
      },
      requiredScopes: ['appointment.write'],
    });

    const result = await subject.loop.approve({
      token,
      input: { appointmentId: 'appointment-456' },
      approver: clinician(),
      credential,
    });

    expect(result).toMatchObject({ ok: false, code: 'AGENT_APPROVAL_INVALID' });
    expect(committed).toEqual([]);
    expect(
      subject.audit.events.some((event) => event.metadata['guardrailRuleId'] === 'input-changed')
    ).toBe(true);
  });

  it('records a rejection as loudly as an approval', async () => {
    const { proposal } = subject.approvals.register({
      agentRunId: 'run-fixed',
      principal: clinician(),
      toolId: 'coding.suggest',
      input: {},
      proposal: {
        kind: 'claim.codingSuggestion',
        effect: [{ label: 'Codes suggested', value: '1' }],
        affects: [],
        commit: { method: 'PATCH', path: '/bff/v0/claims/abc', body: {} },
        derivedFromUntrusted: false,
      },
      requiredScopes: ['claim.write'],
    });

    expect(await subject.loop.reject(proposal.proposalId, clinician())).toBe(true);
    expect(await subject.loop.reject(proposal.proposalId, clinician())).toBe(false);
    expect(subject.audit.events.some((event) => event.metadata['decision'] === 'rejected')).toBe(
      true
    );
  });
});

describe('a cross-tenant result', () => {
  it('aborts the turn instead of filtering the row out', async () => {
    const crossTenant = defineTool({
      id: 'probe.read',
      tier: 'READ',
      trustClass: 'reader',
      approval: 'never',
      requiredScopes: ['patient.read'],
      surfaces: ['staff'],
      summary: 'Returns a row.',
      activityLabel: 'Reading',
      maxResultRows: 5,
      compartmentBound: false,
      input: z.strictObject({}),
      output: z.object({ tenantId: z.string() }),
      execute: () => Promise.resolve({ tenantId: OTHER_TENANT_ID }),
    });

    // Granted on purpose, so the tool actually runs and the refusal comes from
    // the boundary re-check rather than from the allowlist.
    const { loop, audit } = harness({
      registry: createToolRegistry([crossTenant]),
      allowlist: { staff: { clinician: ['probe.read'] }, patient: {} },
      script: [
        { toolCalls: [{ toolName: 'probe.read', input: {} }] },
        { text: 'this step is never reached' },
      ],
    });

    const events = await drain(
      loop.run({ principal: clinician(), credential, message: 'Read it.', turnIndex: 0 })
    );

    expect(events.find((event) => event.type === 'failed')).toMatchObject({
      code: 'AGENT_COMPARTMENT_VIOLATION',
      toolId: 'probe.read',
    });
    expect(events.at(-1)).toMatchObject({ type: 'turn-finished', outcome: 'failed' });
    expect(audit.events.some((event) => event.metadata['guardrailRuleId'] === 'compartment')).toBe(
      true
    );
  });

  it('reaches the API as the calling human, in the calling human organisation', async () => {
    const seen: { tenantId: string; authorization: string }[] = [];
    const { loop } = harness({
      script: [
        { toolCalls: [{ toolName: 'chart.search', input: { resource: 'patient' } }] },
        { text: 'done' },
      ],
      api: {
        call: (_request, context) => {
          seen.push({
            tenantId: context.principal.tenantId,
            authorization: context.credential.authorization,
          });
          return Promise.resolve(PATIENT_PAGE);
        },
      },
    });

    await drain(
      loop.run({
        principal: clinician({ tenantId: OTHER_TENANT_ID }),
        credential,
        message: 'Find them.',
        turnIndex: 0,
      })
    );

    // No agent identity anywhere on the call: the API authorises the human, in
    // the human's own organisation, exactly as it does for the browser.
    expect(seen).toEqual([{ tenantId: OTHER_TENANT_ID, authorization: 'Bearer test-token' }]);
  });
});

describe('caps', () => {
  it('refuses a message longer than a turn allows, rather than truncating it', async () => {
    const { loop } = harness({ script: [{ text: 'unreachable' }] });

    const events = await drain(
      loop.run({
        principal: clinician(),
        credential,
        message: 'x'.repeat(DEFAULT_BUDGET.maxInputCharacters + 1),
        turnIndex: 0,
      })
    );

    expect(events[0]).toMatchObject({ type: 'failed', code: 'AGENT_TURN_LIMIT' });
    expect(events.at(-1)).toMatchObject({ type: 'turn-finished', outcome: 'failed' });
  });

  it('refuses a second turn while one is already running for the same person', async () => {
    const { loop } = harness({ script: [{ text: 'first' }] });
    const principal = clinician();

    const first = loop.run({ principal, credential, message: 'one', turnIndex: 0 });
    await first.next();

    const events = await drain(loop.run({ principal, credential, message: 'two', turnIndex: 1 }));
    expect(events[0]).toMatchObject({ type: 'failed', code: 'AGENT_TURN_LIMIT' });
    await drain(first);
  });

  it('stops a run that asks for more tool calls than a turn allows', async () => {
    const many = Array.from({ length: 8 }, () => ({
      toolName: 'chart.search',
      input: { resource: 'patient' as const },
    }));
    const { loop } = harness({ script: [{ toolCalls: many }] });

    const events = await drain(
      loop.run({ principal: clinician(), credential, message: 'Everything.', turnIndex: 0 })
    );

    expect(events.find((event) => event.type === 'failed')).toMatchObject({
      code: 'AGENT_TURN_LIMIT',
    });
  });

  it('stops a run that outlasts the wall clock', async () => {
    let clock = 0;
    const audit = new CollectingSink();
    const loop = new AgentLoop({
      registry: createV1Registry(),
      profile: profile(),
      client: scriptedModel([{ text: 'slow' }]),
      api: recordingApiClient(() => PATIENT_PAGE),
      approvals: new ApprovalRegistry(SECRET),
      budget: new BudgetGuard(DEFAULT_BUDGET),
      audit,
      transcripts: createMemoryTranscriptStore(),
      now: () => {
        clock += 60_001;
        return clock;
      },
    });

    const events = await drain(
      loop.run({ principal: clinician(), credential, message: 'Take your time.', turnIndex: 0 })
    );
    expect(events.find((event) => event.type === 'failed')).toMatchObject({
      code: 'AGENT_TURN_LIMIT',
    });
  });
});

describe('a failing tool', () => {
  it('reports the failure in the transcript and keeps the turn alive', async () => {
    const api: ApiClient = {
      call: () => Promise.reject(new Error('upstream is down')),
    };
    const { loop } = harness({
      api,
      script: [
        { toolCalls: [{ toolName: 'chart.search', input: { resource: 'patient' } }] },
        { text: 'I could not read the chart.' },
      ],
    });

    const events = await drain(
      loop.run({ principal: clinician(), credential, message: 'Look it up.', turnIndex: 0 })
    );

    expect(events.find((event) => event.type === 'failed')).toMatchObject({
      toolId: 'chart.search',
    });
    expect(events.at(-1)).toMatchObject({ type: 'turn-finished', outcome: 'completed' });
  });

  it('allows exactly one repair round-trip on malformed arguments', async () => {
    const model = scriptedModel([
      { toolCalls: [{ toolName: 'chart.search', input: { resource: 'nonsense' } }] },
      { toolCalls: [{ toolName: 'chart.search', input: { resource: 'patient' } }] },
      { text: 'One patient matches.' },
    ]);
    const { loop } = harness({ client: model });

    const events = await drain(
      loop.run({ principal: clinician(), credential, message: 'Find them.', turnIndex: 0 })
    );

    expect(events.find((event) => event.type === 'sources')).toBeDefined();
    expect(model.requests.length).toBeGreaterThanOrEqual(3);
  });
});

describe('visibleTools', () => {
  it('answers the capabilities question for the current principal', () => {
    const { loop } = harness({});
    expect(loop.visibleTools(clinician()).map((tool) => tool.id)).toContain('chart.search');
    expect(loop.visibleTools(stubPrincipal({ roleIds: [] }))).toEqual([]);
  });
});
