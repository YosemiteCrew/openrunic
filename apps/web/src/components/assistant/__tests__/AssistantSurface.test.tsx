import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AssistantLauncher, AssistantPanel, AssistantProvider } from '@/components/assistant';
import type { ProbeAssistant, RunAgentTurn } from '@/components/assistant';
import { CommandPalette, CommandProvider } from '@/components/command';
import type { AgentAvailability, AgentCapabilities, AgentEvent } from '@/lib/agent';

/**
 * The four paths a demo never walks: nothing configured, an endpoint that is
 * down, an answer a clinician interrupts, and the whole surface driven from the
 * keyboard.
 */

const push = vi.fn();
let pathname = '/schedule';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => pathname,
}));

beforeEach(() => {
  push.mockClear();
  pathname = '/schedule';
});

const LOCAL_CAPABILITIES: AgentCapabilities = {
  model: {
    modelId: 'local/qwen-2.5-32b',
    endpointHost: 'inference.internal:8000',
    remote: false,
    dataLeavesDeployment: false,
  },
  tools: [
    {
      id: 'chart.search',
      tier: 'READ',
      summary: 'Finds records.',
      requiredScopes: ['patient.read'],
      approval: 'never',
    },
  ],
};

const ENABLED: AgentAvailability = { status: 'enabled', capabilities: LOCAL_CAPABILITIES };

const REMOTE: AgentAvailability = {
  status: 'enabled',
  capabilities: {
    tools: LOCAL_CAPABILITIES.tools,
    model: {
      modelId: 'vendor/big',
      endpointHost: 'api.vendor.example',
      remote: true,
      dataLeavesDeployment: true,
    },
  },
};

const SOURCE = {
  resourceType: 'Encounter',
  resourceId: '0192f1a0-0000-7000-8000-00000000e001',
  label: 'Office visit, 3 March',
  untrusted: false,
};

const FINISHED: AgentEvent = {
  type: 'turn-finished',
  outcome: 'completed',
  usage: { inputTokens: 1, outputTokens: 2, costCents: 0 },
};

const FAILED: AgentEvent = {
  type: 'turn-finished',
  outcome: 'failed',
  usage: { inputTokens: 0, outputTokens: 0, costCents: 0 },
};

interface RecordedRequest {
  message: string;
  turnIndex: number;
  chartPatientId?: string;
}

/** A turn the test drives event by event, so an answer can be stopped part way. */
function openChannel(): {
  run: RunAgentTurn;
  emit: (...events: readonly AgentEvent[]) => Promise<void>;
  requests: RecordedRequest[];
} {
  const queued: AgentEvent[] = [];
  const requests: RecordedRequest[] = [];
  let wake: (() => void) | null = null;

  async function* stream(): AsyncGenerator<AgentEvent> {
    for (;;) {
      const next = queued.shift();
      if (next !== undefined) {
        yield next;
        continue;
      }
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
  }

  return {
    requests,
    run: (request) => {
      requests.push({
        message: request.message,
        turnIndex: request.turnIndex,
        ...(request.chartPatientId === undefined ? {} : { chartPatientId: request.chartPatientId }),
      });
      return stream();
    },
    emit: async (...events) => {
      queued.push(...events);
      await act(async () => {
        const resume = wake;
        wake = null;
        resume?.();
        await Promise.resolve();
      });
    },
  };
}

/** A turn that answers in one go. */
function replay(...events: readonly AgentEvent[]): RunAgentTurn {
  return function run(): AsyncGenerator<AgentEvent> {
    return (async function* emit() {
      // Yielding through a resolved promise keeps this asynchronous, which is
      // how a real stream arrives: a synchronous generator would settle the
      // whole turn inside the click handler and hide every ordering bug.
      for (const event of events) {
        await Promise.resolve();
        yield event;
      }
    })();
  };
}

interface SurfaceOptions {
  probe?: ProbeAssistant;
  runTurn?: RunAgentTurn;
}

function renderSurface({ probe, runTurn }: SurfaceOptions = {}) {
  return render(
    <CommandProvider>
      <AssistantProvider
        probe={probe ?? ((): Promise<AgentAvailability> => Promise.resolve({ status: 'absent' }))}
        runTurn={runTurn ?? replay(FINISHED)}
      >
        <AssistantLauncher />
        <AssistantPanel />
        <CommandPalette />
      </AssistantProvider>
    </CommandProvider>
  );
}

async function openPanel(options: SurfaceOptions = {}) {
  const view = renderSurface({ probe: () => Promise.resolve(ENABLED), ...options });
  const launcher = await screen.findByRole('button', { name: 'Assistant' });
  // Focused first because a real pointer click focuses the button it presses,
  // and the panel hands focus back to whatever held it on open.
  launcher.focus();
  fireEvent.click(launcher);
  return { launcher, ...view };
}

function composer(): HTMLElement {
  return screen.getByRole('textbox', { name: /Ask about this record/ });
}

/** Types a question and presses Ask, the way a person does. */
function askFor(question: string): void {
  fireEvent.change(composer(), { target: { value: question } });
  fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
}

describe('with nothing configured', () => {
  it('renders no assistant at all, which is the shipped default', async () => {
    const { container } = renderSurface();

    // Waiting for the probe to settle: the point is that nothing appears after
    // it does either, not merely that nothing appeared on the first frame.
    await waitFor(() => expect(container.querySelector('.or-assistant')).toBeNull());
    expect(screen.queryByRole('button', { name: 'Assistant' })).toBeNull();
    expect(screen.queryByRole('complementary', { name: 'Assistant' })).toBeNull();
    expect(container.textContent).not.toMatch(/assistant/i);
  });

  it('offers nothing in the command palette either', async () => {
    renderSurface();
    await act(async () => {
      await Promise.resolve();
    });

    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'assistant' } });

    expect(screen.queryByRole('option', { name: /Ask the assistant/ })).toBeNull();
  });

  it('renders nothing when the probe itself is broken', async () => {
    // A failed probe must not be able to break the shell it renders inside, and
    // must not leave a control that cannot work.
    const { container } = renderSurface({ probe: () => Promise.reject(new Error('boom')) });

    await waitFor(() => expect(container.querySelector('.or-assistant')).toBeNull());
    expect(screen.queryByRole('button', { name: 'Assistant' })).toBeNull();
  });

  it('renders nothing while the probe is still in flight', () => {
    renderSurface({ probe: () => new Promise<AgentAvailability>(() => {}) });
    expect(screen.queryByRole('button', { name: 'Assistant' })).toBeNull();
  });
});

