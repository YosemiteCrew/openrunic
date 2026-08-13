import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PatientChartScreen } from '@/app/patients/[id]/PatientChartScreen';
import { ApiError, MOCK_PATIENTS } from '@/lib/api';
import type { Patient } from '@/lib/api';
import { createMockChartClient } from '@/lib/api/chart';
import type { ChartClient } from '@/lib/api/chart';
import { emptyChart } from '@/lib/api/mock/chart';

const push = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => '/patients/0192f1a0-0000-7000-8000-00000000p001',
}));

function patientByMrn(mrn: string): Patient {
  const found = MOCK_PATIENTS.find((patient) => patient.mrn === mrn);
  if (!found) throw new Error(`Fixture missing for MRN ${mrn}`);
  return found;
}

const testina = patientByMrn('OR-100482');

/** A chart read that fails the way a dropped connection fails. */
function chartThatFails(): ChartClient {
  return {
    mode: 'mock',
    summary: {
      get: () => Promise.reject(new ApiError('offline', { kind: 'network' })),
    },
    notes: {
      get: () => Promise.reject(new ApiError('offline', { kind: 'network' })),
    },
  };
}

beforeEach(() => {
  push.mockClear();
});

describe('PatientChartScreen', () => {
  it('heads the page with the patient, not with the word "chart"', async () => {
    render(<PatientChartScreen patientId={testina.id} />);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Tess Patientsson' })
    ).toBeInTheDocument();
  });

  it('opens on the summary, with the rail beside it', async () => {
    render(<PatientChartScreen patientId={testina.id} />);

    expect(await screen.findByRole('tab', { name: /Summary/ })).toHaveAttribute(
      'aria-selected',
      'true'
    );

    const rail = await screen.findByRole('complementary', { name: 'Page context' });
    expect(within(rail).getByText('Penicillin - Severe')).toBeInTheDocument();
  });

  it('shows today first, with the visit status as a word', async () => {
    render(<PatientChartScreen patientId={testina.id} />);

    // She was seen at 08:00 today for the blood pressure follow-up. The strip
    // leads with it and states the outcome in a word, never in colour alone.
    expect(await screen.findByText(/08:00, follow-up, blood pressure review/)).toBeInTheDocument();
    expect(screen.getByText('Fulfilled')).toBeInTheDocument();
  });

  it('offers the unsigned note as the page’s one primary action', async () => {
    render(<PatientChartScreen patientId={testina.id} />);

    const action = await screen.findByRole('link', { name: /Open visit note/ });
    expect(action).toHaveAttribute('href', '/encounters/0192f1a0-0000-7000-8000-00000000e001');
  });

  it('switches to a record tab on click and renders its table', async () => {
    render(<PatientChartScreen patientId={testina.id} />);

    fireEvent.click(await screen.findByRole('tab', { name: /Medications/ }));

    expect(await screen.findByRole('table', { name: 'Active medications' })).toBeInTheDocument();
    expect(screen.getByText('Take 1 tablet by mouth each morning')).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Discontinued medications' })).toBeInTheDocument();
  });

  it('moves between tabs with the arrow keys, one tab stop for the strip', async () => {
    render(<PatientChartScreen patientId={testina.id} />);

    const summary = await screen.findByRole('tab', { name: /Summary/ });
    expect(summary).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: /Visits/ })).toHaveAttribute('tabindex', '-1');

    summary.focus();
    fireEvent.keyDown(summary, { key: 'ArrowRight' });

    const visits = screen.getByRole('tab', { name: /Visits/ });
    await waitFor(() => expect(visits).toHaveAttribute('aria-selected', 'true'));
    expect(visits).toHaveFocus();
    expect(await screen.findByRole('table', { name: 'Visits, most recent first' })).toBeVisible();
  });

  it('counts what is on each tab so nothing has to be opened to be seen', async () => {
    render(<PatientChartScreen patientId={testina.id} />);

    const results = await screen.findByRole('tab', { name: /Results/ });
    expect(results).toHaveTextContent('6');
  });

  it('states every result with a unit and a worded range state', async () => {
    render(<PatientChartScreen patientId={testina.id} />);

    fireEvent.click(await screen.findByRole('tab', { name: /Results/ }));

    const table = await screen.findByRole('table', { name: 'Results, most recent first' });
    expect(within(table).getByText('11.2 g/dL')).toBeInTheDocument();
    expect(within(table).getAllByText('Below range').length).toBeGreaterThan(0);
    expect(within(table).getByText('12 to 15.5 g/dL')).toBeInTheDocument();
  });

  it('marks an expired document with a word as well as a tint', async () => {
    render(<PatientChartScreen patientId={testina.id} />);

    fireEvent.click(await screen.findByRole('tab', { name: /Documents/ }));

    const table = await screen.findByRole('table', { name: 'Documents, most recent first' });
    expect(within(table).getByText('Expired 31 May 2026')).toBeInTheDocument();
    expect(within(table).getByText('Expires 30 Sep 2026')).toBeInTheDocument();
    expect(within(table).getByText('No expiry')).toBeInTheDocument();
  });

  it('guides a new patient with an empty chart rather than showing a blank panel', async () => {
    render(
      <PatientChartScreen
        patientId={testina.id}
        chartClient={createMockChartClient({ charts: [emptyChart(testina.id)] })}
      />
    );

    expect(await screen.findByText('No history yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Go to today.s schedule/ })).toHaveAttribute(
      'href',
      '/schedule'
    );
  });

  it('writes a per-tab empty state, not one generic blank', async () => {
    render(
      <PatientChartScreen
        patientId={testina.id}
        chartClient={createMockChartClient({ charts: [emptyChart(testina.id)] })}
      />
    );

    fireEvent.click(await screen.findByRole('tab', { name: /Results/ }));
    expect(await screen.findByText('No results for this patient')).toBeInTheDocument();
  });

  it('says what happened and offers a retry when the chart does not load', async () => {
    render(<PatientChartScreen patientId={testina.id} chartClient={chartThatFails()} />);

    // Both the rail and the panel read the chart, so both say what happened
    // rather than one of them going quietly blank.
    expect((await screen.findAllByText('No connection to the server')).length).toBe(2);
    expect(screen.getAllByRole('button', { name: /Try again/ }).length).toBe(2);
  });

  it('registers every tab and the note with the command palette', async () => {
    render(<PatientChartScreen patientId={testina.id} />);
    await screen.findByRole('tab', { name: /Summary/ });

    fireEvent.keyDown(window, { key: 'k', metaKey: true });

    expect(await screen.findByRole('option', { name: /Show medications/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Open the visit note/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Print chart summary/ })).toBeInTheDocument();
  });

  it('changes tab from the palette, keyboard only', async () => {
    render(<PatientChartScreen patientId={testina.id} />);
    await screen.findByRole('tab', { name: /Summary/ });

    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    fireEvent.click(await screen.findByRole('option', { name: /Show care team/ }));

    await waitFor(() =>
      expect(screen.getByRole('tab', { name: /Care team/ })).toHaveAttribute(
        'aria-selected',
        'true'
      )
    );
    expect(screen.getByText('Dr. Halvorsen')).toBeInTheDocument();
  });
});
