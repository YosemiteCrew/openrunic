'use client';

import type { Translator } from '@openrunic/i18n';
import { Badge, Card, Table, Tag } from '@openrunic/ui';
import type { StatusTone, TableColumn } from '@openrunic/ui';
import Link from 'next/link';
import type { ReactElement, ReactNode } from 'react';

import type {
  ChartDocument,
  ChartSummary,
  Medication,
  ResultObservation,
  Visit,
} from '@/lib/api/chart';
import { calendarDay, formatDate, formatVital } from '@/lib/format';
import { useTranslator } from '@/lib/i18n/messages';

import { CARE_TEAM_LABELS, MEDICATION_SOURCE_LABELS, NOTE_STATE_LABELS } from './labels';

/**
 * The five record tabs behind the chart's summary.
 *
 * All five obey the table canon: white surface, sticky header, one line per
 * cell, dates in one format, numbers right-aligned with their unit, and every
 * state carried by a word as well as by ink. None of them paginate; a chart
 * with more rows than this scrolls.
 *
 * The column definitions carry catalogue keys rather than words, and become
 * `TableColumn`s at render. Keeping the shape of a table beside the table it
 * describes is worth more than inlining six `t()` calls into a component body,
 * and carrying a key rather than a sentence is what lets a module-scope
 * constant hold copy at all: a constant evaluated once cannot know who is
 * reading.
 */

interface ColumnSpec {
  /** The row property this column reads. Never rendered. */
  readonly key: string;
  /** Catalogue key for the header a reader sees. */
  readonly headerKey: string;
  readonly numeric?: boolean;
  readonly mono?: boolean;
}

function columns(specs: readonly ColumnSpec[], t: Translator): TableColumn[] {
  return specs.map(({ key, headerKey, numeric, mono }) => ({
    key,
    header: t(headerKey),
    ...(numeric === undefined ? {} : { numeric }),
    ...(mono === undefined ? {} : { mono }),
  }));
}

/* -------------------------------------------------------------------------- */
/* Visits                                                                      */
/* -------------------------------------------------------------------------- */

const VISIT_COLUMNS: readonly ColumnSpec[] = [
  { key: 'date', headerKey: 'chart.visits.column.date' },
  { key: 'type', headerKey: 'chart.visits.column.type' },
  { key: 'provider', headerKey: 'chart.visits.column.provider' },
  { key: 'reason', headerKey: 'chart.visits.column.reason' },
  { key: 'note', headerKey: 'chart.visits.column.note' },
  { key: 'open', headerKey: 'chart.visits.column.open' },
];

function noteTone(state: Visit['noteState']): StatusTone {
  if (state === 'SIGNED') return 'success';
  if (state === 'UNSIGNED' || state === 'COSIGN_PENDING') return 'danger';
  return 'neutral';
}

