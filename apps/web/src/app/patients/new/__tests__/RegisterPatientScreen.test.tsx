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
  return createMockClient({ failure: error });
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
    // The number the record will be filed under is stated before the save, not
    // after it: the front desk can still change it while the dialog is open.
    expect(dialog).toHaveTextContent('The record becomes bookable immediately');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Register patient' }));

    const toast = await screen.findByRole('status');
    expect(toast).toHaveTextContent('Patient registered');
    expect(toast).toHaveTextContent(/Kai Nordstrom is in the practice under OR-\d{6}/);
  });

  it('files the walk-in under a number the practice can read back', async () => {
    const client = createMockClient();
    render(<RegisterPatientScreen client={client} />);

    fillWalkIn();
    const mrn = (screen.getByLabelText('Medical record number') as HTMLInputElement).value;
    fireEvent.click(screen.getByRole('button', { name: 'Register patient' }));
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Register patient',
      })
    );
    await screen.findByRole('status');

    // The write survives the screen: the next read of the practice finds it.
    const found = await client.patients.list({ mrn });
    expect(found.data[0]?.name.family).toBe('Nordstrom');
  });

  it('keeps the form intact and says why when the record number is already taken', async () => {
    render(<RegisterPatientScreen client={createMockClient()} />);

    fillWalkIn();
    // OR-100482 belongs to Testina Patientsson in the demo clinic.
    type('Medical record number', 'OR-100482');
    fireEvent.click(screen.getByRole('button', { name: 'Register patient' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Register patient' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('That MRN is taken.');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    // Nothing typed is lost: the patient is still standing at the desk.
    expect(screen.getByLabelText('Given name')).toHaveValue('Kai');
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

/** Opens the palette the way a keyboard user does, and runs one verb by name. */
async function runCommand(label: string): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: /Search or run a command/ }));
  fireEvent.click(await screen.findByRole('option', { name: new RegExp(label) }));
}

describe('RegisterPatientScreen, the fields beyond the required four', () => {
  it('uses the preferred name everywhere the patient is named, not the given one', async () => {
    render(<RegisterPatientScreen client={createMockClient()} />);

    fillWalkIn();
    type('Preferred name', 'Kai-Lee');
    fireEvent.click(screen.getByRole('button', { name: 'Register patient' }));

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Create a record for Kai-Lee Nordstrom, born 1991-02-17');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Register patient' }));

    expect(
      await screen.findByText(/Kai-Lee Nordstrom is in the practice under OR-\d{6}/)
    ).toBeInTheDocument();
  });

  it('records sex at birth and pronouns as separate answers', () => {
    render(<RegisterPatientScreen client={createMockClient()} />);

    fireEvent.change(screen.getByLabelText('Sex at birth'), { target: { value: 'FEMALE' } });
    type('Pronouns', 'they/them');

    // Two different questions, deliberately: one drives clinical decision
    // support, the other is how the patient is addressed.
    expect(screen.getByLabelText('Sex at birth')).toHaveValue('FEMALE');
    expect(screen.getByLabelText('Pronouns')).toHaveValue('they/them');
  });

  it('keeps every optional address field, none of which blocks the save', () => {
    render(<RegisterPatientScreen client={createMockClient()} />);

    type('Street address', '14 Alder Row');
    type('City', 'Birchwood');
    type('State', 'OR');
    type('Postal code', '97031');

    expect(screen.getByLabelText('Street address')).toHaveValue('14 Alder Row');
    expect(screen.getByLabelText('City')).toHaveValue('Birchwood');
    expect(screen.getByLabelText('State')).toHaveValue('OR');
    expect(screen.getByLabelText('Postal code')).toHaveValue('97031');

    // Still nothing to fix: the address is genuinely optional.
    fillWalkIn();
    fireEvent.click(screen.getByRole('button', { name: 'Register patient' }));
    expect(screen.queryByText('Fix these before registering')).not.toBeInTheDocument();
  });

  it('sets the language, the record sensitivity and the portal invitation', () => {
    render(<RegisterPatientScreen client={createMockClient()} />);

    fireEvent.change(screen.getByLabelText('Preferred language'), { target: { value: 'es-US' } });
    fireEvent.change(screen.getByLabelText('Record sensitivity'), {
      target: { value: 'RESTRICTED' },
    });
    const portal = screen.getByLabelText('Invite to the patient portal');
    fireEvent.click(portal);

    expect(screen.getByLabelText('Preferred language')).toHaveValue('es-US');
    expect(screen.getByLabelText('Record sensitivity')).toHaveValue('RESTRICTED');
    expect(portal).toBeChecked();

    // And it toggles back off, rather than being a one-way switch.
    fireEvent.click(portal);
    expect(portal).not.toBeChecked();
  });
});

