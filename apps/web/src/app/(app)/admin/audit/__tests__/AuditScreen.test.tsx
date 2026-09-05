import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AuditScreen } from '@/app/(app)/admin/audit/AuditScreen';
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

  it('descends the outline one level at a time inside the drawer', async () => {
    render(<AuditScreen />);
    await screen.findByRole('table', { name: /Audit events/ });

    fireEvent.click(screen.getByRole('button', { name: 'Open event 48208' }));
    const drawer = screen.getByRole('dialog', { name: 'Breakglass read' });

    // The drawer owns the h2, so the card inside it is a level below. The
    // shared Card defaults to level 2, which would nest an h2 in an h2.
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(within(drawer).getByRole('heading', { level: 2 })).toHaveTextContent('Breakglass read');
    expect(
      within(drawer).getByRole('heading', { level: 3, name: 'Hash chain' })
    ).toBeInTheDocument();
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

/** Opens the palette the way a keyboard user does, and runs one verb by name. */
async function runCommand(label: string): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: /Search or run a command/ }));
  fireEvent.click(await screen.findByRole('option', { name: new RegExp(label) }));
}

describe('AuditScreen, narrowing the trail', () => {
  it('answers "who touched this chart" from the MRN box alone', async () => {
    render(<AuditScreen />);
    await screen.findByRole('table', { name: 'Audit events, newest first' });

    fireEvent.change(screen.getByLabelText('Patient MRN'), { target: { value: 'OR-100482' } });

    const table = await screen.findByRole('table', { name: 'Audit events, newest first' });
    expect(within(table).getAllByText('OR-100482').length).toBeGreaterThan(0);
    expect(within(table).queryByText('OR-100517')).not.toBeInTheDocument();
  });

  it('narrows to one actor, one action and one purpose of use', async () => {
    render(<AuditScreen />);
    await screen.findByRole('table', { name: 'Audit events, newest first' });

    fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'LOGIN_FAILURE' } });
    let table = await screen.findByRole('table', { name: 'Audit events, newest first' });
    expect(within(table).getAllByText('Login failure').length).toBeGreaterThan(0);
    expect(within(table).queryByText('Note sign')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Action'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Purpose of use'), { target: { value: 'PAYMENT' } });
    table = await screen.findByRole('table', { name: 'Audit events, newest first' });
    expect(within(table).getAllByText('Payment').length).toBeGreaterThan(0);
    expect(within(table).queryByText('Treatment')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Purpose of use'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Actor'), {
      target: { value: '0192f1a0-0000-7000-8000-00000000d001' },
    });
    table = await screen.findByRole('table', { name: 'Audit events, newest first' });
    expect(within(table).getAllByText('Ada Okafor').length).toBeGreaterThan(0);
    expect(within(table).queryByText('Rosa Mbeki')).not.toBeInTheDocument();
  });

  it('bounds the period, and says so rather than showing nothing', async () => {
    render(<AuditScreen />);
    await screen.findByRole('table', { name: 'Audit events, newest first' });

    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-09-01' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-09-30' } });

    expect(await screen.findByText('No events match this query')).toBeInTheDocument();
  });

  it('clears every filter from the empty state, bringing the trail back', async () => {
    render(<AuditScreen />);
    await screen.findByRole('table', { name: 'Audit events, newest first' });

    fireEvent.change(screen.getByLabelText('Patient MRN'), { target: { value: 'OR-999999' } });
    expect(await screen.findByText('No events match this query')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear the filters' }));

    expect(
      await screen.findByRole('table', { name: 'Audit events, newest first' })
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Patient MRN')).toHaveValue('');
  });
});

