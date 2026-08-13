import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { EncounterNoteScreen } from '@/app/encounters/[id]/EncounterNoteScreen';
import { ApiError } from '@/lib/api';
import { createMockChartClient } from '@/lib/api/chart';
import type { ChartClient } from '@/lib/api/chart';
import { MOCK_ENCOUNTER_IDS } from '@/lib/api/mock/chart';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => '/encounters/0192f1a0-0000-7000-8000-00000000e001',
}));

function chartThatFails(): ChartClient {
  return createMockChartClient({ failure: new ApiError('offline', { kind: 'network' }) });
}

describe('EncounterNoteScreen', () => {
  it('names the visit in the heading and the note in the description', async () => {
    render(<EncounterNoteScreen encounterId={MOCK_ENCOUNTER_IDS.testinaUnsigned} />);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Visit note' })
    ).toBeInTheDocument();
    expect(screen.getByText('Follow-up, 12 Aug 2026, Dr. Okafor, MD')).toBeInTheDocument();
  });

  it('carries the patient context rail, allergies and all', async () => {
    render(<EncounterNoteScreen encounterId={MOCK_ENCOUNTER_IDS.testinaUnsigned} />);

    const rail = await screen.findByRole('complementary', { name: 'Page context' });
    expect(await within(rail).findByText('Penicillin - Severe')).toBeInTheDocument();
    expect(within(rail).getByText('Tess Patientsson')).toBeInTheDocument();
  });

  it('links the rail back to the chart, since the note has no tabs of its own', async () => {
    render(<EncounterNoteScreen encounterId={MOCK_ENCOUNTER_IDS.testinaUnsigned} />);

    const rail = await screen.findByRole('complementary', { name: 'Page context' });
    expect(await within(rail).findByRole('link', { name: 'Medications' })).toHaveAttribute(
      'href',
      expect.stringContaining('/patients/')
    );
  });

  it('renders a draft note as a draft, not as an unsigned one', async () => {
    render(<EncounterNoteScreen encounterId={MOCK_ENCOUNTER_IDS.aikoDraft} />);

    expect(await screen.findByText('Draft')).toBeInTheDocument();
    expect(screen.getByText(/not part of the record until it is signed/)).toBeInTheDocument();
  });

  it('says the note was not found, and what to do about it', async () => {
    render(<EncounterNoteScreen encounterId="0192f1a0-0000-7000-8000-0000000000ff" />);

    expect(await screen.findByText('Not found')).toBeInTheDocument();
    expect(screen.getByText(/could not find this visit note/)).toBeInTheDocument();
  });

  it('says what happened and offers a retry when the read fails', async () => {
    render(
      <EncounterNoteScreen
        encounterId={MOCK_ENCOUNTER_IDS.testinaUnsigned}
        chartClient={chartThatFails()}
      />
    );

    expect(await screen.findByText('No connection to the server')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Try again/ })).toBeInTheDocument();
  });

  it('registers signing and the chart with the command palette', async () => {
    render(<EncounterNoteScreen encounterId={MOCK_ENCOUNTER_IDS.testinaUnsigned} />);
    await screen.findByRole('textbox', { name: 'Plan' });

    fireEvent.keyDown(window, { key: 'k', metaKey: true });

    expect(await screen.findByRole('option', { name: /Sign note/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Open the chart/ })).toBeInTheDocument();
  });

  it('offers an addendum rather than signing once the note is signed', async () => {
    render(<EncounterNoteScreen encounterId={MOCK_ENCOUNTER_IDS.testinaSigned} />);
    await screen.findByText('Signed and locked');

    fireEvent.keyDown(window, { key: 'k', metaKey: true });

    expect(await screen.findByRole('option', { name: /Add addendum/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Sign note/ })).not.toBeInTheDocument();
  });
});
