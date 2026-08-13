'use client';

import { Badge, Button, Card, Checkbox, Input, Table, VitalStat } from '@openrunic/ui';
import type { TableColumn } from '@openrunic/ui';
import { useCallback, useMemo, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';

import {
  arSummary,
  BUCKET_LABELS,
  BUCKET_ORDER,
  bucketTone,
  DUNNING_LABELS,
  Money,
  StatementDrawer,
  ToastDock,
  useToasts,
} from '@/components/billing';
import { ScreenCommands } from '@/components/command';
import type { Command } from '@/components/command';
import { AppShell } from '@/components/shell';
import { AsyncBoundary } from '@/components/state';
import { filterStatements, useStatements } from '@/lib/api';
import type { AgeingBucket, BillingClient, StatementAccount } from '@/lib/api';
import { formatDate, formatMoney, formatMrn, formatName } from '@/lib/format';

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

const COLUMNS: TableColumn[] = [
  { key: 'select', header: 'Select' },
  { key: 'patient', header: 'Patient' },
  { key: 'balance', header: 'Balance', numeric: true },
  { key: 'bucket', header: 'Oldest balance' },
  { key: 'statements', header: 'Statements', numeric: true },
  { key: 'lastPayment', header: 'Last payment' },
  { key: 'dunning', header: 'Dunning stage' },
  { key: 'actions', header: 'Actions', align: 'right' },
];

export interface StatementsScreenProps {
  /** Injectable data client. Tests drive the empty and error states with it. */
  client?: BillingClient;
}

export function StatementsScreen({ client }: StatementsScreenProps = {}): ReactElement {
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
        title: 'Nothing selected',
        message: 'Select the accounts to include in this run.',
      });
      return;
    }
    setPreview(chosen);
  }, [visible, selected, toasts]);

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
        title: `${batch.length} ${batch.length === 1 ? 'statement' : 'statements'} sent`,
        message: 'Accounts with a mobile number also received a payment link.',
      });
    },
    [toasts]
  );

  const sendTextToPay = useCallback(
    (account: StatementAccount) => {
      setTexted((current) => new Set(current).add(account.id));
      toasts.push({
        tone: 'success',
        title: 'Payment link sent',
        message: `${formatName(account.patient.name)} can pay from the link on their phone.`,
      });
    },
    [toasts]
  );

  const commands = useMemo<Command[]>(
    () => [
      {
        id: 'billing.statements.run',
        group: 'actions',
        label: 'Preview a statement run',
        keywords: ['statements', 'run', 'send', 'dunning'],
        icon: 'mail',
        perform: openRun,
      },
      {
        id: 'billing.statements.selectAll',
        group: 'actions',
        label: 'Select every account in this view',
        keywords: ['select all', 'bulk'],
        icon: 'check-check',
        perform: selectAll,
      },
      {
        id: 'billing.statements.over90',
        group: 'actions',
        label: 'Show balances over 90 days',
        keywords: ['aging', 'ageing', 'collections', '90'],
        icon: 'triangle-alert',
        perform: () => {
          setBucket('DAYS_91_PLUS');
          setSelected(new Set());
        },
      },
      {
        id: 'billing.statements.all',
        group: 'actions',
        label: 'Show every balance',
        keywords: ['clear filter', 'all balances'],
        icon: 'list',
        perform: () => setBucket(null),
      },
    ],
    [openRun, selectAll]
  );

  const rows = visible.map((account): Record<string, ReactNode> => {
    const statementsSent = account.statementsSent + (sent[account.id] ?? 0);
    return {
      id: account.id,
      select: (
        <Checkbox
          checked={selected.has(account.id)}
          aria-label={`Select ${formatName(account.patient.name, 'listing')}`}
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
          <Badge tone={bucketTone(account.bucket)}>{BUCKET_LABELS[account.bucket]}</Badge>
          {account.paymentPlan ? (
            <Badge tone="neutral" icon="calendar-clock">
              Plan {account.paymentPlan.instalmentsPaid} of {account.paymentPlan.instalmentsTotal}
            </Badge>
          ) : null}
        </span>
      ),
      statements: <span className="or-mono">{statementsSent}</span>,
      lastPayment: account.lastPaymentAt ? (
        <span className="or-claim-age">
          <span>{formatDate(account.lastPaymentAt, 'dense')}</span>
          <span className="or-mono or-caption">
            {formatMoney(account.lastPaymentAmount ?? 0, { currency: account.currency }).text}
          </span>
        </span>
      ) : (
        <span className="or-small">None recorded</span>
      ),
      dunning: <span className="or-small">{DUNNING_LABELS[account.dunningStage]}</span>,
      actions: (
        <Button
          variant="ghost"
          size="sm"
          iconRight="arrow-right"
          onClick={() => setPreview([account])}
          aria-label={`Preview statement for ${formatName(account.patient.name, 'listing')}`}
        >
          Preview
        </Button>
      ),
    };
  });

  const selectedCount = visible.filter((account) => selected.has(account.id)).length;

  return (
    <AppShell
      title="Statements and AR"
      description="Patient balances, how old they are, and how to collect them."
      topBarActions={
        <Input
          className="or-billing__search"
          aria-label="Search balances"
          placeholder="Patient or MRN"
          iconLeft="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          autoComplete="off"
        />
      }
      actions={
        <div className="or-billing__action">
          <Button iconLeft="mail" disabled={selectedCount === 0} onClick={openRun}>
            Preview statement run
          </Button>
          <p className="or-caption or-billing__action-hint">
            {selectedCount === 0
              ? 'Select accounts to run statements for.'
              : `${selectedCount} selected.`}
          </p>
        </div>
      }
    >
      <ScreenCommands commands={commands} />

      <section className="or-strip" aria-label="Accounts receivable by age">
        {BUCKET_ORDER.map((candidate) => (
          <VitalStat
            key={candidate}
            label={BUCKET_LABELS[candidate]}
            value={formatMoney(summary.buckets[candidate], { currency: 'USD' }).text}
            state={bucketTone(candidate)}
            stateLabel={
              candidate === 'CURRENT'
                ? 'On track'
                : candidate === 'DAYS_31_60'
                  ? 'Ageing'
                  : 'Chase these'
            }
          />
        ))}
      </section>

      <Card overline="Ageing" title="Filter by bucket">
        <div className="or-filter-chips" role="group" aria-label="Ageing bucket">
          <button
            type="button"
            className="or-filter-chip"
            aria-pressed={bucket === null}
            onClick={() => {
              setBucket(null);
              setSelected(new Set());
            }}
          >
            All <span className="or-mono">{accounts.length}</span>
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
              {BUCKET_LABELS[candidate]}{' '}
              <span className="or-mono">
                {formatMoney(summary.buckets[candidate], { currency: 'USD' }).text}
              </span>
            </button>
          ))}
        </div>
      </Card>

      <AsyncBoundary
        state={statementsState}
        subject="patient balances"
        isEmpty={() => visible.length === 0}
        loadingRows={8}
        empty={{
          title: bucket ? `No balances in ${BUCKET_LABELS[bucket].toLowerCase()}` : 'No balances',
          message:
            'Patient responsibility arrives here from remittance advice. Nothing is outstanding in this view.',
          icon: 'mail',
          action: <Button href="/billing/remittance">Go to remittance</Button>,
        }}
      >
        {() => <Table caption="Patient balances" columns={COLUMNS} rows={rows} />}
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
