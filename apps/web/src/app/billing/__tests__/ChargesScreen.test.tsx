import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ChargesScreen } from '@/app/billing/charges/ChargesScreen';
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
