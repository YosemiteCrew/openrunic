'use client';

import type { Translator } from '@openrunic/i18n';
import { Button, Card, Select, Table, Tag } from '@openrunic/ui';
import type { SelectOption, TableColumn } from '@openrunic/ui';
import { useMemo, useState } from 'react';
import type { ChangeEvent, ReactElement, ReactNode } from 'react';

import { ScreenCommands } from '@/components/command';
import type { Command } from '@/components/command';
import {
  isStuck,
  OrderAge,
  ORDER_PRIORITY_LABELS,
  ORDER_STATUS_LABELS,
  OrderStatusBadge,
} from '@/components/orders';
import { AppShell } from '@/components/shell';
import { AsyncBoundary, isEmptyList } from '@/components/state';
import { MOCK_NOW, mockPatientById, mockProviderName, ORDER_STATUSES, useOrders } from '@/lib/api';
import type { ListResponse, Order, OrderStatus, WorklistClient } from '@/lib/api';
import { formatDateTime, formatMrn, formatName } from '@/lib/format';
import { useTranslator } from '@/lib/i18n/messages';

/**
 * OR-03 Orders list and tracking.
 *
 * One question answers this screen: did the lab get it. Order status is a
 * first-class ledger here, the way a claim is, rather than plumbing inside a
 * lab module, so a transmitted order nobody has acknowledged carries its age in
 * the row and a retry beside it.
 *
 * Everything a person reads comes from the catalogue. Everything an order
 * carries with it - its name, its code, its destination, the diagnosis it was
 * linked to, the reason it was cancelled - is rendered as it arrived: those are
 * coded values that already have one name, and a second one written here would
 * be a second name for the same code.
 */

export interface OrdersScreenProps {
  /** Injectable for tests. Defaults to the app's worklist client. */
  client?: WorklistClient;
  /** Fixed "now", so a state age is the same in a test and a screenshot. */
  now?: string;
}

/**
 * The ledger's columns, carried as catalogue keys.
 *
 * Data rather than a translated constant, because the words depend on who is
 * reading and a module-scope constant is built before anybody has. The `Key`
 * suffix is also what `catalogue-drift.test.ts` reads, so a heading pointing at
 * a key nobody defined fails the build rather than appearing above a column.
 */
const COLUMNS: readonly (Omit<TableColumn, 'header'> & { headerKey: string })[] = [
  { key: 'order', headerKey: 'orders.list.column.order' },
  { key: 'patient', headerKey: 'orders.list.column.patient' },
  { key: 'placed', headerKey: 'orders.list.column.placed' },
  { key: 'provider', headerKey: 'orders.list.column.provider' },
  { key: 'destination', headerKey: 'orders.list.column.destination' },
  { key: 'status', headerKey: 'orders.list.column.status' },
  { key: 'age', headerKey: 'orders.list.column.age' },
  { key: 'actions', headerKey: 'orders.list.column.actions' },
];

