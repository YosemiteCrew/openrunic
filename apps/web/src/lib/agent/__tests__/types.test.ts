import { describe, expect, it } from 'vitest';

import { parseAgentCapabilities, parseAgentEvent } from '@/lib/agent';

/**
 * The surface reads a stream it did not author, from a server that may be a
 * version ahead or behind it. Every case here is about what the browser does
 * with a frame it cannot use: it ignores it. A frame that is dropped costs a
 * line of an answer; a frame that is trusted blindly costs a render.
 */

describe('parseAgentEvent', () => {
  it('reads the events a turn is made of', () => {
    expect(
      parseAgentEvent({ type: 'turn-started', agentRunId: 'run-1', turnIndex: 2, modelId: 'm' })
    ).toEqual({ type: 'turn-started', agentRunId: 'run-1', turnIndex: 2, modelId: 'm' });

    expect(parseAgentEvent({ type: 'text-delta', text: 'Seen ' })).toEqual({
      type: 'text-delta',
      text: 'Seen ',
    });

    expect(
      parseAgentEvent({ type: 'step', label: 'Searching the chart', state: 'done', toolId: 'c.s' })
    ).toEqual({ type: 'step', label: 'Searching the chart', state: 'done', toolId: 'c.s' });
  });

  it('treats an unknown step state as still running rather than as finished', () => {
    // A step wrongly shown as done is a claim that work completed. The safe
    // default is the one that claims less.
    expect(parseAgentEvent({ type: 'step', label: 'Reading' })).toEqual({
      type: 'step',
      label: 'Reading',
      state: 'active',
    });
  });

  it('keeps only the ledger entries that carry a whole reference', () => {
    const event = parseAgentEvent({
      type: 'sources',
      entries: [
        { resourceType: 'Patient', resourceId: 'p1', label: 'Patientsson, Testina' },
        { resourceType: 'Patient', label: 'no id' },
        'not an entry',
      ],
    });

    expect(event).toEqual({
      type: 'sources',
      entries: [
        {
          resourceType: 'Patient',
          resourceId: 'p1',
          label: 'Patientsson, Testina',
          untrusted: false,
        },
      ],
    });
  });

  it('reads a proposal and its effect fields', () => {
    expect(
      parseAgentEvent({
        type: 'proposal',
        proposalId: 'prop-1',
        toolId: 'appointments.propose',
        approvalSignature: 'ignored-by-this-surface',
        proposal: {
          kind: 'appointment.book',
          effect: [{ label: 'Starts', value: '09:00' }, { label: 'bad' }],
          derivedFromUntrusted: true,
        },
      })
    ).toEqual({
      type: 'proposal',
      proposalId: 'prop-1',
      toolId: 'appointments.propose',
      proposal: {
        kind: 'appointment.book',
        effect: [{ label: 'Starts', value: '09:00' }],
        derivedFromUntrusted: true,
      },
    });
  });

  it('keeps a proposal whose effect list is unreadable, with no effect fields', () => {
    // The card then shows a draft with nothing in it, which is honest. Dropping
    // the proposal entirely would hide that the server proposed something.
    expect(
      parseAgentEvent({
        type: 'proposal',
        proposalId: 'p',
        toolId: 't',
        proposal: { kind: 'appointment.book', effect: 'Starts at 09:00' },
      })
    ).toMatchObject({ proposal: { effect: [], derivedFromUntrusted: false } });
  });

  it('reads a deferral and a failure', () => {
    expect(parseAgentEvent({ type: 'deferred', toolId: 'a.b', reason: 'no slot' })).toEqual({
      type: 'deferred',
      toolId: 'a.b',
      reason: 'no slot',
    });

    expect(
      parseAgentEvent({ type: 'failed', code: 'AGENT_TURN_LIMIT', detail: 'ran long' })
    ).toEqual({ type: 'failed', code: 'AGENT_TURN_LIMIT', detail: 'ran long' });
  });

  it('reads any outcome that is not "completed" as a failure', () => {
    expect(
      parseAgentEvent({ type: 'turn-finished', outcome: 'weather', usage: { inputTokens: 3 } })
    ).toEqual({
      type: 'turn-finished',
      outcome: 'failed',
      usage: { inputTokens: 3, outputTokens: 0, costCents: 0 },
    });
  });

  it('settles a turn whose usage block is missing or nonsense', () => {
    // Never a reason to lose the finish event: usage is an operator figure and
    // the turn has to settle whatever shape it arrives in.
    expect(parseAgentEvent({ type: 'turn-finished', outcome: 'completed' })).toEqual({
      type: 'turn-finished',
      outcome: 'completed',
      usage: { inputTokens: 0, outputTokens: 0, costCents: 0 },
    });

    expect(
      parseAgentEvent({
        type: 'turn-finished',
        outcome: 'completed',
        usage: { inputTokens: Number.NaN, outputTokens: '12' },
      })
    ).toMatchObject({ usage: { inputTokens: 0, outputTokens: 0 } });
  });

  it.each([
    ['a type this build has never seen', { type: 'telepathy', text: 'hello' }],
    ['a frame with no type at all', { text: 'hello' }],
    ['a frame that is not an object', 'turn-started'],
    ['a text delta with no text', { type: 'text-delta' }],
    ['a start with no run id', { type: 'turn-started', modelId: 'm' }],
    ['a step with no label', { type: 'step', state: 'done' }],
    ['a source list that is not a list', { type: 'sources', entries: 'Patient/1' }],
    ['a proposal with no proposal', { type: 'proposal', proposalId: 'p', toolId: 't' }],
    [
      'a proposal with no kind',
      { type: 'proposal', proposalId: 'p', toolId: 't', proposal: { effect: [] } },
    ],
    ['a deferral with no reason', { type: 'deferred', toolId: 't' }],
    ['a failure with no detail', { type: 'failed', code: 'AGENT_TURN_LIMIT' }],
  ])('drops %s', (_name, frame) => {
    expect(parseAgentEvent(frame)).toBeNull();
  });
});

