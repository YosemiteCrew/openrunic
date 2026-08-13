import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Money } from '@/components/Money';
import { Notice } from '@/components/Notice';
import { PageHeader } from '@/components/PageHeader';
import { PlainTerm } from '@/components/PlainTerm';
import { ProgressMeter } from '@/components/ProgressMeter';
import { RangeBadge } from '@/components/RangeBadge';

describe('PageHeader', () => {
  it('renders exactly one h1, with its overline and lede', () => {
    render(<PageHeader lede="What needs you today." overline="Your care" title="Home" />);

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Home');
    expect(screen.getByText('Your care')).toBeInTheDocument();
    expect(screen.getByText('What needs you today.')).toBeInTheDocument();
  });
});

describe('Money', () => {
  it('renders a plain amount', () => {
    render(<Money value={{ amountMinor: 8450, currency: 'GBP' }} />);

    expect(screen.getByText('£84.50')).toBeInTheDocument();
    expect(screen.queryByText('credit')).not.toBeInTheDocument();
  });

  it('names the currency when asked', () => {
    render(<Money showCode value={{ amountMinor: 8450, currency: 'GBP' }} />);

    expect(screen.getByText('£84.50 GBP')).toBeInTheDocument();
  });

  it('labels a credit in words rather than leaving it to a minus sign', () => {
    render(<Money value={{ amountMinor: -1200, currency: 'GBP' }} />);

    expect(screen.getByText('£12.00')).toBeInTheDocument();
    expect(screen.getByText('credit')).toBeInTheDocument();
  });
});

describe('PlainTerm', () => {
  it('puts the plain-language gloss beside the coded term', () => {
    render(<PlainTerm code="E03.9" plain="Underactive thyroid" term="Hypothyroidism" />);

    expect(screen.getByText('Hypothyroidism, E03.9')).toBeInTheDocument();
    expect(screen.getByText('Underactive thyroid')).toBeInTheDocument();
  });

  it('omits the comma when the record has no code', () => {
    render(<PlainTerm plain="Seasonal flu" term="Influenza" />);

    expect(screen.getByText('Influenza')).toBeInTheDocument();
  });
});

describe('Notice', () => {
  it('is a labelled aside carrying the caution', () => {
    render(<Notice title="Not for emergencies">Replies can take a few working days.</Notice>);

    const notice = screen.getByRole('complementary', { name: 'Not for emergencies' });
    expect(notice).toHaveTextContent('Replies can take a few working days.');
  });
});

describe('ProgressMeter', () => {
  it('exposes the count in words as well as the numbers', () => {
    render(<ProgressMeter done={2} label="2 of 3 answered" total={3} />);

    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '2');
    expect(bar).toHaveAttribute('aria-valuemax', '3');
    expect(bar).toHaveAttribute('aria-valuetext', '2 of 3 answered');
    expect(screen.getByText('2 of 3 answered')).toBeInTheDocument();
  });

  it('does not divide by zero on a form with no questions', () => {
    render(<ProgressMeter done={0} label="0 of 0 answered" total={0} />);

    expect(screen.getByRole('progressbar')).toHaveStyle({ '--portal-progress-fill': '0%' });
  });
});

describe('RangeBadge', () => {
  it('always carries the verdict in words, whatever the tone', () => {
    const { rerender } = render(<RangeBadge label="In the usual range" range="in-range" />);
    expect(screen.getByText('In the usual range')).toBeInTheDocument();

    rerender(<RangeBadge label="Above the usual range" range="out-of-range" />);
    expect(screen.getByText('Above the usual range')).toBeInTheDocument();

    rerender(<RangeBadge label="No usual range recorded" range="unknown" />);
    expect(screen.getByText('No usual range recorded')).toBeInTheDocument();
  });
});
