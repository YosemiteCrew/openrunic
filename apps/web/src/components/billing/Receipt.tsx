'use client';

import { Badge, Button, Table } from '@openrunic/ui';
import type { ReactElement, ReactNode } from 'react';

import type { Payment } from '@/lib/api';
import { formatDate, formatDateTime, formatMrn, formatName } from '@/lib/format';
import { useTranslator } from '@/lib/i18n/messages';

import { receiptRows } from './billing';
import { translateColumns } from './columns';
import type { KeyedColumn } from './columns';
import { Drawer } from './Drawer';
import { Money } from './Money';

/**
 * The receipt, in the drawer the desk opens it from.
 *
 * It states what was taken, how, by whom, and exactly which visits it paid,
 * because "a payment" with no allocation behind it is what makes a patient
 * ledger unarguable-with later. Reprint is always available: a receipt that can
 * only be printed once is a receipt that gets lost.
 *
 * `payment.method.label` is not translated here. It is the description the
 * payment carries - "Visa ending 4242" from the processor, or the words the
 * desk chose when it took the money - and a receipt that renames the method
 * after the fact is a receipt that no longer matches the transaction.
 */

const COLUMNS: readonly KeyedColumn[] = [
  { key: 'serviceDate', headerKey: 'billing.receipt.column.visit' },
  { key: 'description', headerKey: 'billing.receipt.column.description' },
  { key: 'allocated', headerKey: 'billing.receipt.column.applied', numeric: true },
];

export interface ReceiptProps {
  payment: Payment | null;
  onClose: () => void;
  /** Fired by the print and email controls; both are stubs until the adapter lands. */
  onDeliver: (payment: Payment, channel: 'print' | 'email') => void;
}

export function Receipt({
  payment,
  onClose,
  onDeliver,
}: Readonly<ReceiptProps>): ReactElement | null {
  const t = useTranslator();

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
      title={t('billing.receipt.title', { number: payment.receiptNumber })}
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
            {t('billing.receipt.print')}
          </Button>
          <Button iconLeft="mail" onClick={() => onDeliver(payment, 'email')}>
            {t('billing.receipt.email')}
          </Button>
        </>
      }
    >
      <div className="or-receipt">
        <dl className="or-totals">
          <div className="or-totals__row">
            <dt>{t('billing.receipt.amount')}</dt>
            <dd>
              <Money amount={payment.amount} currency={payment.currency} emphasis />
            </dd>
          </div>
          <div className="or-totals__row">
            <dt>{t('billing.receipt.method')}</dt>
            <dd>{payment.method.label}</dd>
          </div>
          <div className="or-totals__row">
            <dt>{t('billing.receipt.taken')}</dt>
            <dd>
              {t('billing.receipt.takenAtBy', {
                at: formatDateTime(payment.takenAt),
                by: payment.takenBy,
              })}
            </dd>
          </div>
        </dl>

        {payment.status === 'REVERSED' ? (
          <Badge tone="danger">{t('billing.receipt.reversed')}</Badge>
        ) : (
          <Badge tone="success">{t('billing.receipt.captured')}</Badge>
        )}

        <Table
          caption={t('billing.receipt.caption')}
          columns={translateColumns(COLUMNS, t)}
          rows={rows}
        />
      </div>
    </Drawer>
  );
}
