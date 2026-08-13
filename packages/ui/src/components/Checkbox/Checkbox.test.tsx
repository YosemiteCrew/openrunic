import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Checkbox } from './Checkbox';

describe('Checkbox', () => {
  it('renders an unchecked box named by its own label', () => {
    render(<Checkbox label="Share with my care team" />);
    const box = screen.getByRole('checkbox', { name: 'Share with my care team' });
    expect(box).not.toBeChecked();
    expect(screen.getByText('Share with my care team')).toHaveAttribute('for', box.id);
  });

  it('reflects the controlled checked state', () => {
    const onChange = vi.fn();
    render(<Checkbox label="Share with my care team" checked onChange={onChange} />);
    expect(screen.getByRole('checkbox', { name: 'Share with my care team' })).toBeChecked();
  });

  it('starts from defaultChecked when it is left uncontrolled', () => {
    render(<Checkbox label="Share with my care team" defaultChecked />);
    expect(screen.getByRole('checkbox')).toBeChecked();
  });

  it('describes the box with its hint and drops the node when there is none', () => {
    const { rerender } = render(
      <Checkbox label="Share with my care team" hint="You can revoke this at any time." />
    );
    const box = screen.getByRole('checkbox', { name: 'Share with my care team' });
    expect(box).toHaveAccessibleDescription('You can revoke this at any time.');

    rerender(<Checkbox label="Share with my care team" />);
    expect(screen.getByRole('checkbox')).not.toHaveAttribute('aria-describedby');
  });

  it('renders a ReactNode label', () => {
    render(
      <Checkbox
        label={
          <>
            I agree to the <a href="#terms">terms</a>
          </>
        }
      />
    );
    expect(screen.getByRole('link', { name: 'terms' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox')).toBeInTheDocument();
  });

  it('renders no label node when none is given', () => {
    const { container } = render(<Checkbox aria-label="Select this row" />);
    expect(container.querySelector('.or-checkbox__label')).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'Select this row' })).toBeInTheDocument();
  });

  it('hides the painted box from assistive technology', () => {
    const { container } = render(<Checkbox label="Share with my care team" />);
    expect(container.querySelector('.or-checkbox__box')).toHaveAttribute('aria-hidden', 'true');
  });

  it('merges a caller className instead of replacing the component classes', () => {
    const { container } = render(<Checkbox label="Consent" className="or-consent-row" />);
    expect(container.querySelector('.or-checkbox')).toHaveClass('or-checkbox', 'or-consent-row');
  });

  it('honours name and value for form submission', () => {
    render(<Checkbox label="Cardiology" name="teams" value="cardiology" />);
    const box = screen.getByRole('checkbox', { name: 'Cardiology' });
    expect(box).toHaveAttribute('name', 'teams');
    expect(box).toHaveAttribute('value', 'cardiology');
  });

  it('disables the box and blocks the click', async () => {
    const onChange = vi.fn();
    const { container } = render(
      <Checkbox label="Share with my care team" disabled onChange={onChange} />
    );
    const box = screen.getByRole('checkbox', { name: 'Share with my care team' });
    expect(box).toBeDisabled();
    expect(container.querySelector('.or-checkbox')).toHaveClass('or-checkbox--disabled');

    await userEvent.click(screen.getByText('Share with my care team'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('toggles from the label click', async () => {
    const onChange = vi.fn();
    render(<Checkbox label="Share with my care team" checked={false} onChange={onChange} />);
    await userEvent.click(screen.getByText('Share with my care team'));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('takes focus from the keyboard and toggles on Space', async () => {
    const onChange = vi.fn();
    render(<Checkbox label="Share with my care team" checked={false} onChange={onChange} />);
    const box = screen.getByRole('checkbox', { name: 'Share with my care team' });

    await userEvent.tab();
    expect(box).toHaveFocus();

    await userEvent.keyboard(' ');
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('uses a caller-supplied id for the label and hint association', () => {
    render(<Checkbox id="share" label="Share" hint="Revocable at any time." />);
    const box = screen.getByRole('checkbox', { name: 'Share' });
    expect(box).toHaveAttribute('id', 'share');
    expect(box).toHaveAttribute('aria-describedby', 'share-hint');
  });
});
