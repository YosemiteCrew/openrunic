import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VitalStat } from './VitalStat';

describe('VitalStat', () => {
  it('renders the label, value and unit, and defaults to the neutral state', () => {
    const { container } = render(<VitalStat label="Resting heart rate" value="58" unit="bpm" />);
    expect(screen.getByText('Resting heart rate')).toHaveClass('or-vital-stat__label');
    expect(screen.getByText('58')).toHaveClass('or-vital-stat__value');
    expect(screen.getByText('bpm')).toHaveClass('or-vital-stat__unit');
    expect(container.querySelector('.or-vital-stat')).toHaveClass('or-vital-stat--neutral');
  });

  it('omits the unit row when there is no unit', () => {
    const { container } = render(<VitalStat label="Blood pressure" value="118 / 74" />);
    expect(container.querySelector('.or-vital-stat__unit')).toBeNull();
  });

  it.each([
    ['success', 'or-vital-stat--success', 'In range'],
    ['neutral', 'or-vital-stat--neutral', 'Awaiting lab'],
    ['danger', 'or-vital-stat--danger', 'Above range'],
  ] as const)('renders the %s state with its own words', (state, expected, stateLabel) => {
    const { container } = render(
      <VitalStat
        label="Blood glucose"
        value="7.4"
        unit="mmol/L"
        state={state}
        stateLabel={stateLabel}
      />
    );
    expect(container.querySelector('.or-vital-stat')).toHaveClass(expected);
    expect(screen.getByText(stateLabel)).toHaveClass('or-vital-stat__state');
    expect(container.querySelector('.or-vital-stat__state-icon')).toHaveAttribute(
      'aria-hidden',
      'true'
    );
  });

  it('drops the state row entirely when there is no label, rather than showing colour alone', () => {
    const { container } = render(<VitalStat label="Blood glucose" value="7.4" state="danger" />);
    expect(container.querySelector('.or-vital-stat__state')).toBeNull();
    expect(container.querySelector('.or-vital-stat')).toHaveClass('or-vital-stat--danger');
  });

  it('renders a decorative label icon and degrades on a typo', () => {
    const { container, rerender } = render(
      <VitalStat label="Resting heart rate" icon="heart-pulse" value="58" unit="bpm" />
    );
    expect(container.querySelector('.or-vital-stat__label-icon')).toHaveAttribute(
      'aria-hidden',
      'true'
    );

    rerender(
      <VitalStat label="Resting heart rate" icon="not-a-real-lucide-icon" value="58" unit="bpm" />
    );
    expect(container.querySelector('.or-vital-stat__label-icon')).toBeNull();
    expect(screen.getByText('Resting heart rate')).toBeInTheDocument();
  });

  it('shows the capture time only when it is given', () => {
    const { container, rerender } = render(<VitalStat label="Blood glucose" value="7.4" />);
    expect(container.querySelector('.or-vital-stat__captured')).toBeNull();

    rerender(<VitalStat label="Blood glucose" value="7.4" capturedAt="Today, 07:12" />);
    expect(screen.getByText('Today, 07:12')).toHaveClass('or-vital-stat__captured');
  });

  it('accepts a node as the value', () => {
    render(
      <VitalStat
        label="Blood pressure"
        value={
          <>
            118 <span data-testid="over">/</span> 74
          </>
        }
        unit="mmHg"
      />
    );
    expect(screen.getByTestId('over')).toBeInTheDocument();
  });

  it('merges className and forwards native attributes', () => {
    render(
      <VitalStat
        className="or-today__stat"
        data-testid="glucose"
        id="glucose"
        label="Blood glucose"
        value="7.4"
        unit="mmol/L"
      />
    );
    const stat = screen.getByTestId('glucose');
    expect(stat).toHaveClass('or-vital-stat', 'or-today__stat');
    expect(stat).toHaveAttribute('id', 'glucose');
  });
});
