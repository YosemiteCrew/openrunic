import type { ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { stubApi } from '@/__tests__/support';

const auth = vi.hoisted(() => ({
  endSession: vi.fn(() => Promise.resolve()),
  restoreSession: vi.fn(),
  returnToSignIn: vi.fn(),
}));

vi.mock('@/lib/api/config', () => ({ API_MODE: 'live', isLiveMode: () => true }));
vi.mock('@/lib/auth/client', () => auth);
vi.mock('next/navigation', () => ({ usePathname: () => '/' }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/components/assistant/AssistantProvider', () => ({
  useAssistant: () => ({ availability: { status: 'absent' } }),
}));

import { PortalChrome } from '@/components/PortalChrome';
import { PortalSessionBoundary } from '@/components/PortalSessionBoundary';

beforeEach(() => {
  auth.endSession.mockClear();
  auth.restoreSession.mockReset();
  auth.returnToSignIn.mockClear();
});

describe('PortalChrome in live mode', () => {
  it('ends the sealed session before returning to sign in', async () => {
    render(
      <PortalChrome api={stubApi()}>
        <p>Private record</p>
      </PortalChrome>
    );

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(auth.endSession).toHaveBeenCalledOnce();
    await waitFor(() => expect(auth.returnToSignIn).toHaveBeenCalledOnce());
  });

  it('takes the private pages down as it goes, rather than when the browser arrives', async () => {
    auth.restoreSession.mockResolvedValue({
      expiresAt: Date.now() + 120_000,
      idleExpiresAt: Date.now() + 90_000,
    });
    render(
      <PortalSessionBoundary>
        <PortalChrome api={stubApi()}>
          <p>Private record</p>
        </PortalChrome>
      </PortalSessionBoundary>
    );
    await screen.findByText('Private record');

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    /* Signing out is a request and then a page load. Everything on this side of
       the boundary keeps running for both, and on the assistant that includes
       an open microphone. */
    expect(screen.queryByText('Private record')).not.toBeInTheDocument();
  });
});
