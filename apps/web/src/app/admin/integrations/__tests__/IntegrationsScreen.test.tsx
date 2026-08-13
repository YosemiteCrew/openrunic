import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { IntegrationsScreen } from '@/app/admin/integrations/IntegrationsScreen';
import { adminMockFailure, createAdminMockClient, MOCK_INTEGRATIONS } from '@/lib/api';
import type { AdminClient, Integration } from '@/lib/api';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => '/admin/integrations',
}));

describe('IntegrationsScreen', () => {
  it('shows every seam with a state word, not only a chip colour', async () => {
    render(<IntegrationsScreen />);

    expect(await screen.findByText('Claims clearinghouse')).toBeInTheDocument();
    expect(screen.getAllByText('Connected').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Placeholder mode').length).toBeGreaterThan(0);
    expect(screen.getByText('Not working')).toBeInTheDocument();
    expect(screen.getByText('Not connected')).toBeInTheDocument();
  });

  it('says what a not-connected seam costs the practice', async () => {
    render(<IntegrationsScreen />);
    await screen.findByText('Fax');
    expect(
      screen.getByText(/No adapter configured. The features that need this seam are unavailable./)
    ).toBeInTheDocument();
  });

  it('leads with the failing connection and what happens to queued work', async () => {
    render(<IntegrationsScreen />);

    expect(await screen.findByText(/Laboratory network is not working/)).toBeInTheDocument();
    expect(screen.getByText(/queued rather than lost/)).toBeInTheDocument();
  });

  it('opens the failing seam from the banner and explains it in plain language', async () => {
    render(<IntegrationsScreen />);
    await screen.findByText('Laboratory network');

    fireEvent.click(screen.getAllByRole('button', { name: 'Open the failing connection' })[0]!);

    const drawer = screen.getByRole('dialog', { name: 'Laboratory network' });
    expect(within(drawer).getByText(/refused the connection credentials/)).toBeInTheDocument();
    expect(within(drawer).getByText(/Last working:/)).toBeInTheDocument();
  });

  it('never shows a credential value, only its reference', async () => {
    render(<IntegrationsScreen />);
    await screen.findByText('Card payments');

    fireEvent.click(screen.getByRole('button', { name: 'Configure Card payments' }));

    const drawer = screen.getByRole('dialog', { name: 'Card payments' });
    const field = within(drawer).getByLabelText('Secret reference');
    expect(field).toHaveValue('secret://payments/demo-key');
    expect(field).toHaveAttribute('readonly');
  });

  it('tests a connection and reports the result in a sentence', async () => {
    render(<IntegrationsScreen />);
    await screen.findByText('Claims clearinghouse');

    fireEvent.click(screen.getByRole('button', { name: 'Configure Claims clearinghouse' }));
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));

    expect(screen.getAllByText(/answered in 142 ms/).length).toBeGreaterThan(0);
  });

  it('descends the outline one level at a time inside the drawer', async () => {
    render(<IntegrationsScreen />);
    await screen.findByText('Claims clearinghouse');

    fireEvent.click(screen.getByRole('button', { name: 'Configure Claims clearinghouse' }));
    // Adds the third card, so the assertion covers the conditional one too.
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));

    const drawer = screen.getByRole('dialog', { name: 'Claims clearinghouse' });

    // The drawer owns the h2, so the cards inside it are a level below. The
    // shared Card defaults to level 2, which would nest an h2 in an h2 and let
    // a reader moving by heading leave the drawer without noticing.
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(within(drawer).getByRole('heading', { level: 2 })).toHaveTextContent(
      'Claims clearinghouse'
    );
    for (const name of ['Credentials', 'Test result', 'Recent activity']) {
      expect(within(drawer).getByRole('heading', { level: 3, name })).toBeInTheDocument();
    }
  });

  it('marks demo adapters unmistakably', async () => {
    render(<IntegrationsScreen />);
    await screen.findByText('Prescribing');

    fireEvent.click(screen.getByRole('button', { name: 'Configure Prescribing' }));
    expect(screen.getByText(/never reach a real partner/)).toBeInTheDocument();
  });

  it('closes the drawer with Escape', async () => {
    render(<IntegrationsScreen />);
    await screen.findByText('Text messages');

    fireEvent.click(screen.getByRole('button', { name: 'Configure Text messages' }));
    expect(screen.getByRole('dialog', { name: 'Text messages' })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Text messages' })).not.toBeInTheDocument();
  });

  it('renders the empty state', async () => {
    render(<IntegrationsScreen client={createAdminMockClient({ empty: true })} />);
    expect(await screen.findByText('No seams configured')).toBeInTheDocument();
  });

  it('explains a failure and offers a retry', async () => {
    render(<IntegrationsScreen client={createAdminMockClient({ failure: adminMockFailure() })} />);
    expect(await screen.findByText('The server could not answer')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Try again/ })).toBeInTheDocument();
  });

  it('shows card skeletons while the seams load', () => {
    render(<IntegrationsScreen />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading integrations');
  });
});

