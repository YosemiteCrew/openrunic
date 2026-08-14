import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IconButton } from './IconButton';

describe('IconButton', () => {
  it('renders a button named by its label, with a safe default type', () => {
    render(<IconButton icon="x" label="Close" />);
    const button = screen.getByRole('button', { name: 'Close' });
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveClass('or-icon-btn', 'or-icon-btn--ghost', 'or-icon-btn--md');
  });

  it('uses the label as the tooltip title as well as the accessible name', () => {
    render(<IconButton icon="pencil" label="Edit observation" />);
    const button = screen.getByRole('button', { name: 'Edit observation' });
    expect(button).toHaveAttribute('title', 'Edit observation');
    expect(button).toHaveAccessibleName('Edit observation');
  });

  it.each([
    ['primary', 'or-icon-btn--primary'],
    ['secondary', 'or-icon-btn--secondary'],
    ['ghost', 'or-icon-btn--ghost'],
  ] as const)('renders the %s variant', (variant, expected) => {
    render(<IconButton icon="plus" label="New record" variant={variant} />);
    expect(screen.getByRole('button')).toHaveClass(expected);
  });

  it.each([
    ['sm', 'or-icon-btn--sm'],
    ['md', 'or-icon-btn--md'],
    ['lg', 'or-icon-btn--lg'],
  ] as const)('renders the %s size', (size, expected) => {
    const { container } = render(<IconButton icon="plus" label="New record" size={size} />);
    expect(screen.getByRole('button')).toHaveClass(expected);
    // Every size still renders exactly one glyph, sized from the control specimen.
    expect(container.querySelectorAll('.or-icon-btn__icon')).toHaveLength(1);
  });

  it('hides the glyph from assistive technology, leaving the label as the only name', () => {
    const { container } = render(<IconButton icon="ellipsis" label="More actions" />);
    const glyph = container.querySelector('.or-icon-btn__icon');
    expect(glyph).not.toBeNull();
    expect(glyph).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByRole('button')).toHaveAccessibleName('More actions');
  });

  it('stays a named control when the icon slug does not exist', () => {
    const { container } = render(<IconButton icon="not-a-real-lucide-icon" label="Close" />);
    expect(container.querySelectorAll('.or-icon-btn__icon')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('merges a caller className instead of replacing the component classes', () => {
    render(<IconButton icon="x" label="Close" className="or-modal__close" />);
    expect(screen.getByRole('button')).toHaveClass('or-icon-btn', 'or-modal__close');
  });

  it('forwards arbitrary aria attributes to the button', () => {
    render(<IconButton icon="ellipsis" label="More actions" aria-expanded={false} />);
    expect(screen.getByRole('button', { name: 'More actions' })).toHaveAttribute(
      'aria-expanded',
      'false'
    );
  });

  it('disables the button and blocks clicks', async () => {
    const onClick = vi.fn();
    render(<IconButton icon="trash-2" label="Delete draft" disabled onClick={onClick} />);
    const button = screen.getByRole('button', { name: 'Delete draft' });
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('fires onClick and is operable from the keyboard', async () => {
    const onClick = vi.fn();
    render(<IconButton icon="x" label="Close" onClick={onClick} />);
    const button = screen.getByRole('button', { name: 'Close' });

    await userEvent.tab();
    expect(button).toHaveFocus();

    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard(' ');
    expect(onClick).toHaveBeenCalledTimes(2);
  });
});
