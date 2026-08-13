import type { Metadata } from 'next';

import { IS_MOCK_MODE } from '@/lib/api/config';
import { MOCK_PATIENTS } from '@/lib/api/mock/fixtures';

import { PatientChartScreen } from './PatientChartScreen';

/**
 * CH-01 Chart home.
 *
 * The route file is a server component and owns metadata only. The title is
 * "PATIENTSSON, Testina - Chart" rather than "Chart", because two browser tabs
 * open on two patients must be impossible to confuse, and the tab strip is
 * often all a tired person has to tell them apart.
 *
 * It reads the fixtures directly rather than through `@/lib/api`, whose hooks
 * are client modules and this file is not. In live mode there is no server-side
 * patient read wired up yet, so the title falls back to "Chart", which is
 * honest rather than wrong.
 */
interface PatientChartPageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PatientChartPageProps): Promise<Metadata> {
  const { id } = await params;
  if (!IS_MOCK_MODE) return { title: 'Chart' };

  const patient = MOCK_PATIENTS.find((record) => record.id === id);
  if (!patient) return { title: 'Chart' };

  const given = patient.name.preferred ?? patient.name.given;
  return { title: `${patient.name.family.toUpperCase()}, ${given} - Chart` };
}

export default async function PatientChartPage({ params }: PatientChartPageProps) {
  const { id } = await params;
  return <PatientChartScreen patientId={id} />;
}
