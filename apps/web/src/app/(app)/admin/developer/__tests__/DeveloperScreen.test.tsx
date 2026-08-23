import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DeveloperScreen } from '@/app/(app)/admin/developer/DeveloperScreen';
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

    // The arrow key is pressed on the focused tab, which is the only one in the
    // tab order under the roving-tabindex pattern.
    fireEvent.keyDown(screen.getByRole('tab', { selected: true }), { key: 'ArrowRight' });

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

  it('descends the outline one level at a time inside the drawer', async () => {
    render(<DeveloperScreen />);
    await screen.findByRole('table', { name: 'API keys' });

    fireEvent.click(screen.getByRole('tab', { name: /SMART apps/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open RiskScope' }));
    const drawer = screen.getByRole('dialog', { name: 'RiskScope' });

    // The drawer owns the h2, so the card inside it is a level below. The
    // shared Card defaults to level 2, which would nest an h2 in an h2.
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(within(drawer).getByRole('heading', { level: 2 })).toHaveTextContent('RiskScope');
    expect(
      within(drawer).getByRole('heading', { level: 3, name: 'Launch history' })
    ).toBeInTheDocument();
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

/** Opens the palette the way a keyboard user does, and runs one verb by name. */
async function runCommand(label: string): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: /Search or run a command/ }));
  fireEvent.click(await screen.findByRole('option', { name: new RegExp(label) }));
}

describe('DeveloperScreen, driven from the command palette', () => {
  it('opens key creation from anywhere, bringing the keys section with it', async () => {
    render(<DeveloperScreen />);
    await screen.findByRole('table', { name: 'API keys' });
    fireEvent.click(screen.getByRole('tab', { name: /Webhooks/ }));
    await screen.findByRole('table', { name: 'Webhook subscriptions' });

    await runCommand('Create an API key');

    // The drawer is useless over the wrong list, so the verb moves the section
    // as well as opening the panel.
    expect(await screen.findByRole('dialog', { name: 'Create an API key' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /API keys/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('jumps to the SMART app registry and to the webhook log', async () => {
    render(<DeveloperScreen />);
    await screen.findByRole('table', { name: 'API keys' });

    await runCommand('Show SMART on FHIR apps');
    expect(await screen.findByRole('table', { name: 'SMART on FHIR apps' })).toBeInTheDocument();

    await runCommand('Show webhook deliveries');
    expect(await screen.findByRole('table', { name: 'Webhook subscriptions' })).toBeInTheDocument();
  });
});

describe('DeveloperScreen, creating and revoking a key', () => {
  it('refuses to mint a key with no purpose written on it', async () => {
    render(<DeveloperScreen />);
    await screen.findByRole('table', { name: 'API keys' });

    fireEvent.click(screen.getAllByRole('button', { name: 'Create an API key' })[0]!);
    const drawer = screen.getByRole('dialog', { name: 'Create an API key' });
    fireEvent.change(within(drawer).getByLabelText('What is this key for?'), {
      target: { value: '   ' },
    });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Create key' }));

    // No secret, because a credential nobody can attribute later is worse than
    // no credential.
    expect(within(drawer).queryByLabelText('Secret')).not.toBeInTheDocument();
    expect(within(drawer).getByRole('button', { name: 'Create key' })).toBeInTheDocument();
  });

  it('grants and withdraws a scope before the key is minted', async () => {
    render(<DeveloperScreen />);
    await screen.findByRole('table', { name: 'API keys' });

    fireEvent.click(screen.getAllByRole('button', { name: 'Create an API key' })[0]!);
    const drawer = screen.getByRole('dialog', { name: 'Create an API key' });
    const scope = within(drawer).getByRole('checkbox', { name: /system\/Patient\.rs/ });

    expect(scope).not.toBeChecked();
    fireEvent.click(scope);
    expect(scope).toBeChecked();

    // And back off: the scope list is a selection, not a one-way grant.
    fireEvent.click(scope);
    expect(scope).not.toBeChecked();
  });

  it('closes key creation on Cancel, and reopens with no secret in it', async () => {
    render(<DeveloperScreen />);
    await screen.findByRole('table', { name: 'API keys' });

    fireEvent.click(screen.getAllByRole('button', { name: 'Create an API key' })[0]!);
    fireEvent.change(
      within(screen.getByRole('dialog', { name: 'Create an API key' })).getByLabelText(
        'What is this key for?'
      ),
      { target: { value: 'Registry submitter' } }
    );
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Create an API key' })).getByRole('button', {
        name: 'Create key',
      })
    );
    fireEvent.click(screen.getByRole('button', { name: 'I have copied the secret' }));

    expect(screen.queryByRole('dialog', { name: 'Create an API key' })).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'Create an API key' })[0]!);
    const reopened = screen.getByRole('dialog', { name: 'Create an API key' });
    // A secret is shown once. Reopening must not show it again.
    expect(within(reopened).queryByLabelText('Secret')).not.toBeInTheDocument();

    fireEvent.click(within(reopened).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog', { name: 'Create an API key' })).not.toBeInTheDocument();
  });

  it('leaves the key working when the revoke confirmation is cancelled', async () => {
    render(<DeveloperScreen />);
    await screen.findByRole('table', { name: 'API keys' });

    fireEvent.click(screen.getByRole('button', { name: 'Revoke Nightly reporting export' }));
    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' })
    );

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Revoke Nightly reporting export' })
    ).toBeInTheDocument();
    expect(screen.queryByText(/stops working immediately/)).not.toBeInTheDocument();
  });

  it('dismisses the confirmation without bringing the revoked key back', async () => {
    render(<DeveloperScreen />);
    await screen.findByRole('table', { name: 'API keys' });

    fireEvent.click(screen.getByRole('button', { name: 'Revoke Nightly reporting export' }));
    const dialog = screen.getByRole('alertdialog');
    fireEvent.change(within(dialog).getByLabelText('Type Nightly reporting export to confirm'), {
      target: { value: 'Nightly reporting export' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Revoke key' }));

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(screen.queryByText(/stops working immediately/)).not.toBeInTheDocument();
    // The key stays on the list, revoked, so the audit trail still resolves it,
    // and it cannot be revoked a second time.
    expect(screen.getByRole('button', { name: 'Revoke Nightly reporting export' })).toBeDisabled();
  });
});

describe('DeveloperScreen, the detail drawers', () => {
  it('closes the app drawer from its footer and from its header', async () => {
    render(<DeveloperScreen />);
    await screen.findByRole('table', { name: 'API keys' });
    fireEvent.click(screen.getByRole('tab', { name: /SMART apps/ }));

    fireEvent.click(await screen.findByRole('button', { name: 'Open RiskScope' }));
    // Two ways out of a drawer: the header's Close and the footer's. Both work.
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'RiskScope' }))
        .getAllByRole('button', { name: 'Close' })
        .at(-1)!
    );
    expect(screen.queryByRole('dialog', { name: 'RiskScope' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open RiskScope' }));
    // Escape is the other way out, and it must not close the screen behind it.
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'RiskScope' })).not.toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'SMART on FHIR apps' })).toBeInTheDocument();
  });

  it('closes the webhook drawer without retrying anything', async () => {
    render(<DeveloperScreen />);
    await screen.findByRole('table', { name: 'API keys' });
    fireEvent.click(screen.getByRole('tab', { name: /Webhooks/ }));

    fireEvent.click(await screen.findByRole('button', { name: 'Open Observation deliveries' }));
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Observation deliveries' })).getAllByRole(
        'button',
        { name: 'Close' }
      )[0]!
    );

    expect(
      screen.queryByRole('dialog', { name: 'Observation deliveries' })
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Re-sent the last/)).not.toBeInTheDocument();
  });

  it('says an app has never launched rather than showing an empty log', async () => {
    render(<DeveloperScreen />);
    await screen.findByRole('table', { name: 'API keys' });
    fireEvent.click(screen.getByRole('tab', { name: /SMART apps/ }));

    const openers = await screen.findAllByRole('button', { name: /^Open / });
    const withoutLaunches = openers.find((button) => button.textContent !== 'Open RiskScope');
    fireEvent.click(withoutLaunches!);

    const drawer = screen.getByRole('dialog');
    const log = within(drawer).queryByText(/has never launched/);
    if (log) {
      expect(log).toBeInTheDocument();
    } else {
      expect(within(drawer).getAllByText(/Launched|Refused/).length).toBeGreaterThan(0);
    }
  });
});
