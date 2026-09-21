import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { AssistantProvider, useAssistant } from '@/components/assistant/AssistantProvider';
import type { RunAgentTurn } from '@/components/assistant/transport';
import type { AgentAvailability, AgentCapabilities, AgentEvent } from '@/lib/agent';
import type { SpeechAdapter, SpeechCapability } from '@/lib/speech/types';
import { parseEvidenceReviewResult, useEvidenceReview } from '@/lib/speech/useEvidenceReview';

/**
 * Two separate gates decide whether a biller can ask this out loud: the tool
 * has to be in the capability list the server sent, and a speech provider has
 * to be configured. Either one absent is a refusal, and the refusal has to be
 * the one the assistant never ran a turn for.
 */

const REVIEW_TOOL = {
  id: 'authorisation.reviewEvidence',
  tier: 'READ' as const,
  summary: 'Reviews authorisation evidence.',
  requiredScopes: ['claim.read'],
  approval: 'never' as const,
};

const MODEL = {
  modelId: 'local/qwen-2.5-32b',
  endpointHost: 'inference.internal:8000',
  remote: false,
  dataLeavesDeployment: false,
};

function availability(tools: AgentCapabilities['tools']): AgentAvailability {
  return { status: 'enabled', capabilities: { model: MODEL, tools } };
}

function capableAdapter(): SpeechAdapter {
  return {
    name: 'Fake',
    providerId: 'fake',
    capabilities: new Set<SpeechCapability>([
      'stt-streaming',
      'tts-streaming',
      'interruption-handling',
      'partial-transcripts',
    ]),
    checkCapability: () => ({ supported: true }),
    startSession: async (config) => ({
      sessionId: config.sessionId,
      turnId: config.turnId,
      startedAt: 0,
    }),
    stopSession: async () => {},
    sendAudio: async () => {},
    speak: async () => {},
    interrupt: async () => {},
  };
}

const NO_USAGE = { inputTokens: 0, outputTokens: 0, costCents: 0 };

const CASES = [
  {
    caseId: 'case-1',
    caseType: 'prior-authorisation' as const,
    payerProfile: { system: 'http://payer.example/plans', code: 'PLAN-A' },
  },
];

function renderReview(options: {
  tools?: AgentCapabilities['tools'];
  isBiller?: boolean;
  adapter?: SpeechAdapter;
  events?: AgentEvent[];
}) {
  const runTurn: RunAgentTurn = vi.fn(async function* (): AsyncGenerator<AgentEvent> {
    for (const event of options.events ?? []) yield event;
  });

  const wrapper = ({ children }: { children: ReactNode }) => (
    <AssistantProvider
      probe={() => Promise.resolve(availability(options.tools ?? [REVIEW_TOOL]))}
      runTurn={runTurn}
    >
      {children}
    </AssistantProvider>
  );

  const view = renderHook(
    () => ({
      review: useEvidenceReview({
        isBiller: options.isBiller ?? true,
        sessionId: 'session-1',
        chartId: 'chart-1',
        surface: 'staff',
        ...(options.adapter === undefined ? {} : { adapter: options.adapter }),
      }),
      // The capability probe resolves a tick after the first render, and until
      // it does `capabilities` is null and every gate reads false for the
      // wrong reason. Tests wait on this, never on a gate's own answer.
      probed: useAssistant().availability.status === 'enabled',
    }),
    { wrapper }
  );

  return { ...view, runTurn };
}

describe('useEvidenceReview gating', () => {
  it('refuses when no speech provider is configured, even for a biller with the tool', async () => {
    const { result, runTurn } = renderReview({});

    await waitFor(() => expect(result.current.probed).toBe(true));
    expect(result.current.review.speech.available).toBe(false);
    expect(result.current.review.canReviewEvidence).toBe(false);

    await act(async () => {
      await result.current.review.reviewEvidence(CASES);
    });
    expect(runTurn).not.toHaveBeenCalled();
  });

  it('refuses when the user is not a biller', async () => {
    const { result, runTurn } = renderReview({ adapter: capableAdapter(), isBiller: false });

    await waitFor(() => expect(result.current.probed).toBe(true));
    expect(result.current.review.speech.available).toBe(true);
    expect(result.current.review.canReviewEvidence).toBe(false);

    await act(async () => {
      await result.current.review.reviewEvidence(CASES);
    });
    expect(runTurn).not.toHaveBeenCalled();
  });

  it('refuses when the server did not offer the evidence tool', async () => {
    // The three conjuncts are asserted one at a time. A fixture that failed
    // two of them at once could not tell which one the code actually reads.
    const { result, runTurn } = renderReview({ adapter: capableAdapter(), tools: [] });

    await waitFor(() => expect(result.current.probed).toBe(true));
    expect(result.current.review.speech.available).toBe(true);
    expect(result.current.review.canReviewEvidence).toBe(false);

    await act(async () => {
      await result.current.review.reviewEvidence(CASES);
    });
    expect(runTurn).not.toHaveBeenCalled();
  });

  it('allows the review when the role, the tool and the provider are all present', async () => {
    const { result } = renderReview({ adapter: capableAdapter() });

    await waitFor(() => expect(result.current.review.canReviewEvidence).toBe(true));
  });
});

