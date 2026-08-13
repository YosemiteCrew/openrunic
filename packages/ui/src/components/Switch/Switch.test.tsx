import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Switch } from './Switch';

describe('Switch', () => {
  it('renders an off switch named by its own label', () => {
    render(<Switch label="Sync with wearable" />);
    const control = screen.getByRole('switch', { name: 'Sync with wearable' });
    expect(control).toHaveAttribute('aria-checked', 'false');
    expect(control).toHaveAttribute('type', 'button');
    expect(control).toHaveClass('or-switch__control');
  });

  it('reports the on state through aria-checked', () => {
    render(<Switch label="Sync with wearable" checked />);
    expect(screen.getByRole('switch', { name: 'Sync with wearable' })).toBeChecked();
  });

  it('describes the switch with its hint and drops the node when there is none', () => {
    const { rerender } = render(<Switch label="Sync with wearable" hint="Every 15 minutes." />);
    const control = screen.getByRole('switch', { name: 'Sync with wearable' });
    expect(control).toHaveAccessibleDescription('Every 15 minutes.');

    rerender(<Switch label="Sync with wearable" />);
    expect(screen.getByRole('switch')).not.toHaveAttribute('aria-describedby');
  });

  it('renders a ReactNode label and still names the button', () => {
    render(
      <Switch
        label={
          <>
            Sync <span className="or-mono">Observation/8867-4</span>
          </>
        }
      />
    );
    expect(screen.getByRole('switch', { name: 'Sync Observation/8867-4' })).toBeInTheDocument();
  });

  it('renders no label node when none is given', () => {
    const { container } = render(<Switch aria-label="Sync with wearable" />);
    expect(container.querySelector('.or-switch__label')).toBeNull();
    expect(screen.getByRole('switch', { name: 'Sync with wearable' })).toBeInTheDocument();
    expect(screen.getByRole('switch')).not.toHaveAttribute('aria-labelledby');
  });

  it('hides the thumb from assistive technology', () => {
    const { container } = render(<Switch label="Sync with wearable" />);
    expect(container.querySelector('.or-switch__thumb')).toHaveAttribute('aria-hidden', 'true');
  });

  it('merges a caller className instead of replacing the component classes', () => {
    const { container } = render(<Switch label="Sync" className="or-settings-row" />);
    expect(container.querySelector('.or-switch')).toHaveClass('or-switch', 'or-settings-row');
  });

  it('disables the switch and blocks the click', async () => {
    const onChange = vi.fn();
    const { container } = render(
      <Switch label="Sync with wearable" disabled onChange={onChange} />
    );
    const control = screen.getByRole('switch', { name: 'Sync with wearable' });
    expect(control).toBeDisabled();
    expect(container.querySelector('.or-switch')).toHaveClass('or-switch--disabled');

    await userEvent.click(control);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('fires onChange on click', async () => {
    const onChange = vi.fn();
    render(<Switch label="Sync with wearable" onChange={onChange} />);
    await userEvent.click(screen.getByRole('switch', { name: 'Sync with wearable' }));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('takes focus from the keyboard and flips on Enter and Space', async () => {
    const onChange = vi.fn();
    render(<Switch label="Sync with wearable" onChange={onChange} />);
    const control = screen.getByRole('switch', { name: 'Sync with wearable' });

    await userEvent.tab();
    expect(control).toHaveFocus();

    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard(' ');
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('uses a caller-supplied id for the label and hint association', () => {
    render(<Switch id="sync" label="Sync with wearable" hint="Every 15 minutes." />);
    const control = screen.getByRole('switch');
    expect(control).toHaveAttribute('id', 'sync');
    expect(control).toHaveAttribute('aria-labelledby', 'sync-label');
    expect(control).toHaveAttribute('aria-describedby', 'sync-hint');
  });
});
