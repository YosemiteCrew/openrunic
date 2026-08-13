import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DeveloperScreen } from '@/app/admin/developer/DeveloperScreen';
import { adminMockFailure, createAdminMockClient } from '@/lib/api';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => '/admin/developer',
}));

describe('DeveloperScreen', () => {
  it('opens on API keys with their scopes and last use', async () => {
    render(<DeveloperScreen />);

    const table = await screen.findByRole('table', { name: 'API keys' });
    expect(within(table).getByText('Nightly reporting export')).toBeInTheDocument();
    expect(within(table).getAllByText('system/Patient.rs').length).toBeGreaterThan(0);
    expect(within(table).getByText('Revoked')).toBeInTheDocument();
  });

  it('moves between sections with the arrow keys alone', async () => {
    render(<DeveloperScreen />);
    await screen.findByRole('table', { name: 'API keys' });

    const tabs = screen.getByRole('tablist', { name: 'Developer platform sections' });
    fireEvent.keyDown(tabs, { key: 'ArrowRight' });

    expect(await screen.findByRole('table', { name: 'SMART on FHIR apps' })).toBeInTheDocument();
  });

  it('shows a new secret once, with a copy-now warning', async () => {
    render(<DeveloperScreen />);
    await screen.findByRole('table', { name: 'API keys' });

    fireEvent.click(screen.getAllByRole('button', { name: 'Create an API key' })[0]!);
    const drawer = screen.getByRole('dialog', { name: 'Create an API key' });

    fireEvent.change(within(drawer).getByLabelText('What is this key for?'), {
      target: { value: 'Registry submitter' },
    });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Create key' }));

    expect(screen.getByText(/Copy this secret now/)).toBeInTheDocument();
    expect(within(drawer).getByLabelText('Secret')).toHaveAttribute('readonly');
    expect(screen.getByRole('button', { name: 'I have copied the secret' })).toBeInTheDocument();
  });

  it('revokes a key only after its name is typed, and keeps the record', async () => {
    render(<DeveloperScreen />);
    await screen.findByRole('table', { name: 'API keys' });

    fireEvent.click(screen.getByRole('button', { name: 'Revoke Nightly reporting export' }));

    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('The key is kept, revoked');

    const confirm = within(dialog).getByRole('button', { name: 'Revoke key' });
    expect(confirm).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText('Type Nightly reporting export to confirm'), {
      target: { value: 'Nightly reporting export' },
    });
    fireEvent.click(confirm);

    expect(screen.getByText(/stops working immediately/)).toBeInTheDocument();
  });

  it('translates a failed SMART launch into a sentence a developer can act on', async () => {
    render(<DeveloperScreen />);
    await screen.findByRole('table', { name: 'API keys' });

    fireEvent.click(screen.getByRole('tab', { name: /SMART apps/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open RiskScope' }));

    const drawer = screen.getByRole('dialog', { name: 'RiskScope' });
    expect(within(drawer).getByText(/asked for a scope it is not granted/)).toBeInTheDocument();
    expect(within(drawer).getByText('Refused')).toBeInTheDocument();
  });

  it('test-launches an app against the demo tenant from the drawer', async () => {
    render(<DeveloperScreen />);
    await screen.findByRole('table', { name: 'API keys' });

    fireEvent.click(screen.getByRole('tab', { name: /SMART apps/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open RiskScope' }));
    fireEvent.click(screen.getByRole('button', { name: 'Test launch' }));

    expect(screen.getByText(/Test launch of RiskScope succeeded/)).toBeInTheDocument();
  });

  it('shows the delivery log of a failing webhook with a retry', async () => {
    render(<DeveloperScreen />);
    await screen.findByRole('table', { name: 'API keys' });

    fireEvent.click(screen.getByRole('tab', { name: /Webhooks/ }));
    const hooks = await screen.findByRole('table', { name: 'Webhook subscriptions' });
    expect(within(hooks).getByText('Failing')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open Observation deliveries' }));
    const drawer = screen.getByRole('dialog', { name: 'Observation deliveries' });

    expect(within(drawer).getByText('503')).toBeInTheDocument();
    expect(within(drawer).getByText('Timed out')).toBeInTheDocument();
    expect(
      within(drawer).getByText(/pauses itself after 100 consecutive failures/)
    ).toBeInTheDocument();

    fireEvent.click(within(drawer).getByRole('button', { name: 'Retry last delivery' }));
    expect(screen.getByText(/Re-sent the last Observation delivery/)).toBeInTheDocument();
  });

  it('renders the empty state for each section with one action', async () => {
    render(<DeveloperScreen client={createAdminMockClient({ empty: true })} />);

    expect(await screen.findByText('No API keys yet')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /Webhooks/ }));
    expect(await screen.findByText('No subscriptions yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create a subscription' })).toBeInTheDocument();
  });

  it('explains a failure and offers a retry', async () => {
    render(<DeveloperScreen client={createAdminMockClient({ failure: adminMockFailure() })} />);
    expect(await screen.findByText('The server could not answer')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Try again/ }).length).toBeGreaterThan(0);
  });

  it('shows a skeleton while the keys load', () => {
    render(<DeveloperScreen />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading api keys');
  });
});
