import { fireEvent, render, screen } from '@testing-library/react';
import { SILENT } from '@openrunic/voice';
import type { ReadbackAvailability, ReadbackState } from '@openrunic/voice';
import { describe, expect, it, vi } from 'vitest';

import { AssistantReadback } from '@/components/assistant';

/**
 * The control, on its own.
 *
 * Three of its states are the point: a device that cannot speak, an answer
 * being read, and an answer that could not be. The fourth - an answer read in
 * full - says nothing, because the reader just heard it.
 */

const AVAILABLE: ReadbackAvailability = { status: 'available' };

function show(
  state: ReadbackState,
  availability: ReadbackAvailability = AVAILABLE,
  onStop = vi.fn(),
  onToggle = vi.fn()
) {
  render(
    <AssistantReadback
      availability={availability}
      onStop={onStop}
      onToggle={onToggle}
      state={state}
    />
  );
  return { onStop, onToggle };
}

describe('the control that turns the voice on', () => {
  it('draws nothing where the browser has no speech at all', () => {
    const { container } = render(
      <AssistantReadback
        availability={{ status: 'unavailable', reason: 'no-adapter' }}
        onStop={vi.fn()}
        onToggle={vi.fn()}
        state={SILENT}
      />
    );

    /* The same answer the shell gives everywhere else for something that is not
       there. A control that exists only to say it does not work is still a
       control to read past. */
    expect(container).toBeEmptyDOMElement();
  });

  it('starts off, and says what it will read before it reads anything', () => {
    show(SILENT);

    const toggle = screen.getByRole('switch', { name: 'Read answers aloud' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(
      screen.getByText(/reads out the answer already on this screen, and nothing else/)
    ).toBeInTheDocument();
  });

  it('turns on when it is pressed', () => {
    const { onToggle } = show(SILENT);

    fireEvent.click(screen.getByRole('switch', { name: 'Read answers aloud' }));

    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('explains a device that has speech and no voice installed', () => {
    show(SILENT, { status: 'unavailable', reason: 'no-voice' });

    expect(screen.getByRole('switch', { name: 'Read answers aloud' })).toBeDisabled();
    expect(screen.getByText(/no voice installed/)).toBeInTheDocument();
  });

  it('explains a device with no voice for the language of the page', () => {
    show(SILENT, { status: 'unavailable', reason: 'language' });

    expect(screen.getByRole('switch', { name: 'Read answers aloud' })).toBeDisabled();
    expect(screen.getByText(/no voice for the language this page is in/)).toBeInTheDocument();
  });
});

describe('while an answer is being read', () => {
  const reading: ReadbackState = {
    on: true,
    speaking: { turnId: 'turn-1', text: 'Two requirements are unmet.' },
    attempted: new Set(['turn-1']),
    ended: 'none',
  };

  it('says so, and offers the way to stop it', () => {
    const { onStop } = show(reading);

    expect(screen.getByRole('status')).toHaveTextContent('Reading the answer aloud.');

    fireEvent.click(screen.getByRole('button', { name: 'Stop reading' }));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('offers no stop when nothing is being read', () => {
    show({ ...reading, speaking: null, ended: 'heard' });

    expect(screen.queryByRole('button', { name: 'Stop reading' })).not.toBeInTheDocument();
  });
});

describe('how the last answer ended', () => {
  const settled: ReadbackState = {
    on: true,
    speaking: null,
    attempted: new Set(['turn-1']),
    ended: 'none',
  };

  it('says nothing at all about an answer that was read in full', () => {
    show({ ...settled, ended: 'heard' });

    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('says an answer that was stopped is still on screen', () => {
    show({ ...settled, ended: 'interrupted' });

    expect(screen.getByRole('status')).toHaveTextContent(
      'Stopped reading. The answer is still on screen.'
    );
  });

  it('says an answer that could not be read aloud, where silence would be the only other sign', () => {
    show({ ...settled, ended: 'failed' });

    expect(screen.getByRole('status')).toHaveTextContent(
      'The answer could not be read aloud. It is on screen above.'
    );
  });

  it('lets the voice speak over how the last one ended', () => {
    show({
      ...settled,
      speaking: { turnId: 'turn-2', text: 'Two requirements are unmet.' },
      ended: 'failed',
    });

    expect(screen.getByRole('status')).toHaveTextContent('Reading the answer aloud.');
  });
});
