import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { FacilitiesScreen } from '@/app/(app)/admin/facilities/FacilitiesScreen';
import { adminMockFailure, createAdminMockClient } from '@/lib/api';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => '/admin/facilities',
}));

/**
 * Waits for the facility list itself.
 *
 * Not `findByText('Cedar Clinic')`: the shell's top bar paints the current
 * facility's name synchronously from a static fixture, so that query resolves
 * against the top bar while the list is still a skeleton and the very next line
 * races the data. The Edit control exists only once a card has rendered.
 */
async function listLoaded(): Promise<HTMLElement> {
  return screen.findByRole('button', { name: 'Edit Cedar Clinic' });
}

describe('FacilitiesScreen', () => {
  it('lists the active facilities with their billing attributes', async () => {
    render(<FacilitiesScreen />);

    await listLoaded();
    expect(screen.getByRole('heading', { name: 'Cedar Clinic' })).toBeInTheDocument();
    expect(screen.getByText('Birchwood Annex')).toBeInTheDocument();
    expect(screen.getAllByText('POS 11').length).toBeGreaterThan(0);
    expect(screen.getByText('Primary')).toBeInTheDocument();
  });

  it('hides inactive facilities until asked, and never deletes them', async () => {
    render(<FacilitiesScreen />);
    await listLoaded();

    expect(screen.queryByText('Rune Street Rooms')).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Show inactive'));
    expect(screen.getByText('Rune Street Rooms')).toBeInTheDocument();
    expect(screen.getByText('Inactive')).toBeInTheDocument();
  });

  it('opens a facility in a drawer with its hours grid and rooms', async () => {
    render(<FacilitiesScreen />);
    await listLoaded();

    fireEvent.click(screen.getByRole('button', { name: 'Edit Cedar Clinic' }));

    const drawer = screen.getByRole('dialog', { name: 'Cedar Clinic' });
    const hours = within(drawer).getByRole('table', { name: /Opening hours at Cedar Clinic/ });
    expect(within(hours).getByText('Monday')).toBeInTheDocument();
    // A closed day says "Closed" rather than leaving the cell blank.
    expect(within(hours).getAllByText('Closed').length).toBe(2);
    expect(within(drawer).getByText('Procedure room')).toBeInTheDocument();
  });

  it('descends the outline one level at a time inside the drawer', async () => {
    render(<FacilitiesScreen />);
    await listLoaded();

    fireEvent.click(screen.getByRole('button', { name: 'Edit Cedar Clinic' }));
    const drawer = screen.getByRole('dialog', { name: 'Cedar Clinic' });

    // The drawer owns the h2, so the cards inside it are a level below. The
    // shared Card defaults to level 2, which would nest an h2 in an h2 and let
    // a reader moving by heading leave the drawer without noticing.
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(within(drawer).getByRole('heading', { level: 2 })).toHaveTextContent('Cedar Clinic');
    for (const name of ['Identity and billing', 'Opening hours', 'Rooms']) {
      expect(within(drawer).getByRole('heading', { level: 3, name })).toBeInTheDocument();
    }
  });

  it('closes the drawer with the keyboard alone', async () => {
    render(<FacilitiesScreen />);
    await listLoaded();

    fireEvent.click(screen.getByRole('button', { name: 'Edit Birchwood Annex' }));
    expect(screen.getByRole('dialog', { name: 'Birchwood Annex' })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Birchwood Annex' })).not.toBeInTheDocument();
  });

  it('says a facility with no rooms breaks the Flow Board, in words', async () => {
    render(<FacilitiesScreen />);
    await listLoaded();

    fireEvent.click(screen.getByLabelText('Show inactive'));
    fireEvent.click(screen.getByRole('button', { name: 'Edit Rune Street Rooms' }));

    expect(screen.getByText(/No rooms yet/)).toBeInTheDocument();
  });

  it('renders the empty state with one action', async () => {
    render(<FacilitiesScreen client={createAdminMockClient({ empty: true })} />);
    expect(await screen.findByText('No facilities yet')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Add a facility' }).length).toBeGreaterThan(0);
  });

  it('explains a failure and offers a retry', async () => {
    render(<FacilitiesScreen client={createAdminMockClient({ failure: adminMockFailure() })} />);
    expect(await screen.findByText('The server could not answer')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Try again/ })).toBeInTheDocument();
  });

  it('shows card skeletons while facilities load', () => {
    render(<FacilitiesScreen />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading facilities');
  });
});

/** Opens the palette the way a keyboard user does, and runs one verb by name. */
async function runCommand(label: string): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: /Search or run a command/ }));
  fireEvent.click(await screen.findByRole('option', { name: new RegExp(label) }));
}

describe('FacilitiesScreen, driven from the command palette', () => {
  it('opens the main site, and opening it again does not switch sites', async () => {
    render(<FacilitiesScreen />);
    await listLoaded();

    await runCommand('Open the main facility');
    expect(await screen.findByRole('dialog', { name: 'Cedar Clinic' })).toBeInTheDocument();

    // Already open on a facility: the verb must not yank the drawer onto a
    // different site mid-edit.
    fireEvent.click(screen.getByRole('button', { name: 'Edit Birchwood Annex' }));
    await runCommand('Open the main facility');
    expect(screen.getByRole('dialog', { name: 'Birchwood Annex' })).toBeInTheDocument();
  });

  it('reveals the retired sites, which are kept rather than deleted', async () => {
    render(<FacilitiesScreen />);
    await listLoaded();

    await runCommand('Show inactive facilities');

    // A claim from an earlier year still has to resolve where it happened.
    expect(await screen.findByText('Rune Street Rooms')).toBeInTheDocument();
    expect(screen.getByLabelText('Show inactive')).toBeChecked();
  });

  it('closes the drawer from Cancel and from Save alike', async () => {
    render(<FacilitiesScreen />);
    await listLoaded();

    fireEvent.click(screen.getByRole('button', { name: 'Edit Cedar Clinic' }));
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Cedar Clinic' })).getByRole('button', {
        name: 'Cancel',
      })
    );
    expect(screen.queryByRole('dialog', { name: 'Cedar Clinic' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Edit Cedar Clinic' }));
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Cedar Clinic' })).getByRole('button', {
        name: 'Save facility',
      })
    );
    expect(screen.queryByRole('dialog', { name: 'Cedar Clinic' })).not.toBeInTheDocument();
  });

  it('opens an inactive site once it is visible, and names it as inactive', async () => {
    render(<FacilitiesScreen />);
    await listLoaded();
    fireEvent.click(screen.getByLabelText('Show inactive'));

    fireEvent.click(screen.getByRole('button', { name: 'Edit Rune Street Rooms' }));

    const drawer = await screen.findByRole('dialog', { name: 'Rune Street Rooms' });
    expect(within(drawer).getByText('Inactive')).toBeInTheDocument();
  });
});
