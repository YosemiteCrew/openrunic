import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Icon } from './Icon';

describe('Icon', () => {
  it('renders a decorative icon hidden from assistive technology by default', () => {
    const { container } = render(<Icon name="heart-pulse" />);
    const icon = container.querySelector('.or-icon');
    expect(icon).toHaveAttribute('aria-hidden', 'true');
    expect(icon).not.toHaveAttribute('role');
    expect(icon).toHaveStyle({ width: '20px', height: '20px' });
    // The default ink is currentColor, so the glyph takes the surrounding brand ink.
    expect(icon?.getAttribute('style')).toContain('color: currentcolor');
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('exposes a labelled icon as an image with an accessible name', () => {
    render(<Icon name="check" label="In range" />);
    const icon = screen.getByRole('img', { name: 'In range' });
    expect(icon).not.toHaveAttribute('aria-hidden');
  });

  it('hides the inner svg from assistive technology even when the wrapper is labelled', () => {
    const { container } = render(<Icon name="check" label="In range" />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('focusable', 'false');
  });

  it.each([['heart-pulse'], ['folder-open'], ['calendar-days'], ['file-text'], ['shield-check']])(
    'resolves the %s slug to a Lucide glyph',
    (name) => {
      const { container } = render(<Icon name={name} />);
      expect(container.querySelector('.or-icon__svg')).toBeInTheDocument();
    }
  );

  it('renders an empty box of the right size when the slug does not exist', () => {
    const { container } = render(<Icon name="not-a-real-lucide-icon" label="Unknown" size={24} />);
    expect(container.querySelector('svg')).toBeNull();
    const icon = screen.getByRole('img', { name: 'Unknown' });
    expect(icon).toHaveStyle({ width: '24px', height: '24px' });
  });

  it.each([[16], [20], [24], [32]])('sizes the box and the glyph to %ipx', (size) => {
    const { container } = render(<Icon name="activity" size={size} />);
    expect(container.querySelector('.or-icon')).toHaveStyle({
      width: `${size}px`,
      height: `${size}px`,
    });
    expect(container.querySelector('svg')).toHaveAttribute('width', String(size));
  });

  it('draws every glyph at the brand stroke weight', () => {
    const { container } = render(<Icon name="activity" />);
    expect(container.querySelector('svg')).toHaveAttribute('stroke-width', '1.75');
  });

  it('takes an explicit colour so the glyph can carry a status ink', () => {
    const { container } = render(<Icon name="check" color="var(--olive)" label="In range" />);
    expect(container.querySelector('.or-icon')).toHaveStyle({ color: 'var(--olive)' });
  });

  it('merges a caller className and forwards native attributes', () => {
    const { container } = render(
      <Icon name="activity" className="or-vital__icon" data-testid="vital-icon" />
    );
    const icon = container.querySelector('.or-icon');
    expect(icon).toHaveClass('or-icon', 'or-vital__icon');
    expect(screen.getByTestId('vital-icon')).toBe(icon);
  });

  it('lets a caller style override the computed box', () => {
    const { container } = render(<Icon name="activity" size={20} style={{ width: 40 }} />);
    expect(container.querySelector('.or-icon')).toHaveStyle({ width: '40px', height: '20px' });
  });
});