describe('with an assistant configured', () => {
  it('states its purpose and names the endpoint before anything is asked', async () => {
    await openPanel();

    const panel = screen.getByRole('complementary', { name: 'Assistant' });
    expect(within(panel).getByText(/Documentation support/)).toBeInTheDocument();
    expect(within(panel).getByText(/does not advise/)).toBeInTheDocument();
    expect(within(panel).getByText('local/qwen-2.5-32b')).toBeInTheDocument();
    expect(
      within(panel).getByText(/Nothing you type here leaves this deployment/)
    ).toBeInTheDocument();
  });

  it('says plainly when the configured endpoint is outside the deployment', async () => {
    await openPanel({ probe: () => Promise.resolve(REMOTE) });

    expect(
      screen.getByText(/leaves this deployment and is sent to that endpoint/)
    ).toBeInTheDocument();
  });

  it('lists what it can reach, which is what the caller was granted and nothing more', async () => {
    await openPanel();
    expect(screen.getByText('What it can reach here (1)')).toBeInTheDocument();
    expect(screen.getByText('Finds records.')).toBeInTheDocument();
  });

  it('says the chart narrows the answer, and sends that chart', async () => {
    pathname = '/patients/0192f1a0-0000-7000-8000-00000000f001';
    const channel = openChannel();
    await openPanel({ runTurn: channel.run });

    askFor('any allergies');

    expect(screen.getByText('Answers are limited to the chart you have open.')).toBeInTheDocument();
    expect(channel.requests[0]).toEqual({
      message: 'any allergies',
      turnIndex: 0,
      chartPatientId: '0192f1a0-0000-7000-8000-00000000f001',
    });
  });

  it('names no chart when the clinician is not in one', async () => {
    const channel = openChannel();
    await openPanel({ runTurn: channel.run });

    askFor('how busy is tomorrow');

    expect(screen.queryByText('Answers are limited to the chart you have open.')).toBeNull();
    expect(channel.requests[0]).not.toHaveProperty('chartPatientId');
  });

  it('shows the answer, the steps it took and a link to every record behind it', async () => {
    await openPanel({
      runTurn: replay(
        { type: 'step', label: 'Searching the chart', state: 'active', toolId: 'chart.search' },
        { type: 'step', label: 'Searching the chart', state: 'done', toolId: 'chart.search' },
        { type: 'text-delta', text: 'Two visits are recorded.' },
        { type: 'sources', entries: [SOURCE] },
        FINISHED
      ),
    });

    askFor('how many visits');

    expect(await screen.findByText('Two visits are recorded.')).toBeInTheDocument();
    expect(screen.getByText('Searching the chart - done')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Encounter Office visit, 3 March' })).toHaveAttribute(
      'href',
      '/encounters/0192f1a0-0000-7000-8000-00000000e001'
    );
  });

  it('marks patient-written and outside text wherever it is cited', async () => {
    await openPanel({
      runTurn: replay(
        { type: 'text-delta', text: 'The message asks about a refill.' },
        { type: 'sources', entries: [{ ...SOURCE, resourceType: 'Message', untrusted: true }] },
        FINISHED
      ),
    });

    askFor('what did they ask');

    expect(await screen.findByText('Patient-written or outside text')).toBeInTheDocument();
    // No detail route for a message yet, so the reference carries the id rather
    // than pretending to link somewhere.
    expect(screen.queryByRole('link', { name: /Message/ })).toBeNull();
    expect(screen.getByText('0192f1a0-0000-7000-8000-00000000e001')).toBeInTheDocument();
  });

  it('shows nothing an answer cannot be checked against', async () => {
    await openPanel({
      runTurn: replay({ type: 'text-delta', text: 'That is probably fine.' }, FINISHED),
    });

    askFor('is it fine');

    expect(
      await screen.findByText(/arrived without the records it was drawn from/)
    ).toBeInTheDocument();
    expect(screen.queryByText('That is probably fine.')).toBeNull();
  });

  it('renders a proposal with no way to accept it', async () => {
    await openPanel({
      runTurn: replay(
        {
          type: 'proposal',
          proposalId: 'prop-1',
          toolId: 'appointments.propose',
          proposal: {
            kind: 'appointment.book',
            effect: [{ label: 'Starts', value: '3 March, 09:00' }],
            derivedFromUntrusted: true,
          },
        },
        FINISHED
      ),
    });

    askFor('book a follow-up');

    expect(await screen.findByText('Draft - nothing has been saved')).toBeInTheDocument();
    expect(screen.getByText('3 March, 09:00')).toBeInTheDocument();
    expect(screen.getByText(/Based partly on patient-written or outside text/)).toBeInTheDocument();
    // The rule made structural: no control on this surface commits anything.
    for (const control of screen.getAllByRole('button')) {
      expect(control).not.toHaveAccessibleName(/save|confirm|approve|accept|book/i);
    }
  });

  it('reports a step the assistant declined to take', async () => {
    await openPanel({
      runTurn: replay(
        { type: 'deferred', toolId: 'appointments.propose', reason: 'no slot matched' },
        FINISHED
      ),
    });

    askFor('book a follow-up');

    expect(
      await screen.findByText(/did not go ahead with appointments.propose/)
    ).toBeInTheDocument();
  });
});

