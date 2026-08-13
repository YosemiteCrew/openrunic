import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import RootLayout, { metadata, viewport } from '../layout';

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

  it('renders its children inside a document with lang="en"', () => {
    render(
      <RootLayout>
        <p>hello from openrunic</p>
      </RootLayout>
    );
    expect(screen.getByText('hello from openrunic')).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute('lang', 'en');
  });

  it('opens every page with a skip link to the main landmark', () => {
    render(
      <RootLayout>
        <main id="main-content">content</main>
      </RootLayout>
    );
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute(
      'href',
      '#main-content'
    );
  });
});
