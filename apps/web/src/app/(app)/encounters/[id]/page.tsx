import type { Metadata } from 'next';

import { IS_MOCK_MODE } from '@/lib/api/config';
import { mockEncounterNote } from '@/lib/api/mock/chart';
import { MOCK_PATIENTS } from '@/lib/api/mock/fixtures';
import { pageMetadata, tabName } from '@/lib/i18n/metadata';

import { EncounterNoteScreen } from './EncounterNoteScreen';

/**
 * CH-02 Visit workspace, the note editor.
 *
 * "Encounter" survives in the URL because that is the FHIR resource name and
 * the route is part of the API-shaped surface; every string a clinician reads
 * says "visit". The tab title names the patient for the same reason the chart's
 * does: two notes open on two patients must be impossible to confuse.
 */
interface EncounterPageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: EncounterPageProps): Promise<Metadata> {
  if (!IS_MOCK_MODE) return pageMetadata({ titleKey: 'encounter.page.title' });

  const { id } = await params;

  const note = mockEncounterNote(id);
  const patient = note ? MOCK_PATIENTS.find((record) => record.id === note.patientId) : undefined;
  if (!patient) return pageMetadata({ titleKey: 'encounter.page.title' });

  return pageMetadata({
    titleKey: 'encounter.page.titleForPatient',
    values: { name: tabName(patient.name) },
  });
}

export default async function EncounterPage({ params }: Readonly<EncounterPageProps>) {
  const { id } = await params;
  return <EncounterNoteScreen encounterId={id} />;
}
