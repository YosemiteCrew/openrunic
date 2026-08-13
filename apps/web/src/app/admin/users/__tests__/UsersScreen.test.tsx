import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { UsersScreen } from '@/app/admin/users/UsersScreen';
import { adminMockFailure, createAdminMockClient } from '@/lib/api';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => '/admin/users',
}));

describe('UsersScreen', () => {
  it('lists staff with their roles, facilities and two-factor state', async () => {
    render(<UsersScreen />);

    expect(await screen.findByText('Ada Okafor')).toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'Staff accounts' });
    expect(within(table).getAllByText('Provider').length).toBeGreaterThan(0);
    expect(within(table).getAllByText('Cedar Clinic, Birchwood Annex').length).toBeGreaterThan(0);
    // Never colour alone: the state is a word in the badge.
    expect(within(table).getAllByText('Not enrolled').length).toBeGreaterThan(0);
  });

  it('carries the admin breadcrumb, which the chart never does', async () => {
    render(<UsersScreen />);
    const crumbs = await screen.findByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumbs).getByRole('link', { name: 'Admin' })).toHaveAttribute('href', '/admin');
    expect(within(crumbs).getByText('Users and roles')).toHaveAttribute('aria-current', 'page');
  });

  it('warns about accounts without a second factor, in words', async () => {
    render(<UsersScreen />);
    expect(await screen.findByText(/active accounts have no second factor/)).toBeInTheDocument();
  });

  it('invites a colleague from a drawer and confirms what happened', async () => {
    render(<UsersScreen />);
    await screen.findByText('Ada Okafor');

    fireEvent.click(screen.getAllByRole('button', { name: /Invite a colleague/ })[0]!);

    const drawer = screen.getByRole('dialog', { name: 'Invite a colleague' });
    fireEvent.change(within(drawer).getByLabelText('Full name'), {
      target: { value: 'Yara Nkemdirim' },
    });
    fireEvent.change(within(drawer).getByLabelText('Work email'), {
      target: { value: 'y.nkemdirim@cedar.clinic.invalid' },
    });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Send invite' }));

    expect(screen.getByText(/Invite sent to y.nkemdirim@cedar.clinic.invalid/)).toBeInTheDocument();
    expect(screen.getByText('Yara Nkemdirim')).toBeInTheDocument();
  });

  it('closes the invite drawer on Escape without inviting anyone', async () => {
    render(<UsersScreen />);
    await screen.findByText('Ada Okafor');

    fireEvent.click(screen.getAllByRole('button', { name: /Invite a colleague/ })[0]!);
    expect(screen.getByRole('dialog', { name: 'Invite a colleague' })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Invite a colleague' })).not.toBeInTheDocument();
  });

  it('deactivates an account only after the name is typed, and never deletes it', async () => {
    render(<UsersScreen />);
    await screen.findByText('Ada Okafor');

    fireEvent.click(screen.getByRole('button', { name: 'Open Rosa Mbeki' }));
    fireEvent.click(screen.getByRole('button', { name: 'Deactivate account' }));

    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('stays resolvable in the audit trail');

    const confirm = within(dialog).getByRole('button', { name: 'Deactivate account' });
    expect(confirm).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText('Type Rosa Mbeki to confirm'), {
      target: { value: 'Rosa Mbeki' },
    });
    fireEvent.click(confirm);

    expect(screen.getByText(/Rosa Mbeki can no longer sign in/)).toBeInTheDocument();
  });

  it('summarises a role in a plain sentence in the role editor', async () => {
    render(<UsersScreen />);
    await screen.findByText('Ada Okafor');

    fireEvent.click(screen.getAllByRole('button', { name: /Edit role permissions/ })[0]!);

    const drawer = await screen.findByRole('dialog', { name: 'Role permissions' });
    expect(await within(drawer).findByTestId('role-summary')).toHaveTextContent('Can view charts');

    fireEvent.click(within(drawer).getByLabelText('Sign notes for Medical assistant'));
    expect(within(drawer).getByTestId('role-summary')).toHaveTextContent('sign notes');
  });

  it('filters the list, and says how many accounts are left', async () => {
    render(<UsersScreen />);
    await screen.findByText('Ada Okafor');

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'farkas' } });

    expect(await screen.findByText('Nils Farkas')).toBeInTheDocument();
    expect(screen.queryByText('Ada Okafor')).not.toBeInTheDocument();
    expect(screen.getByText('1 account')).toBeInTheDocument();
  });

  it('renders the empty state with one action when nothing matches', async () => {
    render(<UsersScreen client={createAdminMockClient({ empty: true })} />);

    expect(await screen.findByText('No accounts match these filters')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Invite a colleague/ }).length).toBeGreaterThan(0);
  });

  it('explains a failure and offers a retry rather than "something went wrong"', async () => {
    render(<UsersScreen client={createAdminMockClient({ failure: adminMockFailure() })} />);

    expect(await screen.findByText('The server could not answer')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Try again/ })).toBeInTheDocument();
    expect(screen.queryByText(/Something went wrong/)).not.toBeInTheDocument();
  });

  it('shows a skeleton with a polite status line while the list loads', () => {
    render(<UsersScreen />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading staff accounts');
  });
});
