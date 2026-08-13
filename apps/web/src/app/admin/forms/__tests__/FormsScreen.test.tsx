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

/** Opens the palette the way a keyboard user does, and runs one verb by name. */
async function runCommand(label: string): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: /Search or run a command/ }));
  fireEvent.click(await screen.findByRole('option', { name: new RegExp(label) }));
}

describe('FormsScreen, driven from the command palette', () => {
  it('opens the preview, and the switch reflects that it is open', async () => {
    render(<FormsScreen />);
    await screen.findByText('Version 3, published');

    await runCommand('Preview this form');

    expect(await screen.findByText('Preview: Adult intake')).toBeInTheDocument();
    expect(screen.getByLabelText('Preview')).toBeChecked();
  });

  it('opens the publish confirmation, which can be cancelled without releasing', async () => {
    render(<FormsScreen />);
    await screen.findByText('Version 3, published');

    await runCommand('Publish a new version');
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancel' })
    );

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.queryByText(/is live on portal intake/)).not.toBeInTheDocument();
    expect(screen.getByText('Version 3, published')).toBeInTheDocument();
  });
});

describe('FormsScreen, the field properties pane', () => {
  it('says what to do rather than showing an empty pane with no field chosen', async () => {
    render(<FormsScreen />);
    await screen.findByText('Version 3, published');

    expect(
      screen.getByText(/Select a field on the canvas to change its label/)
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Label')).not.toBeInTheDocument();
  });

  it('carries help text, portal visibility, graphing and ask-once onto the chip row', async () => {
    render(<FormsScreen />);
    await screen.findByText('Version 3, published');

    fireEvent.click(screen.getByRole('button', { name: /Add Number/ }));
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Height in cm' } });
    fireEvent.change(screen.getByLabelText('Help text'), {
      target: { value: 'Measured without shoes.' },
    });
    fireEvent.click(screen.getByLabelText('Ask once'));

    const chip = screen.getByRole('button', { name: /Height in cm/ });
    // A number field is graphable and portal-visible by default; ask-once is
    // the one that was just turned on.
    expect(chip).toHaveTextContent('Graphable');
    expect(chip).toHaveTextContent('Portal');
    expect(chip).toHaveTextContent('Asked once');
    expect(screen.getByLabelText('Help text')).toHaveValue('Measured without shoes.');
  });

  it('takes a field out of the portal without removing it from the form', async () => {
    render(<FormsScreen />);
    await screen.findByText('Version 3, published');

    fireEvent.click(screen.getByRole('button', { name: /Add Short text/ }));
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Internal note' } });
    fireEvent.click(screen.getByLabelText('Visible in the patient portal'));

    expect(screen.getByRole('button', { name: /Internal note/ })).not.toHaveTextContent('Portal');

    fireEvent.click(screen.getByLabelText('Preview'));
    expect(screen.queryByLabelText(/Internal note/)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Rendered as'), { target: { value: 'staff' } });
    expect(screen.getByLabelText(/Internal note/)).toBeInTheDocument();
  });

  it('turns graphable off for a number field that is not a measurement', async () => {
    render(<FormsScreen />);
    await screen.findByText('Version 3, published');

    fireEvent.click(screen.getByRole('button', { name: /Add Number/ }));
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Room number' } });
    fireEvent.click(screen.getByLabelText('Graphable'));

    expect(screen.getByRole('button', { name: /Room number/ })).not.toHaveTextContent('Graphable');
  });

  it('shows a field conditionally, and the condition reads on the canvas', async () => {
    render(<FormsScreen />);
    await screen.findByText('Version 3, published');

    fireEvent.click(screen.getByRole('button', { name: /Add Short text/ }));
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Which brand?' } });
    fireEvent.change(screen.getByLabelText('Show when'), {
      target: { value: 'Show when Do you smoke? is Yes' },
    });

    expect(screen.getByRole('button', { name: /Which brand\?/ })).toHaveTextContent(
      'Show when Do you smoke? is Yes'
    );

    // Clearing it makes the field unconditional again, rather than storing "".
    fireEvent.change(screen.getByLabelText('Show when'), { target: { value: '' } });
    expect(screen.getByRole('button', { name: /Which brand\?/ })).not.toHaveTextContent(
      'Show when'
    );
  });

  it('says the edits are collecting in the next draft once anything changes', async () => {
    render(<FormsScreen />);
    await screen.findByText('Version 3, published');

    const notice = () => screen.getByText(/is published and cannot change/).closest('p')!;

    // PHQ-9 v1 is published with nothing pending, so the notice describes what
    // editing would do rather than what has already been done.
    fireEvent.change(screen.getByLabelText('Form'), { target: { value: 'form-phq9' } });
    await screen.findByText('Version 1, published');
    expect(notice().textContent).toMatch(/Editing anything starts draft version 2/);

    fireEvent.click(screen.getByRole('button', { name: /Add Number/ }));

    expect(notice().textContent).toMatch(/edits are collecting in draft version 2/);
  });

  it('leaves a draft form on its own version rather than bumping it', async () => {
    render(<FormsScreen />);
    await screen.findByText('Version 3, published');

    fireEvent.change(screen.getByLabelText('Form'), { target: { value: 'form-sports' } });

    expect(await screen.findByText('Version 1, draft')).toBeInTheDocument();
    // A draft is still the version it claims to be, so publishing does not skip
    // a number, and the "cannot change" notice does not apply.
    expect(screen.getByRole('button', { name: 'Publish version 1' })).toBeInTheDocument();
    expect(screen.queryByText(/is published and cannot change/)).not.toBeInTheDocument();
  });

  it('dismisses the publish confirmation toast', async () => {
    render(<FormsScreen />);
    await screen.findByText('Version 3, published');

    fireEvent.click(screen.getByRole('button', { name: 'Publish version 4' }));
    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Publish version 4' })
    );
    expect(screen.getByText(/version 4 is live on portal intake/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText(/version 4 is live on portal intake/)).not.toBeInTheDocument();
  });
});

describe('FormsScreen, field types with choices', () => {
  it('gives a new select field one option to start from, never zero', async () => {
    render(<FormsScreen />);
    await screen.findByText('Version 3, published');

    fireEvent.click(screen.getByRole('button', { name: /Add Single select/ }));
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Preferred pharmacy' } });
    fireEvent.click(screen.getByLabelText('Preview'));

    // A choice field with no choices is unanswerable, so it starts with one,
    // and the preview shows the choices a patient would be offered.
    expect(screen.getByLabelText(/Preferred pharmacy/)).toHaveAttribute('placeholder', 'Option 1');
  });

  it('leaves a text field with no options at all', async () => {
    render(<FormsScreen />);
    await screen.findByText('Version 3, published');

    fireEvent.click(screen.getByRole('button', { name: /Add Short text/ }));
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Employer' } });
    fireEvent.click(screen.getByLabelText('Preview'));

    // Nothing to choose from, so nothing is suggested in the field.
    expect(screen.getByLabelText(/Employer/)).not.toHaveAttribute('placeholder');
  });

  it('renders a section that has no fields in it as an empty section, not a crash', async () => {
    render(<FormsScreen />);
    await screen.findByText('Version 3, published');

    // Every section heading renders whether or not any field belongs to it.
    const canvas = screen.getByText('Canvas').closest('div')!;
    expect(within(canvas).getAllByRole('heading').length).toBeGreaterThan(1);
  });
});
