'use client';

import { Table } from '@openrunic/ui';
import type { ReactElement, ReactNode } from 'react';

import { formatDate } from '@/lib/format';
import { useTranslator } from '@/lib/i18n/messages';
import { numericFieldValue } from '@/lib/numeric-field';

import type { OpenItem } from './billing';
import { translateColumns } from './columns';
import type { KeyedColumn } from './columns';
import { Money } from './Money';

/**
 * Allocating a payment across the visits it pays for.
 *
 * Each visit shows what is still owed on it and takes the part of the payment
 * that belongs to it. The remainder lives outside this table, pinned, because
 * it is the number the screen is really about: the batch this replaces hid it,
 * and money allocated to the wrong visit is the mistake nobody finds later.
 *
 * The columns carry catalogue keys rather than words, and are turned into
 * headers at render. A module-scope array of English headers would render
 * English on a Spanish screen, because a constant is built once and the reader
 * arrives afterwards.
 */

const COLUMNS: readonly KeyedColumn[] = [
  { key: 'serviceDate', headerKey: 'billing.allocation.column.visit' },
  { key: 'description', headerKey: 'billing.allocation.column.description' },
  { key: 'outstanding', headerKey: 'billing.allocation.column.outstanding', numeric: true },
  { key: 'allocated', headerKey: 'billing.allocation.column.allocated', numeric: true },
];

export interface AllocationTableProps {
  items: readonly OpenItem[];
  currency: string;
  allocations: Readonly<Record<string, number>>;
  onChange: (visitId: string, amount: number) => void;
}

export function AllocationTable({
  items,
  currency,
  allocations,
  onChange,
}: Readonly<AllocationTableProps>): ReactElement {
  const t = useTranslator();

  const columns = translateColumns(COLUMNS, t);

  const rows = items.map((item): Record<string, ReactNode> => ({
    id: item.visitId,
    serviceDate: formatDate(t, item.serviceDate),
    description: item.description,
    outstanding: <Money amount={item.outstanding} currency={currency} />,
    allocated: (
      <input
        type="number"
        className="or-units-field or-mono"
        value={allocations[item.visitId] ?? 0}
        aria-label={t('billing.allocation.amountFor', { date: formatDate(t, item.serviceDate) })}
        onChange={(event) => {
          const next = numericFieldValue(event.target.value);
          if (next !== null) onChange(item.visitId, next);
        }}
      />
    ),
  }));

  return <Table caption={t('billing.allocation.caption')} columns={columns} rows={rows} />;
}
