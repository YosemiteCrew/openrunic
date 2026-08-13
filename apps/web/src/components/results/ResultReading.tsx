'use client';

import { Badge, Button, Card, Table } from '@openrunic/ui';
import type { BadgeTone, TableColumn } from '@openrunic/ui';
import type { ReactElement, ReactNode } from 'react';

import { mockPatientById, mockProviderName } from '@/lib/api';
import type { ResultAnalyte, ResultReport } from '@/lib/api';
import { formatDate, formatDateTime, formatMrn, formatName, formatVital } from '@/lib/format';

import { ResultFlagBadge } from './ResultFlagBadge';

/**
 * The reading pane: every value against its reference range, in words.
 *
 * A number on a clinical surface always carries a unit and a labelled range
 * state, so "6.2 mmol/L" is never shown without "Above range" beside it. The
 * previous column is the cumulative context a decision needs: one value is a
 * number, three are a direction.
 */

const STATE_TONE: Record<string, BadgeTone> = {
  success: 'success',
  danger: 'danger',
  neutral: 'neutral',
};

export interface SignedNote {
  /** ISO instant. */
  at: string;
  /** The addendum a clinician typed while signing, when they typed one. */
  note: string | null;
}

export interface ResultReadingProps {
  report: ResultReport;
  signed: SignedNote | null;
  onSign: () => void;
  onSignWithNote: () => void;
  /** Fixed "now" for the age line. */
  now: string;
}

export function ResultReading({
  report,
  signed,
  onSign,
  onSignWithNote,
  now,
}: ResultReadingProps): ReactElement {
  const patient = mockPatientById(report.patientId);
  const isSigned = report.status === 'SIGNED' || signed !== null;

  const columns: TableColumn[] = [
    { key: 'analyte', header: 'Analyte' },
    { key: 'value', header: 'Result', numeric: true },
    { key: 'range', header: 'Reference range' },
    { key: 'state', header: 'Range state' },
    { key: 'previous', header: 'Previous' },
  ];

  return (
    <Card
      tone="cream"
      overline="Reading"
      title={report.panel}
      className="or-reading"
      footer={
        <div className="or-cluster">
          {isSigned ? (
            <>
              <Badge tone="neutral" icon="check">
                Signed
              </Badge>
              <span className="or-small">
                {signed
                  ? `Signed ${formatDateTime(signed.at, 'dense')} by ${mockProviderName(report.orderedBy)}`
                  : `Signed by ${mockProviderName(report.orderedBy)}`}
              </span>
            </>
          ) : (
            <>
              <Button iconLeft="pen-line" onClick={onSign}>
                Sign
              </Button>
              <Button variant="secondary" iconLeft="message-square" onClick={onSignWithNote}>
                Sign with note
              </Button>
              <Button variant="ghost" href="/orders/new" iconLeft="circle-plus">
                Order follow-up
              </Button>
            </>
          )}
        </div>
      }
    >
      <div className="or-reading__head">
        <p className="or-body">
          {patient ? formatName(patient.name, 'full') : 'Not recorded'}
          {patient ? (
            <>
              {' '}
              <span className="or-mono">{formatMrn(patient.mrn)}</span>, born{' '}
              {formatDate(patient.birthDate)}
            </>
          ) : null}
        </p>
        <div className="or-cluster">
          <ResultFlagBadge flag={report.flag} />
          <span className="or-small">
            Collected {formatDateTime(report.collectedAt, 'dense')}, reported{' '}
            {formatDateTime(report.reportedAt, 'dense')} by {report.performer}
          </span>
        </div>
        <p className="or-small or-muted">
          Ordered by {mockProviderName(report.orderedBy)}. Today is {formatDate(now)}.
        </p>
      </div>

      {signed?.note ? (
        <div className="or-reading__note">
          <p className="or-overline">Note on signing</p>
          <p className="or-body">{signed.note}</p>
        </div>
      ) : null}

      {report.narrative ? (
        <p className="or-body or-reading__narrative">{report.narrative}</p>
      ) : null}

      {report.analytes.length > 0 ? (
        <Table
          columns={columns}
          rows={report.analytes.map((analyte) => toRow(analyte))}
          caption={`${report.panel}, values against their reference ranges`}
        />
      ) : null}
    </Card>
  );
}

function toRow(analyte: ResultAnalyte): Record<string, ReactNode> {
  const reading = formatVital({
    label: analyte.label,
    value: analyte.value,
    unit: analyte.unit,
    range: { low: analyte.low, high: analyte.high },
    decimals: analyte.decimals,
  });

  return {
    id: analyte.code,
    analyte: (
      <span className="or-stack-tight">
        <span>{analyte.label}</span>
        <span className="or-mono or-muted">{analyte.code}</span>
      </span>
    ),
    // The unit rides with the value: a bare number is never a reading.
    value: `${reading.value} ${reading.unit}`.trim(),
    range: reading.rangeText ?? 'No range recorded',
    state: (
      <Badge tone={STATE_TONE[reading.state] ?? 'neutral'} icon={null}>
        {reading.stateLabel}
      </Badge>
    ),
    previous:
      analyte.previous && analyte.previous.length > 0
        ? analyte.previous
            .map((prior) => `${prior.value} on ${formatDate(prior.at, 'dense')}`)
            .join(', ')
        : 'No prior value',
  };
}
