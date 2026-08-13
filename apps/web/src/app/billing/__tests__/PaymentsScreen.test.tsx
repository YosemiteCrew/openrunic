import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PaymentsScreen } from '@/app/billing/payments/PaymentsScreen';
import { ApiError, createBillingClient, MOCK_STATEMENT_ACCOUNTS } from '@/lib/api';
import type { BillingClient } from '@/lib/api';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => '/billing/payments',
}));

function failing(): BillingClient {
  return {
    ...createBillingClient(),
    statements: () =>
      Promise.reject(new ApiError('The server could not be reached.', { kind: 'network' })),
  };
}

/** Ivo Petrescu: the largest balance, three open visits, no card on file. */
function withoutCard(): BillingClient {
  const account = MOCK_STATEMENT_ACCOUNTS.find((row) => !row.cardOnFile);
  if (!account) throw new Error('Fixture missing');
  return createBillingClient({ statements: [account] });
}

async function enterAmount(value: string) {
  fireEvent.change(await screen.findByLabelText('Amount'), { target: { value } });
}

/**
 * The desk opens on the largest balance, which in the fixtures is a patient
 * with no card on file. Cash is what a desk would reach for there, and it keeps
 * these tests about allocation rather than about consent.
 */
async function chooseCash() {
  fireEvent.click(await screen.findByRole('radio', { name: /Cash/ }));
}

describe('PaymentsScreen', () => {
  it('renders the desk with a patient, a method and the visits to allocate against', async () => {
    render(<PaymentsScreen />);

    expect(await screen.findByRole('heading', { level: 1, name: 'Payments' })).toBeInTheDocument();
    expect(await screen.findByLabelText('Patient')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Card on file/ })).toBeChecked();
    expect(screen.getByRole('table', { name: 'Open visits' })).toBeInTheDocument();
  });

  it('separates a card already consented to from one keyed at the desk', async () => {
    render(<PaymentsScreen />);

    expect(
      await screen.findByText('Charges the card the patient has already consented to.')
    ).toBeInTheDocument();
    expect(screen.getByText('One-off card, nothing stored.')).toBeInTheDocument();
  });

  it('refuses card-on-file for a patient who has none, and says which methods work', async () => {
    render(<PaymentsScreen client={withoutCard()} />);

    expect(await screen.findByText('No card on file')).toBeInTheDocument();
    expect(screen.getByText(/has no card on file\. Key the card at the desk/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Take payment' })).toBeDisabled();
  });

  it('keeps the remainder visible and blocks a payment that is not fully allocated', async () => {
    render(<PaymentsScreen />);

    await chooseCash();
    await enterAmount('38');

    expect(screen.getByText('Still to allocate')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Take payment' })).toBeDisabled();
    expect(screen.getByText('Allocate the whole payment before taking it.')).toBeInTheDocument();
  });

  it('allocates oldest visit first and drives the remainder to zero', async () => {
    render(<PaymentsScreen />);

    await chooseCash();
    await enterAmount('38');
    fireEvent.click(screen.getByRole('button', { name: 'Allocate oldest first' }));

    expect(screen.getByText('Fully allocated')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Take payment' })).toBeEnabled();
  });

  it('calls an over-allocation an error rather than a warning', async () => {
    render(<PaymentsScreen />);

    await chooseCash();
    await enterAmount('10');
    const cells = await screen.findAllByLabelText(/Amount allocated to the visit on/);
    const first = cells[0];
    if (!first) throw new Error('No open visit to allocate against');
    fireEvent.change(first, { target: { value: '40' } });

    expect(screen.getByText('Over-allocated')).toBeInTheDocument();
    expect(screen.getByText('More is allocated than is being taken.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Take payment' })).toBeDisabled();
  });

  it('takes the payment and issues a receipt naming the visits it paid', async () => {
    render(<PaymentsScreen />);

    await chooseCash();
    await enterAmount('38');
    fireEvent.click(screen.getByRole('button', { name: 'Allocate oldest first' }));
    fireEvent.click(screen.getByRole('button', { name: 'Take payment' }));

    const receipt = await screen.findByRole('dialog', { name: /^Receipt RCP-/ });
    expect(within(receipt).getByText('Captured')).toBeInTheDocument();
    expect(
      within(receipt).getByRole('table', { name: 'What this payment paid' })
    ).toBeInTheDocument();
    expect(within(receipt).getByText('Cash')).toBeInTheDocument();
  });

  it('reprints a receipt rather than issuing it once and losing it', async () => {
    render(<PaymentsScreen />);

    await chooseCash();
    await enterAmount('38');
    fireEvent.click(screen.getByRole('button', { name: 'Allocate oldest first' }));
    fireEvent.click(screen.getByRole('button', { name: 'Take payment' }));

    const receipt = await screen.findByRole('dialog', { name: /^Receipt RCP-/ });
    fireEvent.click(within(receipt).getByRole('button', { name: 'Print receipt' }));
    expect(await screen.findByText('Receipt sent to the printer')).toBeInTheDocument();
  });

  it('closes the receipt on Escape', async () => {
    render(<PaymentsScreen />);

    await chooseCash();
    await enterAmount('38');
    fireEvent.click(screen.getByRole('button', { name: 'Allocate oldest first' }));
    fireEvent.click(screen.getByRole('button', { name: 'Take payment' }));
    expect(await screen.findByRole('dialog', { name: /^Receipt RCP-/ })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens a past receipt from the recent list', async () => {
    render(<PaymentsScreen />);

    fireEvent.click(await screen.findByText('RCP-70412'));

    const receipt = screen.getByRole('dialog', { name: 'Receipt RCP-70412' });
    expect(within(receipt).getByText('Visa ending 4242')).toBeInTheDocument();
  });

  it('shows the empty state when there is nothing to collect', async () => {
    render(<PaymentsScreen client={createBillingClient({ statements: [], payments: [] })} />);

    expect(await screen.findByText('No balances to collect')).toBeInTheDocument();
    expect(screen.getByText('No payments yet')).toBeInTheDocument();
  });

  it('says what happened and offers a retry when the read fails', async () => {
    render(<PaymentsScreen client={failing()} />);

    expect(await screen.findByText('No connection to the server')).toBeInTheDocument();
    expect(screen.getByText(/patient balances did not load/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
