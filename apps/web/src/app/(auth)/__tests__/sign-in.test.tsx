import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { developmentCredentials } from '@/lib/auth/directory';
import { ABSOLUTE_LIFETIME_MS } from '@/lib/auth/session';
import type { Session } from '@/lib/auth/session';
import { heldSession, holdSession } from '@/lib/auth/store';

import SignInPage, { metadata } from '../sign-in/page';
import { SignInScreen } from '../sign-in/SignInScreen';

/**
 * The screen that stands between a stranger and the application.
 *
 * Everything asserted here is something a clinician does or reads: the token
 * they type, the name of the button they press, the sentence that explains why
 * they are looking at this form again, and where they end up afterwards.
 */

const NOON = Date.parse('2026-08-13T12:00:00Z');

const SESSION: Session = {
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

function accepted(): Response {
  return new Response(JSON.stringify(SESSION), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function refused(): Response {
  return new Response(JSON.stringify({ error: 'no' }), {
    status: 401,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  fetchImpl.mockReset();
  navigate.mockReset();
  vi.stubGlobal('fetch', fetchImpl);
  holdSession(null);
});

afterEach(() => {
  holdSession(null);
  vi.unstubAllGlobals();
});

describe('signing in with a token', () => {
  it('sends the clinician to the schedule when nothing else was asked for', async () => {
    fetchImpl.mockResolvedValue(accepted());
    render(<SignInScreen navigate={navigate} credentials={[]} />);

    fireEvent.change(screen.getByLabelText('Access token'), {
      target: { value: 'dev-clinician-a' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/schedule'));
    expect(heldSession()).toEqual(SESSION);
  });

  it('starts the application from scratch rather than layering it over the form', async () => {
    // A document navigation, not a router push: the signed-out tree, its state
    // and anything it rendered go away before the signed-in one is built.
    const assign = vi.fn();
    vi.stubGlobal('location', { assign, search: '' });
    fetchImpl.mockResolvedValue(accepted());
    render(<SignInScreen credentials={[]} />);

    fireEvent.change(screen.getByLabelText('Access token'), {
      target: { value: 'dev-clinician-a' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(assign).toHaveBeenCalledWith('/schedule'));
  });

  it('sends them back to the page they were trying to open', async () => {
    fetchImpl.mockResolvedValue(accepted());
    render(<SignInScreen navigate={navigate} credentials={[]} next="/patients?query=okafor" />);

    fireEvent.change(screen.getByLabelText('Access token'), {
      target: { value: 'dev-clinician-a' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/patients?query=okafor'));
  });

  it('never follows a return path that leaves this origin', async () => {
    fetchImpl.mockResolvedValue(accepted());
    render(<SignInScreen navigate={navigate} credentials={[]} next="//not-openrunic.test" />);

    fireEvent.change(screen.getByLabelText('Access token'), {
      target: { value: 'dev-clinician-a' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/schedule'));
  });

  it('will not submit an empty field', () => {
    render(<SignInScreen navigate={navigate} credentials={[]} />);

    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled();
  });

  it('keeps the token out of sight on a shared workstation', () => {
    render(<SignInScreen navigate={navigate} credentials={[]} />);

    expect(screen.getByLabelText('Access token')).toHaveAttribute('type', 'password');
  });
});

describe('when signing in does not work', () => {
  it('says the token was not recognised, against the field it was typed into', async () => {
    fetchImpl.mockResolvedValue(refused());
    render(<SignInScreen navigate={navigate} credentials={[]} />);

    fireEvent.change(screen.getByLabelText('Access token'), { target: { value: 'guessing' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('That access token was not recognised.')).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('blames the server when the server is at fault, not the person holding the token', async () => {
    fetchImpl.mockRejectedValue(new TypeError('Failed to fetch'));
    render(<SignInScreen navigate={navigate} credentials={[]} />);

    fireEvent.change(screen.getByLabelText('Access token'), {
      target: { value: 'dev-clinician-a' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(
      await screen.findByText('The sign-in service could not be reached.')
    ).toBeInTheDocument();
    expect(screen.queryByText('That access token was not recognised.')).not.toBeInTheDocument();
  });

  it('clears the complaint as soon as the token is edited', async () => {
    fetchImpl.mockResolvedValue(refused());
    render(<SignInScreen navigate={navigate} credentials={[]} />);

    fireEvent.change(screen.getByLabelText('Access token'), { target: { value: 'guessing' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('That access token was not recognised.')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Access token'), { target: { value: '-again' } });

    expect(screen.queryByText('That access token was not recognised.')).not.toBeInTheDocument();
  });
});

describe('arriving here holding a session that stopped working', () => {
  it('explains an idle sign-out rather than appearing to be a fault', async () => {
    render(<SignInScreen navigate={navigate} credentials={[]} reason="idle" />);

    expect(
      await screen.findByText('You were signed out after 15 minutes without activity.')
    ).toBeInTheDocument();
  });

  it('explains an ended session', () => {
    render(<SignInScreen navigate={navigate} credentials={[]} reason="expired" />);

    expect(screen.getByText('Your session has ended.')).toBeInTheDocument();
  });

  it('says nothing when there is nothing to explain', () => {
    render(<SignInScreen navigate={navigate} credentials={[]} reason="something-else" />);

    expect(screen.queryByText('Your session has ended.')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('the development sign-in', () => {
  it('signs in as a named principal in one press', async () => {
    fetchImpl.mockResolvedValue(accepted());
    render(<SignInScreen navigate={navigate} credentials={developmentCredentials('test')} />);

    fireEvent.click(screen.getByRole('button', { name: 'Dr. Adaeze Okafor (clinician)' }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/schedule'));
    expect(fetchImpl.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({ token: 'dev-clinician-a' }));
  });

  it('offers every development principal, and says they are only that', () => {
    render(<SignInScreen navigate={navigate} credentials={developmentCredentials('test')} />);

    expect(screen.getByRole('group', { name: 'Development sign-in' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Front Desk (front-desk)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Billing (biller)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dr. Rowan Vale (clinician)' })).toBeInTheDocument();
  });

  it('is absent from a production build, which offers no door at all', () => {
    render(<SignInScreen navigate={navigate} credentials={developmentCredentials('production')} />);

    expect(screen.queryByRole('group', { name: 'Development sign-in' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Access token')).toBeInTheDocument();
  });
});

describe('the route', () => {
  it('names the tab, and stays out of search indexes', () => {
    expect(metadata.title).toBe('Sign in');
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it('reads the reason and the return path off the URL for the screen', async () => {
    fetchImpl.mockResolvedValue(accepted());
    render(
      await SignInPage({
        searchParams: Promise.resolve({ reason: 'idle', next: '/orders' }),
      })
    );

    expect(
      screen.getByText('You were signed out after 15 minutes without activity.')
    ).toBeInTheDocument();
  });

  it('takes the first value when a parameter arrives repeated', async () => {
    render(
      await SignInPage({
        searchParams: Promise.resolve({ reason: ['expired', 'idle'], next: [] }),
      })
    );

    expect(screen.getByText('Your session has ended.')).toBeInTheDocument();
  });

  it('renders without either parameter', async () => {
    render(await SignInPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument();
  });
});

describe('the organisation sign-in link', () => {
  it('is absent when the deployment has no identity provider', () => {
    render(<SignInScreen reason={null} next={null} credentials={[]} />);

    expect(screen.queryByRole('link', { name: /organisation/i })).not.toBeInTheDocument();
  });

  it('starts the redirect flow when one is configured', () => {
    render(<SignInScreen reason={null} next={null} credentials={[]} oidcEnabled />);

    expect(screen.getByRole('link', { name: /organisation/i })).toHaveAttribute(
      'href',
      '/auth/start'
    );
  });

  it('carries the return path through the provider and back', () => {
    render(<SignInScreen reason={null} next="/billing" credentials={[]} oidcEnabled />);

    expect(screen.getByRole('link', { name: /organisation/i })).toHaveAttribute(
      'href',
      '/auth/start?next=%2Fbilling'
    );
  });
});
