'use client';

import { formatCount, plural } from '@openrunic/i18n';
import type { Translator } from '@openrunic/i18n';
import { Badge, Button } from '@openrunic/ui';
import { useRef } from 'react';
import type { KeyboardEvent, ReactElement } from 'react';

import { mockPatientById } from '@/lib/api';
import type { ResultAnalyte, ResultReport } from '@/lib/api';
import { formatDateTime, formatMrn, formatName, formatVital, vitalState } from '@/lib/format';
import { useTranslator } from '@/lib/i18n/messages';

import { ResultFlagBadge } from './ResultFlagBadge';

/**
 * The triage queue: abnormal first, and every row says why it is flagged.
 *
 * The legacy "pending review" screen showed abnormal flags and then offered
 * nothing to do about them. Here the queue is designed to shrink: the row
 * carries the value that matters and the sign-off action, and moving down the
 * list is Arrow keys rather than Tab through every control.
 *
 * The panel name, the analyte labels, the narrative and the performer are the
 * laboratory's own words and are rendered as they arrived. Only the sentences
 * this application wrote around them come from the catalogue.
 */

/**
 * The reading that earned the flag, in one phrase.
 *
 * Takes the translator rather than returning a key, because two of the three
 * answers are a whole phrase built around a value the laboratory supplied, and
 * the third is a narrative it wrote.
 */
function headline(t: Translator, report: ResultReport): string {
  const outOfRange = report.analytes.find((analyte) => stateOf(analyte) === 'danger');
  if (outOfRange) {
    const reading = formatVital(t, {
      label: outOfRange.label,
      value: outOfRange.value,
      unit: outOfRange.unit,
      range: { low: outOfRange.low, high: outOfRange.high },
      decimals: outOfRange.decimals,
    });
    // One message rather than a template literal, because the analyte name and
    // the reading are two translated-or-supplied pieces and which comes first is
    // a language decision. Concatenating them here fixes English word order into
    // code, where no translator can reach it.
    return t('results.row.outOfRange', { label: outOfRange.label, reading: reading.text });
  }
  if (report.analytes.length > 0) {
    const count = report.analytes.length;
    const values = { count: formatCount(count, t.locale) };
    return plural(
      {
        one: t('results.row.allInRangeOne', values),
        other: t('results.row.allInRangeOther', values),
      },
      count,
      t.locale
    );
  }
  return report.narrative ?? t('results.row.reportAttached');
}

function stateOf(analyte: ResultAnalyte): string {
  return vitalState(analyte.value, { low: analyte.low, high: analyte.high });
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
}: Readonly<ResultListProps>): ReactElement {
  const t = useTranslator();
  const listRef = useRef<HTMLUListElement>(null);
  const signed = new Set(signedIds);

  /* Arrow keys walk the queue, Home and End jump its ends. Tab still reaches
     every control in a row; this is the shortcut, not the only way in.

     Bound to each row's button rather than to the <ul>. The list itself is not
     focusable and never should be, so a key handler on it could only ever fire
     from a bubbling child; putting it on the child that actually holds focus
     says the same thing without claiming the list handles keys. */
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    const rows = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>('[data-result-row]') ?? []
    );
    if (rows.length === 0) return;
    const active = document.activeElement;
    const current = active instanceof HTMLButtonElement ? rows.indexOf(active) : -1;
    event.preventDefault();

    if (event.key === 'Home') {
      rows[0]?.focus();
      return;
    }
    if (event.key === 'End') {
      rows.at(-1)?.focus();
      return;
    }
    const step = event.key === 'ArrowDown' ? 1 : -1;
    const base = current < 0 ? 0 : current + step;
    rows[(base + rows.length) % rows.length]?.focus();
  };

  return (
    <ul ref={listRef} className="or-results__list" aria-label={t('results.queue.title')}>
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
              onKeyDown={onKeyDown}
            >
              <span className="or-result-row__head">
                <span className="or-result-row__patient">
                  {patient ? formatName(patient.name, 'listing') : t('results.notRecorded')}
                </span>
                <span className="or-mono or-muted">{patient ? formatMrn(patient.mrn) : ''}</span>
              </span>
              <span className="or-result-row__panel">{report.panel}</span>
              <span className="or-small or-result-row__headline">{headline(t, report)}</span>
              <span className="or-small or-muted">
                {t('results.row.reported', {
                  at: formatDateTime(t, report.reportedAt, 'dense'),
                  performer: report.performer,
                })}
              </span>
            </button>
            <span className="or-result-row__flags">
              <ResultFlagBadge flag={report.flag} />
              {isSigned ? (
                <Badge tone="neutral" icon="check">
                  {t('results.signedBadge')}
                </Badge>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  iconLeft="pen-line"
                  onClick={() => onSign(report.id)}
                >
                  {t('results.row.sign', { panel: report.panel })}
                </Button>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
