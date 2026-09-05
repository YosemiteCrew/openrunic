import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Alert, Toast } from '@/components/state/Notices';

/**
 * This file replaces the global translator double, and the reason is the file's
 * whole subject.
 *
 * `vitest.setup.ts` gives every component an `en` translator and says plainly
 * that a nested `MessagesProvider` cannot change it - the double replaces the
 * hook, not the context, so a test that rendered its own provider would look
 * like it asked for Spanish and get English. It also says to pass a translator
 * to the thing under test instead. Neither route is open here: `Notices` takes
 * no translator, it calls the hook, and the thing being asserted is exactly
 * which language comes out.
 *
 * So the double is replaced for this file only, with the same one-translator
 * shape the setup file explains, and every expected string below differs
 * between the two languages - `Error` is deliberately not among them, because
 * it is spelt the same either way and an assertion on it would pass against the
 * design system's English default.
 */
vi.mock('@/lib/i18n/messages', async () => {
  const actual = await vi.importActual<typeof import('@/lib/i18n/messages')>('@/lib/i18n/messages');
  const { appCatalogue, createTranslator } = await import('@openrunic/i18n');
  const translator = createTranslator(appCatalogue, 'es');
  return { ...actual, useTranslator: () => translator };
});

describe('the notices this application raises speak the reader language', () => {
  it.each([
    ['info', 'Información'],
    ['caution', 'Precaución'],
    ['success', 'Correcto'],
  ] as const)('says the %s tone on an Alert', (tone, expected) => {
    const { container } = render(<Alert tone={tone} title="Registro actualizado" />);
    expect(container.querySelector('.or-alert__tone')).toHaveTextContent(expected);
  });

  it.each([
    ['info', 'Información'],
    ['success', 'Correcto'],
  ] as const)('says the %s tone on a Toast', (tone, expected) => {
    const { container } = render(<Toast tone={tone} title="Registro actualizado" />);
    expect(container.querySelector('.or-toast__tone')).toHaveTextContent(expected);
  });

  /* `info` is the component's default tone, so a wrapper that read `props.tone`
     without one would hand it `undefined` and fall back to English. */
  it('says the info tone when the call site names none', () => {
    const { container } = render(<Alert title="Registro actualizado" />);
    expect(container.querySelector('.or-alert__tone')).toHaveTextContent('Información');
  });

  it('still says the dismiss label, which arrived by the same route first', () => {
    render(<Alert title="Registro actualizado" onClose={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Descartar' })).toBeInTheDocument();
  });
});
