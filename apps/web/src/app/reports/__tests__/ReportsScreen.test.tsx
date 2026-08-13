import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ReportsScreen } from '@/app/reports/ReportsScreen';
import { adminMockFailure, createAdminMockClient, MOCK_PROVIDERS } from '@/lib/api';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => '/reports',
}));

describe('ReportsScreen dashboard', () => {
  it('states every tile with a unit and a labelled state, never a bare number', async () => {
    render(<ReportsScreen />);

    expect(await screen.findByText('Visits today')).toBeInTheDocument();
    expect(screen.getByText('booked')).toBeInTheDocument();
    expect(screen.getAllByText('Above threshold').length).toBe(2);
    expect(screen.getAllByText('Within target').length).toBeGreaterThan(0);
  });

  it('makes every number reachable in one click from its own tile', async () => {
    render(<ReportsScreen />);

    expect(await screen.findByRole('link', { name: 'Open unsigned notes' })).toHaveAttribute(
      'href',
      '/inbox'
    );
    expect(screen.getByRole('link', { name: 'Open claims needing attention' })).toHaveAttribute(
      'href',
      '/billing'
    );
  });

  it('renders the claim funnel and the aging split as words and numbers', async () => {
    render(<ReportsScreen />);

    const funnel = await screen.findByRole('list', { name: 'Claim funnel by stage' });
    expect(within(funnel).getByText('Captured')).toBeInTheDocument();
    expect(within(funnel).getByText('74 claims')).toBeInTheDocument();

    const aging = screen.getByRole('list', { name: 'Accounts receivable by age' });
    expect(within(aging).getByText('Over 90 days')).toBeInTheDocument();
    expect(within(aging).getByText(/Payer \$1,452.00, patient \$1,839.80/)).toBeInTheDocument();
  });

  it('flags a provider past the signing target in words', async () => {
    render(<ReportsScreen />);
    const table = await screen.findByRole('table', { name: 'Unsigned notes by provider' });
    expect(within(table).getByText('Past the 48 hour target')).toBeInTheDocument();
    expect(within(table).getByText('Within target')).toBeInTheDocument();
  });
});

describe('ReportsScreen report shell', () => {
  it('renders the visits report with a pinned totals row', async () => {
    render(<ReportsScreen />);

    const table = await screen.findByRole('table', { name: /Visits from/ });
    expect(within(table).getAllByText('Testina Patientsson').length).toBeGreaterThan(0);

    // The totals row is a description list beside the table, so it survives a
    // horizontal scroll of the columns.
    const totals = screen.getByTestId('visits-totals');
    expect(totals).toHaveTextContent('Visits');
    expect(totals).toHaveTextContent('$1,458.00');
  });

  it('filters by provider and recomputes the totals', async () => {
    render(<ReportsScreen />);
    await screen.findByRole('table', { name: /Visits from/ });

    fireEvent.change(screen.getByLabelText('Provider'), {
      target: { value: MOCK_PROVIDERS[1].id },
    });

    const summary = await screen.findByText(/4 visits/);
    expect(summary).toBeInTheDocument();
    expect(screen.queryByText('Placeholder Nullsson')).not.toBeInTheDocument();
  });

  it('offers an export that says what it did', async () => {
    render(<ReportsScreen />);
    await screen.findByRole('table', { name: /Visits from/ });

    fireEvent.click(screen.getAllByRole('button', { name: /Export/ })[0]!);
    expect(screen.getByText(/Exported \d+ visits|cannot download files/)).toBeInTheDocument();
  });

  it('explains an empty filtered report and offers a way back', async () => {
    render(<ReportsScreen />);
    await screen.findByRole('table', { name: /Visits from/ });

    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-09-01' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-09-30' } });

    expect(await screen.findByText('No visits match these filters')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reset to this week' })).toBeInTheDocument();
  });

  it('resets to this week from the empty state, keyboard reachable', async () => {
    render(<ReportsScreen />);
    await screen.findByRole('table', { name: /Visits from/ });

    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-09-01' } });
    const reset = await screen.findByRole('button', { name: 'Reset to this week' });

    reset.focus();
    expect(reset).toHaveFocus();
    fireEvent.click(reset);

    expect(await screen.findByRole('table', { name: /Visits from/ })).toBeInTheDocument();
  });

  it('renders the onboarding empty dashboard for a practice with no data', async () => {
    render(<ReportsScreen client={createAdminMockClient({ empty: true })} />);

    expect(await screen.findByText('Nothing to report yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to the schedule' })).toHaveAttribute(
      'href',
      '/schedule'
    );
  });

  it('explains a failure and offers a retry', async () => {
    render(<ReportsScreen client={createAdminMockClient({ failure: adminMockFailure() })} />);

    expect((await screen.findAllByText('The server could not answer')).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /Try again/ }).length).toBeGreaterThan(0);
  });

  it('shows skeletons while the dashboard loads', () => {
    render(<ReportsScreen />);
    expect(screen.getAllByRole('status')[0]).toHaveTextContent('Loading the practice dashboard');
  });
});
