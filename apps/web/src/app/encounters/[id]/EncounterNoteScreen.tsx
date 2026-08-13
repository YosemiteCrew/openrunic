'use client';

import { useMemo } from 'react';
import type { ReactElement } from 'react';

import { ChartRail } from '@/components/chart';
import { ScreenCommands } from '@/components/command';
import type { Command } from '@/components/command';
import { NoteEditor } from '@/components/encounter';
import { AppShell } from '@/components/shell';
import { AsyncBoundary } from '@/components/state';
import { SLASH_COMMANDS, useEncounterNote } from '@/lib/api/chart';
import type { ChartClient, SlashCommand } from '@/lib/api/chart';
import { formatDate } from '@/lib/format';

/**
 * CH-02 Visit workspace.
 *
 * The chart rail is on the right on every chart screen without exception, so
 * the note is never documented against a patient whose allergies are one
 * navigation away. The note itself is the whole centre of the screen: there is
 * no second column of widgets competing with the thing being written.
 */

export interface EncounterNoteScreenProps {
  encounterId: string;
  /** Injectable for tests. */
  chartClient?: ChartClient;
  commands?: readonly SlashCommand[];
}

export function EncounterNoteScreen({
  encounterId,
  chartClient,
  commands = SLASH_COMMANDS,
}: Readonly<EncounterNoteScreenProps>): ReactElement {
  const note = useEncounterNote(encounterId, chartClient ? { client: chartClient } : {});
  const patientId = note.data?.patientId ?? null;

  const screenCommands = useMemo<Command[]>(
    () =>
      patientId
        ? [
            {
              id: 'note.open-chart',
              group: 'navigate',
              label: 'Open the chart',
              keywords: ['chart', 'summary', 'patient', 'problems'],
              icon: 'user-round',
              href: `/patients/${patientId}`,
            },
          ]
        : [],
    [patientId]
  );

  const description = note.data
    ? `${note.data.visitType}, ${formatDate(note.data.visitDate)}, ${note.data.providerName}, ${note.data.providerCredential}`
    : undefined;

  return (
    <AppShell
      title="Visit note"
      description={description}
      rightRail={
        patientId ? (
          <ChartRail
            patientId={patientId}
            patientHref={`/patients/${patientId}`}
            chartClient={chartClient}
          />
        ) : null
      }
    >
      {/* Registered from inside the shell, which is where the registry lives. */}
      <ScreenCommands commands={screenCommands} />

      <AsyncBoundary
        state={note}
        subject="this visit note"
        loadingVariant="cards"
        loadingRows={4}
        empty={{
          title: 'No note for this visit',
          message: 'Notes are created when a visit starts. Open the chart to see the visit list.',
        }}
      >
        {(loaded) => (
          <NoteEditor
            note={loaded}
            commands={commands}
            {...(chartClient ? { client: chartClient } : {})}
          />
        )}
      </AsyncBoundary>
    </AppShell>
  );
}
