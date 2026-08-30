import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { NewOrderScreen } from '@/app/(app)/orders/new/NewOrderScreen';
import { ApiError } from '@/lib/api/client';
import { createMockClient } from '@/lib/api/mock/client';
import { MOCK_NOW } from '@/lib/api/mock/fixtures';
import type { ApiClient } from '@/lib/api/types';

/**
 * The composer, driven the way a provider drives it: a favourite, a keystroke,
 * a review, a signature. The hard stop and the missing-diagnosis blocker are
 * asserted because they are the difference between a safe order and a fast one.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => '/orders/new',
}));

function failing(): ApiClient {
  return createMockClient({ failure: new ApiError('offline', { kind: 'network' }) });
}

async function renderComposer() {
  render(<NewOrderScreen client={createMockClient()} now={MOCK_NOW} />);
  // Wait for the composer, not for the heading: the shell renders "New order"
  // straight away, including over the loading state, so the h1 says nothing
  // about whether the patient list has arrived. The patient select does.
  await screen.findByLabelText('Ordering for');
  // Orders belong to one chart, so the first act is always choosing it. These
  // tests order for Testina Patientsson, whose problem list drives the ranking
  // and whose in-progress HbA1c raises the duplicate hard stop.
  choosePatient('Patientsson');
}

function choosePatient(family: string): void {
  const select = screen.getByLabelText('Ordering for') as HTMLSelectElement;
  const option = Array.from(select.options).find((candidate) => candidate.text.includes(family));
  if (!option) throw new Error(`No patient option for ${family}`);
  fireEvent.change(select, { target: { value: option.value } });
}

/** The favourites row, named so it is one thing rather than eight buttons. */
function favourite(name: RegExp): HTMLElement {
  return within(screen.getByRole('group', { name: 'Favourite orders' })).getByRole('button', {
    name,
  });
}

/** Strict indexing makes `[0]` optional; this asserts the match exists. */
function at<T>(items: T[], index = 0): T {
  const item = items[index];
  if (!item) throw new Error(`No element at index ${index}`);
  return item;
}