export function OrdersScreen({
  client,
  now = MOCK_NOW,
}: Readonly<OrdersScreenProps>): ReactElement {
  const t = useTranslator();
  const [status, setStatus] = useState<OrderStatus | ''>('');
  const orders = useOrders(status ? { status } : {}, { client });

  const statusFilters = useMemo<SelectOption[]>(
    () => [
      { value: '', label: t('orders.list.everyStatus') },
      ...ORDER_STATUSES.map((option) => ({
        value: option,
        label: t(ORDER_STATUS_LABELS[option].labelKey),
      })),
    ],
    [t]
  );

  const columns = useMemo<TableColumn[]>(
    () => COLUMNS.map(({ headerKey, ...column }) => ({ ...column, header: t(headerKey) })),
    [t]
  );

  const commands = useMemo<Command[]>(
    () => [
      {
        id: 'orders.list.pended',
        group: 'actions',
        label: t('orders.list.command.pended'),
        keywords: searchWords(t('orders.list.command.pendedKeywords')),
        icon: 'circle-dashed',
        perform: () => setStatus('PENDED'),
      },
      {
        id: 'orders.list.transmitted',
        group: 'actions',
        label: t('orders.list.command.transmitted'),
        keywords: searchWords(t('orders.list.command.transmittedKeywords')),
        icon: 'send',
        perform: () => setStatus('TRANSMITTED'),
      },
      {
        id: 'orders.list.all',
        group: 'actions',
        label: t('orders.list.command.all'),
        keywords: searchWords(t('orders.list.command.allKeywords')),
        icon: 'list',
        perform: () => setStatus(''),
      },
    ],
    [t]
  );

  return (
    <AppShell
      title={t('orders.list.title')}
      description={t('orders.list.description')}
      actions={
        <Button href="/orders/new" iconLeft="circle-plus">
          {t('orders.list.newOrder')}
        </Button>
      }
      topBarActions={
        <Select
          label={t('orders.list.statusFilter')}
          options={statusFilters}
          value={status}
          onChange={(event: ChangeEvent<HTMLSelectElement>) =>
            setStatus(event.target.value as OrderStatus | '')
          }
        />
      }
    >
      <ScreenCommands commands={commands} />
      <Card tone="cream" title={t('orders.list.card')}>
        <AsyncBoundary
          state={orders}
          subject={t('orders.list.subject')}
          isEmpty={isEmptyList}
          loadingRows={8}
          empty={{
            title: status
              ? t('orders.list.empty.filteredTitle', {
                  /* Lower-cased with the reader's own rules: the word is a
                     translated one, and the runtime default is wrong for
                     Turkish. */
                  status: t(ORDER_STATUS_LABELS[status].labelKey).toLocaleLowerCase(t.locale),
                })
              : t('orders.list.empty.title'),
            message: status
              ? t('orders.list.empty.filteredMessage')
              : t('orders.list.empty.message'),
            icon: 'clipboard-list',
            action: (
              <Button href="/orders/new" iconLeft="circle-plus">
                {t('orders.list.newOrder')}
              </Button>
            ),
          }}
        >
          {(page: ListResponse<Order>) => (
            <Table
              columns={columns}
              rows={page.data.map((order) => toRow(t, order, now))}
              caption={t('orders.list.caption')}
            />
          )}
        </AsyncBoundary>
      </Card>
    </AppShell>
  );
}

/**
 * The synonyms a tired person types instead of the label.
 *
 * One comma-separated message per command rather than an array of keys, the way
 * the navigation table already carries its own: the words are per-language and
 * not transliterations, so a translator needs to see and replace the whole set
 * at once. The lookup stays at the call site so the key is a literal
 * `t('...')` that `catalogue-drift.test.ts` can find.
 */
function searchWords(words: string): string[] {
  return words
    .split(',')
    .map((word) => word.trim())
    .filter((word) => word !== '');
}

function toRow(t: Translator, order: Order, now: string): Record<string, ReactNode> {
  const patient = mockPatientById(order.patientId);
  return {
    id: order.id,
    order: (
      <span className="or-stack-tight">
        <span>{order.name}</span>
        <span className="or-mono or-muted">{order.code}</span>
        <span className="or-small or-muted">
          {order.cancelReason ?? order.diagnosisDisplay ?? t('orders.list.noDiagnosis')}
        </span>
      </span>
    ),
    patient: patient ? (
      <span className="or-stack-tight">
        <span>{formatName(patient.name, 'listing')}</span>
        <span className="or-mono or-muted">{formatMrn(patient.mrn)}</span>
      </span>
    ) : (
      t('orders.list.patientNotRecorded')
    ),
    placed: formatDateTime(t, order.placedAt, 'dense'),
    provider: mockProviderName(order.providerId),
    destination: order.destination,
    status: (
      <span className="or-cluster-tight">
        <OrderStatusBadge status={order.status} />
        {order.priority === 'ROUTINE' ? null : (
          <Tag>{t(ORDER_PRIORITY_LABELS[order.priority].labelKey)}</Tag>
        )}
      </span>
    ),
    age: <OrderAge order={order} now={now} />,
    actions: (
      <span className="or-cluster-tight">
        {order.resultId ? (
          <Button variant="ghost" size="sm" href="/results" iconLeft="flask-conical">
            {t('orders.list.openResult', { order: order.name })}
          </Button>
        ) : null}
        {isStuck(order, now) ? (
          <Button variant="secondary" size="sm" iconLeft="rotate-ccw">
            {t('orders.list.retry', { order: order.name })}
          </Button>
        ) : null}
      </span>
    ),
  };
}
