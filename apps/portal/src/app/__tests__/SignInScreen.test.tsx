import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  landingPath: vi.fn((next: string | null | undefined) => next ?? '/'),
  signIn: vi.fn(),
}));

vi.mock('@/lib/auth/client', () => auth);

import { SignInScreen } from '@/app/sign-in/SignInScreen';

beforeEach(() => {
  auth.landingPath.mockReset();
  auth.landingPath.mockImplementation((next: string | null | undefined) => next ?? '/');
  auth.signIn.mockReset();
});

describe('SignInScreen', () => {
  it('explains why an idle or expired session ended', () => {
    const { rerender } = render(<SignInScreen reason="idle" developmentToken={null} />);
    expect(screen.getByRole('status')).toHaveTextContent('signed out after being inactive');

    rerender(<SignInScreen reason="expired" developmentToken={null} />);
    expect(screen.getByRole('status')).toHaveTextContent('Your session ended');
  });

  it('submits the typed token and returns only to the sanitised local destination', async () => {
    auth.signIn.mockResolvedValue({
      ok: true,
      session: { expiresAt: 100, idleExpiresAt: 50 },
    });
    auth.landingPath.mockReturnValue('/messages');
    const navigate = vi.fn();
    render(<SignInScreen next="/messages" navigate={navigate} developmentToken={null} />);

    await userEvent.type(screen.getByLabelText('Access token'), 'patient-token');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(auth.signIn).toHaveBeenCalledWith('patient-token');
    expect(auth.landingPath).toHaveBeenCalledWith('/messages');
    expect(navigate).toHaveBeenCalledWith('/messages');
  });

  it('keeps the form open and identifies a rejected token', async () => {
    auth.signIn.mockResolvedValue({ ok: false, reason: 'rejected' });
    render(<SignInScreen navigate={vi.fn()} developmentToken={null} />);

    const input = screen.getByLabelText('Access token');
    await userEvent.type(input, 'wrong-token');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('That access token was not accepted.')).toBeInTheDocument();
    expect(input).toHaveValue('wrong-token');

    await userEvent.type(input, 'x');
    expect(screen.queryByText('That access token was not accepted.')).not.toBeInTheDocument();
  });

  it('reports an unavailable service without calling it a bad token', async () => {
    auth.signIn.mockResolvedValue({ ok: false, reason: 'unavailable' });
    render(<SignInScreen navigate={vi.fn()} developmentToken={null} />);

    await userEvent.type(screen.getByLabelText('Access token'), 'patient-token');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('could not sign you in');
    expect(screen.queryByText('That access token was not accepted.')).not.toBeInTheDocument();
  });

  it('keeps the development shortcut out of production-shaped renders', () => {
    render(<SignInScreen developmentToken={null} />);

    expect(
      screen.queryByRole('button', { name: 'Open development record' })
    ).not.toBeInTheDocument();
  });

  it('uses the seeded token through the same validation path in development', async () => {
    auth.signIn.mockResolvedValue({
      ok: true,
      session: { expiresAt: 100, idleExpiresAt: 50 },
    });
    const navigate = vi.fn();
    render(<SignInScreen developmentToken="dev-portal-a" navigate={navigate} />);

    await userEvent.click(screen.getByRole('button', { name: 'Open development record' }));

    expect(auth.signIn).toHaveBeenCalledWith('dev-portal-a');
    expect(navigate).toHaveBeenCalledWith('/');
  });
});
