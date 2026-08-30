/**
 * The answer a yes/no question stores does not follow the reader's language.
 *
 * This is its own file because it needs a Spanish translator, and
 * `vitest.setup.ts` replaces `useTranslator` with an English one for every
 * other file. A `vi.mock` here takes precedence over that one, which is the
 * only way a component under test can be rendered in another language: the
 * setup file replaces the hook rather than the context, so wrapping the screen
 * in a `MessagesProvider` would set a value nothing reads.
 */

import { appCatalogue, createTranslator } from '@openrunic/i18n';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { FormsScreen } from '@/app/forms/FormsScreen';
import { stubApi } from '@/__tests__/support';

vi.mock('@/lib/i18n/messages', async () => {
  const actual = await vi.importActual<typeof import('@/lib/i18n/messages')>('@/lib/i18n/messages');
  const translator = createTranslator(appCatalogue, 'es');
  return { ...actual, useTranslator: () => translator };
});

describe('a questionnaire answered in Spanish', () => {
  it('shows the choice in Spanish and stores the answer the practice reads', async () => {
    /*
     * The failure this rules out: translating the two choices along with their
     * labels. The stored value is what goes back to the practice, so a patient
     * reading Spanish would save `Sí` and one reading English `Yes`, and the
     * same question would come back holding two different values depending on
     * which language it happened to be answered in. Nothing on either screen
     * would look wrong.
     */
    const api = stubApi();
    const saveSpy = vi.spyOn(api, 'saveForm');

    render(<FormsScreen api={api} />);
    await screen.findByRole('heading', { level: 2, name: 'Contact details check' });
    await userEvent.click(screen.getByRole('button', { name: 'Abrir el formulario' }));

    const yes = screen.getByRole('radio', { name: 'Sí' });
    expect(screen.queryByRole('radio', { name: 'Yes' })).not.toBeInTheDocument();

    await userEvent.click(yes);
    await userEvent.click(screen.getByRole('button', { name: 'Guardar y terminar más tarde' }));

    await waitFor(() =>
      expect(saveSpy).toHaveBeenCalledWith('form-2', expect.objectContaining({ 'q-4': 'Yes' }))
    );
  });

  it('shows a questions own choices as the questionnaire worded them', async () => {
    /*
     * Only the yes/no pair is the interface's to word. Everything else arrives
     * from the questionnaire, already written by whoever composed it, and a
     * Spanish reader sees those exactly as an English one does.
     */
    render(<FormsScreen api={stubApi()} />);
    await screen.findByRole('heading', { level: 2, name: 'Before your thyroid review' });
    await userEvent.click(screen.getByRole('button', { name: 'Continuar el formulario' }));

    expect(screen.getByRole('radio', { name: 'Most days' })).toBeInTheDocument();
  });
});
