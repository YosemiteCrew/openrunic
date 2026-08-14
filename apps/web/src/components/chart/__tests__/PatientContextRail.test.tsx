import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PatientContextRail } from '@/components/chart';
import { MOCK_NOW, MOCK_PATIENTS } from '@/lib/api';
import type { Patient } from '@/lib/api';
import type { ChartSummary } from '@/lib/api/chart';
import { emptyChart, mockChartFor } from '@/lib/api/mock/chart';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => '/patients',
}));

function patientByMrn(mrn: string): Patient {
  const found = MOCK_PATIENTS.find((patient) => patient.mrn === mrn);
  if (!found) throw new Error(`Fixture missing for MRN ${mrn}`);
  return found;
}

const testina = patientByMrn('OR-100482');
const demonstra = patientByMrn('OR-100608');
const lorem = patientByMrn('OR-101025');

function renderRail(
  patient: Patient,
  chart: ChartSummary,
  onOpenSection?: (tabId: string) => void
) {
  return render(
    <PatientContextRail
      patient={patient}
      chart={chart}
      nextAppointment={null}
      now={MOCK_NOW}
      onOpenSection={onOpenSection}
    />
  );
}

describe('PatientContextRail identity', () => {
  it('calls the patient what they asked to be called, and keeps the legal name visible', () => {
    renderRail(testina, mockChartFor(testina.id));

    expect(screen.getByText('Tess Patientsson')).toBeInTheDocument();
    expect(screen.getByText('Legal name Testina, she/her')).toBeInTheDocument();
    expect(screen.getByText('OR-100482')).toBeInTheDocument();
  });

  it('reads age against the clinic clock, never the machine clock', () => {
    renderRail(testina, mockChartFor(testina.id));
    // Born 14 Mar 1987, read on 12 Aug 2026.
    expect(screen.getByText(/39 y, born 14 Mar 1987/)).toBeInTheDocument();
  });

  it('replaces the identity block with the date of death for a deceased patient', () => {
    renderRail(lorem, mockChartFor(lorem.id));
    expect(screen.getByText(/Deceased 2 Apr 2026/)).toBeInTheDocument();
  });

  it('flags an interpreter need rather than hiding it in the demographics tab', () => {
    renderRail(demonstra, mockChartFor(demonstra.id));
    expect(screen.getByText('Interpreter needed, sv-SE')).toBeInTheDocument();
  });
});

describe('PatientContextRail allergies', () => {
  it('shows every allergy with its severity as a word, never a count', () => {
    renderRail(testina, mockChartFor(testina.id));

    expect(screen.getByText('Penicillin - Severe')).toBeInTheDocument();
    expect(screen.getByText('Peanut - Moderate')).toBeInTheDocument();
    expect(screen.getByText(/hives and facial swelling/i)).toBeInTheDocument();
  });

  it('says "no known allergies" as an affirmed fact, with the date it was affirmed', () => {
    renderRail(demonstra, mockChartFor(demonstra.id));

    expect(screen.getByText('No known allergies')).toBeInTheDocument();
    expect(screen.getByText('Affirmed 12 Aug 2026')).toBeInTheDocument();
  });

  it('distinguishes "not recorded" from "none", and prompts for it', () => {
    renderRail(testina, emptyChart(testina.id));

    expect(screen.getByText('Allergies not recorded')).toBeInTheDocument();
    expect(screen.getByText(/Nobody has asked yet/)).toBeInTheDocument();
    expect(screen.queryByText('No known allergies')).not.toBeInTheDocument();
  });
});

describe('PatientContextRail clinical summary', () => {
  it('counts active medications and names the first few', () => {
    renderRail(testina, mockChartFor(testina.id));
    expect(screen.getByText('3 active medications')).toBeInTheDocument();
    expect(screen.getByText('Lisinopril 10 mg tablet')).toBeInTheDocument();
  });

  it('lists active problems and hides resolved ones behind the summary', () => {
    renderRail(testina, mockChartFor(testina.id));

    const problems = screen.getByRole('region', { name: 'Problems' });
    expect(within(problems).getByText('Essential hypertension')).toBeInTheDocument();
    expect(within(problems).queryByText('Vitamin D deficiency')).not.toBeInTheDocument();
  });

  it('surfaces unsigned documentation with a link to the note', () => {
    renderRail(testina, mockChartFor(testina.id));

    expect(screen.getByText('1 unsigned note')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open the 12 Aug note/ })).toHaveAttribute(
      'href',
      '/encounters/0192f1a0-0000-7000-8000-00000000e001'
    );
  });

  it('says the balance is due, in words as well as in tint', () => {
    renderRail(testina, mockChartFor(testina.id));

    expect(screen.getByText('$38.00')).toBeInTheDocument();
    expect(screen.getByText('Patient responsibility, due')).toBeInTheDocument();
  });

  it('says the balance is settled when nothing is owed', () => {
    renderRail(demonstra, mockChartFor(demonstra.id));
    expect(screen.getByText('Patient responsibility, settled')).toBeInTheDocument();
  });

  it('says "No appointment scheduled" rather than leaving the line blank', () => {
    renderRail(demonstra, mockChartFor(demonstra.id));
    expect(screen.getByText('No appointment scheduled')).toBeInTheDocument();
  });
});

describe('PatientContextRail navigation', () => {
  it('deep-links a section heading to the chart tab that owns it', () => {
    const onOpenSection = vi.fn();
    renderRail(testina, mockChartFor(testina.id), onOpenSection);

    fireEvent.click(screen.getByRole('button', { name: 'Medications' }));
    expect(onOpenSection).toHaveBeenCalledWith('medications');
  });

  it('links to the chart instead when the screen has no tabs of its own', () => {
    render(
      <PatientContextRail
        patient={testina}
        chart={mockChartFor(testina.id)}
        nextAppointment={null}
        now={MOCK_NOW}
        patientHref={`/patients/${testina.id}`}
      />
    );

    expect(screen.getByRole('link', { name: 'Medications' })).toHaveAttribute(
      'href',
      `/patients/${testina.id}`
    );
  });
});