describe('parseAgentCapabilities', () => {
  it('reads the model identity and the capabilities granted to this caller', () => {
    expect(
      parseAgentCapabilities({
        model: {
          modelId: 'local/qwen',
          endpointHost: 'inference.internal:8000',
          remote: false,
          dataLeavesDeployment: false,
        },
        tools: [
          {
            id: 'chart.search',
            tier: 'READ',
            summary: 'Finds records in the chart.',
            requiredScopes: ['patient.read', 7],
            approval: 'never',
          },
          { id: 'broken' },
        ],
      })
    ).toEqual({
      model: {
        modelId: 'local/qwen',
        endpointHost: 'inference.internal:8000',
        remote: false,
        dataLeavesDeployment: false,
      },
      tools: [
        {
          id: 'chart.search',
          tier: 'READ',
          summary: 'Finds records in the chart.',
          requiredScopes: ['patient.read'],
          approval: 'never',
        },
      ],
    });
  });

  it('reads a capability whose tier and policy this build does not recognise as the tightest', () => {
    // An unreadable tier must not read as a weaker one. READ and approval-always
    // are the two answers that claim the least about what the capability can do.
    const parsed = parseAgentCapabilities({
      model: { modelId: 'm', endpointHost: 'h' },
      tools: [{ id: 'x.y', summary: 'Does something.', requiredScopes: 'patient.read' }],
    });

    expect(parsed?.tools).toEqual([
      {
        id: 'x.y',
        summary: 'Does something.',
        tier: 'READ',
        approval: 'always',
        requiredScopes: [],
      },
    ]);
  });

  it('accepts an assistant that was granted nothing, which is a real state', () => {
    // Deny by default: a role with no grants sees a configured assistant that
    // can reach nothing. That is different from no assistant at all.
    const parsed = parseAgentCapabilities({
      model: { modelId: 'm', endpointHost: 'h', remote: true, dataLeavesDeployment: true },
    });
    expect(parsed?.tools).toEqual([]);
    expect(parsed?.model.dataLeavesDeployment).toBe(true);
  });

  it.each([
    ['a body with no model', { tools: [] }],
    ['a model with no id', { model: { endpointHost: 'h' } }],
    ['a model with no host', { model: { modelId: 'm' } }],
    ['a body that is not an object', 'enabled'],
  ])('reads %s as no assistant at all', (_name, body) => {
    expect(parseAgentCapabilities(body)).toBeNull();
  });
});
