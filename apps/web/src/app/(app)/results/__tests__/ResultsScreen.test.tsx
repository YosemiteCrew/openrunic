import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ResultsScreen } from '@/app/(app)/results/ResultsScreen';
import { ApiError } from '@/lib/api/client';
import { MOCK_NOW, MOCK_RESULTS } from '@/lib/api/mock/fixtures';
import { createWorklistClient } from '@/lib/api/worklist';
import type { WorklistClient } from '@/lib/api/worklist';

/**
 * The sign-off queue, driven the way a provider drives it between patients:
 * abnormal first, read the values against their ranges, sign, move on. The
 * batch action and the critical exclusion are asserted because that exclusion
 * is the safety property of the screen.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => '/results',
}));

function failing(): WorklistClient {
  const fail = () => Promise.reject(new ApiError('offline', { kind: 'network' }));
  return { orders: { list: fail }, results: { list: fail }, inbox: { list: fail } };
}

function queue(): HTMLElement {
  return screen.getByRole('list', { name: 'Results to review' });
}

/** Strict indexing makes `[0]` optional; this asserts the match exists. */
function at<T>(items: T[], index = 0): T {
  const item = items[index];
  if (!item) throw new Error(`No element at index ${index}`);
  return item;
}

describe('ResultsScreen', () => {
  it('puts the critical value at the top of the queue and names why', async () => {
    render(<ResultsScreen client={createWorklistClient()} now={MOCK_NOW} />);

    const rows = within(
      await screen.findByRole('list', { name: 'Results to review' })
    ).getAllByRole('listitem');
    expect(at(rows)).toHaveTextContent('Testperson, Exampla');
    expect(at(rows)).toHaveTextContent('Critical value');
    expect(at(rows)).toHaveTextContent(/Potassium 6.2 mmol\/L, above range/);
  });

  it('reads every value against its reference range, in words', async () => {
    render(<ResultsScreen client={createWorklistClient()} now={MOCK_NOW} />);
    await screen.findByRole('list', { name: 'Results to review' });

    const table = screen.getByRole('table');
    expect(within(table).getByText('6.2 mmol/L')).toBeInTheDocument();
    expect(within(table).getByText('3.5 to 5.1 mmol/L')).toBeInTheDocument();
    expect(within(table).getAllByText('Above range').length).toBeGreaterThan(0);
    expect(within(table).getAllByText('In range').length).toBeGreaterThan(0);
    // Cumulative context: one value is a number, three are a direction.
    expect(within(table).getByText(/5.4 on 14 Jun/)).toBeInTheDocument();
  });

  it('moves through the queue with the arrow keys', async () => {
    render(<ResultsScreen client={createWorklistClient()} now={MOCK_NOW} />);
    await screen.findByRole('list', { name: 'Results to review' });

    const openers = within(queue()).getAllByRole('button', { name: /Reported/ });
    at(openers).focus();

    // Fired on the focused row, which is where a real keystroke originates
    // before it bubbles up the queue.
    fireEvent.keyDown(at(openers), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(at(openers, 1));

    fireEvent.keyDown(at(openers, 1), { key: 'Home' });
    expect(document.activeElement).toBe(at(openers));
  });

  it('signs one result behind a confirmation that states the consequence', async () => {
    render(<ResultsScreen client={createWorklistClient()} now={MOCK_NOW} />);
    await screen.findByRole('list', { name: 'Results to review' });

    fireEvent.click(at(screen.getAllByRole('button', { name: /^Sign$/ })));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/releases it to the portal/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Sign result' }));

    expect(await screen.findByText('Comprehensive metabolic panel signed')).toBeInTheDocument();
  });

  it('attaches a note when signing with one', async () => {
    render(<ResultsScreen client={createWorklistClient()} now={MOCK_NOW} />);
    await screen.findByRole('list', { name: 'Results to review' });

    fireEvent.click(screen.getByRole('button', { name: 'Sign with note' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Note for the record'), {
      target: { value: 'Repeat potassium today and call the patient.' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Sign with note' }));

    expect(
      await screen.findByText('Repeat potassium today and call the patient.')
    ).toBeInTheDocument();
  });

  it('never batches a critical value, and says so', async () => {
    render(<ResultsScreen client={createWorklistClient()} now={MOCK_NOW} />);
    await screen.findByRole('list', { name: 'Results to review' });

    fireEvent.click(screen.getByRole('button', { name: /Sign 2 in-range results/ }));

    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText(/Critical and out-of-range results are not included/)
    ).toBeInTheDocument();
    expect(within(dialog).queryByText('Comprehensive metabolic panel')).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Sign 2 results' }));
    expect(await screen.findByText('2 in-range results signed')).toBeInTheDocument();
  });

  it('switches between my queue and the team pool', async () => {
    render(<ResultsScreen client={createWorklistClient()} now={MOCK_NOW} />);
    await screen.findByRole('list', { name: 'Results to review' });

    fireEvent.change(screen.getByLabelText('Assignment'), { target: { value: 'TEAM' } });

    const rows = within(
      await screen.findByRole('list', { name: 'Results to review' })
    ).getAllByRole('listitem');
    expect(rows).toHaveLength(MOCK_RESULTS.filter((report) => report.assignedTo === 'TEAM').length);
  });

  it('says the queue is clear rather than showing a blank region', async () => {
    render(<ResultsScreen client={createWorklistClient({ results: [] })} now={MOCK_NOW} />);

    expect(await screen.findByText('All results reviewed')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to the inbox' })).toHaveAttribute('href', '/inbox');
  });

  it('says what happened and what to do when the queue fails to load', async () => {
    render(<ResultsScreen client={failing()} now={MOCK_NOW} />);

    expect(await screen.findByText('No connection to the server')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
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

describe('ResultsScreen, driven from the command palette', () => {
  it('signs the result the reading pane is showing, not the first in the list', async () => {
    render(<ResultsScreen client={createWorklistClient()} now={MOCK_NOW} />);
    await screen.findByRole('list', { name: 'Results to review' });

    // The queue is abnormal-first, so the first row is the critical potassium.
    // Open the second one, so "the open result" and "the first result" differ.
    const openers = within(queue()).getAllByRole('button', { name: /Reported/ });
    fireEvent.click(at(openers, 1));

    await runCommand(/Sign the open result(?! with)/);
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText(/Signing Full blood count with differential for Fictitia Notreal/)
    ).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Sign result' }));

    expect(
      await screen.findByText('Full blood count with differential signed')
    ).toBeInTheDocument();
    // The critical result at the top of the queue is untouched.
    expect(
      within(queue()).getByRole('button', { name: 'Sign Comprehensive metabolic panel' })
    ).toBeInTheDocument();
  });

  it('opens the note dialog for the open result and can be abandoned', async () => {
    render(<ResultsScreen client={createWorklistClient()} now={MOCK_NOW} />);
    await screen.findByRole('list', { name: 'Results to review' });

    await runCommand('Sign the open result with a note');
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('opens the batch dialog, which can be cancelled without signing anything', async () => {
    render(<ResultsScreen client={createWorklistClient()} now={MOCK_NOW} />);
    await screen.findByRole('list', { name: 'Results to review' });

    await runCommand('Sign every in-range result');
    const dialog = await screen.findByRole('dialog', { name: 'Sign every in-range result' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // Still offered, so nothing left the queue behind the cancel.
    expect(screen.getByRole('button', { name: /Sign 2 in-range results/ })).toBeInTheDocument();
  });

  it('switches queues without a mouse, and back again', async () => {
    render(<ResultsScreen client={createWorklistClient()} now={MOCK_NOW} />);
    await screen.findByRole('list', { name: 'Results to review' });

    await runCommand('Show the team pool');
    expect(await screen.findByLabelText('Assignment')).toHaveValue('TEAM');

    await runCommand('Show my results');
    expect(await screen.findByLabelText('Assignment')).toHaveValue('ME');
  });

  it('does nothing at all when there is no result to sign', async () => {
    render(<ResultsScreen client={createWorklistClient({ results: [] })} now={MOCK_NOW} />);
    await screen.findByText('All results reviewed');

    await runCommand(/Sign the open result(?! with)/);

    // No dialog and no signature: an empty queue has nothing to act on, and the
    // verb must fail closed rather than throw or sign a stale selection.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('All results reviewed')).toBeInTheDocument();
  });
});

describe('ResultsScreen, signing from the queue row', () => {
  it('signs the row the button belongs to, and the row then says Signed', async () => {
    render(<ResultsScreen client={createWorklistClient()} now={MOCK_NOW} />);
    await screen.findByRole('list', { name: 'Results to review' });

    const rowSign = within(queue()).getByRole('button', { name: 'Sign Lipid panel' });
    fireEvent.click(rowSign);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Signing Lipid panel/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Sign result' }));

    expect(await screen.findByText('Lipid panel signed')).toBeInTheDocument();
    expect(
      within(queue()).queryByRole('button', { name: 'Sign Lipid panel' })
    ).not.toBeInTheDocument();
  });

  it('backs out of a signature from the dialog footer, leaving the row unsigned', async () => {
    render(<ResultsScreen client={createWorklistClient()} now={MOCK_NOW} />);
    await screen.findByRole('list', { name: 'Results to review' });

    fireEvent.click(within(queue()).getByRole('button', { name: 'Sign Lipid panel' }));
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' })
    );

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(within(queue()).getByRole('button', { name: 'Sign Lipid panel' })).toBeInTheDocument();
  });

  it('dismisses the confirmation without un-signing what it confirmed', async () => {
    render(<ResultsScreen client={createWorklistClient()} now={MOCK_NOW} />);
    await screen.findByRole('list', { name: 'Results to review' });

    fireEvent.click(within(queue()).getByRole('button', { name: 'Sign Lipid panel' }));
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Sign result' })
    );
    const toast = await screen.findByRole('status');

    fireEvent.click(within(toast).getByRole('button', { name: 'Dismiss' }));

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(
      within(queue()).queryByRole('button', { name: 'Sign Lipid panel' })
    ).not.toBeInTheDocument();
  });

  it('offers no batch once nothing is left in range, and the button does nothing', async () => {
    render(<ResultsScreen client={createWorklistClient()} now={MOCK_NOW} />);
    await screen.findByRole('list', { name: 'Results to review' });

    fireEvent.click(screen.getByRole('button', { name: /Sign 2 in-range results/ }));
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Sign 2 results' })
    );
    await screen.findByText('2 in-range results signed');

    const batch = screen.getByRole('button', { name: 'No in-range results to batch' });
    fireEvent.click(batch);

    // The label is the honest one, and pressing it opens no dialog offering to
    // sign zero results.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('stamps the signature with the clinic clock when no fixed now is passed', async () => {
    render(<ResultsScreen client={createWorklistClient()} />);
    await screen.findByRole('list', { name: 'Results to review' });

    fireEvent.click(within(queue()).getByRole('button', { name: 'Sign Lipid panel' }));
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Sign result' })
    );

    await screen.findByText('Lipid panel signed');
    // The default is the fixtures' fixed instant, so a screenshot taken twice
    // says the same thing.
    expect(screen.getAllByText(/Signed 12 Aug/).length).toBeGreaterThan(0);
  });
});

describe('ResultsScreen, what a queue row says it is', () => {
  /** One report, shaped for the headline case under test. */
  function reportWith(overrides: Partial<(typeof MOCK_RESULTS)[number]>) {
    return { ...MOCK_RESULTS[0]!, id: 'probe-1', ...overrides };
  }

  it('names the out-of-range value that earned the flag', async () => {
    render(<ResultsScreen client={createWorklistClient()} now={MOCK_NOW} />);

    const rows = within(
      await screen.findByRole('list', { name: 'Results to review' })
    ).getAllByRole('listitem');
    expect(at(rows)).toHaveTextContent(/Potassium 6.2 mmol\/L, above range/);
  });

  it('counts the analytes instead when every one of them is in range', async () => {
    const inRange = reportWith({
      flag: 'NORMAL',
      // Every value sitting squarely inside its own range: there is no single
      // reading worth leading with, so the row counts them instead.
      analytes: MOCK_RESULTS[0]!.analytes.map((analyte) => ({
        ...analyte,
        low: 1,
        high: 10,
        value: 5,
      })),
    });
    render(<ResultsScreen client={createWorklistClient({ results: [inRange] })} now={MOCK_NOW} />);

    const rows = within(
      await screen.findByRole('list', { name: 'Results to review' })
    ).getAllByRole('listitem');
    expect(at(rows)).toHaveTextContent(`${inRange.analytes.length} analytes, all in range`);
  });

  it('falls back to the narrative for a report with no analytes at all', async () => {
    const imaging = reportWith({
      flag: 'NORMAL',
      analytes: [],
      narrative: 'No acute cardiopulmonary process.',
    });
    render(<ResultsScreen client={createWorklistClient({ results: [imaging] })} now={MOCK_NOW} />);

    const rows = within(
      await screen.findByRole('list', { name: 'Results to review' })
    ).getAllByRole('listitem');
    expect(at(rows)).toHaveTextContent('No acute cardiopulmonary process.');
  });

  it('says a report is attached when there is neither a value nor a narrative', async () => {
    const bare = reportWith({ flag: 'NORMAL', analytes: [], narrative: null });
    render(<ResultsScreen client={createWorklistClient({ results: [bare] })} now={MOCK_NOW} />);

    const rows = within(
      await screen.findByRole('list', { name: 'Results to review' })
    ).getAllByRole('listitem');
    expect(at(rows)).toHaveTextContent('Report attached');
    // Nothing to tabulate, so no empty table is rendered beside it.
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('marks a report already signed on the server as signed, with no action', async () => {
    const alreadySigned = reportWith({ status: 'SIGNED', flag: 'NORMAL' });
    render(
      <ResultsScreen client={createWorklistClient({ results: [alreadySigned] })} now={MOCK_NOW} />
    );

    const queue = await screen.findByRole('list', { name: 'Results to review' });
    expect(within(queue).getByText('Signed')).toBeInTheDocument();
    expect(within(queue).queryByRole('button', { name: /^Sign / })).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'No in-range results to batch' })
    ).toBeInTheDocument();
  });
});

describe('ResultsScreen, the everyone queue', () => {
  it('drops the assignment filter entirely rather than sending an empty one', async () => {
    render(<ResultsScreen client={createWorklistClient()} now={MOCK_NOW} />);
    await screen.findByRole('list', { name: 'Results to review' });

    fireEvent.change(screen.getByLabelText('Assignment'), { target: { value: '' } });

    // "Everyone" is the absence of a filter, not the string "": every report in
    // the practice is in the queue, mine and the team's alike.
    const rows = within(
      await screen.findByRole('list', { name: 'Results to review' })
    ).getAllByRole('listitem');
    expect(rows).toHaveLength(MOCK_RESULTS.length);
  });
});
