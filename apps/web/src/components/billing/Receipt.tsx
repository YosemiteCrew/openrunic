'use client';

import { Badge, Button, Table } from '@openrunic/ui';
import type { TableColumn } from '@openrunic/ui';
import type { ReactElement, ReactNode } from 'react';

import type { Payment } from '@/lib/api';
import { formatDate, formatDateTime, formatMrn, formatName } from '@/lib/format';

import { receiptRows } from './billing';
import { Drawer } from './Drawer';
import { Money } from './Money';

/**
 * The receipt, in the drawer the desk opens it from.
 *
 * It states what was taken, how, by whom, and exactly which visits it paid,
 * because "a payment" with no allocation behind it is what makes a patient
 * ledger unarguable-with later. Reprint is always available: a receipt that can
 * only be printed once is a receipt that gets lost.
 */

const COLUMNS: TableColumn[] = [
  { key: 'serviceDate', header: 'Visit' },
  { key: 'description', header: 'Description' },
  { key: 'allocated', header: 'Applied', numeric: true },
];

export interface ReceiptProps {
  payment: Payment | null;
  onClose: () => void;
  /** Fired by the print and email controls; both are stubs until the adapter lands. */
  onDeliver: (payment: Payment, channel: 'print' | 'email') => void;
}

export function Receipt({ payment, onClose, onDeliver }: ReceiptProps): ReactElement | null {
  if (!payment) return null;

  const rows = receiptRows(payment.allocations).map((allocation): Record<string, ReactNode> => ({
    id: allocation.id,
    serviceDate: formatDate(allocation.serviceDate),
    description: allocation.description,
    allocated: <Money amount={allocation.allocated} currency={payment.currency} />,
  }));

  return (
    <Drawer
      open
      title={`Receipt ${payment.receiptNumber}`}
      subtitle={
        <>
          {formatName(payment.patient.name)}{' '}
          <span className="or-mono">{formatMrn(payment.patient.mrn)}</span>
        </>
      }
      onClose={onClose}
      footer={
        <>
          <Button
            variant="secondary"
            iconLeft="printer"
            onClick={() => onDeliver(payment, 'print')}
          >
            Print receipt
          </Button>
          <Button iconLeft="mail" onClick={() => onDeliver(payment, 'email')}>
            Email receipt
          </Button>
        </>
      }
    >
      <div className="or-receipt">
        <dl className="or-totals">
          <div className="or-totals__row">
            <dt>Amount</dt>
            <dd>
              <Money amount={payment.amount} currency={payment.currency} emphasis />
            </dd>
          </div>
          <div className="or-totals__row">
            <dt>Method</dt>
            <dd>{payment.method.label}</dd>
          </div>
          <div className="or-totals__row">
            <dt>Taken</dt>
            <dd>
              {formatDateTime(payment.takenAt)} by {payment.takenBy}
            </dd>
          </div>
        </dl>

        {payment.status === 'REVERSED' ? (
          <Badge tone="danger">Reversed, this receipt no longer applies</Badge>
        ) : (
          <Badge tone="success">Captured</Badge>
        )}

        <Table caption="What this payment paid" columns={COLUMNS} rows={rows} />
      </div>
    </Drawer>
  );
}
