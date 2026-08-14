import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Radio } from './Radio';

describe('Radio', () => {
  it('renders an unselected radio named by its own label', () => {
    render(<Radio label="Metric (mmol/L)" />);
    const radio = screen.getByRole('radio', { name: 'Metric (mmol/L)' });
    expect(radio).not.toBeChecked();
    expect(screen.getByText('Metric (mmol/L)')).toHaveAttribute('for', radio.id);
  });

  it('reflects the controlled checked state', () => {
    const onChange = vi.fn();
    render(<Radio label="Metric (mmol/L)" checked onChange={onChange} />);
    expect(screen.getByRole('radio', { name: 'Metric (mmol/L)' })).toBeChecked();
  });

  it('starts from defaultChecked when it is left uncontrolled', () => {
    render(<Radio label="Metric (mmol/L)" defaultChecked />);
    expect(screen.getByRole('radio')).toBeChecked();
  });

  it('groups radios that share a name and carries each value', () => {
    render(
      <>
        <Radio name="units" value="metric" label="Metric (mmol/L)" defaultChecked />
        <Radio name="units" value="us" label="US (mg/dL)" />
      </>
    );
    const [metric, us] = screen.getAllByRole('radio');
    expect(metric).toHaveAttribute('name', 'units');
    expect(us).toHaveAttribute('name', 'units');
    expect(metric).toHaveAttribute('value', 'metric');
    expect(metric).toBeChecked();
    expect(us).not.toBeChecked();
  });

  it('describes the radio with its hint and drops the node when there is none', () => {
    const { rerender } = render(
      <Radio label="Metric (mmol/L)" hint="Used across every glucose reading." />
    );
    expect(screen.getByRole('radio', { name: 'Metric (mmol/L)' })).toHaveAccessibleDescription(
      'Used across every glucose reading.'
    );

    rerender(<Radio label="Metric (mmol/L)" />);
    expect(screen.getByRole('radio')).not.toHaveAttribute('aria-describedby');
  });

  it('renders a ReactNode label', () => {
    render(
      <Radio
        label={
          <>
            Metric <span className="or-mono">mmol/L</span>
          </>
        }
      />
    );
    expect(screen.getByRole('radio', { name: 'Metric mmol/L' })).toBeInTheDocument();
  });

  it('renders no label node when none is given', () => {
    const { container } = render(<Radio aria-label="Metric" />);
    expect(container.querySelector('.or-radio__label')).toBeNull();
    expect(screen.getByRole('radio', { name: 'Metric' })).toBeInTheDocument();
  });

  it('hides the painted ring from assistive technology', () => {
    const { container } = render(<Radio label="Metric (mmol/L)" />);
    expect(container.querySelector('.or-radio__box')).toHaveAttribute('aria-hidden', 'true');
  });

  it('merges a caller className instead of replacing the component classes', () => {
    const { container } = render(<Radio label="Metric" className="or-units-choice" />);
    expect(container.querySelector('.or-radio')).toHaveClass('or-radio', 'or-units-choice');
  });

  it('disables the radio and blocks the click', async () => {
    const onChange = vi.fn();
    const { container } = render(
      <Radio label="US (mg/dL)" disabled onChange={onChange} checked={false} />
    );
    const radio = screen.getByRole('radio', { name: 'US (mg/dL)' });
    expect(radio).toBeDisabled();
    expect(container.querySelector('.or-radio')).toHaveClass('or-radio--disabled');

    await userEvent.click(screen.getByText('US (mg/dL)'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('selects from the label click', async () => {
    const onChange = vi.fn();
    render(<Radio label="US (mg/dL)" checked={false} onChange={onChange} />);
    await userEvent.click(screen.getByText('US (mg/dL)'));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('moves between grouped radios with the arrow keys', async () => {
    render(
      <>
        <Radio name="units" value="metric" label="Metric (mmol/L)" defaultChecked />
        <Radio name="units" value="us" label="US (mg/dL)" />
      </>
    );
    const [metric, us] = screen.getAllByRole('radio');

    await userEvent.tab();
    expect(metric).toHaveFocus();

    await userEvent.keyboard('{ArrowDown}');
    expect(us).toBeChecked();
    expect(metric).not.toBeChecked();
  });

  it('uses a caller-supplied id for the label and hint association', () => {
    render(<Radio id="units-metric" label="Metric" hint="mmol/L" />);
    const radio = screen.getByRole('radio', { name: 'Metric' });
    expect(radio).toHaveAttribute('id', 'units-metric');
    expect(radio).toHaveAttribute('aria-describedby', 'units-metric-hint');
  });
});