describe('useEvidenceReview turn', () => {
  it('runs a turn that names every case and its payer, scoped to the chart', async () => {
    const { result, runTurn } = renderReview({
      adapter: capableAdapter(),
      events: [{ type: 'turn-finished', outcome: 'completed', usage: NO_USAGE }],
    });
    await waitFor(() => expect(result.current.review.canReviewEvidence).toBe(true));

    await act(async () => {
      await result.current.review.reviewEvidence([
        ...CASES,
        {
          caseId: 'case-2',
          caseType: 'denied-claim',
          payerProfile: { system: 'http://payer.example/plans', code: 'PLAN-B' },
        },
      ]);
    });

    expect(runTurn).toHaveBeenCalledTimes(1);
    expect(runTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        chartPatientId: 'chart-1',
        message: expect.stringContaining('prior-authorisation case-1 with payer PLAN-A'),
      })
    );
    expect(runTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('denied-claim case-2 with payer PLAN-B'),
      })
    );
  });

  it('drives the generator to completion rather than only calling it', async () => {
    // `runTurn` is an async generator: a call that is awaited but never
    // iterated runs no turn at all and the tool is never invoked. Counting
    // the events that came back is what separates the two.
    const seen: string[] = [];
    const events: AgentEvent[] = [
      { type: 'step', label: 'Reviewing evidence', state: 'active', toolId: REVIEW_TOOL.id },
      { type: 'text-delta', text: 'Two requirements are missing.' },
      { type: 'turn-finished', outcome: 'completed', usage: NO_USAGE },
    ];
    const runTurn: RunAgentTurn = vi.fn(async function* (): AsyncGenerator<AgentEvent> {
      for (const event of events) {
        seen.push(event.type);
        yield event;
      }
    });

    const wrapper = ({ children }: { children: ReactNode }) => (
      <AssistantProvider
        probe={() => Promise.resolve(availability([REVIEW_TOOL]))}
        runTurn={runTurn}
      >
        {children}
      </AssistantProvider>
    );
    const { result } = renderHook(
      () =>
        useEvidenceReview({
          isBiller: true,
          sessionId: 'session-1',
          chartId: 'chart-1',
          surface: 'staff',
          adapter: capableAdapter(),
        }),
      { wrapper }
    );
    await waitFor(() => expect(result.current.canReviewEvidence).toBe(true));

    await act(async () => {
      await result.current.reviewEvidence(CASES);
    });

    expect(seen).toEqual(['step', 'text-delta', 'turn-finished']);
  });

  it('stops reading the stream once the turn fails', async () => {
    const after = vi.fn();
    const runTurn: RunAgentTurn = vi.fn(async function* (): AsyncGenerator<AgentEvent> {
      yield { type: 'failed', code: 'TOOL_DENIED', detail: 'no claim scope' };
      after();
      yield { type: 'turn-finished', outcome: 'failed', usage: NO_USAGE };
    });

    const wrapper = ({ children }: { children: ReactNode }) => (
      <AssistantProvider
        probe={() => Promise.resolve(availability([REVIEW_TOOL]))}
        runTurn={runTurn}
      >
        {children}
      </AssistantProvider>
    );
    const { result } = renderHook(
      () =>
        useEvidenceReview({
          isBiller: true,
          sessionId: 'session-1',
          chartId: 'chart-1',
          surface: 'staff',
          adapter: capableAdapter(),
        }),
      { wrapper }
    );
    await waitFor(() => expect(result.current.canReviewEvidence).toBe(true));

    await act(async () => {
      await result.current.reviewEvidence(CASES);
    });

    expect(after).not.toHaveBeenCalled();
  });
});

describe('parseEvidenceReviewResult', () => {
  const review = {
    caseType: 'prior-authorisation',
    status: 'awaiting-evidence',
    missingRequirements: [{ label: 'Imaging', satisfied: false, reason: 'no report on file' }],
    evidence: [{ label: 'Progress note', resourceType: 'DocumentReference' }],
  };

  it('reads the first review out of a tool result', () => {
    expect(parseEvidenceReviewResult({ reviews: [review] })).toEqual(review);
  });

  it('defaults the two list fields rather than returning them undefined', () => {
    // A caller that spoke `undefined.length` would throw mid-readback, which
    // is worse than saying nothing is missing.
    expect(
      parseEvidenceReviewResult({ reviews: [{ caseType: 'denied-claim', status: 'denied' }] })
    ).toEqual({
      caseType: 'denied-claim',
      status: 'denied',
      missingRequirements: [],
      evidence: [],
    });
  });

  it.each([
    ['null', null],
    ['a string', 'reviews'],
    ['a number', 7],
    ['an object with no reviews', {}],
    ['a non-array reviews field', { reviews: 'one' }],
    ['an empty reviews array', { reviews: [] }],
    ['a review with no case type', { reviews: [{ status: 'denied' }] }],
    ['a review with no status', { reviews: [{ caseType: 'denied-claim' }] }],
  ])('returns null for %s', (_label, input) => {
    expect(parseEvidenceReviewResult(input)).toBeNull();
  });
});
