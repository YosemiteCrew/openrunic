import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tag } from './Tag';

describe('Tag', () => {
  it('renders its label with no remove control by default', () => {
    const { container } = render(<Tag>Cardiology</Tag>);
    const tag = container.querySelector('.or-tag');
    expect(tag).toHaveTextContent('Cardiology');
    expect(tag).not.toHaveClass('or-tag--mono');
    expect(tag).not.toHaveClass('or-tag--removable');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('sets clinical identifiers in mono only when asked', () => {
    const { container, rerender } = render(<Tag>Cardiology</Tag>);
    expect(container.querySelector('.or-tag')).not.toHaveClass('or-tag--mono');

    rerender(<Tag mono>Observation/8867-4</Tag>);
    expect(container.querySelector('.or-tag')).toHaveClass('or-tag--mono');
    expect(screen.getByText('Observation/8867-4')).toBeInTheDocument();
  });

  it('names the remove control after the chip it removes', () => {
    render(<Tag onRemove={() => {}}>Cardiology</Tag>);
    expect(screen.getByRole('button', { name: 'Remove Cardiology' })).toBeInTheDocument();
  });

  it('falls back to a plain label when the chip content is not plain text', () => {
    render(
      <Tag onRemove={() => {}}>
        <em>Cardiology</em>
      </Tag>
    );
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });

  it('adds the removable modifier and a decorative cross', () => {
    const { container } = render(<Tag onRemove={() => {}}>Cardiology</Tag>);
    expect(container.querySelector('.or-tag')).toHaveClass('or-tag--removable');
    expect(container.querySelector('.or-tag__remove-icon')).toHaveAttribute('aria-hidden', 'true');
  });

  it('calls onRemove on click', async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    render(<Tag onRemove={onRemove}>Cardiology</Tag>);

    await user.click(screen.getByRole('button', { name: 'Remove Cardiology' }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('reaches the remove control by keyboard and fires it with Enter and Space', async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    render(<Tag onRemove={onRemove}>Cardiology</Tag>);

    await user.tab();
    expect(screen.getByRole('button', { name: 'Remove Cardiology' })).toHaveFocus();

    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(onRemove).toHaveBeenCalledTimes(2);
  });

  it('keeps the remove button out of form submission', () => {
    render(<Tag onRemove={() => {}}>Cardiology</Tag>);
    expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
  });

  it('merges className and forwards native attributes', () => {
    render(
      <Tag className="or-filters__chip" data-testid="filter" id="filter-cardiology">
        Cardiology
      </Tag>
    );
    const tag = screen.getByTestId('filter');
    expect(tag).toHaveClass('or-tag', 'or-filters__chip');
    expect(tag).toHaveAttribute('id', 'filter-cardiology');
  });
});
