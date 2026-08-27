import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { BookingModal } from '@/components/schedule/BookingModal';
import type { ScheduleProvider } from '@/components/schedule/ScheduleGrid';
import type { OpenSlot } from '@/components/schedule/schedule';
import { MOCK_PATIENTS } from '@/lib/api';

/**
 * Booking into a chosen slot.
 *
 * The modal had no test of its own. `ScheduleScreen.test.tsx` already drives it
 * through the screen and covers the two states that matter most - the button
 * while the slot is held, and a refusal keeping the dialog open - so those are
 * re-asserted here at unit level rather than claimed as new.
 *
 * What was genuinely unreached is where the 61% branch and 72% function
 * coverage sat: both selects, which each default to the first option so
 * pressing the button proves nothing about them; a patient list with nothing in
 * it; and a slot whose provider has left the list.
 */

const SLOT: OpenSlot = {
  providerId: 'provider-1',
  start: '2026-09-03T09:30:00.000Z',
  end: '2026-09-03T09:50:00.000Z',
};

const PROVIDERS: readonly ScheduleProvider[] = [
  { id: 'provider-1', name: 'Dr. Okafor', role: 'Endocrinology' },
];

function renderModal(overrides: Partial<Parameters<typeof BookingModal>[0]> = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <BookingModal
      slot={SLOT}
      providers={PROVIDERS}
      patients={MOCK_PATIENTS}
      onCancel={onCancel}
      onConfirm={onConfirm}
      {...overrides}
    />
  );
  return { onConfirm, onCancel };
}

describe('BookingModal', () => {
  it('names the patient on the button, so it says what it is about to do', () => {
    renderModal();

    const first = MOCK_PATIENTS[0];
    expect(first).toBeDefined();
    /* The whole given name. `PatientName.given` is a string, so indexing it
       takes one character and a button reading "Book Q" would satisfy this. */
    expect(
      screen.getByRole('button', { name: `Book ${first?.name.given ?? ''}` })
    ).toBeInTheDocument();
  });

  it('says it is working while the server has the request, and refuses a second press', () => {
    /*
     * The state a clerk double-clicks through. The label has to change and both
     * buttons have to refuse, or a slow network books the slot twice.
     */
    renderModal({ pending: true });

    const book = screen.getByRole('button', { name: 'Booking...' });
    expect(book).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });

  it('falls back to the plain title when no patient can be chosen', () => {
    /*
     * An empty patient list leaves `patientId` at '' and `patient` undefined.
     * The button must still say something, and must not offer to book nobody.
     */
    renderModal({ patients: [] });

    const book = screen.getByRole('button', { name: 'Book appointment' });
    expect(book).toBeDisabled();
  });

  it('renders a refusal in place, above the fields, as an alert', () => {
    /*
     * In place rather than as a toast: the clerk is mid-dialog with the fields
     * still filled, and a message that floats away takes the reason with it.
     */
    renderModal({ error: 'That slot was taken while you were booking.' });

    const dialog = screen.getByRole('dialog');
    const alert = within(dialog).getByRole('alert');
    expect(alert).toHaveTextContent('That slot was taken while you were booking.');

    /* Inside the dialog and above the fields, not merely somewhere on the page.
       An unscoped query passes on a toast, which is the thing this rules out. */
    const patientField = within(dialog).getByLabelText(/Patient/u);
    expect(alert.compareDocumentPosition(patientField)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('books what was chosen, carrying the visit type code as well as its display', () => {
    /*
     * Both travel: the code is what the appointment records and the display is
     * what the grid shows. Renaming a catalogue entry later must not rewrite
     * what a past visit was booked as.
     */
    const { onConfirm } = renderModal();

    fireEvent.change(screen.getByLabelText(/Reason/u), {
      target: { value: 'Persistent cough' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Book /u }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    const details = onConfirm.mock.calls[0]?.[0] as {
      slot: OpenSlot;
      reason: string;
      visitType: string;
      visitTypeCode: string;
    };
    expect(details.slot).toEqual(SLOT);
    expect(details.reason).toBe('Persistent cough');
    /* The exact pair. `not.toBe('')` passes on the code echoed into the display
       or on a stale label, and `ScheduleScreen` forwards this value straight
       through as `typeDisplay`. */
    expect(details.visitTypeCode).toBe('FOLLOWUP');
    expect(details.visitType).toBe('Follow-up');
  });

  it('books the patient and visit type the clerk changed to, not the defaults', () => {
    /*
     * Both selects default to the first option, so a test that only presses the
     * button proves nothing about them. Changing each one is what shows the
     * dialog carries a second patient and a second visit type rather than
     * silently booking whoever was at the top of the list.
     */
    const { onConfirm } = renderModal();

    const second = MOCK_PATIENTS[1];
    expect(second).toBeDefined();

    fireEvent.change(screen.getByLabelText(/Patient/u), { target: { value: second?.id } });

    const visitType = screen.getByLabelText(/Visit type/u) as HTMLSelectElement;
    const otherCode = [...visitType.options]
      .map((option) => option.value)
      .find((value) => value !== visitType.value);
    expect(otherCode).toBeDefined();
    fireEvent.change(visitType, { target: { value: otherCode } });

    fireEvent.click(screen.getByRole('button', { name: /^Book /u }));

    const details = onConfirm.mock.calls[0]?.[0] as { patientId: string; visitTypeCode: string };
    expect(details.patientId).toBe(second?.id);
    expect(details.visitTypeCode).toBe(otherCode);
  });

  it('still names the slot when the provider is not in the list', () => {
    /*
     * A slot can outlive the provider list it was found against - a rota edited
     * in another tab, or a provider filtered out. The dialog has to keep
     * describing the time rather than rendering an empty provider, because the
     * clerk is about to commit a patient to that slot.
     */
    const named = render(
      <BookingModal
        slot={SLOT}
        providers={PROVIDERS}
        patients={MOCK_PATIENTS}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />
    );
    const times = (screen.getByRole('dialog').textContent ?? '').match(/\d{1,2}:\d{2}/gu) ?? [];
    expect(times.length).toBeGreaterThanOrEqual(2);
    named.unmount();

    renderModal({ slot: { ...SLOT, providerId: 'provider-gone' } });

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Unassigned');
    /* The times are the point of this case. Dropping them while still rendering
       "Unassigned" would satisfy a check for the fallback alone. */
    for (const time of times) expect(dialog).toHaveTextContent(time);
    expect(screen.getByRole('button', { name: /^Book /u })).toBeEnabled();
  });

  it('closes without booking when the clerk backs out', () => {
    const { onCancel, onConfirm } = renderModal();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
