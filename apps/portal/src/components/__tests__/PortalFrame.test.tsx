import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({ live: true, pathname: '/sign-in' }));

vi.mock('@/lib/api/config', () => ({ isLiveMode: () => runtime.live }));
vi.mock('next/navigation', () => ({ usePathname: () => runtime.pathname }));
vi.mock('@/components/PortalChrome', () => ({
  PortalChrome: ({ children }: { children: React.ReactNode }) => (
    <section data-testid="chrome">{children}</section>
  ),
}));
vi.mock('@/components/PortalSessionBoundary', () => ({
  PortalSessionBoundary: ({ children }: { children: React.ReactNode }) => (
    <section data-testid="session">{children}</section>
  ),
}));
vi.mock('@/components/assistant/AssistantProvider', () => ({
  AssistantProvider: ({ children }: { children: React.ReactNode }) => (
    <section data-testid="assistant">{children}</section>
  ),
}));

import { PortalFrame } from '@/components/PortalFrame';

beforeEach(() => {
  runtime.live = true;
  runtime.pathname = '/sign-in';
});

describe('PortalFrame', () => {
  it('renders sign in outside private portal providers', () => {
    render(<PortalFrame>Sign-in form</PortalFrame>);

    expect(screen.getByText('Sign-in form')).toBeInTheDocument();
    expect(screen.queryByTestId('session')).not.toBeInTheDocument();
    expect(screen.queryByTestId('chrome')).not.toBeInTheDocument();
  });

  it('wraps every private page with session, assistant and chrome providers', () => {
    runtime.pathname = '/messages';
    render(<PortalFrame>Messages</PortalFrame>);

    expect(screen.getByTestId('session')).toContainElement(screen.getByTestId('assistant'));
    expect(screen.getByTestId('assistant')).toContainElement(screen.getByTestId('chrome'));
    expect(screen.getByTestId('chrome')).toHaveTextContent('Messages');
  });

  it('keeps the established mock-mode frame', () => {
    runtime.live = false;
    render(<PortalFrame>Mock portal</PortalFrame>);

    expect(screen.getByTestId('chrome')).toHaveTextContent('Mock portal');
  });
});
