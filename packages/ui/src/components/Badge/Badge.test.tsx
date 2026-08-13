import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge } from './Badge';

describe('Badge', () => {
  it('renders its label in the neutral tone by default', () => {
    render(<Badge>Awaiting lab</Badge>);
    const badge = screen.getByText('Awaiting lab');
    expect(badge).toHaveClass('or-badge', 'or-badge--neutral');
  });

  it.each([
    ['success', 'or-badge--success'],
    ['neutral', 'or-badge--neutral'],
    ['danger', 'or-badge--danger'],
    ['accent', 'or-badge--accent'],
    ['ink', 'or-badge--ink'],
  ] as const)('renders the %s tone', (tone, expected) => {
    const { container } = render(<Badge tone={tone}>Above range</Badge>);
    expect(container.querySelector('.or-badge')).toHaveClass(expected);
  });

  it.each(['success', 'neutral', 'danger', 'accent', 'ink'] as const)(
    'pairs the %s tone with a decorative default icon and a text label',
    (tone) => {
      const { container } = render(<Badge tone={tone}>In range</Badge>);
      const icon = container.querySelector('.or-badge__icon');
      expect(icon).toBeInTheDocument();
      expect(icon).toHaveAttribute('aria-hidden', 'true');
      expect(screen.getByText('In range')).toBeInTheDocument();
    }
  );

  it('drops the icon but keeps the label when icon is null', () => {
    const { container } = render(
      <Badge tone="success" icon={null}>
        In range
      </Badge>
    );
    expect(container.querySelector('.or-badge__icon')).toBeNull();
    expect(screen.getByText('In range')).toBeInTheDocument();
  });

  it('lets an explicit slug override the tone default, and degrades on a typo', () => {
    const { container, rerender } = render(
      <Badge tone="success" icon="flask-conical">
        Sample received
      </Badge>
    );
    expect(container.querySelector('.or-badge__icon')).toBeInTheDocument();

    rerender(
      <Badge tone="success" icon="not-a-real-lucide-icon">
        Sample received
      </Badge>
    );
    expect(container.querySelector('.or-badge__icon')).toBeNull();
    expect(screen.getByText('Sample received')).toBeInTheDocument();
  });

  it('merges className and forwards native attributes', () => {
    render(
      <Badge className="or-results__badge" data-testid="range" title="Reference range 4.0 to 5.9">
        Above range
      </Badge>
    );
    const badge = screen.getByTestId('range');
    expect(badge).toHaveClass('or-badge', 'or-badge--neutral', 'or-results__badge');
    expect(badge).toHaveAttribute('title', 'Reference range 4.0 to 5.9');
  });

  it('can announce itself as a status region when the caller asks for one', () => {
    render(
      <Badge tone="danger" role="status">
        Above range
      </Badge>
    );
    expect(screen.getByRole('status')).toHaveTextContent('Above range');
  });
});
