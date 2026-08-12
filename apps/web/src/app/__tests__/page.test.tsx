import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import HomePage from '../page';

describe('HomePage', () => {
  it('renders the product name and tagline', () => {
    render(<HomePage />);
    expect(screen.getByRole('heading', { level: 1, name: 'openrunic' })).toBeInTheDocument();
    expect(screen.getByText('Open-source operating system for human health')).toBeInTheDocument();
  });

  it('renders the three pillars', () => {
    render(<HomePage />);
    for (const pillar of ['Hospitals', 'Patients', 'Developers']) {
      expect(screen.getByRole('heading', { level: 2, name: pillar })).toBeInTheDocument();
    }
  });

  it('renders the compliance footnote', () => {
    render(<HomePage />);
    expect(
      screen.getByText('openrunic is open-source software, not a certified medical device.')
    ).toBeInTheDocument();
  });
});
