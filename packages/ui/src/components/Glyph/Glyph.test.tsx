import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Glyph } from './Glyph';

/** The block is the only element carrying inline style, and it is always the named image. */
function block(name = 'OpenRunic'): HTMLElement {
  return screen.getByRole('img', { name });
}

describe('Glyph', () => {
  it('renders the static mark as a named image with a single masked layer', () => {
    const { container } = render(<Glyph />);
    const glyph = block();
    expect(glyph).toHaveClass('or-glyph');
    expect(glyph).not.toHaveClass('or-glyph--animate');
    expect(glyph).toHaveStyle({ width: '48px', height: '48px' });
    expect(container.querySelectorAll('.or-glyph__track')).toHaveLength(1);
    expect(container.querySelectorAll('.or-glyph__stroke')).toHaveLength(0);
  });

  it('points the mask at the shipped currentColor build', () => {
    render(<Glyph />);
    const glyph = block();
    expect(glyph.style.getPropertyValue('--or-glyph-src')).toBe('url(assets/logo/glyph.svg)');
    expect(glyph.style.getPropertyValue('--or-glyph-ink')).toBe('currentColor');
  });

  it('resolves the mask against a caller basePath', () => {
    render(<Glyph basePath="/brand/logo" />);
    expect(block().style.getPropertyValue('--or-glyph-src')).toBe('url(/brand/logo/glyph.svg)');
  });

  it('takes an explicit ink, terracotta included', () => {
    render(<Glyph color="var(--terracotta)" />);
    expect(block().style.getPropertyValue('--or-glyph-ink')).toBe('var(--terracotta)');
  });

  it.each([[16], [32], [48], [96]])('renders a %ipx square box', (size) => {
    render(<Glyph size={size} />);
    expect(block()).toHaveStyle({ width: `${size}px`, height: `${size}px` });
  });

  it('draws six staggered stroke layers and renames itself when animating', () => {
    const { container } = render(<Glyph animate />);
    const glyph = block('Loading');
    expect(glyph).toHaveClass('or-glyph--animate');
    expect(container.querySelectorAll('.or-glyph__stroke')).toHaveLength(6);
    // The track stays behind the strokes so the box never reads as empty between cycles.
    expect(container.querySelectorAll('.or-glyph__track')).toHaveLength(1);
  });

  it('lets a caller rename the loading affordance', () => {
    render(<Glyph animate aria-label="Loading records" />);
    expect(block('Loading records')).toBeInTheDocument();
  });

  it('merges a caller className and forwards native attributes', () => {
    render(<Glyph className="or-empty-state__mark" data-testid="mark" id="empty-mark" />);
    const glyph = block();
    expect(glyph).toHaveClass('or-glyph', 'or-empty-state__mark');
    expect(glyph).toHaveAttribute('id', 'empty-mark');
    expect(screen.getByTestId('mark')).toBe(glyph);
  });

  it('lets a caller style override the computed box', () => {
    render(<Glyph size={48} style={{ width: 120 }} />);
    expect(block()).toHaveStyle({ width: '120px', height: '48px' });
  });
});
