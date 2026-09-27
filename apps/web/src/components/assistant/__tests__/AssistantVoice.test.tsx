import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReadbackEvent, ReadbackPort, Utterance } from '@openrunic/voice';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AssistantLauncher, AssistantPanel, AssistantProvider } from '@/components/assistant';
import type { RunAgentTurn } from '@/components/assistant';
import { CommandProvider } from '@/components/command';
import type { AgentAvailability, AgentCapabilities, AgentEvent } from '@/lib/agent';

/**
 * A biller asking what is still missing on an authorisation case, and hearing
 * the answer.
 *
 * The reason this file is not part of the surface test is the thing it exists
 * to hold: the words that reach the device are the words on the screen, and
 * nothing else about the case crosses that boundary. Every case below is
 * driven through the panel rather than the hook, because the two mistakes worth
 * catching - reading an answer the screen withheld, and going on reading after
 * the panel is dismissed - are both about the surface rather than the voice.
 *
 * What "heard" is allowed to mean, and that it means the same against two
 * unalike adapters, is asserted in `@openrunic/voice`.
 */

let pathname = '/billing/claims';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => pathname,
}));

beforeEach(() => {
  pathname = '/billing/claims';
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
      id: 'authorisation.reviewEvidence',
      tier: 'READ',
      summary: 'Lists what a configured payer still requires on a case.',
      requiredScopes: ['claim.read'],
      approval: 'never',
    },
  ],
  dictation: null,
};

const ENABLED: AgentAvailability = { status: 'enabled', capabilities: CAPABILITIES };

const SOURCE = {
  resourceType: 'Claim',
  resourceId: '0192f1a0-0000-7000-8000-00000000c001',
  label: 'Authorisation case, 3 March',
  untrusted: false,
};

const FINISHED: AgentEvent = {
  type: 'turn-finished',
  outcome: 'completed',
  usage: { inputTokens: 1, outputTokens: 2, costCents: 0 },
};

const GAP = 'Two requirements are unmet: the imaging report and the referral letter.';

/** A turn that answers in one go, arriving asynchronously the way a stream does. */
function replay(...events: readonly AgentEvent[]): RunAgentTurn {
  return function run(): AsyncGenerator<AgentEvent> {
    return (async function* emit() {
      for (const event of events) {
        await Promise.resolve();
        yield event;
      }
    })();
  };
}

/** A deterministic voice double. No synthesiser, no service, no audio. */
function recordingVoice(): {
  port: ReadbackPort;
  said: Utterance[];
  cancels: () => number;
  finish: (id: string) => void;
} {
  const said: Utterance[] = [];
  const listeners = new Set<(event: ReadbackEvent) => void>();
  let cancels = 0;

  return {
    said,
    cancels: () => cancels,
    finish: (id) => {
      for (const listener of listeners) listener({ type: 'finished', id });
    },
    port: {
      capabilities: () => ({ languages: ['en-GB'], interruption: true }),
      onCapabilities: () => () => undefined,
      onEvent: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      speak: (utterance) => {
        said.push(utterance);
        for (const listener of listeners) listener({ type: 'started', id: utterance.id });
      },
      cancel: () => {
        cancels += 1;
      },
    },
  };
}

async function openPanel(runTurn: RunAgentTurn, readback: ReadbackPort | null) {
  const view = render(
    <CommandProvider>
      <AssistantProvider probe={() => Promise.resolve(ENABLED)} runTurn={runTurn}>
        <AssistantLauncher />
        <AssistantPanel readback={readback} />
      </AssistantProvider>
    </CommandProvider>
  );
  const launcher = await screen.findByRole('button', { name: 'Assistant' });
  fireEvent.click(launcher);
  return view;
}

function readAloud(): void {
  fireEvent.click(screen.getByRole('switch', { name: 'Read answers aloud' }));
}

