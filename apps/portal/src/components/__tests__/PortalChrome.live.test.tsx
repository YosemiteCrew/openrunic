import type { ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { stubApi } from '@/__tests__/support';

const auth = vi.hoisted(() => ({
  endSession: vi.fn(() => Promise.resolve()),
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

beforeEach(() => {
  auth.endSession.mockClear();
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
});
