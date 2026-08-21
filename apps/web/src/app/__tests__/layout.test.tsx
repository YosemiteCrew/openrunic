import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import RootLayout, { metadata, viewport } from '../layout';

/**
 * The layout is a server component now, because the reader's language has to be
 * known before the first byte. So these render its resolved output rather than
 * the component: `await RootLayout(...)` is what the framework does, and it is
 * the only way to render one from a test.
 */
let requestHeaders = new Headers();

vi.mock('next/headers', () => ({ headers: () => Promise.resolve(requestHeaders) }));

beforeEach(() => {
  requestHeaders = new Headers();
});

async function renderLayout(children: React.ReactNode): Promise<void> {
  render(await RootLayout({ children }));
}

describe('RootLayout', () => {
  it('declares the app title, and a template screens fill in', () => {
    expect(metadata.title).toEqual({ default: 'openrunic', template: '%s - openrunic' });
  });

  it('keeps the staff EMR out of search indexes', () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it('paints the browser chrome bone rather than white', () => {
    expect(viewport.themeColor).toBe('#f5efe6');
  });

  it('renders its children inside a document in the source language by default', async () => {
    await renderLayout(<p>hello from openrunic</p>);

    expect(screen.getByText('hello from openrunic')).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute('lang', 'en');
  });

  it('opens every page with a skip link to the main landmark', async () => {
    await renderLayout(<main id="main-content">content</main>);

    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute(
      'href',
      '#main-content'
    );
  });

  it('renders in the language the browser asked for, and says so in lang', async () => {
    requestHeaders = new Headers({ 'accept-language': 'es-MX,es;q=0.9,en;q=0.5' });

    await renderLayout(<main id="main-content">content</main>);

    // Both halves matter. The attribute is what a screen reader uses to pick a
    // voice, so a Spanish page announced in an English voice is unusable even
    // when every word on it is right.
    expect(document.documentElement).toHaveAttribute('lang', 'es');
    expect(screen.getByRole('link', { name: 'Saltar al contenido' })).toBeInTheDocument();
  });

  it("honours the reader's own choice over the browser's", async () => {
    requestHeaders = new Headers({
      'accept-language': 'en',
      cookie: 'or_locale=es',
    });

    await renderLayout(<main id="main-content">content</main>);

    expect(document.documentElement).toHaveAttribute('lang', 'es');
  });

  it('refuses a locale cookie this build does not carry', async () => {
    // The value reaches `<html lang>` and the catalogue lookup, and a cookie is
    // attacker-writable. Unchecked, it puts arbitrary text into an attribute.
    requestHeaders = new Headers({ cookie: 'or_locale="><script>' });

    await renderLayout(<main id="main-content">content</main>);

    expect(document.documentElement).toHaveAttribute('lang', 'en');
  });
});
