import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { OrderWarnings } from '@/components/orders';
import type { OrderWarning } from '@/lib/api';

/**
 * The three tiers, and the rule that separates them: information is a line,
 * caution asks to be read, and critical holds the signature until a reason is
 * chosen. Every tier names itself in words, so the colour is never the signal.
 */

const INFO: OrderWarning = {
  id: 'w-info',
  orderCode: 'LAB-LIPID',
  patientId: null,
  tier: 'INFO',
  title: 'Last lipid panel was in range',
  detail: 'The next one is due from 14 Feb 2027.',
};

const CAUTION: OrderWarning = {
  id: 'w-caution',
  orderCode: 'LAB-CREAT',
  patientId: null,
  tier: 'CAUTION',
  title: 'Creatinine resulted three days ago',
  detail: 'A repeat inside seven days rarely changes management.',
};

const CRITICAL: OrderWarning = {
  id: 'w-critical',
  orderCode: 'LAB-HBA1C',
  patientId: null,
  tier: 'CRITICAL',
  title: 'HbA1c ordered 10 Aug is still in progress',
  detail: 'A duplicate inside 30 days is not payable.',
  overrideReasons: ['The first specimen was rejected by the lab', 'Clinical change'],
};

describe('OrderWarnings', () => {
  it('names every tier in words, not colour alone', () => {
    render(
      <OrderWarnings
        warnings={[CRITICAL, CAUTION, INFO]}
        cleared={{}}
        onClear={vi.fn()}
        onRestore={vi.fn()}
      />
    );

    expect(screen.getByText('Critical')).toBeInTheDocument();
    expect(screen.getByText('Caution')).toBeInTheDocument();
    expect(screen.getByText('Information')).toBeInTheDocument();
  });

  it('gives information no control to click: there is nothing to do', () => {
    render(<OrderWarnings warnings={[INFO]} cleared={{}} onClear={vi.fn()} onRestore={vi.fn()} />);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('clears a caution with one click and no reason', () => {
    const onClear = vi.fn();
    render(
      <OrderWarnings warnings={[CAUTION]} cleared={{}} onClear={onClear} onRestore={vi.fn()} />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Acknowledge' }));
    expect(onClear).toHaveBeenCalledWith('w-caution', 'Acknowledged');
  });

  it('requires a chosen reason to override a critical, and reports which one', () => {
    const onClear = vi.fn();
    render(
      <OrderWarnings warnings={[CRITICAL]} cleared={{}} onClear={onClear} onRestore={vi.fn()} />
    );

    const alert = screen.getByRole('alert');
    fireEvent.change(within(alert).getByLabelText('Reason for overriding'), {
      target: { value: 'Clinical change' },
    });
    fireEvent.click(within(alert).getByRole('button', { name: 'Override and keep this order' }));

    expect(onClear).toHaveBeenCalledWith('w-critical', 'Clinical change');
  });

  it('shows what an overridden warning was cleared with, and offers the way back', () => {
    const onRestore = vi.fn();
    render(
      <OrderWarnings
        warnings={[CRITICAL]}
        cleared={{ 'w-critical': 'Clinical change' }}
        onClear={vi.fn()}
        onRestore={onRestore}
      />
    );

    expect(screen.getByText('Overridden')).toBeInTheDocument();
    expect(screen.getByText('Clinical change')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Undo, keep the override open/ }));
    expect(onRestore).toHaveBeenCalledWith('w-critical');
  });

  it('renders nothing at all when the draft raises no warning', () => {
    const { container } = render(
      <OrderWarnings warnings={[]} cleared={{}} onClear={vi.fn()} onRestore={vi.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
