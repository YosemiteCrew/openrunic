import type { ChangeEvent } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Select } from './Select';

const TEAMS = ['Primary care', 'Cardiology', 'Endocrinology'];

describe('Select', () => {
  it('renders a labelled select carrying every string option', () => {
    render(<Select label="Care team" options={TEAMS} />);
    const select = screen.getByRole('combobox', { name: 'Care team' });
    expect(select).toHaveClass('or-select__control');
    expect(screen.getAllByRole('option')).toHaveLength(3);
    expect(screen.getByRole('option', { name: 'Cardiology' })).toHaveValue('Cardiology');
    expect(screen.getByText('Care team')).toHaveAttribute('for', select.id);
  });

  it('renders value/label pairs with the value stored and the label shown', () => {
    render(
      <Select
        label="Units"
        options={[
          { value: 'mmol-l', label: 'Metric (mmol/L)' },
          { value: 'mg-dl', label: 'US (mg/dL)' },
        ]}
      />
    );
    expect(screen.getByRole('option', { name: 'Metric (mmol/L)' })).toHaveValue('mmol-l');
    expect(screen.getByRole('option', { name: 'US (mg/dL)' })).toHaveValue('mg-dl');
  });

  it('renders an empty menu when no options are given', () => {
    render(<Select label="Care team" />);
    expect(screen.getByRole('combobox', { name: 'Care team' })).toBeInTheDocument();
    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });

  it('renders without a label when none is given', () => {
    const { container } = render(<Select aria-label="Care team" options={TEAMS} />);
    expect(container.querySelector('.or-select__label')).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Care team' })).toBeInTheDocument();
  });

  it('describes the select with its hint and drops the node when there is none', () => {
    const { rerender } = render(
      <Select label="Care team" options={TEAMS} hint="Who can see this record." />
    );
    const select = screen.getByRole('combobox', { name: 'Care team' });
    expect(select).toHaveAccessibleDescription('Who can see this record.');

    rerender(<Select label="Care team" options={TEAMS} />);
    expect(screen.getByRole('combobox')).not.toHaveAttribute('aria-describedby');
  });

  it('renders a decorative chevron', () => {
    const { container } = render(<Select label="Care team" options={TEAMS} />);
    expect(container.querySelector('.or-select__chevron')).toHaveAttribute('aria-hidden', 'true');
  });

  it('merges a caller className instead of replacing the component classes', () => {
    const { container } = render(<Select className="or-filter" options={TEAMS} />);
    expect(container.querySelector('.or-select')).toHaveClass('or-select', 'or-filter');
  });

  it('honours name, required and an uncontrolled starting value', () => {
    render(
      <Select label="Care team" options={TEAMS} name="team" required defaultValue="Cardiology" />
    );
    const select = screen.getByRole('combobox', { name: 'Care team' });
    expect(select).toHaveAttribute('name', 'team');
    expect(select).toBeRequired();
    expect(select).toHaveValue('Cardiology');
  });

  it('disables the select and keeps it out of the tab order', async () => {
    const { container } = render(<Select label="Care team" options={TEAMS} disabled />);
    const select = screen.getByRole('combobox', { name: 'Care team' });
    expect(select).toBeDisabled();
    expect(container.querySelector('.or-select')).toHaveClass('or-select--disabled');

    await userEvent.tab();
    expect(select).not.toHaveFocus();
  });

  it('takes focus from the keyboard and reports the chosen value', async () => {
    const seen: string[] = [];
    const onChange = vi.fn((event: ChangeEvent<HTMLSelectElement>) => {
      seen.push(event.target.value);
    });
    render(<Select label="Care team" options={TEAMS} value="Primary care" onChange={onChange} />);
    const select = screen.getByRole('combobox', { name: 'Care team' });

    await userEvent.tab();
    expect(select).toHaveFocus();

    await userEvent.selectOptions(select, 'Endocrinology');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(seen).toEqual(['Endocrinology']);
  });

  it('uses a caller-supplied id for the label and hint association', () => {
    render(
      <Select id="care-team" label="Care team" options={TEAMS} hint="Revocable at any time." />
    );
    const select = screen.getByRole('combobox', { name: 'Care team' });
    expect(select).toHaveAttribute('id', 'care-team');
    expect(select).toHaveAttribute('aria-describedby', 'care-team-hint');
  });
});
