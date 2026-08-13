import { stubPrincipal } from '@openrunic/agent-tools/testing';
import { describe, expect, it } from 'vitest';

import {
  assertAuditMetadataShape,
  createHashOnlyTranscriptStore,
  createMemoryTranscriptStore,
  toolCallAuditEvent,
  turnAuditEvent,
} from './audit.js';
import { hashOf } from './hash.js';

/**
 * The regression guard that stops "just log the prompt in metadata".
 *
 * Anything written into the chained event's metadata is inside the hash, so it
 * can never be redacted, corrected or erased without destroying the tenant's
 * chain from that point forward. That is a lawful-erasure landmine, and it is
 * the single most likely way an agent feature damages this codebase.
 */

const principal = stubPrincipal();

const turn = {
  agentRunId: '018f2b40-0000-7000-8000-000000000010',
  turnIndex: 0,
  principal,
  mode: 'read' as const,
  decision: 'auto' as const,
  modelId: 'a-locally-served-model',
  endpointHost: 'vllm:8000',
  egressed: false,
  promptTemplateId: 'agent.reader',
  promptTemplateVersion: '1',
  systemPromptHash: hashOf('system'),
  toolManifestVersion: 'abcdef0123456789',
  transcriptHash: hashOf('transcript'),
  inputTokens: 800,
  outputTokens: 120,
  costCents: 1,
  latencyMs: 2400,
  retrievalSet: ['Patient/018f2b40-0000-7000-8000-000000000003'],
  disclosureShown: true,
  outcome: 'success' as const,
};

describe('assertAuditMetadataShape', () => {
  it('accepts ids, enums, hashes, numbers and booleans', () => {
    expect(() =>
      assertAuditMetadataShape({
        decision: 'approved',
        costCents: 4,
        egressed: true,
        resultIds: ['018f2b40-0000-7000-8000-000000000003'],
      })
    ).not.toThrow();
  });

  it('refuses a long string, because the hash makes it permanent', () => {
    expect(() => assertAuditMetadataShape({ note: 'x'.repeat(200) })).toThrow(
      /can never be redacted/
    );
  });

  it('refuses prose, whatever its length', () => {
    expect(() =>
      assertAuditMetadataShape({ prompt: 'summarise the last three encounters' })
    ).toThrow(/looks like prose/);
  });

  it('refuses prose hiding inside an array', () => {
    expect(() => assertAuditMetadataShape({ notes: ['a note about a patient'] })).toThrow(
      /looks like prose/
    );
  });

  it('refuses a value that is not an id, enum, number or hash at all', () => {
    expect(() =>
      assertAuditMetadataShape({
        // A nested object would sail through a naive length check.
        nested: { deep: 'value' } as unknown as string,
      })
    ).toThrow(/not an id, enum, number or hash/);
  });

  it('lets the delegation record through, because it is ids and enums by construction', () => {
    expect(() =>
      assertAuditMetadataShape({
        viaAgent: {
          agentRunId: 'run-1',
          model: 'a-locally-served-model',
          surface: 'staff',
          mode: 'read',
          endpointHost: 'vllm:8000',
          egressed: false,
        },
      })
    ).not.toThrow();
  });
});

