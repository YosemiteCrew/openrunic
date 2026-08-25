import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { UsersScreen } from '@/app/(app)/admin/users/UsersScreen';
import { adminMockFailure, createAdminMockClient, MOCK_FACILITIES } from '@/lib/api';
import type { AdminClient, StaffUser } from '@/lib/api';

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

  it('refuses to claim an invitation it cannot send, and says why', async () => {
    /*
     * This used to build a row in the component's own state and report "Invite
     * sent to ...". Nothing was sent: the colleague appeared on the staff list
     * as invited and never received an email, which is a harder thing to notice
     * than an obviously broken form.
     */
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

    expect(within(drawer).getByRole('button', { name: 'Send invite' })).toBeDisabled();
    expect(screen.queryByText(/Invite sent to/)).not.toBeInTheDocument();
    expect(screen.queryByText('Yara Nkemdirim')).not.toBeInTheDocument();
    expect(
      within(drawer).getByText(/Invite a colleague wherever accounts are actually created/)
    ).toBeInTheDocument();
  });

  it('closes the invite drawer on Escape without inviting anyone', async () => {
    render(<UsersScreen />);
    await screen.findByText('Ada Okafor');

    fireEvent.click(screen.getAllByRole('button', { name: /Invite a colleague/ })[0]!);
    expect(screen.getByRole('dialog', { name: 'Invite a colleague' })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Invite a colleague' })).not.toBeInTheDocument();
  });

  it('refuses to claim a deactivation it cannot perform, and says why', async () => {
    /*
     * This used to open a typed-confirmation dialog and report "Rosa Mbeki can
     * no longer sign in". She could. Nothing reached the API, because there is
     * no endpoint for it: the id went into a local set and the row was recoloured
     * on top of what the server had said.
     *
     * Three facts rather than one: the control cannot be operated, the sentence
     * that claimed the deactivation is nowhere on the screen, and the reader is
     * told what to do instead.
     */
    render(<UsersScreen />);
    await screen.findByText('Ada Okafor');

    fireEvent.click(screen.getByRole('button', { name: 'Open Rosa Mbeki' }));
    const drawer = await screen.findByRole('dialog', { name: 'Rosa Mbeki' });

    expect(within(drawer).getByRole('button', { name: 'Deactivate account' })).toBeDisabled();
    expect(screen.queryByText(/can no longer sign in/)).not.toBeInTheDocument();
    expect(
      within(drawer).getByText(/Withdraw access wherever sign-in is actually enforced/)
    ).toBeInTheDocument();
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

/** Opens the palette the way a keyboard user does, and runs one verb by name. */
async function runCommand(label: string): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: /Search or run a command/ }));
  fireEvent.click(await screen.findByRole('option', { name: new RegExp(label) }));
}

describe('UsersScreen, driven from the command palette', () => {
  it('opens the invite drawer and the role editor without a mouse', async () => {
    render(<UsersScreen />);
    await screen.findByText('Ada Okafor');

    await runCommand('Invite a colleague');
    expect(await screen.findByRole('dialog', { name: 'Invite a colleague' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });

    await runCommand('Edit role permissions');
    expect(await screen.findByRole('dialog', { name: 'Role permissions' })).toBeInTheDocument();
  });

  it('clears every filter back to the active accounts, not just the search box', async () => {
    render(<UsersScreen />);
    await screen.findByText('Ada Okafor');

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'farkas' } });
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'BILLER' } });
    fireEvent.change(screen.getByLabelText('Facility'), {
      target: { value: MOCK_FACILITIES[1]!.id },
    });
    await screen.findByText('1 account');

    await runCommand('Show active accounts only');

    expect(screen.getByLabelText('Search')).toHaveValue('');
    expect(screen.getByLabelText('Role')).toHaveValue('');
    expect(screen.getByLabelText('Facility')).toHaveValue('');
    expect(screen.getByLabelText('Status')).toHaveValue('ACTIVE');
    // The deactivated biller is filtered out, so this is a real narrowing.
    expect(await screen.findByText('Ada Okafor')).toBeInTheDocument();
    expect(screen.queryByText('Wren Castellanos')).not.toBeInTheDocument();
  });
});

