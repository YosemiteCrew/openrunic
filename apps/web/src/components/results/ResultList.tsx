'use client';

import { Badge, Button } from '@openrunic/ui';
import { useRef } from 'react';
import type { KeyboardEvent, ReactElement } from 'react';

import { mockPatientById } from '@/lib/api';
import type { ResultAnalyte, ResultReport } from '@/lib/api';
import { formatDateTime, formatMrn, formatName, formatVital } from '@/lib/format';

import { ResultFlagBadge } from './ResultFlagBadge';

/**
 * The triage queue: abnormal first, and every row says why it is flagged.
 *
 * OpenEMR's Pending Review screen showed abnormal flags and then offered
 * nothing to do about them. Here the queue is designed to shrink: the row
 * carries the value that matters and the sign-off action, and moving down the
 * list is Arrow keys rather than Tab through every control.
 */

/** The reading that earned the flag, in one phrase. */
function headline(report: ResultReport): string {
  const outOfRange = report.analytes.find((analyte) => stateOf(analyte) === 'danger');
  if (outOfRange) {
    const reading = formatVital({
      label: outOfRange.label,
      value: outOfRange.value,
      unit: outOfRange.unit,
      range: { low: outOfRange.low, high: outOfRange.high },
      decimals: outOfRange.decimals,
    });
    return `${outOfRange.label} ${reading.text}`;
  }
  if (report.analytes.length > 0) return `${report.analytes.length} analytes, all in range`;
  return report.narrative ?? 'Report attached';
}

function stateOf(analyte: ResultAnalyte): string {
  return formatVital({
    label: analyte.label,
    value: analyte.value,
    unit: analyte.unit,
    range: { low: analyte.low, high: analyte.high },
    decimals: analyte.decimals,
  }).state;
}

export interface ResultListProps {
  reports: ResultReport[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onSign: (id: string) => void;
  /** Ids signed in this session, so the row can say so without a refetch. */
  signedIds: string[];
}

export function ResultList({
  reports,
  selectedId,
  onSelect,
  onSign,
  signedIds,
}: ResultListProps): ReactElement {
  const listRef = useRef<HTMLUListElement>(null);
  const signed = new Set(signedIds);

  /* Arrow keys walk the queue, Home and End jump its ends. Tab still reaches
     every control in a row; this is the shortcut, not the only way in. */
  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    const rows = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>('[data-result-row]') ?? []
    );
    if (rows.length === 0) return;
    const current = rows.findIndex((row) => row === document.activeElement);
    event.preventDefault();

    if (event.key === 'Home') {
      rows[0]?.focus();
      return;
    }
    if (event.key === 'End') {
      rows[rows.length - 1]?.focus();
      return;
    }
    const step = event.key === 'ArrowDown' ? 1 : -1;
    const base = current < 0 ? 0 : current + step;
    rows[(base + rows.length) % rows.length]?.focus();
  };

  return (
    <ul
      ref={listRef}
      className="or-results__list"
      aria-label="Results to review"
      onKeyDown={onKeyDown}
    >
      {reports.map((report) => {
        const patient = mockPatientById(report.patientId);
        const isSigned = report.status === 'SIGNED' || signed.has(report.id);
        return (
          <li key={report.id} className="or-result-row" data-selected={report.id === selectedId}>
            <button
              type="button"
              data-result-row
              className="or-result-row__open"
              aria-current={report.id === selectedId ? 'true' : undefined}
              onClick={() => onSelect(report.id)}
            >
              <span className="or-result-row__head">
                <span className="or-result-row__patient">
                  {patient ? formatName(patient.name, 'listing') : 'Not recorded'}
                </span>
                <span className="or-mono or-muted">{patient ? formatMrn(patient.mrn) : ''}</span>
              </span>
              <span className="or-result-row__panel">{report.panel}</span>
              <span className="or-small or-result-row__headline">{headline(report)}</span>
              <span className="or-small or-muted">
                Reported {formatDateTime(report.reportedAt, 'dense')}, {report.performer}
              </span>
            </button>
            <span className="or-result-row__flags">
              <ResultFlagBadge flag={report.flag} />
              {isSigned ? (
                <Badge tone="neutral" icon="check">
                  Signed
                </Badge>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  iconLeft="pen-line"
                  onClick={() => onSign(report.id)}
                >
                  {`Sign ${report.panel}`}
                </Button>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
