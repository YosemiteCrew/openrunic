import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AssistantLauncher, AssistantPanel, AssistantProvider } from '@/components/assistant';
import { CommandProvider } from '@/components/command';
import type { AgentAvailability, AgentCapabilities } from '@/lib/agent';

/**
 * Stopping voice capture has to stop it. The panel simulates a capture with a
 * chain of delayed transitions, and a stop that only resets the state leaves
 * those transitions queued: the session walks itself back into processing and
 * then playing seconds after the clinician asked it to stop.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => '/schedule',
}));

const BILLER_CAPABILITIES: AgentCapabilities = {
  model: {
    modelId: 'local/qwen-2.5-32b',
    endpointHost: 'inference.internal:8000',
    remote: false,
    dataLeavesDeployment: false,
  },
  tools: [
    {
      id: 'authorisation.reviewEvidence',
      tier: 'READ',
      summary: 'Reviews authorisation evidence.',
      requiredScopes: ['claim.read'],
      approval: 'never',
    },
  ],
};

const ENABLED: AgentAvailability = { status: 'enabled', capabilities: BILLER_CAPABILITIES };

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

async function openVoicePanel() {
  const view = render(
    <CommandProvider>
      <AssistantProvider probe={() => Promise.resolve(ENABLED)}>
        <AssistantLauncher />
        <AssistantPanel />
      </AssistantProvider>
    </CommandProvider>
  );
  const launcher = await screen.findByRole('button', { name: 'Assistant' });
  fireEvent.click(launcher);
  return view;
}

async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
  });
}

describe('assistant voice controls', () => {
  it('cancels queued transitions when the session is stopped', async () => {
    const { unmount } = await openVoicePanel();

    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(screen.getByRole('button', { name: 'Start' })).toBeTruthy();

    // Checked at each point the chain would have moved, not only at the end:
    // the chain returns to idle by itself after 3500ms, so a single assertion
    // once every timer has drained passes whether or not stop cancelled them.
    await advance(600); // the queued move into processing
    expect(screen.getByRole('button', { name: 'Start' })).toBeTruthy();
    expect(screen.queryAllByText('Reviewing evidence...')).toHaveLength(0);

    await advance(1000); // the queued move into playing
    expect(screen.getByRole('button', { name: 'Start' })).toBeTruthy();
    expect(screen.queryAllByText('Reading evidence review...')).toHaveLength(0);

    await advance(2000);
    expect(screen.getByRole('button', { name: 'Start' })).toBeTruthy();

    unmount();
  });

  it('drops the queued transitions when the panel goes away', async () => {
    const { unmount } = await openVoicePanel();

    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    unmount();

    // Counted rather than observed through state: React 19 silently drops a
    // setState after unmount, so the leak is only visible as a live timer.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('still walks the simulation through to idle when it is not stopped', async () => {
    await openVoicePanel();

    fireEvent.click(screen.getByRole('button', { name: 'Start' }));

    await advance(600);
    expect(screen.getAllByText('Reviewing evidence...').length).toBeGreaterThan(0);

    await advance(1000);
    expect(screen.getAllByText('Reading evidence review...').length).toBeGreaterThan(0);

    await advance(2000);
    expect(screen.getByRole('button', { name: 'Start' })).toBeTruthy();
  });
});