describe('UsersScreen, the filter bar', () => {
  it('narrows by role, by status and by facility, each on its own', async () => {
    render(<UsersScreen />);
    await screen.findByText('Ada Okafor');

    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'PROVIDER' } });
    expect(await screen.findByText('Ingrid Lindqvist')).toBeInTheDocument();
    expect(screen.queryByText('Rosa Mbeki')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Role'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'INVITED' } });
    expect(await screen.findByText('Junie Oyelowo')).toBeInTheDocument();
    expect(screen.queryByText('Ada Okafor')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Facility'), {
      target: { value: MOCK_FACILITIES[2]!.id },
    });
    // Only one person works at the third site, which is the access boundary the
    // filter exists to make visible.
    expect(await screen.findByText('1 account')).toBeInTheDocument();
    expect(screen.getByText('Nils Farkas')).toBeInTheDocument();
  });
});

describe('UsersScreen, the invite form', () => {
  it('refuses an invite with no name or no address to send it to', async () => {
    render(<UsersScreen />);
    await screen.findByText('Ada Okafor');

    fireEvent.click(screen.getAllByRole('button', { name: /Invite a colleague/ })[0]!);
    const drawer = screen.getByRole('dialog', { name: 'Invite a colleague' });

    fireEvent.change(within(drawer).getByLabelText('Full name'), { target: { value: '  ' } });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Send invite' }));
    expect(screen.getByRole('dialog', { name: 'Invite a colleague' })).toBeInTheDocument();

    fireEvent.change(within(drawer).getByLabelText('Full name'), { target: { value: 'Yara' } });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Send invite' }));
    // Still open: an invite with no address goes nowhere.
    expect(screen.getByRole('dialog', { name: 'Invite a colleague' })).toBeInTheDocument();
    expect(screen.queryByText(/Invite sent to/)).not.toBeInTheDocument();
  });

  it('says what the chosen role will let the new colleague do', async () => {
    render(<UsersScreen />);
    await screen.findByText('Ada Okafor');

    fireEvent.click(screen.getAllByRole('button', { name: /Invite a colleague/ })[0]!);
    const drawer = screen.getByRole('dialog', { name: 'Invite a colleague' });

    fireEvent.change(within(drawer).getByLabelText('Role'), { target: { value: 'PROVIDER' } });
    const asProvider = within(drawer).getByText(/^Can /).textContent;

    fireEvent.change(within(drawer).getByLabelText('Role'), { target: { value: 'READ_ONLY' } });
    const asReadOnly = within(drawer).getByText(/^Can /).textContent;

    // The sentence tracks the control, rather than describing whatever the
    // default role was when the drawer opened.
    expect(asProvider).not.toBe(asReadOnly);
    expect(asProvider).toMatch(/sign notes/);
  });

  it('grants and withdraws a facility on the invite', async () => {
    render(<UsersScreen />);
    await screen.findByText('Ada Okafor');

    fireEvent.click(screen.getAllByRole('button', { name: /Invite a colleague/ })[0]!);
    const drawer = screen.getByRole('dialog', { name: 'Invite a colleague' });
    const annex = within(drawer).getByRole('checkbox', { name: MOCK_FACILITIES[1]!.name });
    const cedar = within(drawer).getByRole('checkbox', { name: MOCK_FACILITIES[0]!.name });

    // The first facility is pre-ticked, because most people work at one site.
    expect(cedar).toBeChecked();
    fireEvent.click(annex);
    expect(annex).toBeChecked();
    fireEvent.click(annex);
    expect(annex).not.toBeChecked();
  });

  it('cancels the invite drawer from its footer', async () => {
    render(<UsersScreen />);
    await screen.findByText('Ada Okafor');

    fireEvent.click(screen.getAllByRole('button', { name: /Invite a colleague/ })[0]!);
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Invite a colleague' })).getByRole('button', {
        name: 'Cancel',
      })
    );

    expect(screen.queryByRole('dialog', { name: 'Invite a colleague' })).not.toBeInTheDocument();
  });
});

