/**
 * The provider and the hook, tested against the real module.
 *
 * `vitest.setup.ts` replaces `useTranslator` for every other test file, so that
 * a screen can be rendered the way the application renders it without each test
 * building a provider. That stub is exactly why this file exists: with it in
 * place, nothing anywhere exercises the real hook, and the guarantee it is
 * supposed to make - that rendering outside the provider is loud rather than
 * silently English - would be untested.
 *
 * `vi.unmock` is not enough on its own, because the setup file's factory is
 * registered before this module is imported. Importing through
 * `vi.importActual` is what reaches past it.
 */

import { appCatalogue, createTranslator } from '@openrunic/i18n';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const { MessagesProvider, useTranslator } =
  await vi.importActual<typeof import('../messages')>('../messages');

function Greeting() {
  const t = useTranslator();
  return <p>{t('portal.home.title')}</p>;
}

describe('MessagesProvider', () => {
  it('gives the components below it a translator for the locale it was handed', () => {
    render(
      <MessagesProvider locale="es">
        <Greeting />
      </MessagesProvider>
    );

    expect(screen.getByText('Inicio')).toBeInTheDocument();
  });

  it('renders the source language when that is what the reader chose', () => {
    render(
      <MessagesProvider locale="en">
        <Greeting />
      </MessagesProvider>
    );

    expect(screen.getByText('Home')).toBeInTheDocument();
  });

  it('hands down one translator for as long as the language does not change', () => {
    /*
     * A translator records the messages it had to fall back on, so rebuilding
     * one per render throws that record away. The invariant is also load-bearing
     * for anything downstream that memoises on the translator it was given.
     */
    const seen: unknown[] = [];

    function Collect() {
      seen.push(useTranslator());
      return null;
    }

    const { rerender } = render(
      <MessagesProvider locale="en">
        <Collect />
      </MessagesProvider>
    );
    rerender(
      <MessagesProvider locale="en">
        <Collect />
      </MessagesProvider>
    );

    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(seen[1]);
  });
});

describe('useTranslator', () => {
  it('throws rather than quietly falling back to the source language', () => {
    /*
     * The failure this prevents is a screen that renders English to a patient
     * who chose Spanish, with nothing in the page or the console to say so. An
     * exception is the only version of that mistake somebody notices.
     *
     * React logs the error it caught as well as rethrowing it, so the console is
     * silenced for the length of the assertion rather than left to print a
     * stack trace that reads like a failure.
     */
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => render(<Greeting />)).toThrow(
      'useTranslator was called outside MessagesProvider.'
    );

    error.mockRestore();
  });
});

describe('the catalogue behind the provider', () => {
  it('is the same catalogue a server component builds its translator from', () => {
    /*
     * The tab title and the page body have to agree. They are built in different
     * places - `lib/i18n/metadata.ts` on the server, this provider in the
     * browser - and the only thing that keeps them in step is that both read
     * `appCatalogue`.
     */
    const server = createTranslator(appCatalogue, 'es');

    render(
      <MessagesProvider locale="es">
        <Greeting />
      </MessagesProvider>
    );

    expect(screen.getByText(server('portal.home.title'))).toBeInTheDocument();
  });
});