describe('NewOrderScreen', () => {
  it('offers favourites, ranked for the open patient', async () => {
    await renderComposer();

    expect(favourite(/Full blood count/)).toBeInTheDocument();
    expect(screen.getByLabelText('Search the order catalogue')).toBeInTheDocument();
  });

  it('places a favourite in one click, pre-filled with a diagnosis from the problem list', async () => {
    await renderComposer();

    fireEvent.click(favourite(/Lipid panel/));

    const drafts = await screen.findByRole('list', { name: 'Drafted orders' });
    expect(within(drafts).getByText('LAB-LIPID')).toBeInTheDocument();
    expect(within(drafts).getByLabelText('Diagnosis this order justifies')).toHaveValue('I10');
  });

  it('adds an order from the keyboard alone, without the caret leaving the field', async () => {
    await renderComposer();

    const search = screen.getByLabelText('Search the order catalogue');
    fireEvent.change(search, { target: { value: 'thyroid' } });
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    fireEvent.keyDown(search, { key: 'Enter' });

    const drafts = await screen.findByRole('list', { name: 'Drafted orders' });
    expect(within(drafts).getAllByText(/Thyroid/).length).toBeGreaterThan(0);
  });

  it('holds the signature until a critical duplicate is overridden with a reason', async () => {
    await renderComposer();

    fireEvent.click(favourite(/HbA1c/));

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('Critical')).toBeInTheDocument();
    expect(within(alert).getByText(/still in progress/)).toBeInTheDocument();

    fireEvent.click(at(screen.getAllByRole('button', { name: 'Sign 1 order' })));

    const blockers = await screen.findByRole('alert', { name: 'Before signing' });
    expect(within(blockers).getByText(/Choose an override reason/)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Override and keep this order' }));
    fireEvent.click(at(screen.getAllByRole('button', { name: 'Sign 1 order' })));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Signing transmits 1 order/)).toBeInTheDocument();
  });

  it('names the missing diagnosis rather than disabling the signature', async () => {
    await renderComposer();

    fireEvent.click(favourite(/Chest X-ray/));
    const drafts = await screen.findByRole('list', { name: 'Drafted orders' });
    expect(within(drafts).getByText('Needs a diagnosis')).toBeInTheDocument();

    fireEvent.click(at(screen.getAllByRole('button', { name: 'Sign 1 order' })));

    const blockers = await screen.findByRole('alert', { name: 'Before signing' });
    expect(within(blockers).getByText(/has no diagnosis linked/)).toBeInTheDocument();
  });

  it('takes a priority, a specimen and a diagnosis on the drafted order', async () => {
    await renderComposer();

    fireEvent.click(favourite(/Full blood count/));
    const drafts = await screen.findByRole('list', { name: 'Drafted orders' });

    fireEvent.change(within(drafts).getByLabelText('Priority'), { target: { value: 'URGENT' } });
    fireEvent.change(within(drafts).getByLabelText('Specimen'), {
      target: { value: 'Blood, serum' },
    });
    fireEvent.change(within(drafts).getByLabelText('Diagnosis this order justifies'), {
      target: { value: 'E11.9' },
    });

    expect(within(drafts).getByLabelText('Priority')).toHaveValue('URGENT');
    expect(within(drafts).getByLabelText('Specimen')).toHaveValue('Blood, serum');
    expect(within(drafts).queryByText('Needs a diagnosis')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Review and sign' }));
    const table = await screen.findByRole('table');
    expect(within(table).getByText('Urgent')).toBeInTheDocument();
    expect(within(table).getByText('E11.9')).toBeInTheDocument();
  });

  it('removes a drafted order it no longer wants', async () => {
    await renderComposer();

    fireEvent.click(favourite(/Lipid panel/));
    const drafts = await screen.findByRole('list', { name: 'Drafted orders' });
    fireEvent.click(within(drafts).getByRole('button', { name: 'Remove Lipid panel' }));

    expect(screen.queryByRole('list', { name: 'Drafted orders' })).not.toBeInTheDocument();
    expect(screen.getByText('Nothing drafted yet')).toBeInTheDocument();
  });

  it('signs a clean draft and says what happened', async () => {
    await renderComposer();

    fireEvent.click(favourite(/Lipid panel/));
    fireEvent.click(at(screen.getAllByRole('button', { name: 'Sign 1 order' })));

    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Sign and transmit' }));

    expect(await screen.findByText('1 order signed')).toBeInTheDocument();
    expect(screen.getByText(/Transmitted to Cedar Reference Lab/)).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Drafted orders' })).not.toBeInTheDocument();
  });

  it('pends a draft without a confirmation, because pending is reversible', async () => {
    await renderComposer();

    fireEvent.click(favourite(/Lipid panel/));
    fireEvent.click(at(screen.getAllByRole('button', { name: 'Pend orders' })));

    expect(await screen.findByText('1 order pended')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('clears the draft when the patient changes, and says why', async () => {
    await renderComposer();

    fireEvent.click(favourite(/Lipid panel/));
    await screen.findByRole('list', { name: 'Drafted orders' });

    choosePatient('Testperson');

    expect(await screen.findByText('Draft cleared')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Drafted orders' })).not.toBeInTheDocument();
  });

  it('says what happened and what to do when the patient list fails to load', async () => {
    render(<NewOrderScreen client={failing()} now={MOCK_NOW} />);

    expect(await screen.findByText('No connection to the server')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('offers one action when there is no patient to order for', async () => {
    render(<NewOrderScreen client={createMockClient({ patients: [] })} now={MOCK_NOW} />);

    expect(await screen.findByText('No patients to order for')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Go to patients' })).toHaveAttribute(
        'href',
        '/patients'
      )
    );
  });

  /**
   * The composer's shell used to be rendered by the loaded branch only, so
   * loading, empty and error each produced a page with no heading, no
   * navigation and nothing for the skip link to reach - a state a keyboard
   * could enter and not leave.
   */
  it.each([
    ['loading', () => createMockClient()],
    ['empty', () => createMockClient({ patients: [] })],
    ['error', failing],
  ])('keeps the shell around the %s state', async (state, makeClient) => {
    render(<NewOrderScreen client={makeClient()} now={MOCK_NOW} />);

    if (state !== 'loading') await screen.findByRole('navigation');

    expect(screen.getByRole('heading', { level: 1, name: 'New order' })).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByRole('navigation')).toBeInTheDocument();
  });
});

/** Opens the palette the way a keyboard user does, and runs one verb by name. */
async function runCommand(label: string | RegExp): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: /Search or run a command/ }));
  fireEvent.click(
    await screen.findByRole('option', {
      name: typeof label === 'string' ? new RegExp(label) : label,
    })
  );
}

