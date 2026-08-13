import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { RegisterPatientScreen } from '@/app/patients/new/RegisterPatientScreen';
import { ApiError, createMockClient } from '@/lib/api';
import type { ApiClient } from '@/lib/api';

/**
 * Registration. Two behaviours carry the screen: a walk-in goes in with four
 * fields, and a person who already has a record cannot get a second one without
 * somebody saying, explicitly, that this is a different person.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => '/patients/new',
}));

function failing(error: ApiError): ApiClient {
  return {
    mode: 'mock',
    patients: { list: () => Promise.reject(error), get: () => Promise.reject(error) },
    appointments: { list: () => Promise.reject(error), get: () => Promise.reject(error) },
  };
}

function type(label: string, value: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function fillWalkIn(): void {
  type('Given name', 'Kai');
  type('Family name', 'Nordstrom');
  type('Date of birth', '1991-02-17');
  type('Mobile number', '+1 555 0142 900');
}

describe('RegisterPatientScreen', () => {
  it('groups the form into sections and marks which are required', () => {
    render(<RegisterPatientScreen client={createMockClient()} />);

    expect(screen.getByRole('heading', { name: 'Identity' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Contact' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Address' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Access and privacy' })).toBeInTheDocument();
    expect(screen.getAllByText('Required')).toHaveLength(2);
  });

  it('validates a field on blur, not while it is being typed', () => {
    render(<RegisterPatientScreen client={createMockClient()} />);

    const given = screen.getByLabelText('Given name');
    fireEvent.change(given, { target: { value: '' } });
    expect(screen.queryByText('Enter the given name.')).not.toBeInTheDocument();

    fireEvent.blur(given);
    expect(screen.getByText('Enter the given name.')).toBeInTheDocument();
  });

  it('summarises every error on submit and links each one to its field', () => {
    render(<RegisterPatientScreen client={createMockClient()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Register patient' }));

    const summary = screen.getByRole('alert');
    expect(summary).toHaveTextContent('Enter the given name.');
    expect(within(summary).getByRole('link', { name: 'Date of birth' })).toHaveAttribute(
      'href',
      '#register-birthDate'
    );
  });

  it('registers a walk-in from four fields and confirms what will happen first', async () => {
    render(<RegisterPatientScreen client={createMockClient()} />);

    fillWalkIn();
    fireEvent.click(screen.getByRole('button', { name: 'Register patient' }));

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('An MRN is assigned on save');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Register patient' }));

    const toast = await screen.findByRole('status');
    expect(toast).toHaveTextContent('Patient registered');
    expect(toast).toHaveTextContent('Kai Nordstrom is in the practice and can be booked.');
  });

  it('clears the form once the patient is registered', async () => {
    render(<RegisterPatientScreen client={createMockClient()} />);

    fillWalkIn();
    fireEvent.click(screen.getByRole('button', { name: 'Register patient' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Register patient' }));

    await screen.findByRole('status');
    expect(screen.getByLabelText('Given name')).toHaveValue('');
  });

  it('blocks a strong duplicate and offers the record that already exists', async () => {
    render(<RegisterPatientScreen client={createMockClient()} />);

    type('Given name', 'Testina');
    type('Family name', 'Patientsson');
    type('Date of birth', '1987-03-14');
    type('Mobile number', '+1 555 0142 118');

    expect(await screen.findByText('This patient may already have a record')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Open the existing record for Tess Patientsson' })
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Register patient' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByText(/Registration is held/)).toBeInTheDocument();
  });

  it('says why the record matched, in words a person can check', async () => {
    render(<RegisterPatientScreen client={createMockClient()} />);

    type('Given name', 'Testina');
    type('Family name', 'Patientsson');
    type('Date of birth', '1987-03-14');
    type('Mobile number', '+1 555 0142 118');

    await screen.findByText('This patient may already have a record');
    expect(screen.getByText('Same date of birth')).toBeInTheDocument();
    expect(screen.getByText('Same mobile number')).toBeInTheDocument();
  });

  it('lets the override through once it is stated explicitly', async () => {
    render(<RegisterPatientScreen client={createMockClient()} />);

    type('Given name', 'Testina');
    type('Family name', 'Patientsson');
    type('Date of birth', '1987-03-14');
    type('Mobile number', '+1 555 0142 118');

    const override = await screen.findByLabelText('This is a different person');
    fireEvent.click(override);
    fireEvent.click(screen.getByRole('button', { name: 'Register patient' }));

    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
  });

  it('is operable from the keyboard: the register verb is a focusable button', () => {
    render(<RegisterPatientScreen client={createMockClient()} />);

    fillWalkIn();
    const register = screen.getByRole('button', { name: 'Register patient' });
    register.focus();
    expect(register).toHaveFocus();

    fireEvent.click(document.activeElement as HTMLElement);
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  it('lets Escape abandon the confirmation without registering anything', async () => {
    render(<RegisterPatientScreen client={createMockClient()} />);

    fillWalkIn();
    fireEvent.click(screen.getByRole('button', { name: 'Register patient' }));
    await screen.findByRole('alertdialog');
    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Given name')).toHaveValue('Kai');
  });

  it('still registers when the duplicate check cannot reach the server', async () => {
    render(<RegisterPatientScreen client={failing(new ApiError('boom', { kind: 'network' }))} />);

    fillWalkIn();
    fireEvent.click(screen.getByRole('button', { name: 'Register patient' }));

    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
  });
});
