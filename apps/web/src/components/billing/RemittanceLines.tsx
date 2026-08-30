'use client';

import { Badge, Button, Table, Tag } from '@openrunic/ui';
import type { ReactElement, ReactNode } from 'react';

import type { RemittanceLine } from '@/lib/api';
import { formatMrn, formatName } from '@/lib/format';
import { useTranslator } from '@/lib/i18n/messages';

import { lineVariance, RESOLUTION_LABEL_KEYS } from './billing';
import type { ExceptionResolution } from './billing';
import { translateColumns } from './columns';
import type { KeyedColumn } from './columns';
import { Money } from './Money';

/**
 * The 835's service lines, billed through to patient responsibility.
 *
 * The column that matters is variance: what the payer paid against what the
 * claim expected, as a number AND a word. The screen this replaces trusted the
 * biller to spot a short payment by reading two columns and subtracting; here
 * the subtraction is done, labelled, and the only lines a human is asked to
 * look at are the ones where it did not come out to zero.
 *
 * Resolving an exception happens in the row. Each disposition is named after
 * what it does to the money, never "OK".
 *
 * The adjustment code, the exception reason and the secondary payer's name come
 * off the 835 and render in the payer's words. The dispositions are the
 * practice's own decisions, so those are translated.
 */

const RESOLUTIONS: readonly ExceptionResolution[] = [
  'ACCEPTED',
  'ADJUSTED',
  'TRANSFERRED',
  'FLAGGED',
];

const COLUMNS: readonly KeyedColumn[] = [
  { key: 'claim', headerKey: 'billing.remittanceLines.column.claim', mono: true },
  { key: 'patient', headerKey: 'billing.remittanceLines.column.patient' },
  { key: 'code', headerKey: 'billing.remittanceLines.column.code', mono: true },
  { key: 'billed', headerKey: 'billing.remittanceLines.column.billed', numeric: true },
  { key: 'allowed', headerKey: 'billing.remittanceLines.column.allowed', numeric: true },
  { key: 'paid', headerKey: 'billing.remittanceLines.column.paid', numeric: true },
  { key: 'adjustment', headerKey: 'billing.remittanceLines.column.adjustment', numeric: true },
  {
    key: 'responsibility',
    headerKey: 'billing.remittanceLines.column.responsibility',
    numeric: true,
  },
  { key: 'variance', headerKey: 'billing.remittanceLines.column.variance' },
];

const RESOLVE_COLUMN: KeyedColumn = {
  key: 'actions',
  headerKey: 'billing.remittanceLines.column.resolve',
  align: 'right',
};

export interface RemittanceLinesProps {
  lines: readonly RemittanceLine[];
  currency: string;
  /** Dispositions applied in this session, keyed by line id. */
  resolutions: Readonly<Record<string, ExceptionResolution>>;
  /** Omitted on the full-ledger table, where nothing is actionable. */
  onResolve?: (lineId: string, resolution: ExceptionResolution) => void;
  caption: string;
}

export function RemittanceLines({
  lines,
  currency,
  resolutions,
  onResolve,
  caption,
}: Readonly<RemittanceLinesProps>): ReactElement {
  const t = useTranslator();
  const columns = translateColumns(onResolve ? [...COLUMNS, RESOLVE_COLUMN] : COLUMNS, t);

  const rows = lines.map((line): Record<string, ReactNode> => {
    const variance = lineVariance(line);
    const resolved = resolutions[line.id];

    return {
      id: line.id,
      claim: line.claimNumber,
      patient: (
        <span className="or-claim-patient">
          <span>{formatName(line.patient.name, 'listing')}</span>
          <span className="or-mono or-caption">{formatMrn(line.patient.mrn)}</span>
        </span>
      ),
      code: line.code,
      billed: <Money amount={line.billed} currency={currency} />,
      allowed: <Money amount={line.allowed} currency={currency} />,
      paid: <Money amount={line.paid} currency={currency} />,
      adjustment: <Money amount={line.adjustment} currency={currency} />,
      responsibility: <Money amount={line.patientResponsibility} currency={currency} />,
      variance: (
        <span className="or-variance">
          <Badge tone={variance.tone}>{t(variance.labelKey)}</Badge>
          <Money amount={variance.amount} currency={currency} negativeLabel="credit" />
          {line.adjustmentCode ? <Tag mono>{line.adjustmentCode}</Tag> : null}
          {line.exceptionReason ? <span className="or-small">{line.exceptionReason}</span> : null}
          {line.secondaryPayerName ? (
            <span className="or-small">
              {t('billing.remittanceLines.cascades', { payer: line.secondaryPayerName })}
            </span>
          ) : null}
        </span>
      ),
      ...(onResolve
        ? {
            actions: resolved ? (
              <Badge tone="success">{t(RESOLUTION_LABEL_KEYS[resolved])}</Badge>
            ) : (
              <span className="or-row-actions">
                {RESOLUTIONS.map((resolution) => (
                  <Button
                    key={resolution}
                    variant="ghost"
                    size="sm"
                    onClick={() => onResolve(line.id, resolution)}
                    aria-label={t('billing.remittanceLines.resolveFor', {
                      resolution: t(RESOLUTION_LABEL_KEYS[resolution]),
                      claim: line.claimNumber,
                      code: line.code,
                    })}
                  >
                    {t(RESOLUTION_LABEL_KEYS[resolution])}
                  </Button>
                ))}
              </span>
            ),
          }
        : {}),
    };
  });

  return <Table caption={caption} columns={columns} rows={rows} />;
}
