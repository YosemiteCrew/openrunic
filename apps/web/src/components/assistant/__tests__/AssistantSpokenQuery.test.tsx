import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type {
  CaptureAvailability,
  CaptureEvent,
  CaptureFailure,
  CapturePort,
  CaptureSession,
} from '@openrunic/voice';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AssistantLauncher, AssistantPanel, AssistantProvider } from '@/components/assistant';
import type { RunAgentTurn } from '@/components/assistant';
import { CommandProvider } from '@/components/command';
import type { AgentAvailability, AgentCapabilities, AgentEvent } from '@/lib/agent';

/**
 * A clinician asking about the chart in front of them by voice.
 *
 * Driven through the panel rather than the hook, because what this surface has
 * to prove is about the surface: that a spoken question is the same question
 * as a typed one, carrying the same chart and nothing more; that speech alone
 * never asks anything; and that moving to another chart or dismissing the panel
 * closes the microphone before a late word can land in the wrong question.
 *
 * What the microphone reducer does with late, stale and malformed events - and
 * that it does it against two unalike adapters - is asserted in
 * `@openrunic/voice`. The capture double here is labelled as one: no audio is
 * produced and no recogniser is contacted.
 */

const CHART_A = '0192f1a0-0000-7000-8000-00000000f001';
const CHART_B = '0192f1a0-0000-7000-8000-00000000f002';

let pathname = `/patients/${CHART_A}`;

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => pathname,
}));

beforeEach(() => {
  pathname = `/patients/${CHART_A}`;
});

const CAPABILITIES: AgentCapabilities = {
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
      summary: 'Searches the open chart.',
      requiredScopes: ['patient.read'],
      approval: 'never',
    },
  ],
  dictation: null,
};

const ENABLED: AgentAvailability = { status: 'enabled', capabilities: CAPABILITIES };

const FINISHED: AgentEvent = {
  type: 'turn-finished',
  outcome: 'completed',
  usage: { inputTokens: 1, outputTokens: 2, costCents: 0 },
};

type TurnRequest = Parameters<RunAgentTurn>[0];

/** Records every turn asked for, and answers each one with nothing. */
function recordingTurns(): { run: RunAgentTurn; asked: Omit<TurnRequest, 'signal'>[] } {
  const asked: Omit<TurnRequest, 'signal'>[] = [];
  return {
    asked,
    run: ({ signal: _signal, ...request }) => {
      asked.push(request);
      return (async function* emit() {
        await Promise.resolve();
        yield FINISHED;
      })();
    },
  };
}

/** A deterministic microphone double. */
function microphone(answer: CaptureAvailability = { status: 'available' }) {
  const opened: CaptureSession[] = [];
  const listeners = new Set<(event: CaptureEvent) => void>();
  let aborts = 0;
  let stops = 0;

  const emit = (event: CaptureEvent) => {
    for (const listener of listeners) listener(event);
  };
  const last = () => opened.at(-1)?.id ?? '';

  const port: CapturePort = {
    available: async () => answer,
    onEvent: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start: (session) => {
      opened.push(session);
    },
    stop: () => {
      stops += 1;
    },
    abort: () => {
      aborts += 1;
    },
  };

  return {
    port,
    opened,
    aborts: () => aborts,
    stops: () => stops,
    listening: () => emit({ type: 'listening', id: last() }),
    say: (text: string, final: boolean) => emit({ type: 'heard', id: last(), text, final }),
    /** A word for a named session, however stale. Delivered whether or not anybody listens. */
    sayFor: (id: string, text: string) => emit({ type: 'heard', id, text, final: true }),
    fail: (reason: CaptureFailure) => emit({ type: 'failed', id: last(), reason }),
    end: () => emit({ type: 'ended', id: last() }),
  };
}

function tree(run: RunAgentTurn, capture: CapturePort | null): ReactElement {
  return (
    <CommandProvider>
      <AssistantProvider probe={() => Promise.resolve(ENABLED)} runTurn={run}>
        <AssistantLauncher />
        <AssistantPanel readback={null} capture={capture} />
      </AssistantProvider>
    </CommandProvider>
  );
}