describe('the turn event', () => {
  it('keeps the human as the actor and records the agent beside them', () => {
    const event = turnAuditEvent(turn);

    expect(event.action).toBe('agent.turn');
    expect(event.targetId).toBe(turn.agentRunId);
    expect(event.metadata['viaAgent']).toEqual({
      agentRunId: turn.agentRunId,
      model: 'a-locally-served-model',
      surface: 'staff',
      mode: 'read',
      endpointHost: 'vllm:8000',
      egressed: false,
    });
  });

  it('carries the hash of the transcript rather than the transcript', () => {
    const event = turnAuditEvent(turn);
    expect(event.metadata['transcriptHash']).toBe(turn.transcriptHash);
    expect(JSON.stringify(event)).not.toContain('summarise');
  });

  it('records what was retrieved as resource ids, so a citation stays auditable', () => {
    const event = turnAuditEvent(turn);
    expect(event.metadata['retrievalSet']).toEqual(turn.retrievalSet);
    expect(event.metadata['retrievalCount']).toBe(1);
  });

  it('names the guardrail when one fired', () => {
    const event = turnAuditEvent({
      ...turn,
      decision: 'blocked_by_guardrail',
      outcome: 'failure',
      guardrailRuleId: 'compartment',
    });
    expect(event.outcome).toBe('failure');
    expect(event.metadata['guardrailRuleId']).toBe('compartment');
  });

  it('records the provider request id when the endpoint gave one', () => {
    const event = turnAuditEvent({ ...turn, providerRequestId: 'req-0001' });
    expect(event.metadata['providerRequestId']).toBe('req-0001');
  });
});

describe('the tool call event', () => {
  it('records the arguments as a hash and a coded summary, never as arguments', () => {
    const event = toolCallAuditEvent({
      agentRunId: turn.agentRunId,
      principal,
      mode: 'propose',
      modelId: turn.modelId,
      endpointHost: turn.endpointHost,
      egressed: false,
      toolId: 'appointments.propose',
      toolArgsHash: hashOf({ typeCode: 'FOLLOWUP' }),
      argSummary: { proposalKind: 'appointment.book' },
      resultCount: 1,
      resultIds: ['018f2b40-0000-7000-8000-000000000003'],
      decision: 'proposed',
      outcome: 'success',
    });

    expect(event.action).toBe('agent.toolCall');
    expect(event.metadata['toolId']).toBe('appointments.propose');
    expect(event.metadata['proposalKind']).toBe('appointment.book');
  });

  it('records who signed, and when', () => {
    const event = toolCallAuditEvent({
      agentRunId: turn.agentRunId,
      principal,
      mode: 'execute',
      modelId: turn.modelId,
      endpointHost: turn.endpointHost,
      egressed: false,
      toolId: 'appointments.propose',
      toolArgsHash: hashOf({}),
      argSummary: {},
      resultCount: 1,
      resultIds: [],
      decision: 'approved',
      outcome: 'success',
      approverUserId: principal.userId,
      approvedAt: 1_700_000_000_000,
      guardrailRuleId: 'none',
    });

    expect(event.metadata['approverUserId']).toBe(principal.userId);
    expect(event.metadata['approvedAt']).toBe(1_700_000_000_000);
  });

  it('refuses to emit an event carrying free text, at the emitting site', () => {
    expect(() =>
      toolCallAuditEvent({
        agentRunId: turn.agentRunId,
        principal,
        mode: 'read',
        modelId: turn.modelId,
        endpointHost: turn.endpointHost,
        egressed: false,
        toolId: 'chart.search',
        toolArgsHash: hashOf({}),
        argSummary: { query: 'find every patient with back pain' },
        resultCount: 0,
        resultIds: [],
        decision: 'auto',
        outcome: 'success',
      })
    ).toThrow(/looks like prose/);
  });
});

describe('the transcript store', () => {
  const record = {
    agentRunId: turn.agentRunId,
    turnIndex: 0,
    tenantId: principal.tenantId,
    renderedPrompt: 'What is the last recorded blood pressure?',
    completion: 'Not recorded.',
    toolCalls: [],
  };

  it('keeps nothing by default, and still returns a provable hash', () => {
    const store = createHashOnlyTranscriptStore();
    expect(store.put(record)).toBe(hashOf(record));
  });

  it('keeps a bounded window when a deployer asks for one', () => {
    const store = createMemoryTranscriptStore(2);
    const first = store.put(record);
    store.put({ ...record, turnIndex: 1 });
    store.put({ ...record, turnIndex: 2 });

    expect(store.records.size).toBe(2);
    expect(store.records.has(first as string)).toBe(false);
  });
});
