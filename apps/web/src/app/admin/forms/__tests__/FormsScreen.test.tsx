import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { FormsScreen } from '@/app/admin/forms/FormsScreen';
import { adminMockFailure, createAdminMockClient } from '@/lib/api';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => '/admin/forms',
}));

describe('FormsScreen', () => {
  it('opens on a published form and says the version cannot change', async () => {
    render(<FormsScreen />);

    expect(await screen.findByText('Version 3, published')).toBeInTheDocument();
    expect(screen.getByText(/Version 3 is published and cannot change/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publish version 4' })).toBeInTheDocument();
  });

  it('carries the three-crumb trail down to the version being edited', async () => {
    render(<FormsScreen />);
    const crumbs = await screen.findByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumbs).getByRole('link', { name: 'Form builder' })).toBeInTheDocument();
    expect(within(crumbs).getByText('Adult intake v3')).toHaveAttribute('aria-current', 'page');
  });

  it('adds a field from the catalogue and selects it on the canvas', async () => {
    render(<FormsScreen />);
    await screen.findByText('Version 3, published');

    fireEvent.click(screen.getByRole('button', { name: /Add Yes or no/ }));

    const selected = screen.getByRole('button', { name: /Yes or no/, pressed: true });
    expect(selected).toBeInTheDocument();
    // The properties pane follows the selection.
    expect(screen.getByLabelText('Label')).toHaveValue('Yes or no');
  });

  it('edits the selected field, and the canvas chip follows', async () => {
    render(<FormsScreen />);
    await screen.findByText('Version 3, published');

    fireEvent.click(screen.getByRole('button', { name: /Add Short text/ }));
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Preferred pharmacy' } });
    fireEvent.click(screen.getByLabelText('Required'));

    expect(screen.getByRole('button', { name: /Preferred pharmacy/ })).toHaveTextContent(
      'Required'
    );
  });

  it('previews the form as the patient sees it, hiding staff-only fields', async () => {
    render(<FormsScreen />);
    await screen.findByText('Version 3, published');

    fireEvent.click(screen.getByLabelText('Preview'));

    expect(screen.getByText('Preview: Adult intake')).toBeInTheDocument();
    expect(screen.getByLabelText(/Reason for your visit today \(required\)/)).toBeInTheDocument();
    // "Rooming vitals" is not portal-visible, so the portal preview omits it.
    expect(screen.queryByLabelText(/Rooming vitals/)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Rendered as'), { target: { value: 'staff' } });
    expect(screen.getByLabelText(/Rooming vitals/)).toBeInTheDocument();
  });

  it('states the consequence before publishing, and confirms deliberately', async () => {
    render(<FormsScreen />);
    await screen.findByText('Version 3, published');

    fireEvent.click(screen.getByRole('button', { name: 'Publish version 4' }));

    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('can never be edited again');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Publish version 4' }));
    expect(screen.getByText(/version 4 is live on portal intake/)).toBeInTheDocument();
  });

  it('switches to another definition and forgets the unsaved draft edits', async () => {
    render(<FormsScreen />);
    await screen.findByText('Version 3, published');

    fireEvent.click(screen.getByRole('button', { name: /Add Number/ }));
    fireEvent.change(screen.getByLabelText('Form'), { target: { value: 'form-phq9' } });

    expect(screen.getByText('Version 1, published')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Add Number/, pressed: true })
    ).not.toBeInTheDocument();
  });

  it('renders the empty state with one action', async () => {
    render(<FormsScreen client={createAdminMockClient({ empty: true })} />);
    expect(await screen.findByText('No forms yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Build a form' })).toBeInTheDocument();
  });

  it('explains a failure and offers a retry', async () => {
    render(<FormsScreen client={createAdminMockClient({ failure: adminMockFailure() })} />);
    expect(await screen.findByText('The server could not answer')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Try again/ })).toBeInTheDocument();
  });

  it('shows a skeleton while the definitions load', () => {
    render(<FormsScreen />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading form definitions');
  });
});
