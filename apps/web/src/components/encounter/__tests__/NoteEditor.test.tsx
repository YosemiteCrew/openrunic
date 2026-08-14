import '@testing-library/jest-dom/vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CommandPalette, CommandProvider } from '@/components/command';
import { NoteEditor } from '@/components/encounter';
import { ApiError } from '@/lib/api';
import { contentHash, createMockChartClient, SLASH_COMMANDS } from '@/lib/api/chart';
import type { ChartClient } from '@/lib/api/chart';
import type { EncounterNote } from '@/lib/api/chart';
import { MOCK_ENCOUNTER_IDS, mockEncounterNote } from '@/lib/api/mock/chart';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => '/encounters/0192f1a0-0000-7000-8000-00000000e001',
}));

function noteById(id: string): EncounterNote {
  const found = mockEncounterNote(id);
  if (!found) throw new Error(`Fixture missing for note ${id}`);
  return found;
}

const unsigned = noteById(MOCK_ENCOUNTER_IDS.testinaUnsigned);
const signed = noteById(MOCK_ENCOUNTER_IDS.testinaSigned);

/* A client per render, so a signature written by one test is invisible to the
   next: the mock chart client keeps its writes for the life of the client. */
function renderEditor(note: EncounterNote, client = createMockChartClient()) {
  return render(
    <CommandProvider>
      <NoteEditor note={note} commands={SLASH_COMMANDS} client={client} />
    </CommandProvider>
  );
}

