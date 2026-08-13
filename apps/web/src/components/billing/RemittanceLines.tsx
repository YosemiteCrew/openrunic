'use client';

import { Badge, Button, Table, Tag } from '@openrunic/ui';
import type { TableColumn } from '@openrunic/ui';
import type { ReactElement, ReactNode } from 'react';

import type { RemittanceLine } from '@/lib/api';
import { formatMrn, formatName } from '@/lib/format';

import { lineVariance, RESOLUTION_LABELS } from './billing';
import type { ExceptionResolution } from './billing';
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
 */

const RESOLUTIONS: ExceptionResolution[] = ['ACCEPTED', 'ADJUSTED', 'TRANSFERRED', 'FLAGGED'];

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
  const columns: TableColumn[] = [
    { key: 'claim', header: 'Claim', mono: true },
    { key: 'patient', header: 'Patient' },
    { key: 'code', header: 'Code', mono: true },
    { key: 'billed', header: 'Billed', numeric: true },
    { key: 'allowed', header: 'Allowed', numeric: true },
    { key: 'paid', header: 'Paid', numeric: true },
    { key: 'adjustment', header: 'Adjustment', numeric: true },
    { key: 'responsibility', header: 'Patient responsibility', numeric: true },
    { key: 'variance', header: 'Variance' },
    ...(onResolve ? [{ key: 'actions', header: 'Resolve', align: 'right' as const }] : []),
  ];

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
          <Badge tone={variance.tone}>{variance.label}</Badge>
          <Money amount={variance.amount} currency={currency} negativeLabel="Credit" />
          {line.adjustmentCode ? <Tag mono>{line.adjustmentCode}</Tag> : null}
          {line.exceptionReason ? <span className="or-small">{line.exceptionReason}</span> : null}
          {line.secondaryPayerName ? (
            <span className="or-small">Cascades to {line.secondaryPayerName}</span>
          ) : null}
        </span>
      ),
      ...(onResolve
        ? {
            actions: resolved ? (
              <Badge tone="success">{RESOLUTION_LABELS[resolved]}</Badge>
            ) : (
              <span className="or-row-actions">
                {RESOLUTIONS.map((resolution) => (
                  <Button
                    key={resolution}
                    variant="ghost"
                    size="sm"
                    onClick={() => onResolve(line.id, resolution)}
                    aria-label={`${RESOLUTION_LABELS[resolution]} for ${line.claimNumber} ${line.code}`}
                  >
                    {RESOLUTION_LABELS[resolution]}
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
