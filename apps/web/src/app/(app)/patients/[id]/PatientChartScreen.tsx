'use client';

import type { Translator } from '@openrunic/i18n';
import { Button } from '@openrunic/ui';
import { useMemo, useState } from 'react';
import type { ReactElement } from 'react';

import {
  appointmentOnDay,
  CareTeamPanel,
  ChartTabs,
  DocumentsPanel,
  MedicationsPanel,
  nextBookedAppointment,
  panelId,
  PatientContextRail,
  ResultsPanel,
  SummaryPanel,
  tabId,
  VisitsPanel,
} from '@/components/chart';
import type { ChartTabItem } from '@/components/chart';
import { ScreenCommands } from '@/components/command';
import type { Command } from '@/components/command';
import { AppShell } from '@/components/shell';
import { AsyncBoundary } from '@/components/state';
import type { AsyncBoundaryEmpty } from '@/components/state';
import { useAppointments, usePatient } from '@/lib/api';
import type { ApiClient } from '@/lib/api';
import { clinicNow, useChartSummary } from '@/lib/api/chart';
import type { ChartClient, ChartSummary } from '@/lib/api/chart';
import { formatDate, formatName } from '@/lib/format';
import { searchWords } from '@/lib/i18n/counted';
import { useTranslator } from '@/lib/i18n/messages';

/**
 * CH-01 Chart home.
 *
 * Three zones, and the order never changes: the patient context rail (who this
 * is and what must never be forgotten), the chart tab row (one level, never
 * nested), and the panel. The rail answers the legacy widget-hub dashboard,
 * where allergies sat in a box of equal weight to a portal link and could be
 * toggled off entirely: here it cannot be dismissed, reordered or hidden, and
 * the summary below it is ranked rather than configurable.
 *
 * Every tab is reachable from the command palette as well as from the strip,
 * because a provider between rooms types faster than they point.
 *
 * The tables below carry catalogue keys rather than words. A constant evaluated
 * once at module scope cannot know who is reading, so a tab label or an empty
 * state written there would be written in one language for everybody; carrying
 * the key keeps the tables where they belong and moves only the lookup into the
 * render.
 */

interface ChartTab {
  /**
   * Stable identity, independent of what the tab is called.
   *
   * The palette command id is built from this rather than from the label, so a
   * command keeps its identity when the reader's language changes and anything
   * keyed on it goes on matching.
   */
  readonly id: string;
  /**
   * Catalogue key for the label on the strip. The palette entry is built from
   * the same words, lower-cased into "Show {tab}" and added to that command's
   * own keyword list, so a tab is searchable by the word it is labelled with.
   */
  readonly labelKey: string;
}

const CHART_TABS = [
  { id: 'summary', labelKey: 'chart.tab.summary' },
  { id: 'visits', labelKey: 'chart.tab.visits' },
  { id: 'results', labelKey: 'chart.tab.results' },
  { id: 'medications', labelKey: 'chart.tab.medications' },
  { id: 'documents', labelKey: 'chart.tab.documents' },
  { id: 'care-team', labelKey: 'chart.tab.careTeam' },
] as const satisfies readonly ChartTab[];

type ChartTabId = (typeof CHART_TABS)[number]['id'];

const TAB_IDS: ReadonlySet<string> = new Set(CHART_TABS.map((tab) => tab.id));

interface TabEmpty {
  readonly titleKey: string;
  readonly messageKey: string;
  readonly icon?: string;
  /**
   * The one way on, as a label key and a route rather than as a built button.
   *
   * The button used to be constructed here, which put its words into a module
   * constant. Carrying the key, the route and the variant instead lets the same
   * table hold the action while the render decides what language it is in.
   * `null` where a tab has nothing to offer: more than one control is a screen
   * that has not decided, and none is a legitimate answer.
   */
  readonly action: {
    readonly labelKey: string;
    readonly href: string;
    readonly variant: 'primary' | 'secondary';
  } | null;
}

