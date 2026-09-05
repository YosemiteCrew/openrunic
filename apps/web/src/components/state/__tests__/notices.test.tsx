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

/** The word each tone is spelt with in the language these cases render in. */
const IN_SPANISH = {
  info: 'Información',
  caution: 'Precaución',
  danger: 'Error',
  success: 'Correcto',
} as const;

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

  /**
   * A call site that names no tone gets the word for the tone it actually
   * renders, whichever that is.
   *
   * The wrapper writes `props.tone ?? 'info'` and `Alert.tsx` separately
   * declares `tone = 'info'`. Nothing pins those to each other, and the first
   * version of this test asserted the word for `info` on the strength of a
   * comment saying so - an assertion about a value in another package that it
   * did not check. Move the component's default to `caution` and update the
   * design system's own test with it, which is what anyone would do in one
   * commit, and both suites are green while a bare notice renders the caution
   * icon and caution styling and announces "Información". The word contradicts
   * the colour, which is the one thing the tone word exists to prevent.
   *
   * So the assertion is on the PAIR, read off the element that was rendered
   * rather than from either constant. Raised in review.
   */
  it('says the word for the tone it actually rendered when none is named', () => {
    const { container } = render(<Alert title="Registro actualizado" />);
    const notice = container.querySelector('.or-alert');
    const rendered = [...(notice?.classList ?? [])]
      .map((name) => /^or-alert--(?<tone>\w+)$/u.exec(name)?.groups?.['tone'])
      .find((tone) => tone !== undefined);

    expect(rendered, 'the notice rendered no tone class at all').toBeDefined();
    expect(container.querySelector('.or-alert__tone')).toHaveTextContent(
      IN_SPANISH[rendered as keyof typeof IN_SPANISH]
    );
  });

  it('still says the dismiss label, which arrived by the same route first', () => {
    render(<Alert title="Registro actualizado" onClose={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Descartar' })).toBeInTheDocument();
  });
});
