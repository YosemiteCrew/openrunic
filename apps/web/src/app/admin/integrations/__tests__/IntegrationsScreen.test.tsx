import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { IntegrationsScreen } from '@/app/admin/integrations/IntegrationsScreen';
import { adminMockFailure, createAdminMockClient } from '@/lib/api';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => '/admin/integrations',
}));

describe('IntegrationsScreen', () => {
  it('shows every seam with a state word, not only a chip colour', async () => {
    render(<IntegrationsScreen />);

    expect(await screen.findByText('Claims clearinghouse')).toBeInTheDocument();
    expect(screen.getAllByText('Connected').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Demo mode').length).toBeGreaterThan(0);
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
