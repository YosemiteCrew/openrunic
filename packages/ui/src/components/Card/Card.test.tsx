import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Card } from './Card';

describe('Card', () => {
  it('renders children inside a cream section by default', () => {
    const { container } = render(<Card>118 / 74 mmHg</Card>);
    const card = container.querySelector('section');
    expect(card).toHaveClass('or-card', 'or-card--cream');
    expect(card).not.toHaveClass('or-card--raised');
    expect(screen.getByText('118 / 74 mmHg')).toBeInTheDocument();
  });

  it.each([
    ['cream', 'or-card--cream'],
    ['bone', 'or-card--bone'],
    ['white', 'or-card--white'],
    ['inverse', 'or-card--inverse'],
  ] as const)('renders the %s tone', (tone, expected) => {
    const { container } = render(<Card tone={tone}>Blood pressure</Card>);
    expect(container.querySelector('section')).toHaveClass(expected);
  });

  it('names the region with its own title', () => {
    render(
      <Card overline="Vitals" title="Blood pressure">
        <p className="or-body">118 / 74 mmHg, measured this morning.</p>
      </Card>
    );
    const region = screen.getByRole('region', { name: 'Blood pressure' });
    const heading = screen.getByRole('heading', { level: 2, name: 'Blood pressure' });
    expect(region).toContainElement(heading);
    expect(region).toHaveAttribute('aria-labelledby', heading.id);
    expect(screen.getByText('Vitals')).toHaveClass('or-overline', 'or-card__overline');
  });

  it('leaves the section unnamed when there is no title', () => {
    const { container } = render(<Card overline="Vitals">118 / 74 mmHg</Card>);
    const card = container.querySelector('section');
    expect(card).not.toHaveAttribute('aria-labelledby');
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });

  it('pins the footer below a hairline and omits it when absent', () => {
    const { container, rerender } = render(<Card title="Records">Nothing yet.</Card>);
    expect(container.querySelector('.or-card__footer')).toBeNull();

    rerender(
      <Card title="Records" footer={<span>Updated 12 Aug</span>}>
        Nothing yet.
      </Card>
    );
    expect(container.querySelector('.or-card__footer')).toHaveTextContent('Updated 12 Aug');
  });

  it('adds the raised shadow only when asked', () => {
    const { container } = render(<Card raised>Observation/8867-4</Card>);
    expect(container.querySelector('section')).toHaveClass('or-card--raised');
  });

  it('merges className and forwards native attributes', () => {
    const { container } = render(
      <Card className="or-dashboard-tile" data-testid="vitals" id="vitals-card">
        118 / 74 mmHg
      </Card>
    );
    const card = container.querySelector('section');
    expect(card).toHaveClass('or-card', 'or-dashboard-tile');
    expect(card).toHaveAttribute('id', 'vitals-card');
    expect(screen.getByTestId('vitals')).toBe(card);
  });

  it('derives the title id from a caller-supplied id', () => {
    render(
      <Card id="vitals-card" title="Blood pressure">
        118 / 74 mmHg
      </Card>
    );
    expect(screen.getByRole('heading', { level: 2 })).toHaveAttribute('id', 'vitals-card-title');
  });

  it('titles a card at level 2, so a page outline never skips from h1 to h3', () => {
    render(<Card title="Blood pressure">118 / 74 mmHg</Card>);
    expect(screen.getByRole('heading', { level: 2, name: 'Blood pressure' })).toBeInTheDocument();
  });

  it('takes a deeper level for a card nested inside another card', () => {
    render(
      <Card title="Vitals">
        <Card headingLevel={3} title="Blood pressure">
          118 / 74 mmHg
        </Card>
      </Card>
    );

    expect(screen.getByRole('heading', { level: 2, name: 'Vitals' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Blood pressure' })).toBeInTheDocument();
  });

  it('keeps the card-title type ramp whatever the heading level', () => {
    render(
      <Card headingLevel={4} title="Blood pressure">
        118 / 74 mmHg
      </Card>
    );

    expect(screen.getByRole('heading', { level: 4 })).toHaveClass('or-h3', 'or-card__title');
  });
});
