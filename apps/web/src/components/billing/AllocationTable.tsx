'use client';

import { Table } from '@openrunic/ui';
import type { TableColumn } from '@openrunic/ui';
import type { ReactElement, ReactNode } from 'react';

import { formatDate } from '@/lib/format';
import { numericFieldValue } from '@/lib/numeric-field';

import type { OpenItem } from './billing';
import { Money } from './Money';

/**
 * Allocating a payment across the visits it pays for.
 *
 * Each visit shows what is still owed on it and takes the part of the payment
 * that belongs to it. The remainder lives outside this table, pinned, because
 * it is the number the screen is really about: the batch this replaces hid it,
 * and money allocated to the wrong visit is the mistake nobody finds later.
 */

const COLUMNS: TableColumn[] = [
  { key: 'serviceDate', header: 'Visit' },
  { key: 'description', header: 'Description' },
  { key: 'outstanding', header: 'Outstanding', numeric: true },
  { key: 'allocated', header: 'Allocated', numeric: true },
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
  const rows = items.map((item): Record<string, ReactNode> => ({
    id: item.visitId,
    serviceDate: formatDate(item.serviceDate),
    description: item.description,
    outstanding: <Money amount={item.outstanding} currency={currency} />,
    allocated: (
      <input
        type="number"
        className="or-units-field or-mono"
        value={allocations[item.visitId] ?? 0}
        aria-label={`Amount allocated to the visit on ${formatDate(item.serviceDate)}`}
        onChange={(event) => {
          const next = numericFieldValue(event.target.value);
          if (next !== null) onChange(item.visitId, next);
        }}
      />
    ),
  }));

  return <Table caption="Open visits" columns={COLUMNS} rows={rows} />;
}
