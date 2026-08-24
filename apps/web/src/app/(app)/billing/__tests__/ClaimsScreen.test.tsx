import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ClaimsScreen } from '@/app/(app)/billing/claims/ClaimsScreen';
import { ApiError, createBillingClient } from '@/lib/api';
import type { BillingClient } from '@/lib/api';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => '/billing/claims',
}));

function failing(): BillingClient {
  return {
    ...createBillingClient(),
    claims: () =>
      Promise.reject(new ApiError('The server could not be reached.', { kind: 'network' })),
  };
}

async function filterTo(state: string) {
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(`^${state}`) }));
}

describe('ClaimsScreen', () => {
  it('renders the ledger with every claim carrying its state and its age', async () => {
    render(<ClaimsScreen />);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Claim workbench' })
    ).toBeInTheDocument();
    expect(await screen.findByText('CLM-24118')).toBeInTheDocument();

    const table = screen.getByRole('table', { name: 'Claims' });
    const header = within(table)
      .getAllByRole('columnheader')
      .map((cell) => cell.textContent);
    expect(header).toContain('State');
    expect(header).toContain('Age in state');
  });

  it('says what to do about each ageing band in words, not by tint alone', async () => {
    render(<ClaimsScreen />);

    // The four bands are always rendered, so every advice word is on the screen
    // whatever the fixtures hold. The assertion is here rather than in the
    // drift test because the advice keys are chosen by a ternary and held in a
    // map keyed by tone, and its scanner reads neither shape.
    const strip = await screen.findByRole('region', { name: 'Claims by age in state' });
    expect(within(strip).getByText('0 to 13 days')).toBeInTheDocument();
    expect(within(strip).getByText('60 days and over')).toBeInTheDocument();
    for (const advice of ['on track', 'ageing', 'chase these']) {
      expect(within(strip).getAllByText(new RegExp(`claims?, ${advice}$`)).length).toBeGreaterThan(
        0
      );
    }
  });

  it('filters the queue by state from the chips, which are the primary navigation', async () => {
    render(<ClaimsScreen />);

    await filterTo('Denied');

    const table = screen.getByRole('table', { name: 'Claims' });
    expect(within(table).getByText('CLM-24061')).toBeInTheDocument();
    expect(within(table).queryByText('CLM-24118')).not.toBeInTheDocument();
  });

  it('scrubs a selection in one bulk action and says what moved', async () => {
    render(<ClaimsScreen />);

    await filterTo('Captured');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select claim CLM-24118' }));
    fireEvent.click(screen.getByRole('button', { name: 'Scrub selected claims' }));

    expect(await screen.findByText('1 claim scrubbed')).toBeInTheDocument();
    expect(screen.getByText('Moved to scrubbed.')).toBeInTheDocument();
  });

  it('will not let a claim with scrub errors be selected for a bulk action', async () => {
    render(<ClaimsScreen />);

    await filterTo('Captured');
    const blocked = screen.getByRole('checkbox', { name: 'Select claim CLM-24119' });
    expect(blocked).toBeDisabled();
    expect(screen.getAllByText(/scrub error/).length).toBeGreaterThan(0);
  });

  it('opens the claim detail drawer with its lifecycle and event history', async () => {
    render(<ClaimsScreen />);

    fireEvent.click(await screen.findByRole('button', { name: 'Open claim CLM-24118' }));

    const drawer = screen.getByRole('dialog', { name: 'Claim CLM-24118' });
    expect(within(drawer).getByRole('heading', { name: 'Lifecycle' })).toBeInTheDocument();
    expect(within(drawer).getByRole('heading', { name: 'Event history' })).toBeInTheDocument();
    expect(within(drawer).getByText('Charges captured')).toBeInTheDocument();
  });

  it('closes the drawer on Escape and returns focus to the row it opened from', async () => {
    render(<ClaimsScreen />);

    const open = await screen.findByRole('button', { name: 'Open claim CLM-24118' });
    open.focus();
    fireEvent.click(open);
    expect(screen.getByRole('dialog', { name: 'Claim CLM-24118' })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('dialog', { name: 'Claim CLM-24118' })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(open);
  });

  it('translates a denial into plain language and rebills from the drawer', async () => {
    render(<ClaimsScreen />);

    await filterTo('Denied');
    fireEvent.click(screen.getByRole('button', { name: 'Open claim CLM-24061' }));

    const drawer = screen.getByRole('dialog', { name: 'Claim CLM-24061' });
    // Once in the denial panel, once in the event that carried it.
    expect(within(drawer).getAllByText(/missing the referring provider NPI/)).toHaveLength(2);

    fireEvent.click(within(drawer).getByRole('button', { name: 'Correct and rebill' }));
    expect(within(drawer).getByText(/The original stays on the record/)).toBeInTheDocument();

    fireEvent.click(within(drawer).getByRole('button', { name: 'Rebill claim' }));
    expect(await screen.findByText('CLM-24061 rebilled')).toBeInTheDocument();
  });

  it('descends the outline one level at a time inside the drawer', async () => {
    render(<ClaimsScreen />);

    await filterTo('Denied');
    fireEvent.click(screen.getByRole('button', { name: 'Open claim CLM-24061' }));
    const drawer = screen.getByRole('dialog', { name: 'Claim CLM-24061' });

    // The drawer owns the h2, so its cards belong at level 3 alongside the
    // hand-written sections they sit with. The shared Card defaults to level 2,
    // which would nest an h2 in an h2 and make the denial card outrank
    // Lifecycle, its equal.
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(within(drawer).getByRole('heading', { level: 2 })).toHaveTextContent('Claim CLM-24061');
    expect(within(drawer).getByRole('heading', { level: 3, name: 'CO-16' })).toBeInTheDocument();
    expect(
      within(drawer).getByRole('heading', { level: 3, name: 'Lifecycle' })
    ).toBeInTheDocument();
  });

  it('narrows the queue by claim number without refetching', async () => {
    render(<ClaimsScreen />);

    fireEvent.change(await screen.findByLabelText('Search claims'), {
      target: { value: 'CLM-24099' },
    });

    const table = screen.getByRole('table', { name: 'Claims' });
    expect(within(table).getByText('CLM-24099')).toBeInTheDocument();
    expect(within(table).queryByText('CLM-24118')).not.toBeInTheDocument();
  });

  it('names the state in its empty message rather than saying "no results"', async () => {
    render(<ClaimsScreen client={createBillingClient({ claims: [] })} />);

    await filterTo('Denied');
    expect(await screen.findByText('No denied claims')).toBeInTheDocument();
  });

  it('registers its verbs with the palette, which is the keyboard and agent contract', async () => {
    render(<ClaimsScreen />);

    fireEvent.click(await screen.findByRole('button', { name: /Search or run a command/ }));
    const palette = screen.getByRole('dialog', { name: 'Command palette' });

    expect(within(palette).getByText('Scrub selected claims')).toBeInTheDocument();
    expect(within(palette).getByText('Submit selected claims')).toBeInTheDocument();
    expect(within(palette).getByText('Show denied claims')).toBeInTheDocument();
  });

  it('runs a screen verb from the palette without a pointer', async () => {
    render(<ClaimsScreen />);

    fireEvent.click(await screen.findByRole('button', { name: /Search or run a command/ }));
    fireEvent.click(screen.getByText('Show denied claims'));

    const table = await screen.findByRole('table', { name: 'Claims' });
    expect(within(table).getByText('CLM-24061')).toBeInTheDocument();
    expect(within(table).queryByText('CLM-24118')).not.toBeInTheDocument();
  });

  it('says what happened and offers a retry when the read fails', async () => {
    render(<ClaimsScreen client={failing()} />);

    expect(await screen.findByText('No connection to the server')).toBeInTheDocument();
    expect(screen.getByText(/the claim queue did not load/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

/** Opens the palette the way a keyboard user does, and runs one verb by name. */
async function runCommand(label: string): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: /Search or run a command/ }));
  fireEvent.click(await screen.findByRole('option', { name: new RegExp(label) }));
}

describe('ClaimsScreen, bulk actions from the palette', () => {
  it('refuses a bulk action with nothing selected rather than acting on everything', async () => {
    render(<ClaimsScreen />);
    await screen.findByRole('table', { name: 'Claims' });

    await runCommand('Submit selected claims');

    expect(await screen.findByText('Nothing selected')).toBeInTheDocument();
    expect(screen.getByText('Select the claims to act on first.')).toBeInTheDocument();
  });

  it('selects every claim the scrubber has not blocked, and submits exactly those', async () => {
    render(<ClaimsScreen />);
    await filterTo('Captured');

    await runCommand('Select every claim in this view');
    // CLM-24119 has a scrub error, so it is not selectable and must not move.
    expect(screen.getByRole('checkbox', { name: 'Select claim CLM-24119' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Select claim CLM-24118' })).toBeChecked();

    await runCommand('Submit selected claims');

    expect(await screen.findByText(/claims? submitted/)).toBeInTheDocument();
    expect(screen.getByText('Moved to submitted.')).toBeInTheDocument();
  });

  it('unticks a claim that was ticked by mistake', async () => {
    render(<ClaimsScreen />);
    await filterTo('Captured');

    const box = screen.getByRole('checkbox', { name: 'Select claim CLM-24118' });
    fireEvent.click(box);
    expect(box).toBeChecked();

    fireEvent.click(box);
    expect(box).not.toBeChecked();

    await runCommand('Scrub selected claims');
    expect(await screen.findByText('Nothing selected')).toBeInTheDocument();
  });

  it('drops the selection when the state filter changes', async () => {
    render(<ClaimsScreen />);
    await filterTo('Captured');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select claim CLM-24118' }));

    // Selecting in one queue and then switching queues must not carry the
    // selection into a bulk action over claims nobody looked at.
    await runCommand('Show denied claims');
    await runCommand('Scrub selected claims');

    expect(await screen.findByText('Nothing selected')).toBeInTheDocument();
  });

  it('goes back to every claim from the All chip', async () => {
    render(<ClaimsScreen />);
    await filterTo('Denied');
    expect(
      within(screen.getByRole('table', { name: 'Claims' })).queryByText('CLM-24118')
    ).not.toBeInTheDocument();

    await filterTo('All');

    expect(
      within(await screen.findByRole('table', { name: 'Claims' })).getByText('CLM-24118')
    ).toBeInTheDocument();
  });
});
