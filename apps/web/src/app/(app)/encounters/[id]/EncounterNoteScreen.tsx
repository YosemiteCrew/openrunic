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
import { formatCredentialed, formatDate } from '@/lib/format';
import { useTranslator } from '@/lib/i18n/messages';

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
  const t = useTranslator();
  const note = useEncounterNote(encounterId, chartClient ? { client: chartClient } : {});
  const patientId = note.data?.patientId ?? null;

  /* The palette entry depends on the reader as well as on the note, so the
     translator joins the dependency list. That is only sound because the
     translator is memoised on the locale: the registry registers whenever this
     array's identity changes and registering sets state, so a translator with a
     new identity every render would make this a render loop rather than a
     wasted allocation.

     Keywords are a comma-separated catalogue string split here, matching the
     navigation table: somebody searching in another language does not type the
     English word. */
  const screenCommands = useMemo<Command[]>(
    () =>
      patientId
        ? [
            {
              id: 'note.open-chart',
              group: 'navigate',
              label: t('encounter.command.openChart'),
              keywords: t('encounter.command.openChart.keywords')
                .split(',')
                .map((word) => word.trim())
                .filter((word) => word !== ''),
              icon: 'user-round',
              href: `/patients/${patientId}`,
            },
          ]
        : [],
    [patientId, t]
  );

  /* Visit type, date and author, all from the note. Nothing in this line is
     this screen's own words, so it is joined here rather than translated. */
  const description = note.data
    ? `${note.data.visitType}, ${formatDate(t, note.data.visitDate)}, ${formatCredentialed(note.data.providerName, note.data.providerCredential)}`
    : undefined;

  return (
    <AppShell
      title={t('encounter.title')}
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
        subject={t('encounter.boundary.subject')}
        loadingVariant="cards"
        loadingRows={4}
        empty={{
          title: t('encounter.empty.title'),
          message: t('encounter.empty.message'),
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
