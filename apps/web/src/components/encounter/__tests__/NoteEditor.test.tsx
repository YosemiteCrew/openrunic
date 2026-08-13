import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CommandProvider } from '@/components/command';
import { contentHash, NoteEditor } from '@/components/encounter';
import { SLASH_COMMANDS } from '@/lib/api/chart';
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

function renderEditor(note: EncounterNote) {
  return render(
    <CommandProvider>
      <NoteEditor note={note} commands={SLASH_COMMANDS} />
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
  it('renders signed content as text, with its signature and hash', () => {
    renderEditor(signed);

    expect(screen.getByText('Signed and locked')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByText('9f2c-41ab-77de')).toBeInTheDocument();
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
