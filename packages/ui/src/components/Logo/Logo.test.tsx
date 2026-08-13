import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Logo } from './Logo';

/** Both branches render an image named for the brand, so one query serves the whole suite. */
function mark(): HTMLElement {
  return screen.getByRole('img', { name: 'OpenRunic' });
}

describe('Logo', () => {
  it('renders the horizontal currentColor lockup through a mask by default', () => {
    render(<Logo />);
    const logo = mark();
    expect(logo.tagName).toBe('SPAN');
    expect(logo).toHaveClass('or-logo', 'or-logo--mask');
    expect(logo.style.getPropertyValue('--or-logo-src')).toBe(
      'url(assets/logo/lockup-horizontal.svg)'
    );
    expect(logo).toHaveStyle({ width: '116px', height: '32px' });
  });

  it.each([
    ['horizontal', 'ink', 'SPAN', 'lockup-horizontal.svg'],
    ['horizontal', 'light', 'IMG', 'lockup-horizontal-light.svg'],
    ['horizontal', 'dark', 'IMG', 'lockup-horizontal-dark.svg'],
    ['stacked', 'ink', 'IMG', 'lockup-stacked-light.svg'],
    ['stacked', 'light', 'IMG', 'lockup-stacked-light.svg'],
    ['stacked', 'dark', 'IMG', 'lockup-stacked-dark.svg'],
    ['glyph', 'ink', 'SPAN', 'glyph.svg'],
    ['glyph', 'light', 'IMG', 'glyph-espresso.svg'],
    ['glyph', 'dark', 'IMG', 'glyph-bone.svg'],
  ] as const)('renders the %s lockup on the %s theme', (variant, theme, tag, file) => {
    render(<Logo variant={variant} theme={theme} />);
    const logo = mark();
    expect(logo.tagName).toBe(tag);

    if (tag === 'SPAN') {
      expect(logo.style.getPropertyValue('--or-logo-src')).toBe(`url(assets/logo/${file})`);
    } else {
      expect(logo).toHaveAttribute('src', `assets/logo/${file}`);
    }
  });

  it('falls back to the light build for the stacked lockup, which ships no ink build', () => {
    render(<Logo variant="stacked" />);
    const logo = mark();
    expect(logo).toHaveClass('or-logo--image');
    expect(logo).toHaveAttribute('src', 'assets/logo/lockup-stacked-light.svg');
  });

  it.each([
    ['horizontal', 28, '102px'],
    ['horizontal', 64, '233px'],
    ['glyph', 40, '40px'],
  ] as const)('sizes the %s mask box from its height', (variant, height, width) => {
    render(<Logo variant={variant} height={height} />);
    expect(mark()).toHaveStyle({ width, height: `${height}px` });
  });

  it('lets the image build keep its own proportions', () => {
    render(<Logo theme="dark" height={48} />);
    expect(mark()).toHaveStyle({ height: '48px', width: 'auto' });
  });

  it('resolves the masked build against a caller basePath', () => {
    render(<Logo basePath="/brand/logo" />);
    expect(mark().style.getPropertyValue('--or-logo-src')).toBe(
      'url(/brand/logo/lockup-horizontal.svg)'
    );
  });

  it('resolves the image build against a caller basePath', () => {
    render(<Logo theme="light" basePath="/brand/logo" />);
    expect(mark()).toHaveAttribute('src', '/brand/logo/lockup-horizontal-light.svg');
  });

  it('merges a caller className and forwards native attributes on the masked build', () => {
    render(<Logo className="or-nav__logo" data-testid="brand" id="nav-logo" />);
    const logo = mark();
    expect(logo).toHaveClass('or-logo', 'or-nav__logo');
    expect(logo).toHaveAttribute('id', 'nav-logo');
    expect(screen.getByTestId('brand')).toBe(logo);
  });

  it('merges a caller className and forwards native attributes on the image build', () => {
    render(<Logo variant="stacked" theme="dark" className="or-footer__logo" data-testid="brand" />);
    const logo = mark();
    expect(logo).toHaveClass('or-logo', 'or-logo--image', 'or-footer__logo');
    expect(screen.getByTestId('brand')).toBe(logo);
  });

  it('lets a caller style override the computed box', () => {
    render(<Logo height={32} style={{ width: 240 }} />);
    expect(mark()).toHaveStyle({ width: '240px', height: '32px' });
  });
});