async function openPanel(run: RunAgentTurn, capture: CapturePort | null) {
  const view = render(tree(run, capture));
  fireEvent.click(await screen.findByRole('button', { name: 'Assistant' }));
  return view;
}

const SPEAK = { name: 'Speak your question' };

function field(): HTMLElement {
  return screen.getByRole('textbox', { name: /Ask about this record/ });
}

/* The panel has a status region of its own for turn announcements, so the
   microphone's is found by what it is rather than by role alone. */
function dictationStatus(): HTMLElement {
  const status = document.querySelector<HTMLElement>('output.or-assistant__dictation-status');
  if (status === null) throw new Error('no dictation status region');
  return status;
}

async function pressSpeak(): Promise<void> {
  const speak = await screen.findByRole('button', SPEAK);
  await waitFor(() => expect(speak).toBeEnabled());
  fireEvent.click(speak);
}

describe('a question asked by voice', () => {
  it('asks exactly what the typed question asks, with the same chart and nothing else', async () => {
    const turns = recordingTurns();
    const mic = microphone();
    await openPanel(turns.run, mic.port);

    await pressSpeak();
    act(() => {
      mic.listening();
      mic.say('what did the last visit record about the knee', true);
      mic.end();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    await waitFor(() => expect(turns.asked).toHaveLength(1));

    fireEvent.change(field(), {
      target: { value: 'what did the last visit record about the knee' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    await waitFor(() => expect(turns.asked).toHaveLength(2));

    const [spoken, typed] = turns.asked;
    /* One path from a question to chart.search, whichever way it was entered:
       the same words, the same chart scope, and no field that says it was
       spoken. The turn index is the only difference, and it is the position. */
    expect({ ...spoken, turnIndex: 0 }).toEqual({ ...typed, turnIndex: 0 });
    expect(spoken).toEqual({
      message: 'what did the last visit record about the knee',
      turnIndex: 0,
      chartPatientId: CHART_A,
    });
  });

  it('tells the microphone a language and an id, and nothing about the chart', async () => {
    const mic = microphone();
    await openPanel(recordingTurns().run, mic.port);

    await pressSpeak();

    expect(mic.opened).toHaveLength(1);
    expect(Object.keys(mic.opened[0] ?? {}).sort()).toEqual(['id', 'language']);
    expect(JSON.stringify(mic.opened)).not.toContain(CHART_A);
  });

  it('never asks anything on its own, however much is said', async () => {
    const turns = recordingTurns();
    const mic = microphone();
    await openPanel(turns.run, mic.port);

    await pressSpeak();
    act(() => {
      mic.listening();
      mic.say('no penicillin allergy recorded', true);
      mic.say('send it', true);
      mic.say('sign the note', true);
    });

    /* Negation and the words after it are in the box verbatim, where they can
       be read before anything is asked. */
    expect(field()).toHaveValue('no penicillin allergy recorded send it sign the note');
    await Promise.resolve();
    expect(turns.asked).toEqual([]);
  });

  it('shows the words while they arrive and lets a clinician correct them before asking', async () => {
    const turns = recordingTurns();
    const mic = microphone();
    await openPanel(turns.run, mic.port);

    await pressSpeak();
    act(() => {
      mic.listening();
      mic.say('last HbA1c was 7', false);
    });
    expect(screen.getByText('last HbA1c was 7')).toBeVisible();
    expect(field()).toHaveValue('');

    act(() => {
      mic.say('what was the last HbA1c 17', true);
    });
    expect(screen.queryByText('last HbA1c was 7')).not.toBeInTheDocument();

    fireEvent.change(field(), { target: { value: 'what was the last HbA1c' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));

    await waitFor(() => expect(turns.asked).toHaveLength(1));
    expect(turns.asked[0]?.message).toBe('what was the last HbA1c');
  });
});

describe('the microphone belongs to the chart it was opened beside', () => {
  it('closes when the clinician moves to another chart, and a late word lands nowhere', async () => {
    const turns = recordingTurns();
    const mic = microphone();
    const view = await openPanel(turns.run, mic.port);

    await pressSpeak();
    act(() => {
      mic.listening();
      mic.say('any', false);
    });
    const session = mic.opened[0]?.id ?? '';
    const abortsBefore = mic.aborts();

    pathname = `/patients/${CHART_B}`;
    view.rerender(tree(turns.run, mic.port));

    expect(mic.aborts()).toBeGreaterThan(abortsBefore);
    expect(screen.queryByText('any')).not.toBeInTheDocument();
    expect(screen.getByRole('button', SPEAK)).toBeInTheDocument();

    /* The recogniser hands over the last of the old session after it was told
       to stop. It must not become the first words of a question about the next
       patient. */
    act(() => {
      mic.sayFor(session, 'any penicillin allergy');
    });
    expect(field()).toHaveValue('');
  });

  it('closes when the panel is dismissed', async () => {
    const mic = microphone();
    await openPanel(recordingTurns().run, mic.port);

    await pressSpeak();
    act(() => {
      mic.listening();
    });
    const abortsBefore = mic.aborts();

    fireEvent.click(screen.getByRole('button', { name: 'Close the assistant' }));

    expect(mic.aborts()).toBeGreaterThan(abortsBefore);
  });

  it('keeps what was said when the clinician stops it', async () => {
    const mic = microphone();
    await openPanel(recordingTurns().run, mic.port);

    await pressSpeak();
    act(() => {
      mic.listening();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Stop the microphone' }));
    expect(mic.stops()).toBe(1);

    act(() => {
      mic.say('latest creatinine', true);
      mic.end();
    });
    expect(field()).toHaveValue('latest creatinine');
    expect(screen.getByRole('button', SPEAK)).toBeInTheDocument();
  });
});

describe('what the clinician is told', () => {
  it('draws no control at all where the device cannot recognise speech on its own', async () => {
    await openPanel(recordingTurns().run, null);

    await screen.findByRole('complementary', { name: 'Assistant' });
    expect(screen.queryByRole('button', SPEAK)).not.toBeInTheDocument();
    expect(field()).toBeInTheDocument();
  });

  it('says where the words go before the microphone is opened', async () => {
    await openPanel(recordingTurns().run, microphone().port);

    await waitFor(() => expect(screen.getByRole('button', SPEAK)).toBeEnabled());
    expect(screen.getByText(/nothing is sent anywhere to do it/)).toBeVisible();
    expect(dictationStatus()).toHaveTextContent('');
  });

  it('claims the microphone is on only once something reports audio', async () => {
    const mic = microphone();
    await openPanel(recordingTurns().run, mic.port);

    await pressSpeak();
    expect(dictationStatus()).toHaveTextContent('Opening the microphone.');

    act(() => {
      mic.listening();
    });
    expect(dictationStatus()).toHaveTextContent('The microphone is on.');
  });

  it.each([
    ['not-installed', /language pack for this page is installed/],
    ['language', /without sending the sound away, so you can only type here/],
  ] as const)('explains a %s device and disables the control', async (reason, sentence) => {
    await openPanel(recordingTurns().run, microphone({ status: 'unavailable', reason }).port);

    expect(await screen.findByText(sentence)).toBeInTheDocument();
    expect(screen.getByRole('button', SPEAK)).toBeDisabled();
    expect(screen.queryByText(/nothing is sent anywhere to do it/)).not.toBeInTheDocument();
  });

  it.each([
    ['denied', /The microphone was not allowed/],
    ['no-speech', /^Nothing was heard\./],
    ['no-audio', /No microphone could be opened/],
    ['off-device', /only have done this by sending the sound away/],
    ['failed', /The microphone stopped/],
  ] as const)('says why nothing was heard after %s', async (reason, sentence) => {
    const mic = microphone();
    await openPanel(recordingTurns().run, mic.port);

    await pressSpeak();
    act(() => {
      mic.fail(reason);
    });

    expect(dictationStatus()).toHaveTextContent(sentence);
    expect(screen.getByRole('button', SPEAK)).toBeEnabled();
    expect(field()).toHaveValue('');
  });
});