describe('when the model endpoint is down', () => {
  it('reads as a calm, specific sentence and says what still works', async () => {
    await openPanel({
      runTurn: replay(
        {
          type: 'failed',
          code: 'AGENT_UPSTREAM_UNREACHABLE',
          detail: 'the endpoint did not answer',
        },
        FAILED
      ),
    });

    askFor('anything at all');

    expect(await screen.findByText('The model endpoint did not answer')).toBeInTheDocument();
    expect(
      screen.getByText(/charts, the schedule and orders all work as normal/)
    ).toBeInTheDocument();
    expect(screen.queryByText(/AGENT_UPSTREAM_UNREACHABLE/)).toBeNull();
  });

  it('settles the turn rather than leaving the panel claiming to answer', async () => {
    await openPanel({
      runTurn: () => {
        throw new Error('the runner itself broke');
      },
    });

    askFor('anything at all');

    expect(await screen.findByText('The assistant could not be reached')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
  });
});

describe('interrupting an answer', () => {
  it('keeps the sentences that finished and drops the one that did not', async () => {
    const channel = openChannel();
    await openPanel({ runTurn: channel.run });

    askFor('how many visits');
    await channel.emit({ type: 'sources', entries: [SOURCE] });
    await channel.emit({
      type: 'text-delta',
      text: 'Two visits are recorded. The second was a review of the',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));

    expect(screen.getByText('Two visits are recorded.')).toBeInTheDocument();
    expect(screen.queryByText(/The second was a review of the/)).toBeNull();
    expect(screen.getByText('You stopped this answer.')).toBeInTheDocument();
    // The citation survives the interruption: a partial answer that kept its
    // basis is still checkable.
    expect(screen.getByRole('link', { name: /Office visit, 3 March/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
  });

  it('shows nothing when it was stopped before the sources arrived', async () => {
    const channel = openChannel();
    await openPanel({ runTurn: channel.run });

    askFor('how many visits');
    await channel.emit({ type: 'text-delta', text: 'Two visits are recorded. And a third' });

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));

    expect(screen.queryByText(/Two visits are recorded/)).toBeNull();
    expect(screen.getByText(/arrived without the records it was drawn from/)).toBeInTheDocument();
  });

  it('settles the running turn when a new question replaces it', async () => {
    const channel = openChannel();
    await openPanel({ runTurn: channel.run });

    askFor('first question');
    await channel.emit({ type: 'sources', entries: [SOURCE] });
    await channel.emit({ type: 'text-delta', text: 'A first answer. Still going' });

    askFor('second question');

    expect(screen.getByText('A first answer.')).toBeInTheDocument();
    expect(screen.getByText('You stopped this answer.')).toBeInTheDocument();
    expect(channel.requests.map((request) => request.turnIndex)).toEqual([0, 1]);
  });

  it('ignores an empty question', async () => {
    const channel = openChannel();
    await openPanel({ runTurn: channel.run });

    fireEvent.change(composer(), { target: { value: '   ' } });
    fireEvent.keyDown(composer(), { key: 'Enter' });

    expect(channel.requests).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Ask' })).toBeDisabled();
  });
});

describe('from the keyboard alone', () => {
  it('moves focus into the field on open and back to the trigger on close', async () => {
    const { launcher } = await openPanel();
    await waitFor(() => expect(composer()).toHaveFocus());

    fireEvent.keyDown(composer(), { key: 'Escape' });

    expect(screen.queryByRole('complementary', { name: 'Assistant' })).toBeNull();
    expect(launcher).toHaveFocus();
  });

  it('asks with Enter and leaves Shift and Enter to start a new line', async () => {
    const channel = openChannel();
    await openPanel({ runTurn: channel.run });

    fireEvent.change(composer(), { target: { value: 'first line' } });
    fireEvent.keyDown(composer(), { key: 'Enter', shiftKey: true });
    expect(channel.requests).toHaveLength(0);

    fireEvent.change(composer(), { target: { value: 'first line\nsecond line' } });
    fireEvent.keyDown(composer(), { key: 'Enter' });
    expect(channel.requests[0]?.message).toBe('first line\nsecond line');
  });

  it('leaves keys it does not own alone', async () => {
    const channel = openChannel();
    await openPanel({ runTurn: channel.run });

    fireEvent.change(composer(), { target: { value: 'a question' } });
    fireEvent.keyDown(composer(), { key: 'ArrowDown' });

    expect(channel.requests).toHaveLength(0);
  });

  it('does not send while an input method editor is mid composition', async () => {
    const channel = openChannel();
    await openPanel({ runTurn: channel.run });

    fireEvent.change(composer(), { target: { value: 'ありがとう' } });
    fireEvent.keyDown(composer(), { key: 'Enter', isComposing: true });

    expect(channel.requests).toHaveLength(0);
  });

  it('reaches the panel from the command palette', async () => {
    renderSurface({ probe: () => Promise.resolve(ENABLED) });
    await screen.findByRole('button', { name: 'Assistant' });

    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ask the assistant' } });
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });

    expect(await screen.findByRole('complementary', { name: 'Assistant' })).toBeInTheDocument();
  });

  it('announces the state of a turn once, not once per token', async () => {
    const channel = openChannel();
    await openPanel({ runTurn: channel.run });
    const live = screen.getByRole('status');

    askFor('how many visits');
    expect(live).toHaveTextContent('The assistant is answering.');

    await channel.emit({ type: 'text-delta', text: 'Two ' });
    await channel.emit({ type: 'text-delta', text: 'visits.' });
    expect(live).toHaveTextContent('The assistant is answering.');

    await channel.emit({ type: 'sources', entries: [SOURCE] }, FINISHED);
    expect(live).toHaveTextContent('Answer ready, drawn from 1 record.');
  });

  it('keeps the conversation while the panel is dismissed and reopened', async () => {
    const { launcher } = await openPanel({
      runTurn: replay(
        { type: 'text-delta', text: 'Two visits are recorded.' },
        { type: 'sources', entries: [SOURCE] },
        FINISHED
      ),
    });

    askFor('how many visits');
    await screen.findByText('Two visits are recorded.');

    fireEvent.keyDown(composer(), { key: 'Escape' });
    fireEvent.click(launcher);

    expect(screen.getByText('Two visits are recorded.')).toBeInTheDocument();
  });

  it('closes from the launcher as well as from Escape', async () => {
    const { launcher } = await openPanel();
    expect(launcher).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(launcher);

    expect(screen.queryByRole('complementary', { name: 'Assistant' })).toBeNull();
    expect(launcher).toHaveAttribute('aria-expanded', 'false');
    expect(launcher).not.toHaveAttribute('aria-controls');
  });

  it('closes from the panel dismiss control', async () => {
    await openPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Close the assistant' }));
    expect(screen.queryByRole('complementary', { name: 'Assistant' })).toBeNull();
  });
});
