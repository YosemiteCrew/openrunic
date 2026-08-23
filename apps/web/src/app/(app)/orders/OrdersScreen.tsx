'use client';

import { Button, Card, Select, Table, Tag } from '@openrunic/ui';
import type { SelectOption, TableColumn } from '@openrunic/ui';
import { useMemo, useState } from 'react';
import type { ChangeEvent, ReactElement, ReactNode } from 'react';

import { ScreenCommands } from '@/components/command';
import type { Command } from '@/components/command';
import { isStuck, OrderAge, OrderStatusBadge } from '@/components/orders';
import { AppShell } from '@/components/shell';
import { AsyncBoundary, isEmptyList } from '@/components/state';
import { MOCK_NOW, mockPatientById, mockProviderName, ORDER_STATUSES, useOrders } from '@/lib/api';
import type { ListResponse, Order, OrderStatus, WorklistClient } from '@/lib/api';
import { formatDateTime, formatEnumLabel, formatMrn, formatName } from '@/lib/format';

/**
 * OR-03 Orders list and tracking.
 *
 * One question answers this screen: did the lab get it. Order status is a
 * first-class ledger here, the way a claim is, rather than plumbing inside a
 * lab module, so a transmitted order nobody has acknowledged carries its age in
 * the row and a retry beside it.
 */

const STATUS_FILTERS: SelectOption[] = [
  { value: '', label: 'Every status' },
  ...ORDER_STATUSES.map((status) => ({ value: status, label: formatEnumLabel(status) })),
];

export interface OrdersScreenProps {
  /** Injectable for tests. Defaults to the app's worklist client. */
  client?: WorklistClient;
  /** Fixed "now", so a state age is the same in a test and a screenshot. */
  now?: string;
}

const COLUMNS: TableColumn[] = [
  { key: 'order', header: 'Order' },
  { key: 'patient', header: 'Patient' },
  { key: 'placed', header: 'Placed' },
  { key: 'provider', header: 'Ordered by' },
  { key: 'destination', header: 'Destination' },
  { key: 'status', header: 'Status' },
  { key: 'age', header: 'In this state' },
  { key: 'actions', header: 'Actions' },
];

export function OrdersScreen({
  client,
  now = MOCK_NOW,
}: Readonly<OrdersScreenProps>): ReactElement {
  const [status, setStatus] = useState<OrderStatus | ''>('');
  const orders = useOrders(status ? { status } : {}, { client });

  const commands = useMemo<Command[]>(
    () => [
      {
        id: 'orders.list.pended',
        group: 'actions',
        label: 'Show pended orders',
        keywords: ['unsigned orders', 'tray'],
        icon: 'circle-dashed',
        perform: () => setStatus('PENDED'),
      },
      {
        id: 'orders.list.transmitted',
        group: 'actions',
        label: 'Show transmitted orders',
        keywords: ['sent to lab', 'awaiting acknowledgement'],
        icon: 'send',
        perform: () => setStatus('TRANSMITTED'),
      },
      {
        id: 'orders.list.all',
        group: 'actions',
        label: 'Show orders in every status',
        keywords: ['clear filter', 'everything'],
        icon: 'list',
        perform: () => setStatus(''),
      },
    ],
    []
  );

  return (
    <AppShell
      title="Orders"
      description="Every order for the practice, with its lifecycle."
      actions={
        <Button href="/orders/new" iconLeft="circle-plus">
          New order
        </Button>
      }
      topBarActions={
        <Select
          label="Status"
          options={STATUS_FILTERS}
          value={status}
          onChange={(event: ChangeEvent<HTMLSelectElement>) =>
            setStatus(event.target.value as OrderStatus | '')
          }
        />
      }
    >
      <ScreenCommands commands={commands} />
      <Card tone="cream" title="Order ledger">
        <AsyncBoundary
          state={orders}
          subject="the order ledger"
          isEmpty={isEmptyList}
          loadingRows={8}
          empty={{
            title: status ? `No ${formatEnumLabel(status).toLowerCase()} orders` : 'No orders yet',
            message: status
              ? 'Nothing sits in that state right now. Clear the filter to see the rest of the ledger.'
              : 'Orders placed from a visit or from the composer appear here with their status.',
            icon: 'clipboard-list',
            action: (
              <Button href="/orders/new" iconLeft="circle-plus">
                New order
              </Button>
            ),
          }}
        >
          {(page: ListResponse<Order>) => (
            <Table
              columns={COLUMNS}
              rows={page.data.map((order) => toRow(order, now))}
              caption="Orders across the practice, newest first"
            />
          )}
        </AsyncBoundary>
      </Card>
    </AppShell>
  );
}

function toRow(order: Order, now: string): Record<string, ReactNode> {
  const patient = mockPatientById(order.patientId);
  return {
    id: order.id,
    order: (
      <span className="or-stack-tight">
        <span>{order.name}</span>
        <span className="or-mono or-muted">{order.code}</span>
        <span className="or-small or-muted">
          {order.cancelReason ?? order.diagnosisDisplay ?? 'No diagnosis linked'}
        </span>
      </span>
    ),
    patient: patient ? (
      <span className="or-stack-tight">
        <span>{formatName(patient.name, 'listing')}</span>
        <span className="or-mono or-muted">{formatMrn(patient.mrn)}</span>
      </span>
    ) : (
      'Not recorded'
    ),
    placed: formatDateTime(order.placedAt, 'dense'),
    provider: mockProviderName(order.providerId),
    destination: order.destination,
    status: (
      <span className="or-cluster-tight">
        <OrderStatusBadge status={order.status} />
        {order.priority === 'ROUTINE' ? null : <Tag>{formatEnumLabel(order.priority)}</Tag>}
      </span>
    ),
    age: <OrderAge order={order} now={now} />,
    actions: (
      <span className="or-cluster-tight">
        {order.resultId ? (
          <Button variant="ghost" size="sm" href="/results" iconLeft="flask-conical">
            {`Open result for ${order.name}`}
          </Button>
        ) : null}
        {isStuck(order, now) ? (
          <Button variant="secondary" size="sm" iconLeft="rotate-ccw">
            {`Retry ${order.name}`}
          </Button>
        ) : null}
      </span>
    ),
  };
}
