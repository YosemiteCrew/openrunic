import type { ReactNode } from 'react';
import { act, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AssistantComposer, AssistantTurnView, useConversation } from '@/components/assistant';
import type { AssistantTurn } from '@/components/assistant';
import type { AssistantEvent, TurnRequest } from '@/lib/assistant';

/**
 * The pieces the page is built from, driven directly.
 *
 * The conversation hook gets the most attention here because its two hardest
 * moments - stopping, and asking again before the last answer landed - are ones
 * a screen test reaches only by accident.
 */

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const BLANK: AssistantTurn = {
  id: 'turn-1',
  question: 'When am I next in?',
  answer: '',
  steps: [],
  sources: [],
  failures: [],
  deferrals: [],
  outcome: null,
  withheld: 'none',
};

describe('the box a question is typed in', () => {
  it('will not send an empty question, however it is pressed', async () => {
    const onAsk = vi.fn();
    render(<AssistantComposer answering={false} onAsk={onAsk} onStop={vi.fn()} />);

    const ask = screen.getByRole('button', { name: 'Ask' });
    expect(ask).toBeDisabled();

    await userEvent.type(screen.getByLabelText('Your question'), '   ');
    await userEvent.click(ask);
    expect(onAsk).not.toHaveBeenCalled();
  });

  it('clears the box only once the question has gone', async () => {
    const onAsk = vi.fn();
    render(<AssistantComposer answering={false} onAsk={onAsk} onStop={vi.fn()} />);

    const box = screen.getByLabelText('Your question');
    await userEvent.type(box, 'When am I next in?');
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }));

    expect(onAsk).toHaveBeenCalledWith('When am I next in?');
    expect(box).toHaveValue('');
  });

  it('leaves the box usable while an answer is arriving, and offers a way out of it', async () => {
    const onStop = vi.fn();
    render(<AssistantComposer answering onAsk={vi.fn()} onStop={onStop} />);

    // Disabling the field somebody is typing in throws their focus to the top
    // of the document, and a keyboard user then has to find their way back.
    expect(screen.getByLabelText('Your question')).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(onStop).toHaveBeenCalled();
  });
});

