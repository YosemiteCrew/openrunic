import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import RootLayout, { metadata } from '../layout';

describe('RootLayout', () => {
  it('declares the app title in its metadata', () => {
    expect(metadata.title).toBe('openrunic');
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
});
