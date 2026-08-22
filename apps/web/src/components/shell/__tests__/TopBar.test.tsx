import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AssistantProvider } from '@/components/assistant';
import { CommandProvider } from '@/components/command';
import { TopBar } from '@/components/shell/TopBar';
import { ABSOLUTE_LIFETIME_MS } from '@/lib/auth/session';
import type { Session } from '@/lib/auth/session';
import { heldSession, holdSession } from '@/lib/auth/store';
import { SESSION_FETCH_HEADER, SESSION_FETCH_MARKER } from '@/lib/auth/routes';

/**
 * Who the top bar says you are, and how you stop being them.
 *
 * The name is the assertion that matters: the most expensive mistake in this
 * application is writing a note as whoever forgot to sign out, and the only
 * thing standing against it is a legible name in a fixed place.
 */

const NOON = Date.parse('2026-08-13T12:00:00Z');

const CLINICIAN: Session = {
  token: 'dev-clinician-a',
  identity: {
    subject: '01890000-0000-7000-8000-000000000101',
    displayName: 'Dr. Adaeze Okafor',
    roles: ['clinician'],
  },
  expiresAt: NOON + ABSOLUTE_LIFETIME_MS,
};

const fetchImpl = vi.fn<typeof fetch>();
const navigate = vi.fn<(url: string) => void>();

function renderTopBar(): void {
  render(
    <CommandProvider baseCommands={[]}>
      <AssistantProvider>
        <TopBar area="Patients" navigate={navigate} />
      </AssistantProvider>
    </CommandProvider>
  );
}

beforeEach(() => {
  fetchImpl.mockReset();
  fetchImpl.mockResolvedValue(new Response(null, { status: 204 }));
  navigate.mockReset();
  vi.stubGlobal('fetch', fetchImpl);
  holdSession(null);
});

afterEach(() => {
  holdSession(null);
  vi.unstubAllGlobals();
});

describe('the signed-in clinician', () => {
  it('is named in the bar, so nobody writes a note as the last person here', () => {
    holdSession(CLINICIAN);
    renderTopBar();

    expect(screen.getByText('Dr. Adaeze Okafor')).toBeInTheDocument();
  });

  it('changes when the session does, without a reload', () => {
    renderTopBar();
    expect(screen.queryByText('Dr. Adaeze Okafor')).not.toBeInTheDocument();

    act(() => {
      holdSession(CLINICIAN);
    });

    expect(screen.getByText('Dr. Adaeze Okafor')).toBeInTheDocument();
  });

  it('can sign out in one press, without opening a menu first', () => {
    holdSession(CLINICIAN);
    renderTopBar();

    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });
});

describe('signing out', () => {
  it('takes the token away and revokes the cookie', async () => {
    holdSession(CLINICIAN);
    renderTopBar();

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    await waitFor(() => expect(heldSession()).toBeNull());
    expect(fetchImpl).toHaveBeenCalledWith('/session', {
      method: 'DELETE',
      headers: { [SESSION_FETCH_HEADER]: SESSION_FETCH_MARKER },
    });
  });

  it('reloads the document onto the sign-in screen, so no chart is left behind it', async () => {
    holdSession(CLINICIAN);
    renderTopBar();

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/sign-in'));
  });

  it('does that by default, not only when a test says so', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { assign, search: '' });
    holdSession(CLINICIAN);
    render(
      <CommandProvider baseCommands={[]}>
        <AssistantProvider>
          <TopBar area="Patients" />
        </AssistantProvider>
      </CommandProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    await waitFor(() => expect(assign).toHaveBeenCalledWith('/sign-in'));
  });
});

describe('with nobody signed in', () => {
  it('claims no identity at all', () => {
    // A name in the corner is a claim about who is signed in, and there is
    // nobody to claim.
    renderTopBar();

    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument();
    expect(screen.queryByText('Dr. Adaeze Okafor')).not.toBeInTheDocument();
  });

  it('still says where you are and offers the command control', () => {
    renderTopBar();

    expect(screen.getByText('Patients')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Search or run a command/ })).toBeInTheDocument();
  });
});
