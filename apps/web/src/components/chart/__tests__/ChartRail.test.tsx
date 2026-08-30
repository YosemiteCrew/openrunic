import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ChartRail } from '@/components/chart/ChartRail';
import { MOCK_PATIENTS } from '@/lib/api';
import { createMockChartClient } from '@/lib/api/chart';
import { mockChartFor } from '@/lib/api/mock/chart';

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

  it('renders the rail even when the appointment read fails', async () => {
    /*
     * The degradation the module header promises: allergies matter more than a
     * booking, and a failed appointment read must never replace the whole rail
     * with an error.
     *
     * The read is made to fail rather than relying on a patient who happens to
     * have no appointment. The first version of this used the fixture above,
     * which has a booked appointment - so it asserted the degradation while
     * exercising the ordinary path, and would have passed with the fallback
     * removed.
     */
    vi.resetModules();
    vi.doMock('@/lib/api', async () => {
      const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
      return {
        ...actual,
        // The shape a failed read leaves behind: no data, so the `?? []`
        // fallback is the only thing standing between the rail and a crash.
        useAppointments: () => ({ status: 'error', data: undefined, error: new Error('refused') }),
      };
    });
    const { ChartRail: Rail } = await import('@/components/chart/ChartRail');

    render(<Rail patientId={PATIENT?.id ?? ''} />);

    await screen.findByText(/Quinta Examplebury/u);

    expect(screen.getByText(/Allergies not recorded/u)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    vi.doUnmock('@/lib/api');
    vi.resetModules();
  });

  it('uses an injected client when a test hands it one', async () => {
    /*
     * The other arm of the client ternary, and the one every chart test takes.
     * Asserting it explicitly means the default path above is not silently the
     * only one exercised, which is what left this at 50% branch coverage.
     */
    /*
     * The injected chart is somebody else's, and a full one.
     *
     * The first version injected `emptyChart` for this patient, whose default
     * chart is already empty - identical output, so the test passed whether or
     * not the client was used at all. Borrowing a populated chart makes the
     * difference visible: a problem name that the default chart for this
     * patient does not contain.
     */
    const patientId = PATIENT?.id ?? '';
    const populated = MOCK_PATIENTS.find((candidate) => candidate.mrn === 'OR-100482');
    expect(populated).toBeDefined();
    const borrowed = { ...mockChartFor(populated?.id ?? ''), patientId };

    render(
      <ChartRail
        patientId={patientId}
        chartClient={createMockChartClient({ charts: [borrowed] })}
      />
    );

    await screen.findByText(/Quinta Examplebury/u);

    expect(screen.getByText(/Essential hypertension/u)).toBeInTheDocument();
    expect(screen.queryByText(/No problems recorded/u)).not.toBeInTheDocument();
  });
});
