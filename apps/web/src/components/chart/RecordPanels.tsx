'use client';

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
import { formatDate, formatEnumLabel, formatVital, NOT_RECORDED } from '@/lib/format';

/**
 * The five record tabs behind the chart's summary.
 *
 * All five obey the table canon: white surface, sticky header, one line per
 * cell, dates in one format, numbers right-aligned with their unit, and every
 * state carried by a word as well as by ink. None of them paginate; a chart
 * with more rows than this scrolls.
 */

/* -------------------------------------------------------------------------- */
/* Visits                                                                      */
/* -------------------------------------------------------------------------- */

const VISIT_COLUMNS: TableColumn[] = [
  { key: 'date', header: 'Date' },
  { key: 'type', header: 'Visit' },
  { key: 'provider', header: 'Provider' },
  { key: 'reason', header: 'Reason' },
  { key: 'note', header: 'Note' },
  { key: 'open', header: 'Documentation' },
];

function noteTone(state: Visit['noteState']): StatusTone {
  if (state === 'SIGNED') return 'success';
  if (state === 'UNSIGNED' || state === 'COSIGN_PENDING') return 'danger';
  return 'neutral';
}

export function VisitsPanel({ visits }: { visits: readonly Visit[] }): ReactElement {
  const rows = [...visits]
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((visit) => ({
      id: visit.id,
      date: formatDate(visit.date),
      type: visit.type,
      provider: visit.providerName,
      reason: visit.reason,
      note: (
        <Badge tone={noteTone(visit.noteState)}>
          {visit.noteState === 'NONE' ? 'No note' : formatEnumLabel(visit.noteState)}
        </Badge>
      ),
      open: visit.encounterId ? (
        <Link href={`/encounters/${visit.encounterId}`}>
          Open note<span className="or-visually-hidden"> from {formatDate(visit.date)}</span>
        </Link>
      ) : (
        <span className="or-caption">Nothing to open</span>
      ),
    }));

  return (
    <Card title="Visits">
      <Table caption="Visits, most recent first" columns={VISIT_COLUMNS} rows={rows} />
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Results                                                                     */
/* -------------------------------------------------------------------------- */

const RESULT_COLUMNS: TableColumn[] = [
  { key: 'analyte', header: 'Analyte' },
  { key: 'code', header: 'LOINC', mono: true },
  { key: 'value', header: 'Result', numeric: true },
  { key: 'range', header: 'Reference range' },
  { key: 'state', header: 'Range state' },
  { key: 'collected', header: 'Collected' },
  { key: 'review', header: 'Review' },
];

export function ResultsPanel({ results }: { results: readonly ResultObservation[] }): ReactElement {
  const rows = [...results]
    .sort((a, b) => b.collectedAt.localeCompare(a.collectedAt))
    .map((observation) => {
      const vital = formatVital({
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
        range: vital.rangeText ?? NOT_RECORDED,
        state: <Badge tone={vital.state}>{vital.stateLabel}</Badge>,
        collected: formatDate(observation.collectedAt),
        review: observation.reviewed ? 'Signed off' : 'Awaiting review',
      };
    });

  return (
    <Card title="Results">
      <Table caption="Results, most recent first" columns={RESULT_COLUMNS} rows={rows} />
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Medications                                                                 */
/* -------------------------------------------------------------------------- */

const MEDICATION_COLUMNS: TableColumn[] = [
  { key: 'drug', header: 'Medication' },
  { key: 'sig', header: 'Directions' },
  { key: 'prescriber', header: 'Prescriber' },
  { key: 'started', header: 'Started' },
  { key: 'source', header: 'Source' },
  { key: 'refills', header: 'Refills', numeric: true },
];

function medicationRow(med: Medication): Record<string, ReactNode> {
  return {
    id: med.id,
    drug: med.drug,
    sig: med.sig,
    prescriber: med.prescriber,
    started: formatDate(med.startedOn),
    source: formatEnumLabel(med.source),
    refills: med.refillsRemaining === null ? NOT_RECORDED : String(med.refillsRemaining),
  };
}

export function MedicationsPanel({
  medications,
}: {
  medications: readonly Medication[];
}): ReactElement {
  const active = medications.filter((med) => med.status === 'ACTIVE');
  const discontinued = medications.filter((med) => med.status === 'DISCONTINUED');

  return (
    <>
      <Card title="Current medications">
        <Table
          caption="Active medications"
          columns={MEDICATION_COLUMNS}
          rows={active.map(medicationRow)}
        />
      </Card>
      {discontinued.length > 0 ? (
        <Card title="Discontinued">
          <Table
            caption="Discontinued medications"
            columns={[...MEDICATION_COLUMNS, { key: 'stopped', header: 'Stopped' }]}
            rows={discontinued.map((med) => ({
              ...medicationRow(med),
              stopped: formatDate(med.stoppedOn),
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

const DOCUMENT_COLUMNS: TableColumn[] = [
  { key: 'name', header: 'Document' },
  { key: 'category', header: 'Category' },
  { key: 'received', header: 'Received' },
  { key: 'source', header: 'Source' },
  { key: 'expiry', header: 'Expiry' },
];

/** 60 days: long enough for the front desk to chase a replacement before it lapses. */
const EXPIRY_WARNING_DAYS = 60;

function expiryCell(document: ChartDocument, today: string): ReactNode {
  if (!document.expiresOn) return <span className="or-caption">No expiry</span>;

  const days = Math.floor(
    (new Date(`${document.expiresOn}T00:00:00.000Z`).getTime() -
      new Date(`${today}T00:00:00.000Z`).getTime()) /
      86_400_000
  );

  if (days < 0) return <Badge tone="danger">{`Expired ${formatDate(document.expiresOn)}`}</Badge>;
  if (days <= EXPIRY_WARNING_DAYS) {
    return <Badge tone="neutral">{`Expires ${formatDate(document.expiresOn)}`}</Badge>;
  }
  return formatDate(document.expiresOn);
}

export function DocumentsPanel({
  documents,
  now,
}: {
  documents: readonly ChartDocument[];
  now: string;
}): ReactElement {
  const today = formatDate(now, 'iso');
  const rows = [...documents]
    .sort((a, b) => b.receivedOn.localeCompare(a.receivedOn))
    .map((document) => ({
      id: document.id,
      name: document.name,
      category: document.category,
      received: formatDate(document.receivedOn),
      source: document.source,
      expiry: expiryCell(document, today),
    }));

  return (
    <Card title="Documents">
      <Table caption="Documents, most recent first" columns={DOCUMENT_COLUMNS} rows={rows} />
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Care team                                                                   */
/* -------------------------------------------------------------------------- */

export function CareTeamPanel({ chart }: { chart: ChartSummary }): ReactElement {
  // The primary provider first, then the internal team, then anyone outside the
  // practice: the order a clinician asks "who owns this patient" in.
  const rank = { PRIMARY: 0, CARE_TEAM: 1, EXTERNAL: 2 };
  const ordered = [...chart.careTeam].sort(
    (a, b) => rank[a.relationship] - rank[b.relationship] || a.name.localeCompare(b.name)
  );

  return (
    <Card title="Care team">
      <ul className="or-chart-list">
        {ordered.map((member) => (
          <li key={member.id} className="or-chart-item">
            <p className="or-chart-item__title">{member.name}</p>
            <p className="or-caption or-chart-item__meta">
              {member.role}, {member.contact}
            </p>
            <Tag>{formatEnumLabel(member.relationship)}</Tag>
          </li>
        ))}
      </ul>
    </Card>
  );
}
