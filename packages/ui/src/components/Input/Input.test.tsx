import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Input } from './Input';

describe('Input', () => {
  it('renders a labelled text field wired to its own label', () => {
    render(<Input label="Work email" placeholder="you@clinic.org" />);
    const field = screen.getByRole('textbox', { name: 'Work email' });
    expect(field).toHaveAttribute('type', 'text');
    expect(field).toHaveAttribute('placeholder', 'you@clinic.org');
    expect(field).toHaveClass('or-input__control');
    expect(screen.getByText('Work email')).toHaveAttribute('for', field.id);
  });

  it('renders without a label when none is given', () => {
    const { container } = render(<Input aria-label="Search records" />);
    expect(container.querySelector('.or-input__label')).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Search records' })).toBeInTheDocument();
  });

  it('describes the field with its hint', () => {
    render(<Input label="Patient ID" hint="FHIR Patient resource id" />);
    const field = screen.getByRole('textbox', { name: 'Patient ID' });
    expect(field).toHaveAccessibleDescription('FHIR Patient resource id');
    expect(field).not.toHaveAttribute('aria-invalid');
  });

  it('replaces the hint with the error, marks the field invalid and shows an icon', () => {
    const { container } = render(
      <Input
        label="Systolic"
        hint="Measured sitting."
        error="Enter a value between 70 and 220."
        suffix="mmHg"
      />
    );
    const field = screen.getByRole('textbox', { name: 'Systolic' });
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveAccessibleDescription('Enter a value between 70 and 220.');
    expect(screen.queryByText('Measured sitting.')).not.toBeInTheDocument();
    expect(container.querySelector('.or-input')).toHaveClass('or-input--error');
    const icon = container.querySelector('.or-input__message-icon');
    expect(icon).toHaveAttribute('aria-hidden', 'true');
  });

  it('renders the message without an icon when it is only a hint', () => {
    const { container } = render(<Input label="Patient ID" hint="FHIR Patient resource id" />);
    expect(container.querySelector('.or-input__message-icon')).toBeNull();
  });

  it('renders no message node when there is neither hint nor error', () => {
    const { container } = render(<Input label="Given name" />);
    expect(container.querySelector('.or-input__message')).toBeNull();
    expect(screen.getByRole('textbox')).not.toHaveAttribute('aria-describedby');
  });

  it('renders a leading icon hidden from assistive technology', () => {
    const { container } = render(<Input label="Work email" iconLeft="mail" />);
    const icon = container.querySelector('.or-input__icon');
    expect(icon).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByRole('textbox', { name: 'Work email' })).toBeInTheDocument();
  });

  it('renders the field alone when the icon slug does not exist', () => {
    const { container } = render(<Input label="Work email" iconLeft="not-a-real-lucide-icon" />);
    expect(container.querySelector('.or-input__icon')).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Work email' })).toBeInTheDocument();
  });

  it('renders a trailing suffix and omits it when absent', () => {
    const { container, rerender } = render(<Input label="Systolic" suffix="mmHg" />);
    expect(container.querySelector('.or-input__suffix')).toHaveTextContent('mmHg');
    rerender(<Input label="Systolic" />);
    expect(container.querySelector('.or-input__suffix')).toBeNull();
  });

  it('switches the value to mono only when asked', () => {
    const { rerender } = render(<Input label="Resource" />);
    expect(screen.getByRole('textbox')).not.toHaveClass('or-input__control--mono');
    rerender(<Input label="Resource" mono />);
    expect(screen.getByRole('textbox')).toHaveClass('or-input__control--mono');
  });

  it('merges a caller className instead of replacing the component classes', () => {
    const { container } = render(<Input label="Given name" className="or-signin-field" />);
    expect(container.querySelector('.or-input')).toHaveClass('or-input', 'or-signin-field');
  });

  it('honours name, type, required, readOnly, autoComplete and an uncontrolled value', () => {
    render(
      <Input
        label="Work email"
        type="email"
        name="email"
        required
        readOnly
        autoComplete="email"
        defaultValue="okafor@clinic.org"
      />
    );
    const field = screen.getByRole('textbox', { name: 'Work email' });
    expect(field).toHaveAttribute('type', 'email');
    expect(field).toHaveAttribute('name', 'email');
    expect(field).toBeRequired();
    expect(field).toHaveAttribute('readonly');
    expect(field).toHaveAttribute('autocomplete', 'email');
    expect(field).toHaveValue('okafor@clinic.org');
  });

  it('disables the field and blocks typing', async () => {
    const onChange = vi.fn();
    const { container } = render(<Input label="Patient ID" disabled onChange={onChange} />);
    const field = screen.getByRole('textbox', { name: 'Patient ID' });
    expect(field).toBeDisabled();
    expect(container.querySelector('.or-input')).toHaveClass('or-input--disabled');

    await userEvent.type(field, 'OR-100482');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('takes focus from the keyboard and reports every keystroke', async () => {
    const onChange = vi.fn();
    render(<Input label="Patient ID" value="" onChange={onChange} />);
    const field = screen.getByRole('textbox', { name: 'Patient ID' });

    await userEvent.tab();
    expect(field).toHaveFocus();

    await userEvent.keyboard('OR-1');
    expect(onChange).toHaveBeenCalledTimes(4);
  });

  it('uses a caller-supplied id for the label association', () => {
    render(<Input id="systolic" label="Systolic" hint="Sitting, right arm." />);
    const field = screen.getByRole('textbox', { name: 'Systolic' });
    expect(field).toHaveAttribute('id', 'systolic');
    expect(field).toHaveAttribute('aria-describedby', 'systolic-message');
  });
});
