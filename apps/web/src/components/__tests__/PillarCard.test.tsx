import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PillarCard } from '../PillarCard';

describe('PillarCard', () => {
  it('renders the title as a heading', () => {
    render(<PillarCard title="Hospitals" description="Run your hospital on an open EMR." />);
    expect(screen.getByRole('heading', { level: 2, name: 'Hospitals' })).toBeInTheDocument();
  });

  it('renders the description', () => {
    render(<PillarCard title="Patients" description="Own your health data." />);
    expect(screen.getByText('Own your health data.')).toBeInTheDocument();
  });
});
