import type { Metadata } from 'next';

import { IS_MOCK_MODE } from '@/lib/api/config';
import { mockEncounterNote } from '@/lib/api/mock/chart';
import { MOCK_PATIENTS } from '@/lib/api/mock/fixtures';

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
  const { id } = await params;
  if (!IS_MOCK_MODE) return { title: 'Visit note' };

  const note = mockEncounterNote(id);
  const patient = note ? MOCK_PATIENTS.find((record) => record.id === note.patientId) : undefined;
  if (!patient) return { title: 'Visit note' };

  const given = patient.name.preferred ?? patient.name.given;
  return { title: `${patient.name.family.toUpperCase()}, ${given} - Visit note` };
}

export default async function EncounterPage({ params }: EncounterPageProps) {
  const { id } = await params;
  return <EncounterNoteScreen encounterId={id} />;
}