export function VisitsPanel({ visits }: Readonly<{ visits: readonly Visit[] }>): ReactElement {
  const t = useTranslator();
  const rows = [...visits]
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((visit) => ({
      id: visit.id,
      date: formatDate(t, visit.date),
      type: visit.type,
      provider: visit.providerName,
      reason: visit.reason,
      note: (
        <Badge tone={noteTone(visit.noteState)}>
          {t(NOTE_STATE_LABELS[visit.noteState].labelKey)}
        </Badge>
      ),
      open: visit.encounterId ? (
        /* The link is named for the visit it opens, so a column of otherwise
           identical links is still distinguishable by a reader who navigates by
           link name. The accessible name contains the visible words verbatim,
           which is what lets somebody using speech say what they can read. It
           used to be a visually hidden fragment appended to the visible text,
           which meant a translation had to keep a sentence in two pieces
           agreeing in an order English happens to have. */
        <Link
          href={`/encounters/${visit.encounterId}`}
          aria-label={t('chart.visits.openNoteFrom', { date: formatDate(t, visit.date) })}
        >
          {t('chart.visits.openNote')}
        </Link>
      ) : (
        <span className="or-caption">{t('chart.visits.nothingToOpen')}</span>
      ),
    }));

  return (
    <Card title={t('chart.visits.title')}>
      <Table caption={t('chart.visits.caption')} columns={columns(VISIT_COLUMNS, t)} rows={rows} />
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Results                                                                     */
/* -------------------------------------------------------------------------- */

const RESULT_COLUMNS: readonly ColumnSpec[] = [
  { key: 'analyte', headerKey: 'chart.results.column.analyte' },
  { key: 'code', headerKey: 'chart.results.column.code', mono: true },
  { key: 'value', headerKey: 'chart.results.column.value', numeric: true },
  { key: 'range', headerKey: 'chart.results.column.range' },
  { key: 'state', headerKey: 'chart.results.column.state' },
  { key: 'collected', headerKey: 'chart.results.column.collected' },
  { key: 'review', headerKey: 'chart.results.column.review' },
];

export function ResultsPanel({
  results,
}: Readonly<{ results: readonly ResultObservation[] }>): ReactElement {
  const t = useTranslator();
  const rows = [...results]
    .sort((a, b) => b.collectedAt.localeCompare(a.collectedAt))
    .map((observation) => {
      const vital = formatVital(t, {
        label: observation.analyte,
        value: observation.value,
        unit: observation.unit,
        range: {
          low: observation.referenceLow ?? undefined,
          high: observation.referenceHigh ?? undefined,
        },
      });

      return {
        id: observation.id,
        analyte: (
          <>
            {observation.analyte}
            <span className="or-caption or-chart-cell__sub">{observation.panel}</span>
          </>
        ),
        code: observation.code,
        value: `${vital.value} ${vital.unit}`,
        range: vital.rangeText ?? t('common.notRecorded'),
        state: <Badge tone={vital.state}>{vital.stateLabel}</Badge>,
        collected: formatDate(t, observation.collectedAt),
        review: observation.reviewed
          ? t('chart.results.signedOff')
          : t('chart.results.awaitingReview'),
      };
    });

  return (
    <Card title={t('chart.results.title')}>
      <Table
        caption={t('chart.results.caption')}
        columns={columns(RESULT_COLUMNS, t)}
        rows={rows}
      />
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Medications                                                                 */
/* -------------------------------------------------------------------------- */

const MEDICATION_COLUMNS: readonly ColumnSpec[] = [
  { key: 'drug', headerKey: 'chart.medications.column.drug' },
  { key: 'sig', headerKey: 'chart.medications.column.sig' },
  { key: 'prescriber', headerKey: 'chart.medications.column.prescriber' },
  { key: 'started', headerKey: 'chart.medications.column.started' },
  { key: 'source', headerKey: 'chart.medications.column.source' },
  { key: 'refills', headerKey: 'chart.medications.column.refills', numeric: true },
];

const STOPPED_COLUMN: ColumnSpec = {
  key: 'stopped',
  headerKey: 'chart.medications.column.stopped',
};

function medicationRow(t: Translator, med: Medication): Record<string, ReactNode> {
  return {
    id: med.id,
    drug: med.drug,
    sig: med.sig,
    prescriber: med.prescriber,
    started: formatDate(t, med.startedOn),
    source: t(MEDICATION_SOURCE_LABELS[med.source].labelKey),
    refills: med.refillsRemaining === null ? t('common.notRecorded') : String(med.refillsRemaining),
  };
}

export function MedicationsPanel({
  medications,
}: Readonly<{
  medications: readonly Medication[];
}>): ReactElement {
  const t = useTranslator();
  const active = medications.filter((med) => med.status === 'ACTIVE');
  const discontinued = medications.filter((med) => med.status === 'DISCONTINUED');

  return (
    <>
      <Card title={t('chart.medications.title')}>
        <Table
          caption={t('chart.medications.caption')}
          columns={columns(MEDICATION_COLUMNS, t)}
          rows={active.map((med) => medicationRow(t, med))}
        />
      </Card>
      {discontinued.length > 0 ? (
        <Card title={t('chart.medications.discontinued.title')}>
          <Table
            caption={t('chart.medications.discontinued.caption')}
            columns={columns([...MEDICATION_COLUMNS, STOPPED_COLUMN], t)}
            rows={discontinued.map((med) => ({
              ...medicationRow(t, med),
              stopped: formatDate(t, med.stoppedOn),
            }))}
          />
        </Card>
      ) : null}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Documents                                                                   */
/* -------------------------------------------------------------------------- */

const DOCUMENT_COLUMNS: readonly ColumnSpec[] = [
  { key: 'name', headerKey: 'chart.documents.column.name' },
  { key: 'category', headerKey: 'chart.documents.column.category' },
  { key: 'received', headerKey: 'chart.documents.column.received' },
  { key: 'source', headerKey: 'chart.documents.column.source' },
  { key: 'expiry', headerKey: 'chart.documents.column.expiry' },
];

/** 60 days: long enough for the front desk to chase a replacement before it lapses. */
const EXPIRY_WARNING_DAYS = 60;

function expiryCell(document: ChartDocument, today: string | null, t: Translator): ReactNode {
  if (!document.expiresOn)
    return <span className="or-caption">{t('chart.documents.noExpiry')}</span>;

  // No clinic day means nothing to measure the expiry against, so the date is
  // rendered plainly rather than badged as though it had been checked and found
  // safe. An unchecked date that looks checked is the failure worth avoiding.
  //
  // Deleting this line happens to produce the same output today, because the
  // arithmetic below would then run against an invalid date and every
  // comparison with NaN is false, so it falls through to the same plain date.
  // That agreement is an accident of which way round the comparisons are
  // written: inverting one of them - returning the date early and badging on
  // the fall-through - would start badging an expiry nothing checked. The
  // guard is what makes the answer intentional rather than lucky.
  if (today === null) return formatDate(t, document.expiresOn);

  const days = Math.floor(
    (new Date(`${document.expiresOn}T00:00:00.000Z`).getTime() -
      new Date(`${today}T00:00:00.000Z`).getTime()) /
      86_400_000
  );

  const date = formatDate(t, document.expiresOn);
  if (days < 0) return <Badge tone="danger">{t('chart.documents.expired', { date })}</Badge>;
  if (days <= EXPIRY_WARNING_DAYS) {
    return <Badge tone="neutral">{t('chart.documents.expires', { date })}</Badge>;
  }
  return date;
}

export function DocumentsPanel({
  documents,
  now,
}: Readonly<{
  documents: readonly ChartDocument[];
  now: string;
}>): ReactElement {
  const t = useTranslator();
  const today = calendarDay(now);
  const rows = [...documents]
    .sort((a, b) => b.receivedOn.localeCompare(a.receivedOn))
    .map((document) => ({
      id: document.id,
      name: document.name,
      category: document.category,
      received: formatDate(t, document.receivedOn),
      source: document.source,
      expiry: expiryCell(document, today, t),
    }));

  return (
    <Card title={t('chart.documents.title')}>
      <Table
        caption={t('chart.documents.caption')}
        columns={columns(DOCUMENT_COLUMNS, t)}
        rows={rows}
      />
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Care team                                                                   */
/* -------------------------------------------------------------------------- */

// The primary provider first, then the internal team, then anyone outside the
// practice: the order a clinician asks "who owns this patient" in.
const CARE_TEAM_RANK = { PRIMARY: 0, CARE_TEAM: 1, EXTERNAL: 2 };

export function CareTeamPanel({ chart }: Readonly<{ chart: ChartSummary }>): ReactElement {
  const t = useTranslator();
  const ordered = [...chart.careTeam].sort(
    (a, b) =>
      CARE_TEAM_RANK[a.relationship] - CARE_TEAM_RANK[b.relationship] ||
      a.name.localeCompare(b.name)
  );

  return (
    <Card title={t('chart.careTeam.title')}>
      <ul className="or-chart-list">
        {ordered.map((member) => (
          /* Name, role and contact come from the directory and are printed as
             they arrived. The relationship does not: the API sends `CARE_TEAM`
             and no display for it, so that one word is this codebase's and is
             looked up like any other. */
          <li key={member.id} className="or-chart-item">
            <p className="or-chart-item__title">{member.name}</p>
            <p className="or-caption or-chart-item__meta">
              {member.role}, {member.contact}
            </p>
            <Tag>{t(CARE_TEAM_LABELS[member.relationship].labelKey)}</Tag>
          </li>
        ))}
      </ul>
    </Card>
  );
}