/** The fixture client with one collection swapped, for a state no fixture carries. */
function withIntegrations(rows: readonly Integration[]): AdminClient {
  const base = createAdminMockClient();
  return {
    ...base,
    integrations: {
      list: () =>
        Promise.resolve({
          data: [...rows],
          page: { page: 1, pageSize: rows.length, total: rows.length, totalPages: 1 },
        }),
    },
  };
}

/** Opens the palette the way a keyboard user does, and runs one verb by name. */
async function runCommand(label: string): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: /Search or run a command/ }));
  fireEvent.click(await screen.findByRole('option', { name: new RegExp(label) }));
}

describe('IntegrationsScreen, working a broken seam', () => {
  it('opens the failing connection from the palette, not only from the banner', async () => {
    render(<IntegrationsScreen />);
    await screen.findByText('Claims clearinghouse');

    await runCommand('Open the failing connection');

    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByText('Not working')).toBeInTheDocument();
  });

  it('does nothing when every seam is working, rather than opening a healthy one', async () => {
    const healthy = MOCK_INTEGRATIONS.map((integration) => ({
      ...integration,
      status: 'CONNECTED' as const,
    }));
    render(<IntegrationsScreen client={withIntegrations(healthy)} />);
    await screen.findByText('Claims clearinghouse');

    await runCommand('Open the failing connection');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText(/is not working/)).not.toBeInTheDocument();
  });

  it('says how many connections are down when more than one is', async () => {
    const twoDown = MOCK_INTEGRATIONS.map((integration, index) => ({
      ...integration,
      status: index < 2 ? ('ERROR' as const) : ('CONNECTED' as const),
    }));
    render(<IntegrationsScreen client={withIntegrations(twoDown)} />);

    expect(await screen.findByText('2 connections are not working.')).toBeInTheDocument();
    expect(screen.getByText(/queued rather than lost/)).toBeInTheDocument();
  });

  it('closes the drawer from its footer, and saving closes it too', async () => {
    render(<IntegrationsScreen />);
    await screen.findByText('Card payments');

    fireEvent.click(screen.getByRole('button', { name: 'Configure Card payments' }));
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Card payments' }))
        .getAllByRole('button', { name: 'Close' })
        .at(-1)!
    );
    expect(screen.queryByRole('dialog', { name: 'Card payments' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Configure Card payments' }));
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Card payments' })).getByRole('button', {
        name: 'Save connection',
      })
    );
    expect(screen.queryByRole('dialog', { name: 'Card payments' })).not.toBeInTheDocument();
  });

  it('dismisses the test-result toast, leaving the result on the card', async () => {
    render(<IntegrationsScreen />);
    await screen.findByText('Claims clearinghouse');

    fireEvent.click(screen.getByRole('button', { name: 'Configure Claims clearinghouse' }));
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    // The toast is transient; the result belongs to the seam and stays with it.
    expect(
      within(screen.getByRole('dialog', { name: 'Claims clearinghouse' })).getByText(
        /answered in 142 ms/
      )
    ).toBeInTheDocument();
  });

  it('says nothing has gone through a seam rather than showing an empty log', async () => {
    const quiet = MOCK_INTEGRATIONS.map((integration) => ({ ...integration, activityLog: [] }));
    render(<IntegrationsScreen client={withIntegrations(quiet)} />);
    await screen.findByText('Card payments');

    fireEvent.click(screen.getByRole('button', { name: 'Configure Card payments' }));

    expect(
      within(screen.getByRole('dialog', { name: 'Card payments' })).getByText(
        'Nothing has gone through this seam yet. Activity appears here as soon as it does.'
      )
    ).toBeInTheDocument();
  });
});
