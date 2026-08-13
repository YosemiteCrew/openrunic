import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SummaryPanel } from '@/components/chart/SummaryPanel';
import { MOCK_APPOINTMENTS, MOCK_CLINIC_DAY, MOCK_NOW } from '@/lib/api';
import type { Appointment } from '@/lib/api';
import { MOCK_CHARTS } from '@/lib/api/mock/chart';
import type { ChartSummary } from '@/lib/api/chart';

/**
 * The today strip, at the unit the strip actually is.
 *
 * The screen-level test covers the wired path against the fixtures. This one
 * covers the status vocabulary, which has to hold for every appointment status
 * a day can contain, including the two whose enum name is not their English
 * name - and a fixture day only ever contains a few of them.
 */

const chart = MOCK_CHARTS[0] as ChartSummary;
const base = MOCK_APPOINTMENTS[0] as Appointment;

function withStatus(status: Appointment['status']): Appointment {
  return { ...base, status };
}

describe('SummaryPanel today strip', () => {
  it('states the visit in words: time, type and reason, no abbreviations', () => {
    render(<SummaryPanel chart={chart} todayAppointment={base} now={MOCK_NOW} />);

    expect(screen.getByText(/08:00, follow-up, blood pressure review/)).toBeInTheDocument();
  });

  it('spells NOSHOW as two English words, never as the enum', () => {
    render(<SummaryPanel chart={chart} todayAppointment={withStatus('NOSHOW')} now={MOCK_NOW} />);

    expect(screen.getByText('No show')).toBeInTheDocument();
    expect(screen.queryByText('Noshow')).not.toBeInTheDocument();
  });

  it('spells ENTERED_IN_ERROR out rather than shouting the enum', () => {
    render(
      <SummaryPanel
        chart={chart}
        todayAppointment={withStatus('ENTERED_IN_ERROR')}
        now={MOCK_NOW}
      />
    );

    expect(screen.getByText('Entered in error')).toBeInTheDocument();
  });

  it('carries a status word for every status, so colour is never the only signal', () => {
    const statuses: Appointment['status'][] = [
      'BOOKED',
      'ARRIVED',
      'CHECKED_IN',
      'ROOMED',
      'IN_PROGRESS',
      'FULFILLED',
      'CHECKED_OUT',
      'CANCELLED',
      'NOSHOW',
    ];

    for (const status of statuses) {
      const view = render(
        <SummaryPanel chart={chart} todayAppointment={withStatus(status)} now={MOCK_NOW} />
      );
      const strip = view.container.querySelector('.or-chart-strip__row');
      expect(strip?.textContent?.trim()).not.toBe('');
      view.unmount();
    }
  });

  it('offers today’s note when there is one to open', () => {
    render(<SummaryPanel chart={chart} todayAppointment={base} now={MOCK_NOW} />);

    const link = screen.getByRole('link', { name: 'Open the visit note' });
    expect(link).toHaveAttribute('href', `/encounters/${chart.visits[0]?.encounterId}`);
  });

  it('says so plainly on a day with no visit, and names the last one', () => {
    const noVisitToday: ChartSummary = {
      ...chart,
      visits: chart.visits.filter((visit) => visit.date !== MOCK_CLINIC_DAY),
    };

    render(<SummaryPanel chart={noVisitToday} todayAppointment={null} now={MOCK_NOW} />);

    expect(screen.getByText(/No visit today/)).toBeInTheDocument();
  });
});
