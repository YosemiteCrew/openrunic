import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PatientsScreen } from '@/app/patients/PatientsScreen';
import { ApiError, createMockClient, MOCK_PATIENTS } from '@/lib/api';
import type { ApiClient } from '@/lib/api';

/**
 * The roster. The interaction that matters is the one that fails: searching for
 * somebody who is not in the practice has to end in registration, not a shrug.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => '/patients',
}));

function failing(error: ApiError): ApiClient {
  return createMockClient({ failure: error });
}

describe('PatientsScreen', () => {
  it('renders the roster as a real table with header associations', async () => {
    render(<PatientsScreen client={createMockClient()} />);

    const table = await screen.findByRole('table');
    expect(within(table).getByRole('columnheader', { name: 'MRN' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Date of birth' })).toBeInTheDocument();
    expect(within(table).getAllByRole('row')).toHaveLength(MOCK_PATIENTS.length + 1);
  });

  it('links each patient to their chart by name', async () => {
    render(<PatientsScreen client={createMockClient()} />);

    const link = await screen.findByRole('link', { name: 'Patientsson, Tess' });
    expect(link).toHaveAttribute(
      'href',
      `/patients/${MOCK_PATIENTS.find((p) => p.mrn === 'OR-100482')?.id}`
    );
  });

  it('states the record status in words, never colour alone', async () => {
    render(<PatientsScreen client={createMockClient()} />);

    await screen.findByRole('table');
    expect(screen.getByText(/^Deceased /)).toBeInTheDocument();
    expect(screen.getByText('Restricted')).toBeInTheDocument();
  });

  it('narrows the roster as the search is typed', async () => {
    render(<PatientsScreen client={createMockClient()} />);

    await screen.findByRole('table');
    fireEvent.change(screen.getByLabelText('Name, preferred name or MRN'), {
      target: { value: 'Testperson' },
    });

    expect(await screen.findByText('1 patient in this view')).toBeInTheDocument();
  });

  it('finds a patient by MRN, which is what a phone call gives you', async () => {
    render(<PatientsScreen client={createMockClient()} />);

    await screen.findByRole('table');
    fireEvent.change(screen.getByLabelText('Name, preferred name or MRN'), {
      target: { value: 'OR-100482' },
    });

    expect(await screen.findByRole('link', { name: 'Patientsson, Tess' })).toBeInTheDocument();
    expect(screen.getByText('1 patient in this view')).toBeInTheDocument();
  });

  it('switches saved views and says what the view answers', async () => {
    render(<PatientsScreen client={createMockClient()} />);

    await screen.findByRole('table');
    fireEvent.click(screen.getByRole('button', { name: 'Inactive records', pressed: false }));

    expect(await screen.findByText('Records closed, merged or marked deceased.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Inactive records' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  it('ends a zero-result search in registration, not a shrug', async () => {
    render(<PatientsScreen client={createMockClient()} />);

    await screen.findByRole('table');
    fireEvent.change(screen.getByLabelText('Name, preferred name or MRN'), {
      target: { value: 'Nobodyhere' },
    });

    expect(await screen.findByText('No patient matches that search')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Register new patient' }).length).toBeGreaterThan(0);
  });

  it('explains a server failure and offers a retry', async () => {
    render(
      <PatientsScreen client={failing(new ApiError('boom', { kind: 'http', status: 500 }))} />
    );

    expect(await screen.findByText('The server could not answer')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('says the session ended rather than offering a pointless retry', async () => {
    render(<PatientsScreen client={failing(new ApiError('bye', { kind: 'http', status: 401 }))} />);

    expect(await screen.findByText('Your session has ended')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('keeps every saved view reachable from the keyboard', async () => {
    render(<PatientsScreen client={createMockClient()} />);

    await screen.findByRole('table');
    const views = screen.getByRole('group', { name: 'Saved views' });
    const active = within(views).getByRole('button', { name: 'Active patients' });

    active.focus();
    expect(active).toHaveFocus();
    fireEvent.click(document.activeElement as HTMLElement);

    expect(active).toHaveAttribute('aria-pressed', 'true');
  });
});