describe('one turn on screen', () => {
  it('says what a step is doing in words, not only in an icon', () => {
    render(
      <AssistantTurnView
        answering
        turn={{
          ...BLANK,
          steps: [
            { key: 'a', label: 'Reading your appointments', done: true },
            { key: 'b', label: 'Reading your bills', done: false },
          ],
        }}
      />
    );

    expect(screen.getByText(/Reading your appointments, done/)).toBeInTheDocument();
    expect(screen.getByText(/Reading your bills, still going/)).toBeInTheDocument();
    expect(screen.getByText('Still looking.')).toBeInTheDocument();
  });

  it('says when part of a question was not gone ahead with, and offers the way on', () => {
    render(
      <AssistantTurnView
        answering={false}
        turn={{
          ...BLANK,
          outcome: 'completed',
          deferrals: ['your bills could not be read'],
        }}
      />
    );

    expect(screen.getByText(/your bills could not be read/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Write to your care team' })).toHaveAttribute(
      'href',
      '/messages'
    );
  });

  it('marks text somebody wrote, wherever it is shown', () => {
    render(
      <AssistantTurnView
        answering={false}
        turn={{
          ...BLANK,
          answer: 'Your last message mentioned a rash.',
          outcome: 'completed',
          sources: [
            {
              resourceType: 'Message',
              resourceId: 'message-1',
              label: 'A message you sent',
              untrusted: true,
            },
          ],
        }}
      />
    );

    expect(
      screen.getByText('Written by you or by someone outside the practice')
    ).toBeInTheDocument();
    // No portal screen holds a single message by id, so this renders as words
    // rather than as a link that would drop what it was pointing at.
    expect(screen.getByText('Record: A message you sent')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /see it in/ })).not.toBeInTheDocument();
  });

  it('splits a long answer into paragraphs rather than one wall of text', () => {
    render(
      <AssistantTurnView
        answering={false}
        turn={{
          ...BLANK,
          answer: 'First thing.\n\nSecond thing.',
          outcome: 'completed',
          sources: [
            {
              resourceType: 'Bill',
              resourceId: 'bill-1',
              label: 'Bill dated 2026-04-01',
              untrusted: false,
            },
          ],
        }}
      />
    );

    expect(screen.getByText('First thing.')).toBeInTheDocument();
    expect(screen.getByText('Second thing.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'see it in your bills' })).toBeInTheDocument();
  });
});

/** A runner whose events a test releases one at a time. */
function controllable() {
  const requests: TurnRequest[] = [];
  let release: (() => void) | null = null;
  const started = new Promise<void>((resolve) => {
    release = resolve;
  });

  async function* run(request: TurnRequest): AsyncGenerator<AssistantEvent> {
    requests.push(request);
    yield { type: 'text', text: 'Half an answer' };
    await started;
    yield { type: 'finished', outcome: 'completed' };
  }

  return { run, requests, release: () => release?.() };
}

describe('one conversation', () => {
  it('ignores an empty question rather than starting an empty turn', () => {
    const runner = controllable();
    const { result } = renderHook(() => useConversation(runner.run, 'chart-1'));

    act(() => {
      result.current.ask('   ');
    });

    expect(result.current.state.turns).toEqual([]);
    expect(runner.requests).toEqual([]);
  });

  it('settles the turn when the reader stops it, rather than leaving it mid-sentence', async () => {
    const runner = controllable();
    const { result } = renderHook(() => useConversation(runner.run, 'chart-1'));

    await act(async () => {
      result.current.ask('When am I next in?');
      await Promise.resolve();
    });
    act(() => {
      result.current.stop();
    });

    expect(result.current.state.answering).toBe(false);
    expect(result.current.state.turns[0]?.outcome).toBe('stopped');
  });

  it('settles the previous turn when a second question arrives before the first landed', async () => {
    const runner = controllable();
    const { result } = renderHook(() => useConversation(runner.run, 'chart-1'));

    await act(async () => {
      result.current.ask('First question');
      await Promise.resolve();
    });
    await act(async () => {
      result.current.ask('Second question');
      await Promise.resolve();
    });

    // Two turns, and the first is not still claiming to be answering.
    expect(result.current.state.turns.map((turn) => turn.question)).toEqual([
      'First question',
      'Second question',
    ]);
    expect(result.current.state.turns[0]?.outcome).toBe('stopped');
    expect(runner.requests.map((request) => request.turnIndex)).toEqual([0, 1]);
  });

  it('sends the chart that was open when the question was asked', async () => {
    const runner = controllable();
    const { result, rerender } = renderHook(
      ({ chart }: { chart: string }) => useConversation(runner.run, chart),
      { initialProps: { chart: 'chart-1' } }
    );

    rerender({ chart: 'chart-2' });
    await act(async () => {
      result.current.ask('When am I next in?');
      await Promise.resolve();
    });

    expect(runner.requests[0]?.chartPatientId).toBe('chart-2');
  });

  it('settles a turn whose runner threw outside the stream client', async () => {
    const throwing = () => {
      throw new Error('the runner blew up');
    };
    const { result } = renderHook(() => useConversation(throwing as never, 'chart-1'));

    await act(async () => {
      result.current.ask('When am I next in?');
      await Promise.resolve();
    });

    expect(result.current.state.turns[0]?.outcome).toBe('failed');
    expect(result.current.state.turns[0]?.failures).toEqual(['ASSISTANT_UNREACHABLE']);
    expect(result.current.state.answering).toBe(false);
  });

  it('releases the request when the page goes away', async () => {
    const runner = controllable();
    const { result, unmount } = renderHook(() => useConversation(runner.run, 'chart-1'));

    await act(async () => {
      result.current.ask('When am I next in?');
      await Promise.resolve();
    });

    // An unmount is a stop with no transcript left to settle: the only thing
    // to do is let go of the request.
    expect(() => {
      unmount();
    }).not.toThrow();
  });
});