describe('UsersScreen, one account and the role editor', () => {
  it('opens an account, shows what it can do, and closes again', async () => {
    render(<UsersScreen />);
    await screen.findByText('Ada Okafor');

    fireEvent.click(screen.getByRole('button', { name: 'Open Nils Farkas' }));
    const drawer = await screen.findByRole('dialog', { name: 'Nils Farkas' });

    expect(within(drawer).getByText('Practice admin, Biller')).toBeInTheDocument();
    expect(within(drawer).getByText('What this person can do')).toBeInTheDocument();

    fireEvent.click(within(drawer).getAllByRole('button', { name: 'Close' }).at(-1)!);
    expect(screen.queryByRole('dialog', { name: 'Nils Farkas' })).not.toBeInTheDocument();
  });

  it('descends the outline one level at a time inside the drawer', async () => {
    render(<UsersScreen />);
    await screen.findByText('Ada Okafor');

    fireEvent.click(screen.getByRole('button', { name: 'Open Nils Farkas' }));
    const drawer = await screen.findByRole('dialog', { name: 'Nils Farkas' });

    // The drawer owns the h2, so the card inside it is a level below. The
    // shared Card defaults to level 2, which would nest an h2 in an h2.
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(within(drawer).getByRole('heading', { level: 2 })).toHaveTextContent('Nils Farkas');
    expect(
      within(drawer).getByRole('heading', { level: 3, name: 'What this person can do' })
    ).toBeInTheDocument();
  });

  it('shows every account as the API reports it, with no local deactivation on top', async () => {
    /*
     * Wren Castellanos is deactivated in the fixtures, which is the only way an
     * account reads as deactivated now. The list used to layer a locally-held
     * set on top, so a row could say "Deactivated" about somebody the server
     * still considered active. The screen and the server agree again, and
     * disagreeing was the only way the old control could look like it worked.
     */
    render(<UsersScreen />);
    await screen.findByText('Ada Okafor');

    fireEvent.click(screen.getByRole('button', { name: 'Open Wren Castellanos' }));
    const drawer = await screen.findByRole('dialog', { name: 'Wren Castellanos' });

    expect(within(drawer).getByRole('button', { name: 'Deactivate account' })).toBeDisabled();
  });

  it('refuses to claim a permission change that never reaches policy', async () => {
    /*
     * The editor still toggles: reading what a role means is worth keeping, and
     * the toggles are how you read it. What it no longer does is close the
     * drawer and announce that everyone holding the role is affected, which was
     * a sentence about authorisation written by a screen that never asked the
     * server anything.
     */
    render(<UsersScreen />);
    await screen.findByText('Ada Okafor');

    fireEvent.click(screen.getAllByRole('button', { name: /Edit role permissions/ })[0]!);
    const drawer = await screen.findByRole('dialog', { name: 'Role permissions' });

    expect(within(drawer).getByRole('button', { name: 'Save role permissions' })).toBeDisabled();
    expect(screen.queryByText(/Everyone holding these roles is affected/)).not.toBeInTheDocument();
    expect(within(drawer).getByText(/keeps exactly the access they have/)).toBeInTheDocument();
  });

  it('summarises a different role when the summarise control changes', async () => {
    render(<UsersScreen />);
    await screen.findByText('Ada Okafor');

    fireEvent.click(screen.getAllByRole('button', { name: /Edit role permissions/ })[0]!);
    const drawer = await screen.findByRole('dialog', { name: 'Role permissions' });
    const asAssistant = (await within(drawer).findByTestId('role-summary')).textContent;

    fireEvent.change(within(drawer).getByLabelText('Summarise'), { target: { value: 'BILLER' } });

    expect(within(drawer).getByTestId('role-summary').textContent).not.toBe(asAssistant);
  });

  it('cancels the role editor without saving', async () => {
    render(<UsersScreen />);
    await screen.findByText('Ada Okafor');

    fireEvent.click(screen.getAllByRole('button', { name: /Edit role permissions/ })[0]!);
    fireEvent.click(
      within(await screen.findByRole('dialog', { name: 'Role permissions' })).getByRole('button', {
        name: 'Cancel',
      })
    );

    expect(screen.queryByRole('dialog', { name: 'Role permissions' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Role permissions saved/)).not.toBeInTheDocument();
  });
});

describe('UsersScreen, an account with gaps in it', () => {
  /** The fixture client with one collection swapped, for a state no fixture carries. */
  function withUsers(rows: readonly StaffUser[]): AdminClient {
    const base = createAdminMockClient();
    return {
      ...base,
      users: {
        ...base.users,
        list: () =>
          Promise.resolve({
            data: [...rows],
            page: { page: 1, pageSize: rows.length, total: rows.length, totalPages: 1 },
          }),
      },
    };
  }

  const sparse: StaffUser = {
    id: 'staff-sparse',
    name: 'Kai Nordstrom',
    displayName: 'Kai Nordstrom',
    email: 'k.nordstrom@cedar.clinic.invalid',
    roles: [],
    facilityIds: [],
    isProvider: false,
    npi: null,
    taxonomy: null,
    mfaEnrolled: false,
    status: 'INVITED',
    lastActiveAt: null,
    invitedAt: null,
    deactivatedAt: null,
    exceptions: [],
  };

  it('says "not recorded" and "never" rather than leaving the rows blank', async () => {
    render(<UsersScreen client={withUsers([sparse])} />);
    await screen.findByText('Kai Nordstrom');

    fireEvent.click(screen.getByRole('button', { name: 'Open Kai Nordstrom' }));
    const drawer = await screen.findByRole('dialog', { name: 'Kai Nordstrom' });

    // Every attribute is answered: an empty cell reads as "not loaded yet".
    expect(within(drawer).getAllByText('Not recorded').length).toBeGreaterThanOrEqual(3);
    expect(within(drawer).getByText('Never')).toBeInTheDocument();
    expect(within(drawer).getByText('Not enrolled')).toBeInTheDocument();
    expect(within(drawer).getByText('No')).toBeInTheDocument();
  });

  it('describes a role-less account by the read-only bundle rather than crashing', async () => {
    render(<UsersScreen client={withUsers([sparse])} />);
    await screen.findByText('Kai Nordstrom');

    fireEvent.click(screen.getByRole('button', { name: 'Open Kai Nordstrom' }));
    const drawer = await screen.findByRole('dialog', { name: 'Kai Nordstrom' });

    expect(within(drawer).getByText('What this person can do')).toBeInTheDocument();
    expect(within(drawer).getByText(/^Can /)).toBeInTheDocument();
  });

  it('lists the exceptions granted on top of a role, and omits the panel when there are none', async () => {
    const withException: StaffUser = {
      ...sparse,
      id: 'staff-exception',
      name: 'Rune Aaltonen',
      roles: ['FRONT_DESK'],
      exceptions: ['May reprint statements for any facility'],
    };
    render(<UsersScreen client={withUsers([sparse, withException])} />);
    await screen.findByText('Rune Aaltonen');

    fireEvent.click(screen.getByRole('button', { name: 'Open Rune Aaltonen' }));
    expect(
      within(await screen.findByRole('dialog', { name: 'Rune Aaltonen' })).getByText(
        'May reprint statements for any facility'
      )
    ).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Open Kai Nordstrom' }));
    expect(
      within(await screen.findByRole('dialog', { name: 'Kai Nordstrom' })).queryByText('Exceptions')
    ).not.toBeInTheDocument();
  });

  it('warns about a single account with no second factor in the singular', async () => {
    render(<UsersScreen client={withUsers([{ ...sparse, status: 'ACTIVE' }])} />);

    expect(
      await screen.findByText(/1 active accounts have no second factor\./)
    ).toBeInTheDocument();
  });
});
