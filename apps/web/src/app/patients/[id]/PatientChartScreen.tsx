'use client';

import { Button } from '@openrunic/ui';
import { useMemo, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';

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
import { useAppointments, usePatient } from '@/lib/api';
import type { ApiClient } from '@/lib/api';
import { clinicNow, useChartSummary } from '@/lib/api/chart';
import type { ChartClient, ChartSummary } from '@/lib/api/chart';
import { formatDate, formatName } from '@/lib/format';

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
 */

const CHART_TABS = [
  { id: 'summary', label: 'Summary' },
  { id: 'visits', label: 'Visits' },
  { id: 'results', label: 'Results' },
  { id: 'medications', label: 'Medications' },
  { id: 'documents', label: 'Documents' },
  { id: 'care-team', label: 'Care team' },
] as const;

type ChartTabId = (typeof CHART_TABS)[number]['id'];

const TAB_IDS: ReadonlySet<string> = new Set(CHART_TABS.map((tab) => tab.id));

interface TabEmpty {
  title: string;
  message: string;
  icon?: string;
  action?: ReactNode;
}

/** What each tab says when it is empty: the fact, why it is empty, one way on. */
const TAB_EMPTY: Record<ChartTabId, TabEmpty> = {
  summary: {
    title: 'No history yet',
    message: 'Nothing has been recorded for this patient. The first visit starts the chart.',
    icon: 'notebook-pen',
    action: (
      <Button href="/schedule" variant="primary">
        Go to today&apos;s schedule
      </Button>
    ),
  },
  visits: {
    title: 'No visits recorded',
    message: 'Visits appear here once the patient has been seen or an appointment is fulfilled.',
    icon: 'calendar-days',
    action: (
      <Button href="/schedule" variant="primary">
        Book an appointment
      </Button>
    ),
  },
  results: {
    title: 'No results for this patient',
    message: 'Laboratory and imaging results file to the chart as they arrive from the lab.',
    icon: 'flask-conical',
    action: (
      <Button href="/results" variant="secondary">
        Go to results
      </Button>
    ),
  },
  medications: {
    title: 'No medications recorded',
    message:
      'Prescriptions written here and medications the patient reports both appear on this list.',
    icon: 'pill',
    action: (
      <Button href="/orders" variant="secondary">
        Go to orders
      </Button>
    ),
  },
  documents: {
    title: 'No documents filed',
    message: 'Uploads, scans and inbound faxes filed to this chart appear here.',
    icon: 'file-text',
    action: (
      <Button href="/inbox" variant="secondary">
        Go to the inbox
      </Button>
    ),
  },
  'care-team': {
    title: 'No care team recorded',
    message: 'The primary provider and anyone else responsible for this patient appear here.',
    icon: 'users',
  },
};

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
    label: tab.label,
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

  const commands = useMemo<Command[]>(() => {
    const tabCommands: Command[] = CHART_TABS.map((tab) => ({
      id: `chart.tab.${tab.id}`,
      group: 'actions',
      label: `Show ${tab.label.toLowerCase()}`,
      keywords: ['chart', 'tab', tab.label.toLowerCase()],
      icon: 'panel-top',
      perform: () => selectTab(tab.id),
    }));

    const noteCommand: Command[] = openNoteId
      ? [
          {
            id: 'chart.open-note',
            group: 'navigate',
            label: 'Open the visit note',
            keywords: ['note', 'soap', 'documentation', 'sign'],
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
        label: 'Print chart summary',
        keywords: ['print', 'paper', 'record'],
        icon: 'printer',
        perform: () => window.print(),
      },
    ];
  }, [openNoteId]);

  const title = patient.data ? formatName(patient.data.name) : 'Chart';

  const rail = (
    <AsyncBoundary
      state={patient}
      subject="this patient"
      loadingVariant="text"
      loadingRows={8}
      empty={{
        title: 'No patient loaded',
        message: 'Open a chart from the patient index, or press Cmd-K to search.',
      }}
    >
      {(record) => (
        <AsyncBoundary
          state={chart}
          subject="this chart"
          loadingVariant="text"
          loadingRows={8}
          empty={{ title: 'No chart data', message: 'Nothing has been recorded for this patient.' }}
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
        Print summary
      </Button>
      {openNoteId ? (
        <Button variant="primary" href={`/encounters/${openNoteId}`} iconLeft="notebook-pen">
          Open visit note
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
        label="Chart sections"
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
          subject="this chart"
          loadingVariant="cards"
          loadingRows={4}
          isEmpty={(loaded) => isTabEmpty(activeTab, loaded)}
          empty={TAB_EMPTY[activeTab]}
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
