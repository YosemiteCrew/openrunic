import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useAssistant, useConversation } from '@/components/assistant';
import type { RunAgentTurn } from '@/components/assistant';
import type { AgentEvent } from '@/lib/agent';

/**
 * The conversation hook on its own, for the states the panel cannot reach:
 * an empty question, a runner that dies while the caller is already stopping,
 * and an unmount with a turn still in flight.
 */

function never(): RunAgentTurn {
  return () =>
    (async function* stall(): AsyncGenerator<AgentEvent> {
      await new Promise<void>(() => {});
    })();
}

describe('useConversation', () => {
  it('does not start a turn for whitespace', () => {
    const run = vi.fn(never());
    const { result } = renderHook(() => useConversation(run));

    act(() => result.current.ask('   \n  '));

    expect(run).not.toHaveBeenCalled();
    expect(result.current.state.turns).toHaveLength(0);
  });

  it('sends the chart that is open at the moment the question is asked', async () => {
    const run = vi.fn(never());
    const { result, rerender } = renderHook(
      ({ chart }: { chart?: string }) => useConversation(run, chart),
      { initialProps: { chart: 'chart-a' } as { chart?: string } }
    );

    rerender({ chart: 'chart-b' });
    await act(async () => {
      result.current.ask('a question');
      await Promise.resolve();
    });

    expect(run.mock.calls[0]?.[0]).toMatchObject({ chartPatientId: 'chart-b' });
  });

  it('reports nothing when the runner dies because the caller stopped it', async () => {
    // Aborting a real request raises inside the stream. That is the outcome the
    // clinician chose, so the turn settles as stopped and no failure is shown.
    let raise: (() => void) | null = null;
    const run: RunAgentTurn = () =>
      (async function* dies(): AsyncGenerator<AgentEvent> {
        yield { type: 'text-delta', text: 'Two visits are recorded. And' };
        await new Promise<void>((resolve) => {
          raise = resolve;
        });
        throw new DOMException('Aborted', 'AbortError');
      })();

    const { result } = renderHook(() => useConversation(run));

    await act(async () => {
      result.current.ask('how many visits');
      await Promise.resolve();
    });
    act(() => result.current.stop());
    await act(async () => {
      raise?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.state.turns[0]?.outcome).toBe('stopped');
    expect(result.current.state.turns[0]?.failures).toEqual([]);
  });

  it('settles a turn whose runner threw for any other reason', async () => {
    const run: RunAgentTurn = () =>
      (async function* dies(): AsyncGenerator<AgentEvent> {
        await Promise.resolve();
        throw new Error('socket died');
      })();

    const { result } = renderHook(() => useConversation(run));

    await act(async () => {
      result.current.ask('how many visits');
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.state.streaming).toBe(false);
    expect(result.current.state.turns[0]?.failures[0]?.code).toBe('AGENT_TRANSPORT_FAILED');
  });

  it('releases an in-flight turn when the panel goes away', async () => {
    let seen: AbortSignal | undefined;
    const run: RunAgentTurn = (request) => {
      seen = request.signal;
      return (async function* stall(): AsyncGenerator<AgentEvent> {
        await new Promise<void>(() => {});
      })();
    };

    const { result, unmount } = renderHook(() => useConversation(run));
    await act(async () => {
      result.current.ask('how many visits');
      await Promise.resolve();
    });

    unmount();

    expect(seen?.aborted).toBe(true);
  });
});

describe('useAssistant outside a provider', () => {
  it('reports no assistant rather than throwing', () => {
    // The palette registry throws in this position because a screen with no
    // registry is a wiring bug. This one is the opposite: "there is no
    // assistant here" is the shipped default, and rendering nothing is right.
    const { result } = renderHook(() => useAssistant());

    expect(result.current.availability).toEqual({ status: 'absent' });
    expect(result.current.capabilities).toBeNull();
    expect(result.current.isOpen).toBe(false);

    act(() => {
      result.current.open();
      result.current.close();
    });

    expect(result.current.isOpen).toBe(false);
  });
});
