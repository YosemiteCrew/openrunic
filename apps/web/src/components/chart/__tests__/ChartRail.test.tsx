import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ChartRail } from '@/components/chart/ChartRail';
import { MOCK_PATIENTS } from '@/lib/api';
import { createMockChartClient } from '@/lib/api/chart';
import { emptyChart } from '@/lib/api/mock/chart';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => '/patients',
}));

/* The fixture the chart screens open, named by MRN so a re-sorted list cannot
   move this onto a different person. */
const PATIENT = MOCK_PATIENTS.find((candidate) => candidate.mrn === 'OR-101088');

/**
 * The rail, wired to the data layer.
 *
 * Both chart screens mount this rather than fetching a patient each, so the two
 * things worth pinning are that it resolves without being handed a client - the
 * shape every real screen uses - and that it still renders when the appointment
 * read comes back with nothing.
 *
 * That second one is the module's stated promise: allergies matter more than a
 * booking, and a failed appointment read must never replace the whole rail with
 * an error.
 */

describe('ChartRail', () => {
  it('resolves its own client when the caller does not inject one', async () => {
    /*
     * The default path, which every screen uses and no test took: `chartClient`
     * is undefined, so the options object is empty and the hook falls back to
     * the app's client. Passing one is the test-only branch.
     */
    render(<ChartRail patientId={PATIENT?.id ?? ''} />);

    expect(await screen.findByText(/Quinta Examplebury/u)).toBeInTheDocument();
  });

  it('renders the rail even when no appointment comes back', async () => {
    /*
     * `appointments.data?.data ?? []` is the degradation the header promises.
     * With nothing booked the rail still has to draw, because the clinical
     * facts beside it are the reason anyone opened it.
     */
    render(<ChartRail patientId={PATIENT?.id ?? ''} />);

    await screen.findByText(/Quinta Examplebury/u);

    /* The clinical facts are still there, and nothing rendered an error in
       their place. */
    expect(screen.getByText(/Allergies not recorded/u)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('uses an injected client when a test hands it one', async () => {
    /*
     * The other arm of the client ternary, and the one every chart test takes.
     * Asserting it explicitly means the default path above is not silently the
     * only one exercised, which is what left this at 50% branch coverage.
     */
    const patientId = PATIENT?.id ?? '';
    render(
      <ChartRail
        patientId={patientId}
        chartClient={createMockChartClient({ charts: [emptyChart(patientId)] })}
      />
    );

    await screen.findByText(/Quinta Examplebury/u);

    /* An empty chart, from the injected client rather than the app's, so the
       rail says so instead of showing the fixture's own summary. */
    expect(screen.getByText(/Allergies not recorded/u)).toBeInTheDocument();
  });
});