describe('NewOrderScreen, driven from the command palette', () => {
  it('puts the caret in the catalogue search', async () => {
    await renderComposer();

    await runCommand('Search the order catalogue');

    expect(document.activeElement).toBe(screen.getByLabelText('Search the order catalogue'));
  });

  it('orders a favourite by name, without opening the catalogue at all', async () => {
    await renderComposer();

    await runCommand(/^Order Lipid panel/);

    const drafts = await screen.findByRole('list', { name: 'Drafted orders' });
    expect(within(drafts).getByText('LAB-LIPID')).toBeInTheDocument();
  });

  it('moves to review, and back to building from the review step', async () => {
    await renderComposer();
    fireEvent.click(favourite(/Lipid panel/));

    await runCommand('Review the draft orders');
    expect(await screen.findByRole('table', { name: /Orders drafted for/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Back to building' }));
    expect(await screen.findByRole('list', { name: 'Drafted orders' })).toBeInTheDocument();
  });

  it('pends and signs from the palette exactly as the buttons do', async () => {
    await renderComposer();
    fireEvent.click(favourite(/Lipid panel/));

    await runCommand('Pend the draft orders');
    expect(await screen.findByText('1 order pended')).toBeInTheDocument();

    fireEvent.click(favourite(/Lipid panel/));
    await runCommand('Sign the draft orders');
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Sign and transmit' }));

    expect(await screen.findByText('1 order signed')).toBeInTheDocument();
  });

  it('does nothing at all with an empty draft', async () => {
    await renderComposer();

    await runCommand('Pend the draft orders');
    expect(screen.queryByText(/pended/)).not.toBeInTheDocument();

    await runCommand('Sign the draft orders');
    // No confirmation for zero orders, and no move to a review of nothing.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('Nothing drafted yet')).toBeInTheDocument();
  });
});

describe('NewOrderScreen, the review step', () => {
  it('says the draft is empty rather than showing a table with no rows', async () => {
    await renderComposer();

    await runCommand('Review the draft orders');

    expect(
      await screen.findByText(
        'The draft is empty. Go back and add an order from the favourites or the catalogue.'
      )
    ).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: /Orders drafted for/ })).not.toBeInTheDocument();
  });

  it('names every reason the signature is held, and moves the caret to them', async () => {
    await renderComposer();
    fireEvent.click(favourite(/HbA1c/));
    // The duplicate hard stop is raised before the order is even drafted, so
    // draft something orderable alongside it.
    fireEvent.click(favourite(/Full blood count/));

    await runCommand('Sign the draft orders');

    const blockers = await screen.findByRole('alert', { name: 'Before signing' });
    expect(within(blockers).getByRole('heading', { name: 'Before signing' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('cancels the signature confirmation, leaving the draft intact', async () => {
    await renderComposer();
    fireEvent.click(favourite(/Lipid panel/));
    fireEvent.click(at(screen.getAllByRole('button', { name: 'Sign 1 order' })));

    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep editing' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('table', { name: /Orders drafted for/ })).toBeInTheDocument();
    expect(screen.queryByText(/order signed/)).not.toBeInTheDocument();
  });

  it('pends from the review step as well as from the page action', async () => {
    await renderComposer();
    fireEvent.click(favourite(/Lipid panel/));

    await runCommand('Review the draft orders');
    await screen.findByRole('table', { name: /Orders drafted for/ });
    // Two Pend controls exist: one in the page header, one at the foot of the
    // review step. The review step's is the one under the reviewed list.
    fireEvent.click(screen.getAllByRole('button', { name: 'Pend orders' }).at(-1)!);

    expect(await screen.findByText('1 order pended')).toBeInTheDocument();
  });

  it('says a drafted order still needs a diagnosis, in the review table', async () => {
    await renderComposer();
    fireEvent.click(favourite(/Full blood count/));

    await runCommand('Review the draft orders');

    const table = await screen.findByRole('table', { name: /Orders drafted for/ });
    expect(within(table).getByText('Needs a diagnosis')).toBeInTheDocument();
  });
});