/** What each tab says when it is empty: the fact, why it is empty, one way on. */
const TAB_EMPTY: Record<ChartTabId, TabEmpty> = {
  summary: {
    titleKey: 'chart.empty.summary.title',
    messageKey: 'chart.empty.summary.message',
    icon: 'notebook-pen',
    action: { labelKey: 'chart.empty.summary.action', href: '/schedule', variant: 'primary' },
  },
  visits: {
    titleKey: 'chart.empty.visits.title',
    messageKey: 'chart.empty.visits.message',
    icon: 'calendar-days',
    action: { labelKey: 'chart.empty.visits.action', href: '/schedule', variant: 'primary' },
  },
  results: {
    titleKey: 'chart.empty.results.title',
    messageKey: 'chart.empty.results.message',
    icon: 'flask-conical',
    action: { labelKey: 'chart.empty.results.action', href: '/results', variant: 'secondary' },
  },
  medications: {
    titleKey: 'chart.empty.medications.title',
    messageKey: 'chart.empty.medications.message',
    icon: 'pill',
    action: { labelKey: 'chart.empty.medications.action', href: '/orders', variant: 'secondary' },
  },
  documents: {
    titleKey: 'chart.empty.documents.title',
    messageKey: 'chart.empty.documents.message',
    icon: 'file-text',
    action: { labelKey: 'chart.empty.documents.action', href: '/inbox', variant: 'secondary' },
  },
  'care-team': {
    titleKey: 'chart.empty.careTeam.title',
    messageKey: 'chart.empty.careTeam.message',
    icon: 'users',
    action: null,
  },
};

/** The table above as the shared boundary wants it, in the reader's language. */
function emptyState(tab: ChartTabId, t: Translator): AsyncBoundaryEmpty {
  const spec = TAB_EMPTY[tab];
  return {
    title: t(spec.titleKey),
    message: t(spec.messageKey),
    ...(spec.icon === undefined ? {} : { icon: spec.icon }),
    ...(spec.action === null
      ? {}
      : {
          action: (
            <Button href={spec.action.href} variant={spec.action.variant}>
              {t(spec.action.labelKey)}
            </Button>
          ),
        }),
  };
}

function isTabEmpty(tab: ChartTabId, chart: ChartSummary): boolean {
  if (tab === 'visits') return chart.visits.length === 0;
  if (tab === 'results') return chart.results.length === 0;
  if (tab === 'medications') return chart.medications.length === 0;
  if (tab === 'documents') return chart.documents.length === 0;
  if (tab === 'care-team') return chart.careTeam.length === 0;
  // The summary is empty only when the whole chart is: a patient with one
  // recorded allergy still has something worth reading here.
  return (
    chart.visits.length === 0 &&
    chart.problems.length === 0 &&
    chart.medications.length === 0 &&
    chart.results.length === 0 &&
    chart.allergies.entries.length === 0
  );
}

function tabCount(tab: ChartTabId, chart: ChartSummary | null): number | null {
  if (!chart) return null;
  if (tab === 'visits') return chart.visits.length;
  if (tab === 'results') return chart.results.length;
  if (tab === 'medications') {
    return chart.medications.filter((med) => med.status === 'ACTIVE').length;
  }
  if (tab === 'documents') return chart.documents.length;
  if (tab === 'care-team') return chart.careTeam.length;
  return null;
}

export interface PatientChartScreenProps {
  patientId: string;
  /** Injectable for tests. */
  client?: ApiClient;
  chartClient?: ChartClient;
}

