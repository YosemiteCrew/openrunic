import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { RemittanceScreen } from '@/app/(app)/billing/remittance/RemittanceScreen';
import { ApiError, createBillingClient, MOCK_REMITTANCES } from '@/lib/api';
import type { BillingClient } from '@/lib/api';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => '/billing/remittance',
}));

function failing(): BillingClient {
  return {
    ...createBillingClient(),
    remittances: () =>
      Promise.reject(new ApiError('The server could not be reached.', { kind: 'network' })),
  };
}

/** The clean 835: every line matched, so there is nothing for a human to do. */
const cleanOnly = MOCK_REMITTANCES.filter((era) => era.status === 'POSTED');

describe('RemittanceScreen', () => {
  it('opens on a remittance and reports how much of it posted itself', async () => {
    render(<RemittanceScreen />);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Remittance' })
    ).toBeInTheDocument();
    expect(await screen.findByText('Remittance EFT-8841207')).toBeInTheDocument();
    // Two of the five lines posted themselves; the other three need a person.
    expect(screen.getByText('2 of 5 lines')).toBeInTheDocument();
    expect(screen.getByText('Needs a decision')).toBeInTheDocument();
  });

  it('puts the exceptions above the ledger and names why each one is there', async () => {
    render(<RemittanceScreen />);

    const queue = await screen.findByRole('table', { name: 'Exception queue' });
    expect(
      within(queue).getByText('Paid 18.00 under the contracted allowed amount.')
    ).toBeInTheDocument();
    expect(within(queue).getAllByText('Underpaid').length).toBeGreaterThan(0);
  });

  it('labels the variance in words as well as in money', async () => {
    render(<RemittanceScreen />);

    const ledger = await screen.findByRole('table', { name: 'Service lines on EFT-8841207' });
    expect(within(ledger).getAllByText('Matched').length).toBeGreaterThan(0);
    expect(within(ledger).getAllByText('Underpaid').length).toBe(3);
  });

  it('clears an exception from the row, with the disposition named after what it does', async () => {
    render(<RemittanceScreen />);

    const resolve = await screen.findByRole('button', {
      name: 'Transferred to patient for CLM-24045 99213',
    });
    fireEvent.click(resolve);

    // The disposition is confirmed, and the line leaves the queue.
    expect(screen.getAllByText('Transferred to patient').length).toBeGreaterThan(0);
    const queue = screen.getByRole('table', { name: 'Exception queue' });
    expect(
      within(queue).queryByText('Paid 18.00 under the contracted allowed amount.')
    ).not.toBeInTheDocument();
  });

  it('says there is nothing to work when every line matched', async () => {
    render(<RemittanceScreen client={createBillingClient({ remittances: cleanOnly })} />);

    // Stated as the card's own answer and again on the exceptions readout.
    expect((await screen.findAllByText('Nothing to work')).length).toBeGreaterThan(0);
    expect(screen.getByText(/Every line on CHK-550194 matched the claim/)).toBeInTheDocument();
  });

  it('shows the secondary payer cascade on the line it applies to', async () => {
    render(<RemittanceScreen />);

    expect(
      await screen.findByText('Cascades to Birchwood State Plan', { exact: false })
    ).toBeInTheDocument();
  });

  it('switches remittance from the keyboard-reachable list in the rail', async () => {
    render(<RemittanceScreen />);

    fireEvent.click(await screen.findByText('CHK-550194'));

    expect(await screen.findByText('Remittance CHK-550194')).toBeInTheDocument();
  });

  it('filters to remittances that still need a person', async () => {
    render(<RemittanceScreen />);

    fireEvent.click(await screen.findByRole('switch', { name: 'Exceptions only' }));

    expect(screen.queryByText('CHK-550194')).not.toBeInTheDocument();
    expect(screen.getByText('EFT-8841207')).toBeInTheDocument();
  });

  it('shows the empty state when no remittance has arrived', async () => {
    render(<RemittanceScreen client={createBillingClient({ remittances: [] })} />);

    expect(await screen.findByText('No remittance advice received')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to the claim workbench' })).toHaveAttribute(
      'href',
      '/billing/claims'
    );
  });

  it('says what happened and offers a retry when the read fails', async () => {
    render(<RemittanceScreen client={failing()} />);

    expect(await screen.findByText('No connection to the server')).toBeInTheDocument();
    expect(screen.getByText(/remittances did not load/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

/** Opens the palette the way a keyboard user does, and runs one verb by name. */
async function runCommand(label: string): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: /Search or run a command/ }));
  fireEvent.click(await screen.findByRole('option', { name: new RegExp(label) }));
}

describe('RemittanceScreen, driven from the command palette', () => {
  it('walks to the next remittance that still needs a person', async () => {
    const withTwoQueues = MOCK_REMITTANCES.map((era) => ({
      ...era,
      status: 'EXCEPTIONS' as const,
    }));
    render(<RemittanceScreen client={createBillingClient({ remittances: withTwoQueues })} />);
    const first = (await screen.findByRole('heading', { level: 2, name: /^Remittance / }))
      .textContent;

    await runCommand('Open the next remittance with exceptions');

    expect(
      (await screen.findByRole('heading', { level: 2, name: /^Remittance / })).textContent
    ).not.toBe(first);
  });

  it('says so rather than doing nothing when no other queue needs work', async () => {
    render(<RemittanceScreen />);
    await screen.findByRole('heading', { level: 2, name: /^Remittance / });

    await runCommand('Open the next remittance with exceptions');

    expect(await screen.findByText('No other remittance has exceptions')).toBeInTheDocument();
    expect(screen.getByText('Everything else posted in full.')).toBeInTheDocument();
  });

  it('filters to the exception queue and back to every remittance', async () => {
    render(<RemittanceScreen />);
    await screen.findByText('CHK-550194');

    await runCommand('Show only remittances with exceptions');
    expect(screen.queryByText('CHK-550194')).not.toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Exceptions only' })).toBeChecked();

    await runCommand('Show every remittance');
    expect(await screen.findByText('CHK-550194')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Exceptions only' })).not.toBeChecked();
  });

  it('drops the exception count as each line is resolved, down to nothing to work', async () => {
    render(<RemittanceScreen />);
    await screen.findByRole('heading', { level: 2, name: /^Remittance / });

    expect(screen.getByText('Needs a decision')).toBeInTheDocument();

    // Resolve every open exception on the queue this remittance carries.
    let resolvers = screen.queryAllByRole('button', { name: /^Transferred to patient for / });
    while (resolvers.length > 0) {
      fireEvent.click(resolvers[0]!);
      resolvers = screen.queryAllByRole('button', { name: /^Transferred to patient for / });
    }

    expect(screen.queryByRole('table', { name: 'Exception queue' })).not.toBeInTheDocument();
    expect(screen.getAllByText('Nothing to work').length).toBeGreaterThan(0);
    expect(screen.queryByText('Needs a decision')).not.toBeInTheDocument();
  });
});
