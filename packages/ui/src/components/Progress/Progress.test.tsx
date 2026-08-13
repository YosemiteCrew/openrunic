import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Progress } from './Progress';

describe('Progress', () => {
  it('renders a determinate bar with the whole value set on the track', () => {
    const { container } = render(<Progress label="Export in progress" value={64} />);
    const bar = screen.getByRole('progressbar', { name: 'Export in progress' });
    expect(bar).toHaveClass('or-progress__track');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
    expect(bar).toHaveAttribute('aria-valuenow', '64');
    expect(bar).toHaveAttribute('aria-valuetext', '64%');
    expect(container.querySelector('.or-progress')).toHaveClass(
      'or-progress--accent',
      'or-progress--md'
    );
    expect(container.querySelector('.or-progress')).not.toHaveClass('or-progress--indeterminate');
  });

  it('names the bar with aria-label and shows no text when showValue is off', () => {
    const { container } = render(<Progress label="Export in progress" value={64} />);
    const bar = screen.getByRole('progressbar', { name: 'Export in progress' });
    expect(bar).toHaveAttribute('aria-label', 'Export in progress');
    expect(bar).not.toHaveAttribute('aria-labelledby');
    expect(container.querySelector('.or-progress__header')).toBeNull();
  });

  it('names the bar with the visible label and prints the percentage when showValue is on', () => {
    const { container } = render(<Progress label="Export in progress" value={64} showValue />);
    const bar = screen.getByRole('progressbar', { name: 'Export in progress' });
    const labelNode = screen.getByText('Export in progress');
    expect(labelNode).toHaveClass('or-progress__label');
    expect(bar).toHaveAttribute('aria-labelledby', labelNode.id);
    expect(bar).not.toHaveAttribute('aria-label');
    expect(container.querySelector('.or-progress__value')).toHaveTextContent('64%');
  });

  it('announces a rounded percentage rather than the raw value against a custom max', () => {
    const bar = renderBar(<Progress label="Export in progress" value={1284} max={2000} />);
    expect(bar).toHaveAttribute('aria-valuemax', '2000');
    expect(bar).toHaveAttribute('aria-valuenow', '1284');
    expect(bar).toHaveAttribute('aria-valuetext', '64%');
  });

  it('clamps a value below zero to the bottom of the scale', () => {
    const bar = renderBar(<Progress label="Export in progress" value={-10} />);
    expect(bar).toHaveAttribute('aria-valuenow', '0');
    expect(bar).toHaveAttribute('aria-valuetext', '0%');
  });

  it('clamps a value above the max to the top of the scale', () => {
    const { container } = render(<Progress label="Export in progress" value={140} showValue />);
    const bar = screen.getByRole('progressbar', { name: 'Export in progress' });
    expect(bar).toHaveAttribute('aria-valuenow', '100');
    expect(bar).toHaveAttribute('aria-valuetext', '100%');
    expect(container.querySelector('.or-progress')).toHaveStyle({ '--or-progress-value': '100%' });
  });

  it.each([
    ['zero', 0],
    ['negative', -50],
  ])('falls back to the default scale on a %s max instead of reporting NaN', (_name, max) => {
    const bar = renderBar(<Progress label="Export in progress" value={40} max={max} />);
    expect(bar).toHaveAttribute('aria-valuemax', '100');
    expect(bar).toHaveAttribute('aria-valuenow', '40');
    expect(bar).toHaveAttribute('aria-valuetext', '40%');
  });

  it('omits aria-valuenow and aria-valuetext when there is no value', () => {
    const { container } = render(<Progress label="Export in progress" />);
    const bar = screen.getByRole('progressbar', { name: 'Export in progress' });
    expect(bar).not.toHaveAttribute('aria-valuenow');
    expect(bar).not.toHaveAttribute('aria-valuetext');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
    expect(container.querySelector('.or-progress')).toHaveClass('or-progress--indeterminate');
  });

  it('reads a value that is not a finite number as an unknown amount', () => {
    const { container } = render(<Progress label="Export in progress" value={Number.NaN} />);
    const bar = screen.getByRole('progressbar', { name: 'Export in progress' });
    expect(bar).not.toHaveAttribute('aria-valuenow');
    expect(container.querySelector('.or-progress')).toHaveClass('or-progress--indeterminate');
  });

  it('keeps the label and drops the percentage when an indeterminate bar shows its value', () => {
    const { container } = render(<Progress label="Export in progress" showValue />);
    const labelNode = screen.getByText('Export in progress');
    expect(labelNode).toHaveClass('or-progress__label');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-labelledby', labelNode.id);
    expect(container.querySelector('.or-progress__value')).toBeNull();
  });

  it.each([
    ['accent', 'or-progress--accent'],
    ['success', 'or-progress--success'],
    ['danger', 'or-progress--danger'],
  ] as const)('carries the %s tone as a modifier, never as the only signal', (tone, expected) => {
    const { container } = render(
      <Progress label="Export in progress" value={64} tone={tone} showValue />
    );
    expect(container.querySelector('.or-progress')).toHaveClass(expected);
    expect(screen.getByRole('progressbar', { name: 'Export in progress' })).toBeInTheDocument();
    expect(container.querySelector('.or-progress__value')).toHaveTextContent('64%');
  });

  it.each([
    ['sm', 'or-progress--sm'],
    ['md', 'or-progress--md'],
    ['lg', 'or-progress--lg'],
  ] as const)('renders the %s track thickness as a modifier', (size, expected) => {
    const { container } = render(<Progress label="Export in progress" value={64} size={size} />);
    expect(container.querySelector('.or-progress')).toHaveClass(expected);
  });

  it('sets the fill width as an inline custom property', () => {
    const { container } = render(<Progress label="Export in progress" value={1284} max={2000} />);
    const block = container.querySelector('.or-progress');
    expect(block).toHaveStyle({ '--or-progress-value': '64%' });
    expect(container.querySelector('.or-progress__fill')).toBeInTheDocument();
  });

  it('keeps a caller style alongside the fill custom property', () => {
    const { container } = render(
      <Progress label="Export in progress" value={64} style={{ maxWidth: '320px' }} />
    );
    const block = container.querySelector('.or-progress');
    expect(block).toHaveStyle({ maxWidth: '320px' });
    expect(block).toHaveStyle({ '--or-progress-value': '64%' });
  });

  it('merges a caller className instead of replacing the component classes', () => {
    const { container } = render(
      <Progress label="Export in progress" value={64} className="or-export__bar" />
    );
    expect(container.querySelector('.or-progress')).toHaveClass('or-progress', 'or-export__bar');
  });

  it('uses a caller-supplied id for the label association and forwards native attributes', () => {
    render(
      <Progress
        id="export-bundle"
        data-testid="export-bundle"
        label="Export in progress"
        value={64}
        showValue
      />
    );
    const block = screen.getByTestId('export-bundle');
    expect(block).toHaveAttribute('id', 'export-bundle');
    expect(screen.getByText('Export in progress')).toHaveAttribute('id', 'export-bundle-label');
    expect(screen.getByRole('progressbar', { name: 'Export in progress' })).toHaveAttribute(
      'aria-labelledby',
      'export-bundle-label'
    );
  });
});

/** Render a bar and hand back its track, which is where the whole value set lives. */
function renderBar(ui: ReactElement): HTMLElement {
  render(ui);
  return screen.getByRole('progressbar');
}
