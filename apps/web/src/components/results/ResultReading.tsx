'use client';

import type { Translator } from '@openrunic/i18n';
import { Badge, Button, Card, Table } from '@openrunic/ui';
import type { BadgeTone, TableColumn } from '@openrunic/ui';
import { useMemo } from 'react';
import type { ReactElement, ReactNode } from 'react';

import { mockPatientById, mockProviderName } from '@/lib/api';
import type { ResultAnalyte, ResultReport } from '@/lib/api';
import { formatDate, formatDateTime, formatMrn, formatName, formatVital } from '@/lib/format';
import { useTranslator } from '@/lib/i18n/messages';

import { ResultFlagBadge } from './ResultFlagBadge';

/**
 * The reading pane: every value against its reference range, in words.
 *
 * A number on a clinical surface always carries a unit and a labelled range
 * state, so "6.2 mmol/L" is never shown without "Above range" beside it. The
 * previous column is the cumulative context a decision needs: one value is a
 * number, three are a direction.
 *
 * The analyte labels, their codes, the ranges, the readings and the narrative
 * are the laboratory's own and are rendered as they arrived. The range-state
 * word comes from `formatVital`, which serves every clinical surface rather
 * than this one.
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

/** The table's columns, as catalogue keys. See `OrdersScreen` for why. */
const COLUMNS: readonly (Omit<TableColumn, 'header'> & { headerKey: string })[] = [
  { key: 'analyte', headerKey: 'results.reading.column.analyte' },
  { key: 'value', headerKey: 'results.reading.column.value', numeric: true },
  { key: 'range', headerKey: 'results.reading.column.range' },
  { key: 'state', headerKey: 'results.reading.column.state' },
  { key: 'previous', headerKey: 'results.reading.column.previous' },
];

export function ResultReading({
  report,
  signed,
  onSign,
  onSignWithNote,
  now,
}: Readonly<ResultReadingProps>): ReactElement {
  const t = useTranslator();
  const patient = mockPatientById(report.patientId);
  const isSigned = report.status === 'SIGNED' || signed !== null;
  const columns = useMemo<TableColumn[]>(
    () => COLUMNS.map(({ headerKey, ...column }) => ({ ...column, header: t(headerKey) })),
    [t]
  );

  return (
    <Card
      tone="cream"
      overline={t('results.reading.overline')}
      title={report.panel}
      className="or-reading"
      footer={
        <div className="or-cluster">
          {isSigned ? (
            <>
              <Badge tone="neutral" icon="check">
                {t('results.signedBadge')}
              </Badge>
              <span className="or-small">
                {signed
                  ? t('results.reading.signedAtBy', {
                      at: formatDateTime(t, signed.at, 'dense'),
                      clinician: mockProviderName(report.orderedBy),
                    })
                  : t('results.reading.signedBy', {
                      clinician: mockProviderName(report.orderedBy),
                    })}
              </span>
            </>
          ) : (
            <>
              <Button iconLeft="pen-line" onClick={onSign}>
                {t('results.reading.sign')}
              </Button>
              <Button variant="secondary" iconLeft="message-square" onClick={onSignWithNote}>
                {t('results.reading.signWithNote')}
              </Button>
              <Button variant="ghost" href="/orders/new" iconLeft="circle-plus">
                {t('results.reading.followUp')}
              </Button>
            </>
          )}
        </div>
      }
    >
      <div className="or-reading__head">
        <p className="or-body">
          {patient ? formatName(patient.name, 'full') : t('results.notRecorded')}
          {patient ? (
            <>
              {' '}
              {/* The record number keeps its own monospace element, so the
                  identity line is translated on either side of it rather than
                  as one message. */}
              <span className="or-mono">{formatMrn(patient.mrn)}</span>
              {t('results.reading.born', { birthDate: formatDate(t, patient.birthDate) })}
            </>
          ) : null}
        </p>
        <div className="or-cluster">
          <ResultFlagBadge flag={report.flag} />
          <span className="or-small">
            {t('results.reading.collected', {
              collected: formatDateTime(t, report.collectedAt, 'dense'),
              reported: formatDateTime(t, report.reportedAt, 'dense'),
              performer: report.performer,
            })}
          </span>
        </div>
        <p className="or-small or-muted">
          {t('results.reading.orderedBy', {
            clinician: mockProviderName(report.orderedBy),
            today: formatDate(t, now),
          })}
        </p>
      </div>

      {signed?.note ? (
        <div className="or-reading__note">
          <p className="or-overline">{t('results.reading.noteHeading')}</p>
          <p className="or-body">{signed.note}</p>
        </div>
      ) : null}

      {report.narrative ? (
        <p className="or-body or-reading__narrative">{report.narrative}</p>
      ) : null}

      {report.analytes.length > 0 ? (
        <Table
          columns={columns}
          rows={report.analytes.map((analyte) => toRow(t, analyte))}
          caption={t('results.reading.caption', { panel: report.panel })}
        />
      ) : null}
    </Card>
  );
}

function toRow(t: Translator, analyte: ResultAnalyte): Record<string, ReactNode> {
  const reading = formatVital(t, {
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
    range: reading.rangeText ?? t('results.reading.noRange'),
    state: (
      <Badge tone={STATE_TONE[reading.state] ?? 'neutral'} icon={null}>
        {reading.stateLabel}
      </Badge>
    ),
    previous:
      analyte.previous && analyte.previous.length > 0
        ? analyte.previous
            .map((prior) =>
              t('results.reading.prior', {
                value: prior.value,
                at: formatDate(t, prior.at, 'dense'),
              })
            )
            .join(', ')
        : t('results.reading.noPrior'),
  };
}