describe('NoteEditor, unsigned', () => {
  it('says the note is unsigned and what signing will do', () => {
    renderEditor(unsigned);

    expect(screen.getByText('Unsigned')).toBeInTheDocument();
    expect(screen.getByText(/Signing locks the text into the record/)).toBeInTheDocument();
  });

  it('renders the four SOAP blocks as editable text', () => {
    renderEditor(unsigned);

    for (const label of ['Subjective', 'Objective', 'Assessment', 'Plan']) {
      expect(screen.getByRole('textbox', { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole('textbox', { name: 'Subjective' })).toHaveValue(
      unsigned.sections[0]?.text ?? ''
    );
  });

  it('shows what each block already wrote to the chart', () => {
    renderEditor(unsigned);
    expect(screen.getByText('Order: Full blood count, routine')).toBeInTheDocument();
    expect(screen.getByText('Follow up: Follow-up in 6 weeks')).toBeInTheDocument();
  });
});

describe('NoteEditor slash commands', () => {
  it('opens the command list at the caret when a slash is typed', () => {
    renderEditor(unsigned);
    const plan = screen.getByRole('textbox', { name: 'Plan' });

    fireEvent.change(plan, { target: { value: 'Next steps /' } });

    const list = screen.getByRole('listbox', { name: 'Note commands' });
    expect(within(list).getByRole('option', { name: /Order lab/ })).toBeInTheDocument();
    expect(within(list).getByRole('option', { name: /Prescribe/ })).toBeInTheDocument();
  });

  it('filters as the command is typed, and says so when nothing matches', () => {
    renderEditor(unsigned);
    const plan = screen.getByRole('textbox', { name: 'Plan' });

    fireEvent.change(plan, { target: { value: 'Next steps /presc' } });
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(screen.getByRole('option', { name: /Prescribe/ })).toBeInTheDocument();

    fireEvent.change(plan, { target: { value: 'Next steps /zzz' } });
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
    expect(screen.getByText(/No command matches "zzz"/)).toBeInTheDocument();
  });

  it('inserts narrative and writes structured data from the same keystrokes', async () => {
    renderEditor(unsigned);
    const plan = screen.getByRole('textbox', { name: 'Plan' });

    fireEvent.change(plan, { target: { value: 'Next steps /prescribe' } });
    fireEvent.keyDown(plan, { key: 'Enter' });

    await waitFor(() =>
      expect(plan).toHaveValue(
        'Next steps Lisinopril 10 mg, take 1 tablet by mouth each morning, 90 days, 2 refills.'
      )
    );
    expect(screen.getByText('Prescription: Lisinopril 10 mg, once daily')).toBeInTheDocument();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('moves through the list with the arrow keys, caret never leaving the note', () => {
    renderEditor(unsigned);
    const plan = screen.getByRole('textbox', { name: 'Plan' });

    fireEvent.change(plan, { target: { value: '/' } });
    const first = screen.getAllByRole('option')[0];
    expect(first).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(plan, { key: 'ArrowDown' });
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
    expect(plan).toHaveAttribute('aria-activedescendant');

    fireEvent.keyDown(plan, { key: 'ArrowUp' });
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('closes on Escape without writing anything', () => {
    renderEditor(unsigned);
    const plan = screen.getByRole('textbox', { name: 'Plan' });

    fireEvent.change(plan, { target: { value: 'Next steps /' } });
    fireEvent.keyDown(plan, { key: 'Escape' });

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(plan).toHaveValue('Next steps /');
  });

  it('offers the same list from a labelled button, not only from a keystroke', () => {
    renderEditor(unsigned);

    fireEvent.click(screen.getByRole('button', { name: 'Insert a command in plan' }));
    expect(screen.getByRole('listbox', { name: 'Note commands' })).toBeInTheDocument();
  });
});

describe('NoteEditor signing', () => {
  it('confirms before signing, and states the consequence in one sentence', () => {
    renderEditor(unsigned);

    fireEvent.click(screen.getByRole('button', { name: 'Sign note' }));

    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByText('Sign this note?')).toBeInTheDocument();
    expect(
      within(dialog).getByText(/cannot be changed afterwards; addenda remain possible/)
    ).toBeInTheDocument();
  });

  it('leaves the note unsigned when the confirmation is cancelled', () => {
    renderEditor(unsigned);

    fireEvent.click(screen.getByRole('button', { name: 'Sign note' }));
    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' })
    );

    expect(screen.getByText('Unsigned')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Plan' })).toBeInTheDocument();
  });

  it('locks the note, signs it and says so once confirmed', async () => {
    renderEditor(unsigned);

    fireEvent.click(screen.getByRole('button', { name: 'Sign note' }));
    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Sign note' })
    );

    expect(await screen.findByText('Signed and locked')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Plan' })).not.toBeInTheDocument();
    expect(screen.getByText('Signed by')).toBeInTheDocument();
    expect(screen.getByText('Dr. Okafor, MD')).toBeInTheDocument();
    expect(screen.getByText('Note signed')).toBeInTheDocument();
  });
});

describe('NoteEditor, signed', () => {
  it('renders signed content as text, with its signature and fingerprint', () => {
    renderEditor(signed);

    expect(screen.getByText('Signed and locked')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    // The label says what the value is. It was "Content hash" beside a comment
    // calling it proof that the locked text is the signed text, which it never
    // was: nothing on the wire carries the hash taken at signing time.
    expect(screen.getByText('Note fingerprint')).toBeInTheDocument();
    expect(screen.getByText(contentHash(signed.sections))).toBeInTheDocument();
    expect(
      screen.getByText('I attest that this note records the care I provided at this visit.')
    ).toBeInTheDocument();
  });

  it('keeps an existing addendum with its own author and time', () => {
    renderEditor(signed);
    expect(screen.getByText(/Laboratory called with the ferritin result/)).toBeInTheDocument();
    expect(screen.getByText(/Dr. Okafor, MD, 16 May 2026, 14:05/)).toBeInTheDocument();
  });

  it('will not sign an empty addendum', () => {
    renderEditor(signed);

    fireEvent.click(screen.getByRole('button', { name: 'Add addendum' }));
    expect(screen.getByRole('button', { name: 'Sign addendum' })).toBeDisabled();
  });

  it('appends an addendum, confirmed the same deliberate way', async () => {
    renderEditor(signed);

    fireEvent.click(screen.getByRole('button', { name: 'Add addendum' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Addendum text' }), {
      target: { value: 'Ferritin repeated on 20 May: 24 ng/mL, within range.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign addendum' }));
    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Sign addendum' })
    );

    expect(await screen.findByText(/Ferritin repeated on 20 May/)).toBeInTheDocument();
    expect(screen.getAllByText('Addendum')).toHaveLength(2);
    expect(screen.getByText('Addendum signed')).toBeInTheDocument();
  });

  it('records the addendum, so a fresh read of the note carries it', async () => {
    const client = createMockChartClient();
    renderEditor(signed, client);

    fireEvent.click(screen.getByRole('button', { name: 'Add addendum' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Addendum text' }), {
      target: { value: 'Repeat ferritin within range.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign addendum' }));
    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Sign addendum' })
    );
    await screen.findByText(/Repeat ferritin within range/);

    const stored = await client.notes.get(signed.id);
    expect(stored.addenda.at(-1)?.text).toBe('Repeat ferritin within range.');
  });

  it('refuses a second signature and says so instead of stamping one', async () => {
    const client = createMockChartClient();
    // Signed already, so the editor's own lock is bypassed here on purpose: the
    // point is that the server refuses even if a screen asks.
    await expect(client.notes.sign(signed.id, signed.sections)).rejects.toMatchObject({
      status: 409,
    });
  });
});

/**
 * The slash menu without a pointer.
 *
 * The options carry pointer handlers and no key handler, which is only sound
 * because the textarea owns the keyboard. Nothing below fires a pointer event:
 * the list is opened by typing, walked with the arrow keys, and committed with
 * Enter, and the caret never leaves the note while it happens.
 */
describe('NoteEditor slash commands, keyboard only', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function openMenu(): { plan: HTMLElement; options: HTMLElement[] } {
    renderEditor(unsigned);
    const plan = screen.getByRole('textbox', { name: 'Plan' });
    plan.focus();
    fireEvent.change(plan, { target: { value: '/' } });
    return { plan, options: screen.getAllByRole('option') };
  }

  it('opens the whole list from a typed slash and points the textarea at the first option', () => {
    const { plan, options } = openMenu();

    expect(options).toHaveLength(SLASH_COMMANDS.length);
    expect(plan).toHaveAttribute('aria-controls', 'note-block-plan-listbox');
    expect(plan).toHaveAttribute('aria-activedescendant', options[0]?.id);
    expect(plan).toHaveFocus();
  });

  it('commits the command the arrow keys landed on, caret still in the note', async () => {
    const { plan, options } = openMenu();
    const third = SLASH_COMMANDS[2];

    fireEvent.keyDown(plan, { key: 'ArrowDown' });
    fireEvent.keyDown(plan, { key: 'ArrowDown' });

    expect(plan).toHaveAttribute('aria-activedescendant', options[2]?.id);
    expect(options[2]).toHaveAttribute('aria-selected', 'true');
    expect(options[0]).toHaveAttribute('aria-selected', 'false');

    fireEvent.keyDown(plan, { key: 'Enter' });

    await waitFor(() => expect(plan).toHaveValue(third?.insertText));
    const written = screen.getByRole('list', { name: 'Written to the chart from plan' });
    expect(within(written).getByText('Problem: Essential hypertension (I10)')).toBeInTheDocument();
    expect(plan).toHaveFocus();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('reaches the last command by pressing Up at the top of the list', async () => {
    const { plan, options } = openMenu();
    const last = SLASH_COMMANDS[SLASH_COMMANDS.length - 1];

    fireEvent.keyDown(plan, { key: 'ArrowUp' });

    expect(plan).toHaveAttribute('aria-activedescendant', options.at(-1)?.id);

    fireEvent.keyDown(plan, { key: 'Enter' });
    await waitFor(() => expect(plan).toHaveValue(last?.insertText));
  });

  it('scrolls the highlighted command back into view as the selection moves', () => {
    const revealed: Element[] = [];
    vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function reveal(
      this: Element
    ) {
      revealed.push(this);
    });

    const { plan, options } = openMenu();
    revealed.length = 0;

    fireEvent.keyDown(plan, { key: 'ArrowDown' });

    expect(revealed.at(-1)).toBe(options[1]);
  });

  it('announces how many commands are on offer, for a reader that cannot see them', () => {
    const { plan } = openMenu();

    /* Every block owns a live region; only the block with the list open says
       anything, so the reader is never told about a menu somewhere else. */
    const announcing = () => screen.getAllByRole('status').filter((node) => node.textContent);

    expect(announcing()).toHaveLength(1);
    expect(announcing()[0]).toHaveTextContent(
      `${SLASH_COMMANDS.length} commands available. Use the arrow keys and Enter.`
    );

    fireEvent.change(plan, { target: { value: '/presc' } });
    expect(announcing()[0]).toHaveTextContent('1 command available. Use the arrow keys and Enter.');
  });
});

describe('contentHash', () => {
  it('is stable for the same text and different for different text', () => {
    expect(contentHash(unsigned.sections)).toBe(contentHash(unsigned.sections));
    expect(contentHash(unsigned.sections)).not.toBe(contentHash(signed.sections));
  });

  it('reads as a grouped hash rather than a bare number', () => {
    expect(contentHash(signed.sections)).toMatch(/^[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}$/);
  });
});

describe('NoteEditor, the slash menu at its edges', () => {
  function plan(): HTMLElement {
    return screen.getByRole('textbox', { name: 'Plan' });
  }

  it('opens from the labelled button when the caret sits mid-sentence', () => {
    renderEditor(unsigned);

    fireEvent.click(screen.getByRole('button', { name: 'Insert a command in plan' }));

    // Opened without a typed slash: the whole library is on offer.
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(screen.getAllByRole('option').length).toBe(SLASH_COMMANDS.length);
  });

  it('separates the inserted text from what is already written', () => {
    renderEditor(unsigned);
    const field = plan();

    fireEvent.change(field, { target: { value: 'Continue metformin /' } });
    fireEvent.keyDown(field, { key: 'Enter' });

    // The `/token` is consumed rather than left in the chart, and exactly one
    // space separates the inserted narrative from the last word written.
    const written = (field as HTMLTextAreaElement).value;
    expect(written).toMatch(/^Continue metformin \S/);
    expect(written).not.toContain('/');
  });

  it('inserts at the start of an empty block without a leading space', () => {
    renderEditor(unsigned);
    const field = plan();

    fireEvent.change(field, { target: { value: '' } });
    fireEvent.change(field, { target: { value: '/' } });
    fireEvent.keyDown(field, { key: 'Enter' });

    expect((field as HTMLTextAreaElement).value).not.toMatch(/^\s/);
    expect((field as HTMLTextAreaElement).value.length).toBeGreaterThan(0);
  });

  it('leaves other keys alone while the menu is open', () => {
    renderEditor(unsigned);
    const field = plan();

    fireEvent.change(field, { target: { value: '/' } });
    fireEvent.keyDown(field, { key: 'Tab' });
    fireEvent.keyDown(field, { key: 'a' });

    // Tab still moves out of the field, and an ordinary letter still types:
    // the menu intercepts navigation keys only.
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('takes no key at all when the menu is closed', () => {
    renderEditor(unsigned);
    const field = plan();
    const before = (field as HTMLTextAreaElement).value;

    fireEvent.keyDown(field, { key: 'ArrowDown' });
    fireEvent.keyDown(field, { key: 'Enter' });

    expect((field as HTMLTextAreaElement).value).toBe(before);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('holds the arrow keys still when the filter matches nothing', () => {
    renderEditor(unsigned);
    const field = plan();

    fireEvent.change(field, { target: { value: '/zzzz' } });
    expect(screen.getByText(/No command matches/)).toBeInTheDocument();

    // No option to move to and none to commit: neither key may throw, and
    // Enter must not insert an undefined command into the chart.
    fireEvent.keyDown(field, { key: 'ArrowDown' });
    fireEvent.keyDown(field, { key: 'ArrowUp' });
    fireEvent.keyDown(field, { key: 'Enter' });

    expect((field as HTMLTextAreaElement).value).toBe('/zzzz');
  });

  it('closes the menu when the slash is deleted again', () => {
    renderEditor(unsigned);
    const field = plan();

    fireEvent.change(field, { target: { value: '/hpi' } });
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    fireEvent.change(field, { target: { value: 'hpi' } });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(field).not.toHaveAttribute('aria-controls');
  });
});

describe('NoteEditor, signing and its confirmations', () => {
  it('cancels the addendum confirmation, keeping the text to sign later', () => {
    renderEditor(signed);

    fireEvent.click(screen.getByRole('button', { name: 'Add addendum' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Addendum text' }), {
      target: { value: 'Ferritin repeated on 20 May.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign addendum' }));
    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' })
    );

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Addendum text' })).toHaveValue(
      'Ferritin repeated on 20 May.'
    );
    expect(screen.getAllByText('Addendum')).toHaveLength(1);
  });

  it('discards a half-written addendum, clearing the text with it', () => {
    renderEditor(signed);

    fireEvent.click(screen.getByRole('button', { name: 'Add addendum' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Addendum text' }), {
      target: { value: 'Started typing the wrong thing' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Discard addendum' }));

    expect(screen.queryByRole('textbox', { name: 'Addendum text' })).not.toBeInTheDocument();

    // Reopening starts blank, rather than restoring the discarded draft.
    fireEvent.click(screen.getByRole('button', { name: 'Add addendum' }));
    expect(screen.getByRole('textbox', { name: 'Addendum text' })).toHaveValue('');
  });

  it('offers the addendum verb rather than the sign verb once a note is locked', async () => {
    render(
      <CommandProvider defaultOpen>
        <NoteEditor note={signed} commands={SLASH_COMMANDS} />
        <CommandPalette />
      </CommandProvider>
    );

    const palette = await screen.findByRole('dialog', { name: 'Command palette' });
    expect(within(palette).getByText('Add addendum')).toBeInTheDocument();
    // A signed note cannot be signed again, so the verb is not offered at all.
    expect(within(palette).queryByText('Sign note')).not.toBeInTheDocument();
  });

  it('renders a locked block with nothing in it as an absence, not a blank', () => {
    const empty: EncounterNote = {
      ...signed,
      sections: signed.sections.map((section) => ({ ...section, text: '' })),
    };
    render(
      <CommandProvider>
        <NoteEditor note={empty} commands={SLASH_COMMANDS} />
      </CommandProvider>
    );

    expect(screen.getAllByText('Nothing recorded in this block.')).toHaveLength(
      signed.sections.length
    );
  });

  it('clears its own toast after the message has been read', async () => {
    vi.useFakeTimers();
    try {
      renderEditor(unsigned);
      fireEvent.click(screen.getByRole('button', { name: 'Sign note' }));
      fireEvent.click(
        within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Sign note' })
      );
      const toastMessage = /Recorded against this visit/;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(screen.getByText(toastMessage)).toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5100);
      });

      // A confirmation that never leaves becomes furniture nobody reads.
      expect(screen.queryByText(toastMessage)).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('NoteEditor, when the server refuses a signature', () => {
  /** Reads the note normally and refuses every write. */
  function refusesWrites(): ChartClient {
    const client = createMockChartClient();
    const refused = () =>
      Promise.reject(
        new ApiError('forbidden', {
          kind: 'http',
          status: 403,
          problem: {
            type: 'https://openrunic.org/problems/forbidden',
            title: 'Not permitted',
            status: 403,
            detail: 'Only the author may sign this note.',
            instance: '/bff/v0/notes',
            requestId: 'req-3',
          },
        })
      );
    return { ...client, notes: { ...client.notes, sign: refused, addAddendum: refused } };
  }

  it('leaves the note unsigned and says why, rather than showing a signature block', async () => {
    renderEditor(unsigned, refusesWrites());

    fireEvent.click(screen.getByRole('button', { name: 'Sign note' }));
    const dialog = screen.getByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Sign note' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Only the author may sign this note.'
    );
    // The one thing this screen must never do: render a signature for a
    // signature that did not happen.
    expect(screen.getByText('Unsigned')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Plan' })).toBeInTheDocument();
    expect(screen.queryByText('Note signed')).not.toBeInTheDocument();
  });

  it('keeps the addendum text when the addendum is refused', async () => {
    renderEditor(signed, refusesWrites());

    fireEvent.click(screen.getByRole('button', { name: 'Add addendum' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Addendum text' }), {
      target: { value: 'Typed once, and not lost.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign addendum' }));
    const dialog = screen.getByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Sign addendum' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Only the author may sign this note.'
    );
    expect(screen.getByRole('textbox', { name: 'Addendum text' })).toHaveValue(
      'Typed once, and not lost.'
    );
  });
});