function askFor(question: string): void {
  fireEvent.change(screen.getByRole('textbox', { name: /Ask about this record/ }), {
    target: { value: question },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
}

describe('hearing what a case is still missing', () => {
  it('hands the device the answer on the screen, and nothing else about the case', async () => {
    const voice = recordingVoice();
    await openPanel(
      replay({ type: 'text-delta', text: GAP }, { type: 'sources', entries: [SOURCE] }, FINISHED),
      voice.port
    );

    readAloud();
    askFor('what is still missing on this authorisation');

    await waitFor(() => expect(voice.said).toHaveLength(1));
    expect(voice.said[0]?.text).toBe(GAP);
    /* The screen and the sound agree, word for word. */
    expect(screen.getByText(GAP)).toBeInTheDocument();
    /* The whole of what crosses this boundary. No case id, no question, no
       payer, and no way for an adapter to ask for one. */
    expect(Object.keys(voice.said[0] ?? {}).sort()).toEqual(['id', 'language', 'text']);
  });

  it('never reads an answer the screen withheld', async () => {
    /* Prose arrived and its sources did not, so the panel shows the withheld
       notice instead of an answer. The voice has to make the same decision from
       the same rule rather than from a second one. */
    const voice = recordingVoice();
    await openPanel(replay({ type: 'text-delta', text: GAP }, FINISHED), voice.port);

    readAloud();
    askFor('what is still missing on this authorisation');

    await screen.findByText(/arrived without the records it was drawn from/);
    expect(voice.said).toEqual([]);
  });

  it('stops the voice and forgets the consent when the panel is dismissed', async () => {
    /* The rule that makes reading a record aloud safe at all is that the words
       are on the screen as they are spoken. A dismissed panel honours neither
       half, so the answer that settles next must not become audible to whoever
       is standing at the desk. */
    const voice = recordingVoice();
    await openPanel(
      replay({ type: 'text-delta', text: GAP }, { type: 'sources', entries: [SOURCE] }, FINISHED),
      voice.port
    );

    readAloud();
    askFor('what is still missing on this authorisation');
    await waitFor(() => expect(voice.said).toHaveLength(1));

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Close the assistant' }));
    });

    expect(voice.cancels()).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Assistant' }));
    expect(screen.getByRole('switch', { name: 'Read answers aloud' })).toHaveAttribute(
      'aria-checked',
      'false'
    );
  });

  it('draws no control at all on a browser with no speech', async () => {
    await openPanel(replay(FINISHED), null);

    await screen.findByRole('complementary', { name: 'Assistant' });
    expect(screen.queryByRole('switch', { name: 'Read answers aloud' })).not.toBeInTheDocument();
  });
});

describe('how the last answer ended, once the conversation has moved on', () => {
  const STOPPED = 'Stopped reading. The answer is still on screen.';

  /** A different script per turn, so a conversation can carry two unalike answers. */
  function scripted(...turns: readonly (readonly AgentEvent[])[]): RunAgentTurn {
    let asked = 0;
    return function run(): AsyncGenerator<AgentEvent> {
      const events = turns[asked] ?? [];
      asked += 1;
      return (async function* emit() {
        for (const event of events) {
          await Promise.resolve();
          yield event;
        }
      })();
    };
  }

  it('takes the sentence down when a later answer the screen withheld is the one on screen', async () => {
    /* #530. The first answer was read and the reader stopped it, which is worth
       a sentence. The second is withheld, so nothing is read and nothing new is
       said about the voice - and the sentence about the first answer would sit
       under the second one, describing an answer that is no longer the subject. */
    const voice = recordingVoice();
    await openPanel(
      scripted(
        [{ type: 'text-delta', text: GAP }, { type: 'sources', entries: [SOURCE] }, FINISHED],
        [{ type: 'text-delta', text: 'The referral letter is still outstanding.' }, FINISHED]
      ),
      voice.port
    );

    readAloud();
    askFor('what is still missing on this authorisation');
    await waitFor(() => expect(voice.said).toHaveLength(1));

    fireEvent.click(screen.getByRole('button', { name: 'Stop reading' }));
    expect(screen.getByText(STOPPED)).toBeInTheDocument();

    askFor('and the referral letter');
    await screen.findByText(/arrived without the records it was drawn from/);

    expect(screen.queryByText(STOPPED)).not.toBeInTheDocument();
  });
});
