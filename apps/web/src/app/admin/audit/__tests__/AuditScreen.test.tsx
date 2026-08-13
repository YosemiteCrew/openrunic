import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AuditScreen } from '@/app/admin/audit/AuditScreen';
import { adminMockFailure, createAdminMockClient } from '@/lib/api';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => '/admin/audit',
}));

describe('AuditScreen', () => {
  it('says it is append-only before it says anything else', async () => {
    render(<AuditScreen />);
    expect(screen.getByText(/This record is append-only/)).toBeInTheDocument();
    expect(screen.getByText('Hash chain verified')).toBeInTheDocument();
    expect(await screen.findByRole('table', { name: /Audit events/ })).toBeInTheDocument();
  });

  it('offers no way to change or delete an event', async () => {
    render(<AuditScreen />);
    await screen.findByRole('table', { name: /Audit events/ });

    expect(screen.queryByRole('button', { name: /Delete/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Edit/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Save/ })).not.toBeInTheDocument();
  });

  it('shows the actor, action, chart context and purpose of every event', async () => {
    render(<AuditScreen />);
    const table = await screen.findByRole('table', { name: /Audit events/ });

    expect(within(table).getAllByText('Rosa Mbeki').length).toBeGreaterThan(0);
    expect(within(table).getAllByText('Patient read').length).toBeGreaterThan(0);
    expect(within(table).getAllByText('OR-100482').length).toBeGreaterThan(0);
    expect(within(table).getAllByText('Treatment').length).toBeGreaterThan(0);
  });

  it('marks breakglass access with a word, not only a tint', async () => {
    render(<AuditScreen />);
    const table = await screen.findByRole('table', { name: /Audit events/ });
    expect(within(table).getByText('Breakglass')).toBeInTheDocument();
  });

  it('filters to breakglass only, and says how many events are left', async () => {
    render(<AuditScreen />);
    await screen.findByRole('table', { name: /Audit events/ });

    fireEvent.click(screen.getByLabelText('Breakglass only'));

    expect(await screen.findByText('1 event, 1 breakglass')).toBeInTheDocument();
    const table = screen.getByRole('table', { name: /Audit events/ });
    expect(within(table).getAllByRole('row')).toHaveLength(2);
    expect(within(table).getByText('Breakglass')).toBeInTheDocument();
  });

  it('opens the detail drawer with the hash chain and the mandatory reason', async () => {
    render(<AuditScreen />);
    await screen.findByRole('table', { name: /Audit events/ });

    fireEvent.click(screen.getByRole('button', { name: 'Open event 48208' }));

    const drawer = screen.getByRole('dialog', { name: 'Breakglass read' });
    expect(within(drawer).getByText('Hash chain')).toBeInTheDocument();
    expect(within(drawer).getByText('Previous hash')).toBeInTheDocument();
    expect(within(drawer).getByText('Verified against the chain')).toBeInTheDocument();
    expect(within(drawer).getByText(/Covering for Dr. Okafor/)).toBeInTheDocument();
  });

  it('closes the detail drawer with Escape', async () => {
    render(<AuditScreen />);
    await screen.findByRole('table', { name: /Audit events/ });

    fireEvent.click(screen.getByRole('button', { name: 'Open event 48211' }));
    expect(screen.getByRole('dialog', { name: 'Patient read' })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Patient read' })).not.toBeInTheDocument();
  });

  it('exports the filtered events and says the export is itself recorded', async () => {
    render(<AuditScreen />);
    await screen.findByRole('table', { name: /Audit events/ });

    fireEvent.click(screen.getByRole('button', { name: 'Export these events' }));

    expect(screen.getByText(/recorded in this trail|cannot download files/)).toBeInTheDocument();
  });

  it('renders an empty search with a way back', async () => {
    render(<AuditScreen client={createAdminMockClient({ empty: true })} />);

    expect(await screen.findByText('No events match this query')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear the filters' })).toBeInTheDocument();
  });

  it('explains a failure and offers a retry', async () => {
    render(<AuditScreen client={createAdminMockClient({ failure: adminMockFailure() })} />);
    expect(await screen.findByText('The server could not answer')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Try again/ })).toBeInTheDocument();
  });

  it('shows a skeleton while the trail loads', () => {
    render(<AuditScreen />);
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent('Loading audit events');
  });
});