describe('AuditScreen, driven from the command palette', () => {
  it('isolates emergency access and drops the filters that would hide it', async () => {
    render(<AuditScreen />);
    await screen.findByRole('table', { name: 'Audit events, newest first' });

    // A narrow actor filter would hide the very event the incident is about.
    fireEvent.change(screen.getByLabelText('Actor'), {
      target: { value: '0192f1a0-0000-7000-8000-00000000d001' },
    });
    await screen.findByRole('table', { name: 'Audit events, newest first' });

    await runCommand('Show breakglass access only');

    expect(screen.getByLabelText('Breakglass only')).toBeChecked();
    expect(screen.getByLabelText('Actor')).toHaveValue('');
    expect(screen.getByLabelText('Action')).toHaveValue('');
    expect(screen.getByLabelText('Purpose of use')).toHaveValue('');
    expect(await screen.findByText(/1 breakglass/)).toBeInTheDocument();
  });

  it('exports from the palette and records the export in the trail it exported', async () => {
    render(<AuditScreen />);
    await screen.findByRole('table', { name: 'Audit events, newest first' });

    await runCommand('Export the filtered audit trail');

    expect(
      await screen.findByText(/The export itself is recorded in this trail/)
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText(/The export itself is recorded/)).not.toBeInTheDocument();
  });

  it('says the browser cannot download rather than failing silently', async () => {
    const createObjectURL = URL.createObjectURL;
    // A print worker, a locked-down kiosk browser, a server render: the export
    // has to say what happened rather than appear to have worked.
    Object.defineProperty(URL, 'createObjectURL', { value: undefined, configurable: true });
    try {
      render(<AuditScreen />);
      await screen.findByRole('table', { name: 'Audit events, newest first' });

      fireEvent.click(screen.getByRole('button', { name: 'Export these events' }));

      expect(
        await screen.findByText(
          'This browser cannot download files. Copy the filtered table instead.'
        )
      ).toBeInTheDocument();
    } finally {
      Object.defineProperty(URL, 'createObjectURL', {
        value: createObjectURL,
        configurable: true,
      });
    }
  });
});

describe('AuditScreen, one event in full', () => {
  it('closes the drawer from its footer, leaving the trail behind it', async () => {
    render(<AuditScreen />);
    const table = await screen.findByRole('table', { name: 'Audit events, newest first' });
    fireEvent.click(within(table).getAllByRole('button', { name: /^Open event / })[0]!);

    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByText('Hash chain')).toBeInTheDocument();
    expect(within(drawer).getByText('Verified against the chain')).toBeInTheDocument();

    fireEvent.click(within(drawer).getAllByRole('button', { name: 'Close' }).at(-1)!);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Audit events, newest first' })).toBeInTheDocument();
  });

  it('writes the sequence number as it is stored, not as a grouped quantity', async () => {
    /*
     * The two helpers only differ above a thousand, and audit sequences pass a
     * thousand within a day - which is why this is the site that can hold the
     * rule. `verbatim(48211)` is "48211" and `formatCount(48211, 'en')` is
     * "48,211", and the second is a different string from the one in the URL,
     * in the search box and in the ticket somebody pastes it into.
     *
     * Localise what is measured, render verbatim what is matched. Every other
     * call site in this application is below a thousand in every fixture, so
     * swapping the two helpers there is invisible to the whole suite.
     */
    render(<AuditScreen />);
    await screen.findByRole('table', { name: 'Audit events, newest first' });

    expect(screen.getByRole('button', { name: 'Open event 48211' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open event 48,211' })).not.toBeInTheDocument();
  });

  it('says "no chart context" rather than leaving the patient rows blank', async () => {
    render(<AuditScreen />);
    await screen.findByRole('table', { name: 'Audit events, newest first' });

    fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'LOGIN_FAILURE' } });
    const table = await screen.findByRole('table', { name: 'Audit events, newest first' });
    fireEvent.click(within(table).getAllByRole('button', { name: /^Open event / })[0]!);

    const drawer = await screen.findByRole('dialog');
    // A failed sign-in touches no chart, and the drawer says so in both the
    // patient and the MRN row rather than showing two empty cells.
    expect(within(drawer).getAllByText('No chart context')).toHaveLength(2);
    expect(within(drawer).queryByText(/Emergency access/)).not.toBeInTheDocument();
  });
});