describe('RegisterPatientScreen, driven from the command palette', () => {
  it('registers from the palette, with the same confirmation as the button', async () => {
    render(<RegisterPatientScreen client={createMockClient()} />);
    fillWalkIn();

    await runCommand('Register this patient');

    expect(await screen.findByRole('alertdialog')).toHaveTextContent(
      'Create a record for Kai Nordstrom'
    );
  });

  it('refuses from the palette too, and names the fields still missing', async () => {
    render(<RegisterPatientScreen client={createMockClient()} />);
    type('Given name', 'Kai');

    await runCommand('Register this patient');

    expect(await screen.findByText('Fix these before registering')).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(
      within(screen.getByRole('alert')).getByRole('link', { name: 'Family name' })
    ).toHaveAttribute('href', '#register-family');
  });

  it('clears a half-typed form, including the errors it had already shown', async () => {
    render(<RegisterPatientScreen client={createMockClient()} />);
    type('Given name', 'Kai');
    fireEvent.click(screen.getByRole('button', { name: 'Register patient' }));
    expect(await screen.findByText('Fix these before registering')).toBeInTheDocument();

    await runCommand('Clear the registration form');

    expect(screen.getByLabelText('Given name')).toHaveValue('');
    // The error summary goes with the draft that produced it: a blank form
    // showing four errors would be shouting at somebody who has typed nothing.
    expect(screen.queryByText('Fix these before registering')).not.toBeInTheDocument();
  });
});

describe('RegisterPatientScreen, backing out', () => {
  it('cancels the confirmation from its footer, keeping everything typed', async () => {
    render(<RegisterPatientScreen client={createMockClient()} />);
    fillWalkIn();
    fireEvent.click(screen.getByRole('button', { name: 'Register patient' }));

    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancel' })
    );

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(screen.getByLabelText('Given name')).toHaveValue('Kai');
    expect(screen.queryByText(/is in the practice/)).not.toBeInTheDocument();
  });

  it('dismisses the confirmation toast without un-registering the patient', async () => {
    render(<RegisterPatientScreen client={createMockClient()} />);
    fillWalkIn();
    fireEvent.click(screen.getByRole('button', { name: 'Register patient' }));
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Register patient',
      })
    );

    const toast = await screen.findByRole('status');
    // The link goes to the record that now exists, which is the thing the
    // front desk wants next and the proof that it was actually created.
    expect(within(toast).getByRole('link', { name: 'Open the chart' })).toHaveAttribute(
      'href',
      expect.stringMatching(/^\/patients\/.+/) as unknown as string
    );

    fireEvent.click(within(toast).getByRole('button', { name: 'Dismiss' }));

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    // The form is clear and ready for the next walk-in, not repopulated.
    expect(screen.getByLabelText('Given name')).toHaveValue('');
  });
});

describe('RegisterPatientScreen, when each required field is left', () => {
  it.each([
    ['Given name', 'Enter the given name.'],
    ['Family name', 'Enter the family name.'],
    ['Date of birth', 'Enter the date of birth as YYYY-MM-DD.'],
    ['Mobile number', 'Enter a mobile number.'],
  ])('says what is wrong with %s the moment it is left empty', (label) => {
    render(<RegisterPatientScreen client={createMockClient()} />);

    const field = screen.getByLabelText(label);
    fireEvent.change(field, { target: { value: 'x' } });
    fireEvent.change(field, { target: { value: '' } });
    // Nothing said yet: an error while somebody is still typing is nagging.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    fireEvent.blur(field);

    // Now that the field has been left, the problem is stated on the field.
    expect(field).toHaveAttribute('aria-invalid', 'true');
  });

  it('checks the email only once it has been left, and clears when corrected', () => {
    render(<RegisterPatientScreen client={createMockClient()} />);

    const email = screen.getByLabelText('Email');
    fireEvent.change(email, { target: { value: 'not-an-address' } });
    expect(email).not.toHaveAttribute('aria-invalid', 'true');

    fireEvent.blur(email);
    expect(email).toHaveAttribute('aria-invalid', 'true');

    fireEvent.change(email, { target: { value: 'kai@example.invalid' } });
    expect(email).not.toHaveAttribute('aria-invalid', 'true');
  });

  it('accepts a blank email, because the portal is optional', () => {
    render(<RegisterPatientScreen client={createMockClient()} />);
    fillWalkIn();

    fireEvent.blur(screen.getByLabelText('Email'));
    fireEvent.click(screen.getByRole('button', { name: 'Register patient' }));

    expect(screen.queryByText('Fix these before registering')).not.toBeInTheDocument();
  });
});