export function PatientChartScreen({
  patientId,
  client,
  chartClient,
}: Readonly<PatientChartScreenProps>): ReactElement {
  const t = useTranslator();
  const now = clinicNow();
  const [activeTab, setActiveTab] = useState<ChartTabId>('summary');

  const patient = usePatient(patientId, client ? { client } : {});
  const chart = useChartSummary(patientId, chartClient ? { client: chartClient } : {});
  const appointments = useAppointments({ patientId, sort: 'start' }, client ? { client } : {});

  const summary = chart.data;
  const appointmentList = appointments.data?.data ?? [];
  const todayAppointment = appointmentOnDay(appointmentList, now);

  // The note this chart offers to open: today's, and otherwise the oldest
  // unsigned one, because unsigned documentation is the debt worth surfacing.
  const openNote =
    summary?.visits.find((visit) => visit.date === formatDate(now, 'iso') && visit.encounterId) ??
    summary?.visits.find((visit) => visit.noteState === 'UNSIGNED' && visit.encounterId) ??
    null;
  const openNoteId = openNote?.encounterId ?? null;

  const tabs: ChartTabItem[] = CHART_TABS.map((tab) => ({
    id: tab.id,
    label: t(tab.labelKey),
    count: tabCount(tab.id, summary),
  }));

  /**
   * One way in for both the strip and the palette, and the only thing that
   * writes the tab state. It closes over nothing that changes, so the commands
   * below can hold it without re-registering on every render.
   */
  const selectTab = (id: string) => {
    if (TAB_IDS.has(id)) setActiveTab(id as ChartTabId);
  };

  /* The palette entries depend on the reader as well as on the note, so the
     translator joins the dependency list: a list built once in English would
     otherwise survive a language change intact.

     That dependency is only sound because the translator is memoised on the
     locale. The registry registers whenever this array's identity changes and
     registering sets state, so a translator with a new identity every render
     would make this a render loop rather than a wasted allocation.

     The command ids are built from each tab's own `id` and so do not depend on
     the reader, deliberately: anything keyed on one keeps matching when the
     language changes. */
  const commands = useMemo<Command[]>(() => {
    const tabCommands: Command[] = CHART_TABS.map((tab) => {
      const label = t(tab.labelKey).toLowerCase();
      return {
        id: `chart.tab.${tab.id}`,
        group: 'actions',
        label: t('chart.command.showTab', { tab: label }),
        keywords: [...searchWords(t('chart.command.showTab.keywords')), label],
        icon: 'panel-top',
        perform: () => selectTab(tab.id),
      };
    });

    const noteCommand: Command[] = openNoteId
      ? [
          {
            id: 'chart.open-note',
            group: 'navigate',
            label: t('chart.summary.openVisitNote'),
            keywords: searchWords(t('chart.command.openNote.keywords')),
            icon: 'notebook-pen',
            href: `/encounters/${openNoteId}`,
          },
        ]
      : [];

    return [
      ...noteCommand,
      ...tabCommands,
      {
        id: 'chart.print',
        group: 'actions',
        label: t('chart.command.print'),
        keywords: searchWords(t('chart.command.print.keywords')),
        icon: 'printer',
        perform: () => window.print(),
      },
    ];
  }, [openNoteId, t]);

  const title = patient.data ? formatName(patient.data.name) : t('chart.title');

  const rail = (
    <AsyncBoundary
      state={patient}
      subject={t('chart.boundary.patient.subject')}
      loadingVariant="text"
      loadingRows={8}
      empty={{
        title: t('chart.boundary.patient.title'),
        message: t('chart.boundary.patient.message'),
      }}
    >
      {(record) => (
        <AsyncBoundary
          state={chart}
          subject={t('chart.boundary.chart.subject')}
          loadingVariant="text"
          loadingRows={8}
          empty={{
            title: t('chart.boundary.chart.title'),
            message: t('chart.boundary.chart.message'),
          }}
        >
          {(loaded) => (
            <PatientContextRail
              patient={record}
              chart={loaded}
              nextAppointment={nextBookedAppointment(appointmentList, now)}
              now={now}
              onOpenSection={selectTab}
            />
          )}
        </AsyncBoundary>
      )}
    </AsyncBoundary>
  );

  const actions = (
    <>
      <Button variant="secondary" iconLeft="printer" onClick={() => window.print()}>
        {t('chart.action.printSummary')}
      </Button>
      {openNoteId ? (
        <Button variant="primary" href={`/encounters/${openNoteId}`} iconLeft="notebook-pen">
          {t('chart.action.openVisitNote')}
        </Button>
      ) : null}
    </>
  );

  return (
    <AppShell title={title} actions={actions} rightRail={rail}>
      {/* Registered from inside the shell, which is where the registry lives. */}
      <ScreenCommands commands={commands} />

      <ChartTabs
        tabs={tabs}
        activeId={activeTab}
        onChange={selectTab}
        idPrefix="chart"
        label={t('chart.tabs.label')}
      />

      <div
        className="or-chart-panel"
        role="tabpanel"
        id={panelId('chart', activeTab)}
        aria-labelledby={tabId('chart', activeTab)}
        tabIndex={0}
      >
        <AsyncBoundary
          state={chart}
          subject={t('chart.boundary.chart.subject')}
          loadingVariant="cards"
          loadingRows={4}
          isEmpty={(loaded) => isTabEmpty(activeTab, loaded)}
          empty={emptyState(activeTab, t)}
        >
          {(loaded) => {
            if (activeTab === 'visits') return <VisitsPanel visits={loaded.visits} />;
            if (activeTab === 'results') return <ResultsPanel results={loaded.results} />;
            if (activeTab === 'medications') {
              return <MedicationsPanel medications={loaded.medications} />;
            }
            if (activeTab === 'documents') {
              return <DocumentsPanel documents={loaded.documents} now={now} />;
            }
            if (activeTab === 'care-team') return <CareTeamPanel chart={loaded} />;
            return <SummaryPanel chart={loaded} todayAppointment={todayAppointment} now={now} />;
          }}
        </AsyncBoundary>
      </div>
    </AppShell>
  );
}
