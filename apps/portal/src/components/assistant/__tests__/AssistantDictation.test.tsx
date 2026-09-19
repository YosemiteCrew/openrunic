import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AssistantComposer } from '@/components/assistant';
import type { CaptureAvailability, CaptureEvent, CapturePort, CaptureSession } from '@/lib/voice';

/**
 * The microphone as somebody with a phone meets it, wired to the box it writes
 * into.
 *
 * The case the file exists for is the last one: no arrangement of speech asks
 * the assistant anything. Dictated words arrive in the field where typed ones
 * do, and the only thing that sends them is the press that sends anything else.
 * The rest is what the reader is told - which device cannot do this, what the
 * microphone is doing right now, and why nothing was heard.
 */

function fake(answer: CaptureAvailability = { status: 'available' }) {
  const opened: CaptureSession[] = [];
  const listeners = new Set<(event: CaptureEvent) => void>();
  let stops = 0;

  const emit = (event: CaptureEvent) => {
    for (const listener of listeners) listener(event);
  };

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
    abort: () => undefined,
  };

  return {
    port,
    opened,
    stops: () => stops,
    listening: () => emit({ type: 'listening', id: opened[opened.length - 1]?.id ?? '' }),
    say: (text: string, final: boolean) =>
      emit({ type: 'heard', id: opened[opened.length - 1]?.id ?? '', text, final }),
    fail: (reason: 'denied' | 'off-device') =>
      emit({ type: 'failed', id: opened[opened.length - 1]?.id ?? '', reason }),
  };
}

function composer(port: CapturePort | null, onAsk = vi.fn()) {
  render(
    <AssistantComposer
      answering={false}
      capture={port}
      chartPatientId="patient-1"
      onAsk={onAsk}
      onStop={vi.fn()}
    />
  );
  return onAsk;
}

const SPEAK = { name: 'Speak your question' };

describe('a device that cannot dictate', () => {
  it('draws nothing at all where there is no on-device recogniser', () => {
    composer(null);

    expect(screen.queryByRole('button', SPEAK)).not.toBeInTheDocument();
    /* The box is still there. Dictation being absent is not the field being
       unavailable, and a reader who cannot speak can always type. */
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('explains an absence the reader could act on, before anything is captured', async () => {
    composer(fake({ status: 'unavailable', reason: 'not-installed' }).port);

    expect(
      await screen.findByText(/language pack for this page is installed/i)
    ).toBeInTheDocument();
    expect(screen.getByRole('button', SPEAK)).toBeDisabled();
  });

  it('says plainly when the language would only work by sending the sound away', async () => {
    composer(fake({ status: 'unavailable', reason: 'language' }).port);

    expect(await screen.findByText(/without sending the sound away/i)).toBeInTheDocument();
    expect(screen.getByRole('button', SPEAK)).toBeDisabled();
  });
});

describe('one question, spoken', () => {
  it('says where the words go before the microphone is ever opened', async () => {
    composer(fake().port);

    await waitFor(() => {
      expect(screen.getByRole('button', SPEAK)).toBeEnabled();
    });
    expect(screen.getByText(/on the device itself, and nothing is sent anywhere/i)).toBeVisible();
    expect(screen.getByText(/nothing is asked until you press Ask/i)).toBeVisible();
  });

  it('claims the microphone is on only once something reports audio', async () => {
    const double = fake();
    composer(double.port);

    const speak = await screen.findByRole('button', SPEAK);
    await userEvent.click(speak);

    /* The permission prompt lives in this gap. Saying "the microphone is on"
       here would be telling somebody they are being recorded when they are not. */
    expect(screen.getByRole('status')).toHaveTextContent('Opening the microphone.');

    act(() => {
      double.listening();
    });
    expect(screen.getByRole('status')).toHaveTextContent('The microphone is on.');
  });

  it('shows the words as they are recognised, then puts the settled ones in the box', async () => {
    const double = fake();
    composer(double.port);

    await userEvent.click(await screen.findByRole('button', SPEAK));
    act(() => {
      double.listening();
      double.say('when is my', false);
    });

    expect(screen.getByText('when is my')).toBeVisible();
    expect(screen.getByRole('textbox')).toHaveValue('');

    act(() => {
      double.say('when is my appointment', true);
    });

    expect(screen.getByRole('textbox')).toHaveValue('when is my appointment');
    /* Once it is in the box the provisional line goes, rather than showing the
       same sentence twice with only one of them editable. */
    expect(screen.queryByText('when is my')).not.toBeInTheDocument();
  });

  it('offers a way to close the microphone while it is open', async () => {
    const double = fake();
    composer(double.port);

    await userEvent.click(await screen.findByRole('button', SPEAK));
    act(() => {
      double.listening();
    });

    await userEvent.click(screen.getByRole('button', { name: 'Stop the microphone' }));
    expect(double.stops()).toBe(1);
  });

  it('says why nothing was heard, and offers the microphone again', async () => {
    const double = fake();
    composer(double.port);

    await userEvent.click(await screen.findByRole('button', SPEAK));
    act(() => {
      double.fail('denied');
    });

    expect(screen.getByRole('status')).toHaveTextContent(/The microphone was not allowed/i);
    expect(screen.getByRole('button', SPEAK)).toBeEnabled();
  });
});

describe('speech cannot ask anything', () => {
  it('leaves the question unsent however much is said', async () => {
    const double = fake();
    const onAsk = composer(double.port);

    await userEvent.click(await screen.findByRole('button', SPEAK));
    act(() => {
      double.listening();
      double.say('when is my appointment', true);
      double.say('and pay my balance', true);
      double.say('send it', true);
    });

    expect(screen.getByRole('textbox')).toHaveValue(
      'when is my appointment and pay my balance send it'
    );
    /* Nothing in the component that hears can reach the assistant, so this is a
       property of the wiring rather than a rule somebody has to keep. */
    expect(onAsk).not.toHaveBeenCalled();
  });

  it('sends what was dictated when the reader presses Ask, like anything typed', async () => {
    const double = fake();
    const onAsk = composer(double.port);

    await userEvent.click(await screen.findByRole('button', SPEAK));
    act(() => {
      double.say('what do I owe', true);
    });
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }));

    expect(onAsk).toHaveBeenCalledWith('what do I owe');
  });

  it('adds to a half-typed question rather than replacing it', async () => {
    const double = fake();
    composer(double.port);

    await userEvent.type(await screen.findByRole('textbox'), 'When is');
    await userEvent.click(screen.getByRole('button', SPEAK));
    act(() => {
      double.say('my appointment', true);
    });

    expect(screen.getByRole('textbox')).toHaveValue('When is my appointment');
  });
});
