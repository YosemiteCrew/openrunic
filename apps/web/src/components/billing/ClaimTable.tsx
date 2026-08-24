'use client';

import { Badge, Button, Checkbox, Table } from '@openrunic/ui';
import type { ReactElement, ReactNode } from 'react';

import type { Claim } from '@/lib/api';
import { formatDate, formatMrn, formatName } from '@/lib/format';
import { counted } from '@/lib/i18n/counted';
import type { CountedMessage } from '@/lib/i18n/counted';
import { useTranslator } from '@/lib/i18n/messages';

import { ageingState, claimAgeDays, CLAIM_STATUS_LABEL_KEYS, CLAIM_STATUS_TONE } from './billing';
import { translateColumns } from './columns';
import type { KeyedColumn } from './columns';
import { Money } from './Money';

/**
 * The claim ledger: one row per claim, its state, and how long it has sat in
 * it.
 *
 * A claim is never shown without its state age, because "submitted" means
 * nothing until you know whether it was submitted yesterday or in June. Rows
 * carrying scrub errors say so and cannot be selected for a bulk action that
 * would fail, which is how the workbench keeps a bulk submit honest.
 *
 * The claim number and the payer's name are the payer's, and render as they
 * arrived. Everything the practice says about a claim - its state, its age
 * band - is this application's own vocabulary and comes from the catalogue.
 */

const COLUMNS: readonly KeyedColumn[] = [
  { key: 'select', headerKey: 'billing.claimTable.column.select' },
  { key: 'claim', headerKey: 'billing.claimTable.column.claim', mono: true },
  { key: 'patient', headerKey: 'billing.claimTable.column.patient' },
  { key: 'serviceDate', headerKey: 'billing.claimTable.column.serviceDate' },
  { key: 'payer', headerKey: 'billing.claimTable.column.payer' },
  { key: 'billed', headerKey: 'billing.claimTable.column.billed', numeric: true },
  { key: 'status', headerKey: 'billing.claimTable.column.status' },
  { key: 'age', headerKey: 'billing.claimTable.column.age' },
  { key: 'actions', headerKey: 'billing.claimTable.column.actions', align: 'right' },
];

/**
 * How many scrub errors are holding a row out of a bulk action.
 *
 * Through `counted` rather than a `length === 1` ternary, so the form comes
 * from the reader's own plural rules and the digits from their own numerals.
 */
const SCRUB_ERRORS: CountedMessage = {
  oneKey: 'billing.claimTable.scrubErrors.one',
  otherKey: 'billing.claimTable.scrubErrors.other',
};

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
  const t = useTranslator();

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
          aria-label={t('billing.claimTable.select', { number: claim.claimNumber })}
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
          <Badge tone={CLAIM_STATUS_TONE[claim.status]}>
            {t(CLAIM_STATUS_LABEL_KEYS[claim.status])}
          </Badge>
          {blocked ? (
            <Badge tone="danger">{counted(t, SCRUB_ERRORS, claim.scrubErrors.length)}</Badge>
          ) : null}
        </span>
      ),
      age: (
        <span className="or-claim-age">
          <span className="or-mono">{t('billing.claimTable.ageDays', { days })}</span>
          <span className="or-small">{t(ageing.labelKey)}</span>
        </span>
      ),
      actions: (
        <Button
          variant="ghost"
          size="sm"
          iconRight="arrow-right"
          onClick={() => onOpen(claim)}
          aria-label={t('billing.claimTable.openClaim', { number: claim.claimNumber })}
        >
          {t('billing.claimTable.open')}
        </Button>
      ),
    };
  });

  return (
    <Table
      caption={t('billing.claimTable.caption')}
      columns={translateColumns(COLUMNS, t)}
      rows={rows}
    />
  );
}
