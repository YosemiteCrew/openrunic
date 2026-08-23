import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { BillingScreen } from '@/app/(app)/billing/BillingScreen';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => '/billing',
}));

describe('BillingScreen', () => {
  it('answers where the money is stuck today, with a labelled state on every number', async () => {
    render(<BillingScreen />);

    expect(await screen.findByRole('heading', { level: 1, name: 'Billing' })).toBeInTheDocument();

    const strip = await screen.findByRole('region', { name: "Today's revenue cycle" });
    expect(within(strip).getByText('Denied')).toBeInTheDocument();
    expect(within(strip).getByText('2 claims')).toBeInTheDocument();
    expect(within(strip).getByText('Remittance exceptions')).toBeInTheDocument();
    expect(within(strip).getByText('Needs a decision')).toBeInTheDocument();
  });

  it('leads to every workbench by name', async () => {
    render(<BillingScreen />);

    const links = await screen.findAllByRole('link', { name: 'Open' });
    const hrefs = links.map((link) => link.getAttribute('href'));
    expect(hrefs).toEqual([
      '/billing/charges',
      '/billing/claims',
      '/billing/remittance',
      '/billing/statements',
      '/billing/payments',
    ]);
  });

  it('offers the command palette as a visible control on the billing area too', async () => {
    render(<BillingScreen />);

    fireEvent.click(await screen.findByRole('button', { name: /Search or run a command/ }));
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeInTheDocument();
  });
});
