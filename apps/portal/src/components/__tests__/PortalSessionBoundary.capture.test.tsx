import type { ReactNode } from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { stubApi } from '@/__tests__/support';
import type { AssistantAvailability } from '@/lib/assistant';
import type { CaptureEvent, CapturePort, CaptureSession } from '@/lib/voice';

/**
 * What a session ending does to an open microphone.
 *
 * The rest of the portal loses nothing by staying on screen for the second or
 * two a sign-out takes: a page of appointments the reader can no longer refresh
 * is stale, not dangerous. The assistant is the exception, because the thing it
 * leaves running is a microphone. Ending a session is a request to the server
 * and then a page load, and for as long as both take, a portal that only
 * navigates is a portal still listening to somebody who has signed out of it.
 *
 * So this is the boundary and the assistant page together rather than either
 * alone. The closing is done by the cleanup that owns the microphone, and the
 * only thing that runs a cleanup is an unmount - which is a fact about the two
 * of them and about nothing either one of them contains.
 *
 * The recogniser here is a double: no audio is produced, nothing is contacted,
 * and it reports on the way out the way a real one does.
 */

const runtime = vi.hoisted(() => ({ pathname: '/assistant' as string | null }));
const auth = vi.hoisted(() => ({
  endSession: vi.fn(() => Promise.resolve()),
  restoreSession: vi.fn(),
  returnToSignIn: vi.fn(),
}));
const notFound = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api/config', () => ({ API_MODE: 'live', isLiveMode: () => true }));
vi.mock('@/lib/auth/client', () => auth);
vi.mock('next/navigation', () => ({ notFound, usePathname: () => runtime.pathname }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { AssistantScreen } from '@/app/assistant/AssistantScreen';
import { AssistantProvider } from '@/components/assistant';
import { PortalSessionBoundary } from '@/components/PortalSessionBoundary';

const NOON = Date.parse('2026-09-18T12:00:00Z');

const ENABLED: AssistantAvailability = {
  status: 'enabled',
  capabilities: {
    service: {
      modelId: 'a-model',
      endpointHost: 'inference.example.invalid',
      dataLeavesDeployment: true,
    },
    capabilities: [{ id: 'visits.list', summary: 'Reads your own appointments.' }],
  },
};

interface Microphone {
  port: CapturePort;
  opened: CaptureSession[];
  aborts: () => number;
  /** How many subscriptions the adapter is still reporting to. */
  listening: () => number;
  say: (id: string, text: string) => void;
}

/** A recogniser that records what it was told to do and never hears anything. */
function microphone(): Microphone {
  const opened: CaptureSession[] = [];
  const listeners = new Set<(event: CaptureEvent) => void>();
  let aborts = 0;

  const emit = (event: CaptureEvent) => {
    for (const listener of listeners) listener(event);
  };

  return {
    opened,
    aborts: () => aborts,
    listening: () => listeners.size,
    say: (id, text) => emit({ type: 'heard', id, text, final: true }),
    port: {
      available: () => Promise.resolve({ status: 'available' as const }),
      onEvent: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      start: (session) => {
        opened.push(session);
        emit({ type: 'listening', id: session.id });
      },
      stop: () => undefined,
      abort: () => {
        aborts += 1;
      },
    },
  };
}

/** The assistant page as it is actually served: behind the session boundary. */
function mount(capture: CapturePort) {
  return render(
    <PortalSessionBoundary>
      <AssistantProvider probe={() => Promise.resolve(ENABLED)}>
        <AssistantScreen api={stubApi()} capture={capture} readback={null} />
      </AssistantProvider>
    </PortalSessionBoundary>
  );
}

/** Settles the session probe, the assistant probe and the record read. */
async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  runtime.pathname = '/assistant';
  notFound.mockClear();
  auth.endSession.mockClear();
  auth.restoreSession.mockReset();
  auth.returnToSignIn.mockClear();
  window.history.replaceState({}, '', '/assistant');
  vi.useFakeTimers();
  vi.setSystemTime(NOON);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('a session that ends while the microphone is open', () => {
  it('closes it, and the words that arrive afterwards reach nothing', async () => {
    auth.restoreSession.mockResolvedValue({
      expiresAt: NOON + 60_000,
      idleExpiresAt: NOON + 1_000,
    });
    const device = microphone();
    mount(device.port);
    await settle();

    act(() => {
      screen.getByRole('button', { name: 'Speak your question' }).click();
    });
    expect(device.opened).toHaveLength(1);
    expect(device.listening()).toBe(1);
    expect(
      screen.getByText('The microphone is on. Your words go into the box above.')
    ).toBeInTheDocument();

    await act(async () => vi.advanceTimersByTimeAsync(1_000));

    expect(device.aborts()).toBe(1);
    /* Not merely that the box is gone. A recogniser hands over one last result
       on its way out, and this is the assertion that there is no longer anywhere
       for that result to be delivered to. */
    expect(device.listening()).toBe(0);
    expect(screen.queryByLabelText('Your question')).not.toBeInTheDocument();

    /* Driven rather than asserted on: a result arriving after the last
       subscription is gone has nowhere to be delivered, so there is no visible
       difference for an assertion to read. What it does check is that the
       adapter can still report into a surface that has left, which is what a
       real recogniser does on its way out. */
    const opened = device.opened[0];
    if (opened === undefined) throw new Error('the microphone was never opened');
    device.say(opened.id, 'something said after signing out');

    expect(auth.returnToSignIn).toHaveBeenCalledWith('idle', '/assistant');
  });
});
