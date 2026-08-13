import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SessionGate } from '@/lib/auth/SessionGate';
import { ABSOLUTE_LIFETIME_MS, IDLE_TIMEOUT_MS } from '@/lib/auth/session';
import type { Session } from '@/lib/auth/session';
import { heldSession, holdSession } from '@/lib/auth/store';

/**
 * What a clinician sees between asking for a screen and getting one.
 *
 * The gate is not access control - `proxy.ts` and the API are - so these
 * tests are about what renders and when: a chart never appears before there is
 * a token to fetch it with, and a session that has run out sends somebody to
 * sign in rather than leaving them looking at an empty frame.
 */

let pathname: string | null = '/patients';

vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
}));

const NOW = Date.parse('2026-08-13T12:00:00Z');

const SESSION: Session = {
  token: 'dev-clinician-a',
  identity: {
    subject: '01890000-0000-7000-8000-000000000101',
    displayName: 'Dr. Adaeze Okafor',
    roles: ['clinician'],
  },
  expiresAt: NOW + ABSOLUTE_LIFETIME_MS,
};

const fetchImpl = vi.fn<typeof fetch>();
const navigate = vi.fn<(url: string) => void>();

function sessionResponse(): Response {
  return new Response(JSON.stringify(SESSION), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function refusal(): Response {
  return new Response(JSON.stringify({ error: 'no' }), {
    status: 401,
    headers: { 'content-type': 'application/json' },
  });
}

function renderGate(): void {
  render(
    <SessionGate navigate={navigate}>
      <p>Chart for PATIENTSSON, Testina</p>
    </SessionGate>
  );
}

beforeEach(() => {
  pathname = '/patients';
  fetchImpl.mockReset();
  navigate.mockReset();
  vi.stubGlobal('fetch', fetchImpl);
  holdSession(null);
});

afterEach(() => {
  holdSession(null);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('a public page', () => {
  it('renders without waiting for anything', () => {
    pathname = '/';
    renderGate();

    expect(screen.getByText('Chart for PATIENTSSON, Testina')).toBeInTheDocument();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('renders when the route is not known, because guessing wrong here is only confusing', () => {
    pathname = null;
    renderGate();

    expect(screen.getByText('Chart for PATIENTSSON, Testina')).toBeInTheDocument();
  });
});

describe('a clinical page', () => {
  it('does not render the chart before there is a token to fetch it with', () => {
    fetchImpl.mockResolvedValue(sessionResponse());
    renderGate();

    expect(screen.queryByText('Chart for PATIENTSSON, Testina')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Restoring your session');
  });

  it('renders it once the session cookie has been turned back into a token', async () => {
    fetchImpl.mockResolvedValue(sessionResponse());
    renderGate();

    await waitFor(() =>
      expect(screen.getByText('Chart for PATIENTSSON, Testina')).toBeInTheDocument()
    );
    expect(heldSession()).toEqual(SESSION);
  });

  it('renders straight away when the session is already in memory', () => {
    holdSession(SESSION);
    renderGate();

    expect(screen.getByText('Chart for PATIENTSSON, Testina')).toBeInTheDocument();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sends an expired session to sign in rather than showing a broken screen', async () => {
    fetchImpl.mockResolvedValue(refusal());
    renderGate();

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith('/sign-in?next=%2Fpatients&reason=expired')
    );
    expect(screen.queryByText('Chart for PATIENTSSON, Testina')).not.toBeInTheDocument();
  });

  it('carries the query the clinician was looking at into the return path', async () => {
    vi.stubGlobal('location', { assign: vi.fn(), search: '?tab=meds' });
    fetchImpl.mockResolvedValue(refusal());
    renderGate();

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith('/sign-in?next=%2Fpatients%3Ftab%3Dmeds&reason=expired')
    );
  });

  it('sends them to sign in when the API takes the session away mid-shift', async () => {
    holdSession(SESSION);
    renderGate();
    expect(screen.getByText('Chart for PATIENTSSON, Testina')).toBeInTheDocument();

    // What `createSessionAwareFetch` does on a 401 from the API.
    fetchImpl.mockResolvedValue(refusal());
    act(() => {
      holdSession(null);
    });

    await waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(screen.queryByText('Chart for PATIENTSSON, Testina')).not.toBeInTheDocument();
  });

  it('navigates the whole document by default, so no chart survives the redirect', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { assign, search: '' });
    fetchImpl.mockResolvedValue(refusal());

    render(
      <SessionGate>
        <p>Chart for PATIENTSSON, Testina</p>
      </SessionGate>
    );

    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith('/sign-in?next=%2Fpatients&reason=expired')
    );
  });
});

describe('a workstation left unattended', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  it('signs out after the idle window and says so', async () => {
    holdSession(SESSION);
    fetchImpl.mockResolvedValue(new Response(null, { status: 204 }));
    renderGate();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(IDLE_TIMEOUT_MS);
    });

    expect(heldSession()).toBeNull();
    expect(navigate.mock.calls[0]?.[0]).toBe('/sign-in?next=%2Fpatients&reason=idle');
  });

  it('stays signed in while somebody is still using it', async () => {
    holdSession(SESSION);
    fetchImpl.mockResolvedValue(new Response(null, { status: 204 }));
    renderGate();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(IDLE_TIMEOUT_MS - 1000);
    });
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(IDLE_TIMEOUT_MS - 1000);
    });

    expect(heldSession()).toEqual(SESSION);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('counts a click as somebody being there', async () => {
    holdSession(SESSION);
    fetchImpl.mockResolvedValue(new Response(null, { status: 204 }));
    renderGate();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(IDLE_TIMEOUT_MS - 1000);
    });
    act(() => {
      window.dispatchEvent(new Event('pointerdown'));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(IDLE_TIMEOUT_MS - 1000);
    });

    expect(heldSession()).toEqual(SESSION);
  });

  it('ends the session on a public page without throwing the reader off it', async () => {
    pathname = '/';
    holdSession(SESSION);
    fetchImpl.mockResolvedValue(new Response(null, { status: 204 }));
    renderGate();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(IDLE_TIMEOUT_MS);
    });

    expect(heldSession()).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });
});
