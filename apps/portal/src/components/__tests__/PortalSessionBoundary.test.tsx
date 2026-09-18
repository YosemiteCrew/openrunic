import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({ live: true, pathname: '/health-record' as string | null }));
const auth = vi.hoisted(() => ({
  endSession: vi.fn(() => Promise.resolve()),
  restoreSession: vi.fn(),
  returnToSignIn: vi.fn(),
}));

vi.mock('@/lib/api/config', () => ({ isLiveMode: () => runtime.live }));
vi.mock('next/navigation', () => ({ usePathname: () => runtime.pathname }));
vi.mock('@/lib/auth/client', () => auth);

import { PortalSessionBoundary } from '@/components/PortalSessionBoundary';

const NOON = Date.parse('2026-09-18T12:00:00Z');

beforeEach(() => {
  runtime.live = true;
  runtime.pathname = '/health-record';
  auth.endSession.mockClear();
  auth.restoreSession.mockReset();
  auth.returnToSignIn.mockClear();
  window.history.replaceState({}, '', '/health-record');
  vi.useFakeTimers();
  vi.setSystemTime(NOON);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('PortalSessionBoundary', () => {
  it('renders immediately in mock mode and on the public sign-in page', () => {
    runtime.live = false;
    const view = render(
      <PortalSessionBoundary>
        <p>Private record</p>
      </PortalSessionBoundary>
    );
    expect(screen.getByText('Private record')).toBeInTheDocument();

    runtime.live = true;
    runtime.pathname = '/sign-in';
    view.rerender(
      <PortalSessionBoundary>
        <p>Sign-in form</p>
      </PortalSessionBoundary>
    );
    expect(screen.getByText('Sign-in form')).toBeInTheDocument();
    expect(auth.restoreSession).not.toHaveBeenCalled();
  });

  it('holds private content until the server restores the sealed session', async () => {
    auth.restoreSession.mockResolvedValue({
      expiresAt: NOON + 60_000,
      idleExpiresAt: NOON + 30_000,
    });
    const view = render(
      <PortalSessionBoundary>
        <p>Private record</p>
      </PortalSessionBoundary>
    );

    expect(screen.getByText('Checking your session.')).toBeInTheDocument();
    await act(async () => Promise.resolve());
    expect(screen.getByText('Private record')).toBeInTheDocument();

    const signal = auth.restoreSession.mock.calls[0]?.[0] as AbortSignal;
    expect(signal.aborted).toBe(false);
    view.unmount();
    expect(signal.aborted).toBe(true);
  });

  it('returns a refused session to sign in with its local destination', async () => {
    runtime.pathname = '/messages';
    window.history.replaceState({}, '', '/messages?thread=one');
    auth.restoreSession.mockResolvedValue(null);
    render(
      <PortalSessionBoundary>
        <p>Private record</p>
      </PortalSessionBoundary>
    );

    await act(async () => Promise.resolve());

    expect(auth.returnToSignIn).toHaveBeenCalledWith('expired', '/messages?thread=one');
    expect(screen.queryByText('Private record')).not.toBeInTheDocument();
  });

  it('signs out at the idle deadline and reports the actual reason', async () => {
    auth.restoreSession.mockResolvedValue({
      expiresAt: NOON + 60_000,
      idleExpiresAt: NOON + 1_000,
    });
    render(
      <PortalSessionBoundary>
        <p>Private record</p>
      </PortalSessionBoundary>
    );
    await act(async () => Promise.resolve());
    expect(screen.getByText('Private record')).toBeInTheDocument();

    await act(async () => vi.advanceTimersByTimeAsync(1_000));

    expect(auth.endSession).toHaveBeenCalledOnce();
    expect(auth.returnToSignIn).toHaveBeenCalledWith('idle', '/health-record');
  });

  it('refreshes at most once per minute when the reader is active', async () => {
    auth.restoreSession.mockResolvedValue({
      expiresAt: NOON + 120_000,
      idleExpiresAt: NOON + 90_000,
    });
    render(
      <PortalSessionBoundary>
        <p>Private record</p>
      </PortalSessionBoundary>
    );
    await act(async () => Promise.resolve());
    expect(screen.getByText('Private record')).toBeInTheDocument();

    window.dispatchEvent(new Event('keydown'));
    expect(auth.restoreSession).toHaveBeenCalledOnce();

    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    window.dispatchEvent(new Event('pointerdown'));
    await act(async () => Promise.resolve());

    expect(auth.restoreSession).toHaveBeenCalledTimes(2);
  });
});
