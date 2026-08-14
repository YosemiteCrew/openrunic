import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { StatementsScreen } from '@/app/billing/statements/StatementsScreen';
import { ApiError, createBillingClient } from '@/lib/api';
import type { BillingClient } from '@/lib/api';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => '/billing/statements',
}));

function failing(): BillingClient {
  return {
    ...createBillingClient(),
    statements: () =>
      Promise.reject(new ApiError('The server could not be reached.', { kind: 'network' })),
  };
}

describe('StatementsScreen', () => {
  it('renders the AR ageing above the balances it explains', async () => {
    render(<StatementsScreen />);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Statements and AR' })
    ).toBeInTheDocument();

    const strip = screen.getByRole('region', { name: 'Accounts receivable by age' });
    expect(within(strip).getByText('91 days and over')).toBeInTheDocument();
    // Both of the two oldest buckets say the same thing, in words.
    expect(within(strip).getAllByText('Chase these')).toHaveLength(2);
  });

  it('shows every balance with its bucket named, not just tinted', async () => {
    render(<StatementsScreen />);

    const table = await screen.findByRole('table', { name: 'Patient balances' });
    expect(within(table).getByText('Stubbins, Dummonde')).toBeInTheDocument();
    expect(within(table).getAllByText('91 days and over').length).toBeGreaterThan(0);
  });

  it('marks an account on a payment plan so a run cannot escalate it blindly', async () => {
    render(<StatementsScreen />);

    const table = await screen.findByRole('table', { name: 'Patient balances' });
    expect(within(table).getByText(/Plan 2 of 4/)).toBeInTheDocument();
  });

  it('filters to the oldest bucket from the ageing chips', async () => {
    render(<StatementsScreen />);

    fireEvent.click(await screen.findByRole('button', { name: /^91 days and over/ }));

    const table = screen.getByRole('table', { name: 'Patient balances' });
    expect(within(table).getByText('Stubbins, Dummonde')).toBeInTheDocument();
    expect(within(table).queryByText('Patientsson, Tess')).not.toBeInTheDocument();
  });

  it('previews a single statement in the patient register before sending it', async () => {
    render(<StatementsScreen />);

    fireEvent.click(
      await screen.findByRole('button', { name: 'Preview statement for Patientsson, Tess' })
    );

    const drawer = screen.getByRole('dialog', { name: 'Statement for Tess Patientsson' });
    expect(
      within(drawer).getByText(/Your insurance paid \$142\.00\. Your share is \$38\.00\./)
    ).toBeInTheDocument();
    expect(within(drawer).getByText('Card on file')).toBeInTheDocument();
  });

  it('sends a text-to-pay link and says it went', async () => {
    render(<StatementsScreen />);

    fireEvent.click(
      await screen.findByRole('button', { name: 'Preview statement for Patientsson, Tess' })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send text-to-pay link' }));

    expect(await screen.findByText('Payment link sent')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Link sent' })).toBeDisabled();
  });

  it('shows the dunning escalation for every account before a run is sent', async () => {
    render(<StatementsScreen />);

    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select Patientsson, Tess' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select Testperson, Exampla' }));
    fireEvent.click(screen.getByRole('button', { name: 'Preview statement run' }));

    const drawer = screen.getByRole('dialog', { name: 'Statement run' });
    const run = within(drawer).getByRole('table', { name: 'Accounts in this run' });
    expect(within(run).getByText('No statement sent')).toBeInTheDocument();
    expect(within(run).getByText('Second notice')).toBeInTheDocument();

    fireEvent.click(within(drawer).getByRole('button', { name: 'Send 2 statements' }));
    expect(await screen.findByText('2 statements sent')).toBeInTheDocument();
  });

  it('will not run statements with nothing selected, and says so', async () => {
    render(<StatementsScreen />);

    expect(await screen.findByRole('button', { name: 'Preview statement run' })).toBeDisabled();
    expect(screen.getByText('Select accounts to run statements for.')).toBeInTheDocument();
  });

  it('closes the preview on Escape', async () => {
    render(<StatementsScreen />);

    fireEvent.click(
      await screen.findByRole('button', { name: 'Preview statement for Patientsson, Tess' })
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows the empty state when nothing is outstanding', async () => {
    render(<StatementsScreen client={createBillingClient({ statements: [] })} />);

    expect(await screen.findByText('No balances')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to remittance' })).toHaveAttribute(
      'href',
      '/billing/remittance'
    );
  });

  it('says what happened and offers a retry when the read fails', async () => {
    render(<StatementsScreen client={failing()} />);

    expect(await screen.findByText('No connection to the server')).toBeInTheDocument();
    expect(screen.getByText(/patient balances did not load/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

/** Opens the palette the way a keyboard user does, and runs one verb by name. */
async function runCommand(label: string): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: /Search or run a command/ }));
  fireEvent.click(await screen.findByRole('option', { name: new RegExp(label) }));
}

describe('StatementsScreen, driven from the command palette', () => {
  it('selects every account in the current view, not every account there is', async () => {
    render(<StatementsScreen />);
    await screen.findByLabelText('Search balances');

    fireEvent.change(screen.getByLabelText('Search balances'), { target: { value: 'stubbins' } });
    await runCommand('Select every account in this view');

    // A statement run has to mean what the filter says it means: one account
    // matches the search, so one account is selected.
    expect(screen.getByRole('button', { name: 'Preview statement run' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Preview statement run' }));
    expect(
      within(await screen.findByRole('dialog')).getAllByText(/Stubbins/).length
    ).toBeGreaterThan(0);
    expect(within(screen.getByRole('dialog')).queryByText(/Patientsson/)).not.toBeInTheDocument();
  });

  it('jumps to the oldest bucket and back to every balance', async () => {
    render(<StatementsScreen />);
    await screen.findByLabelText('Search balances');

    await runCommand('Show balances over 90 days');
    expect(await screen.findByText('Stubbins, Dummonde')).toBeInTheDocument();
    expect(screen.queryByText('Patientsson, Tess')).not.toBeInTheDocument();

    await runCommand('Show every balance');
    expect(await screen.findByText('Patientsson, Tess')).toBeInTheDocument();
  });

  it('drops a selection when the bucket changes, so a run cannot include a hidden account', async () => {
    render(<StatementsScreen />);
    await screen.findByLabelText('Search balances');

    await runCommand('Select every account in this view');
    expect(screen.getByRole('button', { name: 'Preview statement run' })).toBeEnabled();

    await runCommand('Show balances over 90 days');

    // Selecting eight accounts and then filtering to one must not send eight.
    expect(screen.getByRole('button', { name: 'Preview statement run' })).toBeDisabled();
  });

  it('opens the run from the palette and refuses an empty one the same way', async () => {
    render(<StatementsScreen />);
    await screen.findByLabelText('Search balances');

    await runCommand('Preview a statement run');

    expect(await screen.findByText('Nothing selected')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('StatementsScreen, running statements', () => {
  it('sends a run, counts it on every account it touched, and clears the selection', async () => {
    render(<StatementsScreen />);
    await screen.findByLabelText('Search balances');

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Stubbins, Dummonde' }));
    fireEvent.click(screen.getByRole('button', { name: 'Preview statement run' }));

    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send statement' }));

    expect(await screen.findByText('1 statement sent')).toBeInTheDocument();
    expect(
      screen.getByText('Accounts with a mobile number also received a payment link.')
    ).toBeInTheDocument();
    // Selection cleared, so the same run cannot be sent twice by accident.
    expect(screen.getByRole('button', { name: 'Preview statement run' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Select Stubbins, Dummonde' })).not.toBeChecked();
  });

  it('unticks an account that was ticked by mistake', async () => {
    render(<StatementsScreen />);
    await screen.findByLabelText('Search balances');

    const box = screen.getByRole('checkbox', { name: 'Select Stubbins, Dummonde' });
    fireEvent.click(box);
    expect(box).toBeChecked();

    fireEvent.click(box);
    expect(box).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Preview statement run' })).toBeDisabled();
  });

  it('finds one account by MRN as well as by name', async () => {
    render(<StatementsScreen />);
    await screen.findByLabelText('Search balances');

    fireEvent.change(screen.getByLabelText('Search balances'), { target: { value: 'OR-100866' } });

    expect(await screen.findByText('Stubbins, Dummonde')).toBeInTheDocument();
    expect(screen.queryByText('Patientsson, Tess')).not.toBeInTheDocument();
  });
});
