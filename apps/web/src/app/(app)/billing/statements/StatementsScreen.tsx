'use client';

import { Badge, Button, Card, Checkbox, Input, Table, VitalStat } from '@openrunic/ui';
import { useCallback, useMemo, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';

import {
  arSummary,
  BUCKET_LABEL_KEYS,
  BUCKET_ORDER,
  BUCKET_STATE_LABEL_KEYS,
  bucketTone,
  DUNNING_LABEL_KEYS,
  Money,
  StatementDrawer,
  ToastDock,
  translateColumns,
  useToasts,
} from '@/components/billing';
import type { KeyedColumn } from '@/components/billing';
import { ScreenCommands } from '@/components/command';
import type { Command } from '@/components/command';
import { AppShell } from '@/components/shell';
import { AsyncBoundary } from '@/components/state';
import { filterStatements, useStatements } from '@/lib/api';
import type { AgeingBucket, BillingClient, StatementAccount } from '@/lib/api';
import { formatDate, formatMoney, formatMrn, formatName } from '@/lib/format';
import { searchWords } from '@/lib/i18n/counted';
import { useTranslator } from '@/lib/i18n/messages';

/**
 * BL-07 Statements and patient AR, with BL-08's ageing above it.
 *
 * A balance here is collectable rather than merely printable: every row carries
 * the ageing bucket that decides how hard to chase it, the dunning stage a run
 * would escalate it to, and the two modern ways to actually take the money, a
 * text-to-pay link and a card already consented to.
 *
 * The metric: this week's statements filtered, previewed and sent in four
 * interactions. Nothing is sent without the preview, because the preview is
 * where the escalation is visible, and an escalation that happens silently is
 * how a practice sends a final notice to someone on a payment plan.
 */

const COLUMNS: readonly KeyedColumn[] = [
  { key: 'select', headerKey: 'billing.statements.column.select' },
  { key: 'patient', headerKey: 'billing.statements.column.patient' },
  { key: 'balance', headerKey: 'billing.statements.column.balance', numeric: true },
  { key: 'bucket', headerKey: 'billing.statements.column.bucket' },
  { key: 'statements', headerKey: 'billing.statements.column.statements', numeric: true },
  { key: 'lastPayment', headerKey: 'billing.statements.column.lastPayment' },
  { key: 'dunning', headerKey: 'billing.statements.column.dunning' },
  { key: 'actions', headerKey: 'billing.statements.column.actions', align: 'right' },
];

export interface StatementsScreenProps {
  /** Injectable data client. Tests drive the empty and error states with it. */
  client?: BillingClient;
}

export function StatementsScreen({ client }: Readonly<StatementsScreenProps>): ReactElement {
  const t = useTranslator();
  const statementsState = useStatements({ pageSize: 100 }, { client });
  const accounts = useMemo(() => statementsState.data?.data ?? [], [statementsState.data]);

  const [bucket, setBucket] = useState<AgeingBucket | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [preview, setPreview] = useState<readonly StatementAccount[]>([]);
  const [sent, setSent] = useState<Record<string, number>>({});
  const [texted, setTexted] = useState<ReadonlySet<string>>(new Set());
  const toasts = useToasts();

  const summary = useMemo(() => arSummary(accounts), [accounts]);

  const visible = useMemo(
    () => filterStatements(accounts, { bucket: bucket ?? undefined, q: query || undefined }),
    [accounts, bucket, query]
  );

  const toggle = useCallback((accountId: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(accountId)) next.delete(accountId);
      else next.add(accountId);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelected(new Set(visible.map((account) => account.id)));
  }, [visible]);

  const openRun = useCallback(() => {
    const chosen = visible.filter((account) => selected.has(account.id));
    if (chosen.length === 0) {
      toasts.push({
        tone: 'info',
        title: t('billing.statements.toast.nothingSelected'),
        message: t('billing.statements.toast.nothingSelectedMessage'),
      });
      return;
    }
    setPreview(chosen);
  }, [visible, selected, toasts, t]);

  const send = useCallback(
    (batch: readonly StatementAccount[]) => {
      setSent((current) => {
        const update = { ...current };
        for (const account of batch) update[account.id] = (update[account.id] ?? 0) + 1;
        return update;
      });
      setPreview([]);
      setSelected(new Set());
      toasts.push({
        tone: 'success',
        title: t(
          batch.length === 1
            ? 'billing.statements.toast.sent.one'
            : 'billing.statements.toast.sent.other',
          { count: batch.length }
        ),
        message: t('billing.statements.toast.sentMessage'),
      });
    },
    [toasts, t]
  );

  const sendTextToPay = useCallback(
    (account: StatementAccount) => {
      setTexted((current) => new Set(current).add(account.id));
      toasts.push({
        tone: 'success',
        title: t('billing.statements.toast.linkSent'),
        message: t('billing.statements.toast.linkSentMessage', {
          name: formatName(account.patient.name),
        }),
      });
    },
    [toasts, t]
  );

  const commands = useMemo<Command[]>(
    () => [
      {
        id: 'billing.statements.run',
        group: 'actions',
        label: t('billing.statements.command.run'),
        keywords: searchWords(t('billing.statements.command.run.keywords')),
        icon: 'mail',
        perform: openRun,
      },
      {
        id: 'billing.statements.selectAll',
        group: 'actions',
        label: t('billing.statements.command.selectAll'),
        keywords: searchWords(t('billing.statements.command.selectAll.keywords')),
        icon: 'check-check',
        perform: selectAll,
      },
      {
        id: 'billing.statements.over90',
        group: 'actions',
        label: t('billing.statements.command.over90'),
        keywords: searchWords(t('billing.statements.command.over90.keywords')),
        icon: 'triangle-alert',
        perform: () => {
          setBucket('DAYS_91_PLUS');
          setSelected(new Set());
        },
      },
      {
        id: 'billing.statements.all',
        group: 'actions',
        label: t('billing.statements.command.all'),
        keywords: searchWords(t('billing.statements.command.all.keywords')),
        icon: 'list',
        perform: () => setBucket(null),
      },
    ],
    [openRun, selectAll, t]
  );

  const rows = visible.map((account): Record<string, ReactNode> => {
    const statementsSent = account.statementsSent + (sent[account.id] ?? 0);
    return {
      id: account.id,
      select: (
        <Checkbox
          checked={selected.has(account.id)}
          aria-label={t('billing.statements.select', {
            name: formatName(account.patient.name, 'listing'),
          })}
          onChange={() => toggle(account.id)}
        />
      ),
      patient: (
        <span className="or-claim-patient">
          <span>{formatName(account.patient.name, 'listing')}</span>
          <span className="or-mono or-caption">{formatMrn(account.patient.mrn)}</span>
        </span>
      ),
      balance: <Money amount={account.balance} currency={account.currency} />,
      bucket: (
        <span className="or-claim-state">
          <Badge tone={bucketTone(account.bucket)}>{t(BUCKET_LABEL_KEYS[account.bucket])}</Badge>
          {account.paymentPlan ? (
            <Badge tone="neutral" icon="calendar-clock">
              {t('billing.statements.plan', {
                paid: account.paymentPlan.instalmentsPaid,
                total: account.paymentPlan.instalmentsTotal,
              })}
            </Badge>
          ) : null}
        </span>
      ),
      statements: <span className="or-mono">{statementsSent}</span>,
      lastPayment: account.lastPaymentAt ? (
        <span className="or-claim-age">
          <span>{formatDate(t, account.lastPaymentAt, 'dense')}</span>
          <span className="or-mono or-caption">
            {formatMoney(t, account.lastPaymentAmount ?? 0, { currency: account.currency }).text}
          </span>
        </span>
      ) : (
        <span className="or-small">{t('billing.statements.noneRecorded')}</span>
      ),
      dunning: <span className="or-small">{t(DUNNING_LABEL_KEYS[account.dunningStage])}</span>,
      actions: (
        <Button
          variant="ghost"
          size="sm"
          iconRight="arrow-right"
          onClick={() => setPreview([account])}
          aria-label={t('billing.statements.previewFor', {
            name: formatName(account.patient.name, 'listing'),
          })}
        >
          {t('billing.statements.preview')}
        </Button>
      ),
    };
  });

  const selectedCount = visible.filter((account) => selected.has(account.id)).length;

  return (
    <AppShell
      title={t('billing.statements.title')}
      description={t('billing.statements.description')}
      topBarActions={
        <Input
          className="or-billing__search"
          aria-label={t('billing.statements.search')}
          placeholder={t('billing.statements.searchPlaceholder')}
          iconLeft="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          autoComplete="off"
        />
      }
      actions={
        <div className="or-billing__action">
          <Button iconLeft="mail" disabled={selectedCount === 0} onClick={openRun}>
            {t('billing.statements.previewRun')}
          </Button>
          <p className="or-caption or-billing__action-hint">
            {selectedCount === 0
              ? t('billing.statements.selectPrompt')
              : t('billing.statements.selectedCount', { count: selectedCount })}
          </p>
        </div>
      }
    >
      <ScreenCommands commands={commands} />

      <section className="or-strip" aria-label={t('billing.statements.strip')}>
        {BUCKET_ORDER.map((candidate) => (
          <VitalStat
            key={candidate}
            label={t(BUCKET_LABEL_KEYS[candidate])}
            value={formatMoney(t, summary.buckets[candidate], { currency: 'USD' }).text}
            state={bucketTone(candidate)}
            stateLabel={t(BUCKET_STATE_LABEL_KEYS[candidate])}
          />
        ))}
      </section>

      <Card overline={t('billing.statements.ageing')} title={t('billing.statements.filterTitle')}>
        <fieldset className="or-filter-chips" aria-label={t('billing.statements.bucketLegend')}>
          <button
            type="button"
            className="or-filter-chip"
            aria-pressed={bucket === null}
            onClick={() => {
              setBucket(null);
              setSelected(new Set());
            }}
          >
            {t('billing.statements.all')} <span className="or-mono">{accounts.length}</span>
          </button>
          {BUCKET_ORDER.map((candidate) => (
            <button
              key={candidate}
              type="button"
              className="or-filter-chip"
              aria-pressed={bucket === candidate}
              onClick={() => {
                setBucket(candidate);
                setSelected(new Set());
              }}
            >
              {t(BUCKET_LABEL_KEYS[candidate])}{' '}
              <span className="or-mono">
                {formatMoney(t, summary.buckets[candidate], { currency: 'USD' }).text}
              </span>
            </button>
          ))}
        </fieldset>
      </Card>

      <AsyncBoundary
        state={statementsState}
        subject={t('billing.statements.subject')}
        isEmpty={() => visible.length === 0}
        loadingRows={8}
        empty={{
          title: bucket
            ? t('billing.statements.empty.filtered', {
                bucket: t(BUCKET_LABEL_KEYS[bucket]).toLowerCase(),
              })
            : t('billing.statements.empty.title'),
          message: t('billing.statements.empty.message'),
          icon: 'mail',
          action: (
            <Button href="/billing/remittance">{t('billing.statements.empty.action')}</Button>
          ),
        }}
      >
        {() => (
          <Table
            caption={t('billing.statements.caption')}
            columns={translateColumns(COLUMNS, t)}
            rows={rows}
          />
        )}
      </AsyncBoundary>

      <StatementDrawer
        accounts={preview}
        open={preview.length > 0}
        texted={texted}
        onClose={() => setPreview([])}
        onSend={send}
        onTextToPay={sendTextToPay}
      />
      <ToastDock toasts={toasts.toasts} onDismiss={toasts.dismiss} />
    </AppShell>
  );
}
