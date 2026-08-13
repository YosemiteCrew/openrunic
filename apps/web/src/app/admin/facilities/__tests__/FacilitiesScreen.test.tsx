import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { FacilitiesScreen } from '@/app/admin/facilities/FacilitiesScreen';
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
