'use client';

import { Badge, Button, Checkbox, Table } from '@openrunic/ui';
import type { TableColumn } from '@openrunic/ui';
import type { ReactElement, ReactNode } from 'react';

import type { Claim } from '@/lib/api';
import { formatDate, formatMrn, formatName } from '@/lib/format';

import { ageingState, claimAgeDays, CLAIM_STATUS_LABELS, CLAIM_STATUS_TONE } from './billing';
import { Money } from './Money';

/**
 * The claim ledger: one row per claim, its state, and how long it has sat in
 * it.
 *
 * A claim is never shown without its state age, because "submitted" means
 * nothing until you know whether it was submitted yesterday or in June. Rows
 * carrying scrub errors say so and cannot be selected for a bulk action that
 * would fail, which is how the workbench keeps a bulk submit honest.
 */

const COLUMNS: TableColumn[] = [
  { key: 'select', header: 'Select' },
  { key: 'claim', header: 'Claim', mono: true },
  { key: 'patient', header: 'Patient' },
  { key: 'serviceDate', header: 'Date of service' },
  { key: 'payer', header: 'Payer' },
  { key: 'billed', header: 'Billed', numeric: true },
  { key: 'status', header: 'State' },
  { key: 'age', header: 'Age in state' },
  { key: 'actions', header: 'Actions', align: 'right' },
];

export interface ClaimTableProps {
  claims: readonly Claim[];
  /** Fixed clock, so the ageing column is identical in a test and a demo. */
  now: string;
  selected: ReadonlySet<string>;
  onToggle: (claimId: string) => void;
  onOpen: (claim: Claim) => void;
}

export function ClaimTable({
  claims,
  now,
  selected,
  onToggle,
  onOpen,
}: Readonly<ClaimTableProps>): ReactElement {
  const rows = claims.map((claim): Record<string, ReactNode> => {
    const days = claimAgeDays(claim, now);
    const ageing = ageingState(days);
    const blocked = claim.scrubErrors.length > 0;

    return {
      id: claim.id,
      select: (
        <Checkbox
          checked={selected.has(claim.id)}
          disabled={blocked}
          aria-label={`Select claim ${claim.claimNumber}`}
          onChange={() => onToggle(claim.id)}
        />
      ),
      claim: claim.claimNumber,
      patient: (
        <span className="or-claim-patient">
          <span>{formatName(claim.patient.name, 'listing')}</span>
          <span className="or-mono or-caption">{formatMrn(claim.patient.mrn)}</span>
        </span>
      ),
      serviceDate: formatDate(claim.serviceDate, 'prose'),
      payer: claim.payer.name,
      billed: <Money amount={claim.billed} currency={claim.currency} />,
      status: (
        <span className="or-claim-state">
          <Badge tone={CLAIM_STATUS_TONE[claim.status]}>{CLAIM_STATUS_LABELS[claim.status]}</Badge>
          {blocked ? (
            <Badge tone="danger">
              {claim.scrubErrors.length} scrub {claim.scrubErrors.length === 1 ? 'error' : 'errors'}
            </Badge>
          ) : null}
        </span>
      ),
      age: (
        <span className="or-claim-age">
          <span className="or-mono">{days} d</span>
          <span className="or-small">{ageing.label}</span>
        </span>
      ),
      actions: (
        <Button
          variant="ghost"
          size="sm"
          iconRight="arrow-right"
          onClick={() => onOpen(claim)}
          aria-label={`Open claim ${claim.claimNumber}`}
        >
          Open
        </Button>
      ),
    };
  });

  return <Table caption="Claims" columns={COLUMNS} rows={rows} />;
}
