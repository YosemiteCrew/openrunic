import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from './Button';

describe('Button', () => {
  it('renders a button with an accessible name and a safe default type', () => {
    render(<Button>Connect a clinic</Button>);
    const button = screen.getByRole('button', { name: 'Connect a clinic' });
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveClass('or-btn', 'or-btn--primary', 'or-btn--md');
  });

  it.each([
    ['primary', 'or-btn--primary'],
    ['secondary', 'or-btn--secondary'],
    ['ghost', 'or-btn--ghost'],
    ['inverse', 'or-btn--inverse'],
    ['danger', 'or-btn--danger'],
  ] as const)('renders the %s variant', (variant, expected) => {
    render(<Button variant={variant}>Revoke access</Button>);
    expect(screen.getByRole('button')).toHaveClass(expected);
  });

  it.each([
    ['sm', 'or-btn--sm'],
    ['md', 'or-btn--md'],
    ['lg', 'or-btn--lg'],
  ] as const)('renders the %s size', (size, expected) => {
    render(<Button size={size}>Export NDJSON</Button>);
    expect(screen.getByRole('button')).toHaveClass(expected);
  });

  it('renders leading and trailing icons hidden from assistive technology', () => {
    const { container } = render(
      <Button iconLeft="download" iconRight="arrow-right">
        Export NDJSON
      </Button>
    );
    const icons = container.querySelectorAll('.or-btn__icon');
    expect(icons).toHaveLength(2);
    for (const icon of icons) {
      expect(icon).toHaveAttribute('aria-hidden', 'true');
    }
    expect(screen.getByRole('button')).toHaveAccessibleName('Export NDJSON');
  });

  it('renders the label alone when an icon slug does not exist', () => {
    const { container } = render(<Button iconLeft="not-a-real-lucide-icon">Read the docs</Button>);
    expect(container.querySelectorAll('.or-btn__icon')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Read the docs' })).toBeInTheDocument();
  });

  it('adds the full-width modifier only when asked', () => {
    const { rerender } = render(<Button>Save</Button>);
    expect(screen.getByRole('button')).not.toHaveClass('or-btn--full');
    rerender(<Button fullWidth>Save</Button>);
    expect(screen.getByRole('button')).toHaveClass('or-btn--full');
  });

  it('merges a caller className instead of replacing the component classes', () => {
    render(<Button className="or-hero-cta">Get started</Button>);
    expect(screen.getByRole('button')).toHaveClass('or-btn', 'or-hero-cta');
  });

  it('disables the button and blocks clicks', async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Revoke access
      </Button>
    );
    const button = screen.getByRole('button', { name: 'Revoke access' });
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('fires onClick and is operable from the keyboard', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Grant access</Button>);
    const button = screen.getByRole('button', { name: 'Grant access' });

    await userEvent.tab();
    expect(button).toHaveFocus();

    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard(' ');
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('honours type, name, value and form on the button element', () => {
    render(
      <Button type="submit" name="intent" value="revoke" form="consent-form">
        Confirm
      </Button>
    );
    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('type', 'submit');
    expect(button).toHaveAttribute('name', 'intent');
    expect(button).toHaveAttribute('value', 'revoke');
    expect(button).toHaveAttribute('form', 'consent-form');
  });

  it('renders an anchor when href is set', () => {
    render(
      <Button href="/docs" target="_blank" rel="noreferrer" variant="secondary">
        Read the docs
      </Button>
    );
    const link = screen.getByRole('link', { name: 'Read the docs' });
    expect(link).toHaveAttribute('href', '/docs');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer');
    expect(link).toHaveClass('or-btn--secondary');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('calls onClick from an enabled anchor', async () => {
    const onClick = vi.fn();
    render(
      <Button href="#records" onClick={onClick}>
        Open records
      </Button>
    );
    await userEvent.click(screen.getByRole('link', { name: 'Open records' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('marks a disabled anchor with aria-disabled, removes it from the tab order and swallows the click', () => {
    const onClick = vi.fn();
    render(
      <Button href="/docs" disabled onClick={onClick}>
        Read the docs
      </Button>
    );
    const link = screen.getByRole('link', { name: 'Read the docs' });
    expect(link).toHaveAttribute('aria-disabled', 'true');
    expect(link).toHaveAttribute('tabindex', '-1');

    const clicked = fireEvent.click(link);
    expect(onClick).not.toHaveBeenCalled();
    // fireEvent returns false once a listener has called preventDefault.
    expect(clicked).toBe(false);
  });
});
