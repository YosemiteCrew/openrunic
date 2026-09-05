import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ChargesScreen } from '@/app/(app)/billing/charges/ChargesScreen';
import { ApiError, createBillingClient } from '@/lib/api';
import type { BillingClient } from '@/lib/api';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => '/billing/charges',
}));

function failing(): BillingClient {
  return {
    ...createBillingClient(),
    feeSheets: () =>
      Promise.reject(new ApiError('The server could not be reached.', { kind: 'network' })),
  };
}

describe('ChargesScreen', () => {
  it('renders the visit, its charges and the money they add up to', async () => {
    render(<ChargesScreen />);

    expect(await screen.findByRole('heading', { level: 1, name: 'Fee sheet' })).toBeInTheDocument();
    // The preferred name is what the patient is called, so it is what renders.
    expect(await screen.findByText('Tess Patientsson')).toBeInTheDocument();
    expect(screen.getByText('Office visit, established, 30 min')).toBeInTheDocument();
    // 186 + 18 + 96, spoken in full for a screen reader.
    expect(screen.getByText('300.00 US dollars')).toBeInTheDocument();
  });

  it('says in words that a line has no diagnosis, and blocks billing until it has', async () => {
    render(<ChargesScreen />);

    expect(await screen.findByText('Not justified')).toBeInTheDocument();
    const markReady = screen.getByRole('button', { name: 'Mark ready for billing' });
    expect(markReady).toBeDisabled();
    // Stated beside the disabled action and again in the scrub panel.
    expect(screen.getAllByText(/1 error blocks billing/).length).toBeGreaterThan(0);
  });

  it('links a diagnosis to a charge from the line, and that unblocks billing', async () => {
    render(<ChargesScreen />);

    const link = await screen.findByRole('button', {
      name: 'Link I10 Essential hypertension to 93000',
    });
    expect(link).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(link);

    expect(
      screen.getByRole('button', { name: 'Unlink I10 Essential hypertension from 93000' })
    ).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Mark ready for billing' })).toBeEnabled();
    expect(screen.getByText('Nothing blocks this visit from billing.')).toBeInTheDocument();
  });

  it('adds a charge from a shortcut panel in one click, unjustified and visible', async () => {
    render(<ChargesScreen />);

    fireEvent.click(
      await screen.findByRole('button', { name: 'Add 69210, Removal of impacted cerumen' })
    );

    expect(screen.getByText('Removal of impacted cerumen')).toBeInTheDocument();
    expect(screen.getAllByText('Not justified').length).toBeGreaterThan(1);
  });

  it('finds a code by description and adds it from the search results', async () => {
    render(<ChargesScreen />);

    fireEvent.change(await screen.findByLabelText('Search CPT and HCPCS'), {
      target: { value: 'nebuliser' },
    });
    fireEvent.click(screen.getByRole('button', { name: /94640/ }));

    expect(screen.getByText('Nebuliser treatment')).toBeInTheDocument();
  });

  it('keeps a removed charge on the sheet, struck through and restorable', async () => {
    render(<ChargesScreen />);

    fireEvent.click(await screen.findByRole('button', { name: 'Remove 36415' }));

    expect(screen.getByRole('button', { name: 'Restore 36415' })).toBeInTheDocument();
    expect(screen.getByText('Venipuncture, routine')).toHaveClass('or-charge-line--deleted');
  });

  it('confirms the consequence before the charges lock into the claim pipeline', async () => {
    render(<ChargesScreen />);

    fireEvent.click(
      await screen.findByRole('button', { name: 'Link I10 Essential hypertension to 93000' })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Mark ready for billing' }));

    const dialog = screen.getByRole('alertdialog', { name: 'Mark ready for billing' });
    expect(within(dialog).getByText(/a claim is created for Tess Patientsson/)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Mark ready' }));

    expect(await screen.findByText('Visit marked ready')).toBeInTheDocument();
    expect(screen.getByText('Ready for billing')).toBeInTheDocument();
  });

  it('picks the form of the blocking hint from the number of errors', async () => {
    // The existing assertion for this sentence is a regex over
    // `getAllByText`, and the scrub panel renders a message with the same
    // opening words - so it stays satisfied by the panel alone whatever the
    // hint says. The trailing clause belongs to the hint and to nothing else,
    // so this reads the hint rather than either of them.
    render(<ChargesScreen />);

    expect(
      await screen.findByText('1 error blocks billing. See the scrub panel.')
    ).toBeInTheDocument();

    // A second unjustified line, added the way a coder adds one.
    fireEvent.click(screen.getByRole('button', { name: 'Add 69210, Removal of impacted cerumen' }));

    expect(screen.getByText('2 errors block billing. See the scrub panel.')).toBeInTheDocument();
  });

  it('says "1 charge locks" and not "1 charges lock" when one charge is left', async () => {
    // The form and not the formatting: the two messages carried a single form
    // each, so the confirmation for the one-line visit read "1 charges lock"
    // to the biller being asked to approve it. Reached the way a biller
    // reaches it, by striking lines off the sheet until one is left.
    render(<ChargesScreen />);

    fireEvent.click(await screen.findByRole('button', { name: 'Remove 36415' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove 93000' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mark ready for billing' }));

    const dialog = screen.getByRole('alertdialog', { name: 'Mark ready for billing' });
    expect(within(dialog).getByText(/^1 charge locks and a claim is created/)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Mark ready' }));

    expect(await screen.findByText('A claim was created from 1 charge.')).toBeInTheDocument();
  });

  it('is operable from the keyboard: every justify control is a real focusable button', async () => {
    render(<ChargesScreen />);

    const link = await screen.findByRole('button', {
      name: 'Link E78.5 Hyperlipidaemia, unspecified to 93000',
    });
    link.focus();
    expect(document.activeElement).toBe(link);

    // Enter on a focused button is a click in the platform, so the toggle is
    // reachable without a pointer.
    fireEvent.click(link);
    expect(
      screen.getByRole('button', { name: 'Unlink E78.5 Hyperlipidaemia, unspecified from 93000' })
    ).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows the empty state with one way forward when no visit has charges', async () => {
    render(<ChargesScreen client={createBillingClient({ feeSheets: [] })} />);

    expect(await screen.findByText('No visits to charge')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to the schedule' })).toHaveAttribute(
      'href',
      '/schedule'
    );
  });

  it('says what happened and offers a retry when the read fails', async () => {
    render(<ChargesScreen client={failing()} />);

    expect(await screen.findByText('No connection to the server')).toBeInTheDocument();
    expect(screen.getByText(/today's fee sheets did not load/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

/** Opens the command palette the way a keyboard user does, and runs one verb. */
async function runCommand(label: string): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: /Search or run a command/ }));
  fireEvent.click(await screen.findByRole('option', { name: new RegExp(label) }));
}

describe('ChargesScreen, the money on the visit header', () => {
  it('names the copay as taken, short by an amount, or not owed at all', async () => {
    render(<ChargesScreen />);

    // Sheet one took the 30 it was owed.
    expect(await screen.findByText('Copay collected $30.00')).toBeInTheDocument();

    // Sheet two is owed 30 and has none of it, so the shortfall is named.
    fireEvent.change(screen.getByLabelText('Visit'), {
      target: { value: '0192f1a0-0000-7000-8000-00000000c002' },
    });
    expect(await screen.findByText('Copay outstanding $30.00')).toBeInTheDocument();

    // Sheet three owes nothing, which is said in words rather than left blank.
    fireEvent.change(screen.getByLabelText('Visit'), {
      target: { value: '0192f1a0-0000-7000-8000-00000000c003' },
    });
    expect(await screen.findByText('No copay due')).toBeInTheDocument();
  });

  it('locks a sheet already in the claim pipeline instead of letting it be edited', async () => {
    render(<ChargesScreen />);

    fireEvent.change(await screen.findByLabelText('Visit'), {
      target: { value: '0192f1a0-0000-7000-8000-00000000c003' },
    });

    expect(await screen.findByText('Ready for billing')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark ready for billing' })).toBeDisabled();
    expect(screen.getByText('This visit is in the claim pipeline.')).toBeInTheDocument();
    // Every edit control on a locked sheet is disabled, not merely ignored.
    expect(screen.getByLabelText('Units for 99392')).toBeDisabled();
    expect(screen.getByLabelText('Modifier for 99392')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove 99392' })).toBeDisabled();
  });
});

describe('ChargesScreen, editing a charge line', () => {
  it('puts a modifier on a line and takes it off again', async () => {
    render(<ChargesScreen />);

    const modifier = await screen.findByLabelText('Modifier for 36415');
    fireEvent.change(modifier, { target: { value: '59' } });
    expect(screen.getByLabelText('Modifier for 36415')).toHaveValue('59');

    fireEvent.change(screen.getByLabelText('Modifier for 36415'), { target: { value: '' } });
    expect(screen.getByLabelText('Modifier for 36415')).toHaveValue('');
  });

  it('multiplies the fee by the units, and refuses a unit count below one', async () => {
    render(<ChargesScreen />);

    const units = await screen.findByLabelText('Units for 36415');
    fireEvent.change(units, { target: { value: '3' } });

    // 18 a unit, three units, so the line reads 54 and the visit total moves
    // from 300 to 336.
    expect(screen.getByText('54.00 US dollars')).toBeInTheDocument();
    expect(screen.getByText('336.00 US dollars')).toBeInTheDocument();

    // A cleared field is zero, which is not a billable quantity: it clamps to
    // one rather than shipping a zero-fee line into a claim.
    fireEvent.change(screen.getByLabelText('Units for 36415'), { target: { value: '' } });
    expect(screen.getByLabelText('Units for 36415')).toHaveValue(1);
    expect(screen.getByText('300.00 US dollars')).toBeInTheDocument();
  });

  it('restores a removed charge, and the total comes back with it', async () => {
    render(<ChargesScreen />);

    fireEvent.click(await screen.findByRole('button', { name: 'Remove 36415' }));
    expect(screen.getByText('282.00 US dollars')).toBeInTheDocument();
    expect(screen.getByText('Charge removed')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Restore 36415' }));

    expect(screen.getByText('Charge restored')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove 36415' })).toBeInTheDocument();
    expect(screen.getByText('300.00 US dollars')).toBeInTheDocument();
  });

  it('says so rather than going blank when nothing matches the code search', async () => {
    render(<ChargesScreen />);

    fireEvent.change(await screen.findByLabelText('Search CPT and HCPCS'), {
      target: { value: 'zzzz' },
    });

    expect(screen.getByText(/No code matches "zzzz"/)).toBeInTheDocument();
  });

  it('clears the search box once a searched-for code is on the sheet', async () => {
    render(<ChargesScreen />);

    const search = await screen.findByLabelText('Search CPT and HCPCS');
    fireEvent.change(search, { target: { value: 'nebuliser' } });
    fireEvent.click(screen.getByRole('button', { name: /94640/ }));

    expect(search).toHaveValue('');
    expect(screen.getByText('94640 added')).toBeInTheDocument();
  });
});

describe('ChargesScreen, driven from the command palette', () => {
  it('puts the caret in the code search so a charge can be added without a mouse', async () => {
    render(<ChargesScreen />);
    await screen.findByText('Tess Patientsson');

    await runCommand('Add charge');

    expect(document.activeElement).toBe(screen.getByLabelText('Search CPT and HCPCS'));
  });

  it('opens the mark-ready confirmation, which can be cancelled without marking', async () => {
    render(<ChargesScreen />);
    await screen.findByText('Tess Patientsson');

    await runCommand('Mark visit ready for billing');

    const dialog = await screen.findByRole('alertdialog', { name: 'Mark ready for billing' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.queryByText('Visit marked ready')).not.toBeInTheDocument();
    expect(screen.queryByText('Ready for billing')).not.toBeInTheDocument();
  });

  it('moves to the next visit, and wraps back to the first from the last', async () => {
    render(<ChargesScreen />);
    await screen.findByText('Tess Patientsson');

    await runCommand("Open the next visit's fee sheet");
    expect(await screen.findByText('Chronic care')).toBeInTheDocument();

    await runCommand("Open the next visit's fee sheet");
    expect(await screen.findByText('Well-child visit')).toBeInTheDocument();

    await runCommand("Open the next visit's fee sheet");
    expect(await screen.findByText('Follow-up')).toBeInTheDocument();
  });

  it('offers no fee-sheet verbs at all when there is no visit to act on', async () => {
    render(<ChargesScreen client={createBillingClient({ feeSheets: [] })} />);
    await screen.findByText('No visits to charge');

    fireEvent.click(screen.getByRole('button', { name: /Search or run a command/ }));

    // The commands are registered by the screen, so they are still offered; the
    // point is that running one on an empty screen must not throw or invent a
    // sheet to act on.
    fireEvent.click(await screen.findByRole('option', { name: /Open the next visit/ }));
    expect(screen.getByText('No visits to charge')).toBeInTheDocument();
  });
});
