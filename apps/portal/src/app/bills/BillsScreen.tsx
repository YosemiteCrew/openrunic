'use client';

/**
 * Bills: statements, what each line was actually for, and paying.
 *
 * Line items lead with plain language and keep the billing code beside it in a quiet
 * column, because the code is what a patient needs to quote when querying a charge but not
 * what they need to read it. Money is right-aligned and tabular so amounts line up down the
 * column, and the currency is named in the column header rather than left to a bare symbol.
 *
 * A credit is never just a minus sign. It is labelled in words next to the figure, since a
 * sign is easy to miss on a phone and impossible to hear.
 */

import type { Translator } from '@openrunic/i18n';
import { useCallback, useState } from 'react';
import { Badge, Button, Card, EmptyState, Modal, Table } from '@openrunic/ui';
import type { BadgeTone, TableColumn } from '@openrunic/ui';
import { AsyncBoundary } from '@/components/AsyncBoundary';
import { Money } from '@/components/Money';
import { PageHeader } from '@/components/PageHeader';
import { getPortalApi } from '@/lib/api';
import type { PortalApi, Receipt, Statement, StatementStatus } from '@/lib/api/types';
import { useTranslator } from '@/lib/i18n/messages';
import { formatDate, formatDateTime, formatMoney, formatMoneyWithCode } from '@/lib/format';
import { useAction, useAsync } from '@/lib/useAsync';

export interface BillsScreenProps {
  api?: PortalApi;
}

/*
 * The three states a statement can be in.
 *
 * Keys as the map's values, which is the shape `catalogue-drift.test.ts`
 * reaches by checking the catalogue against the source rather than the source
 * against the catalogue: the property name is the status, not `somethingKey`,
 * so the forward scan cannot see these.
 */
const STATUS_LABEL_KEYS: Record<StatementStatus, string> = {
  due: 'portal.bills.status.due',
  paid: 'portal.bills.status.paid',
  credit: 'portal.bills.status.credit',
};

/* Terracotta is for actions, so a status badge never wears it. */
const STATUS_TONE: Record<StatementStatus, BadgeTone> = {
  due: 'neutral',
  paid: 'success',
  credit: 'success',
};

/**
 * The columns, built per statement because one of them names the currency.
 *
 * The header used to read `Amount (GBP)` whatever the money said. A practice
 * billing in euros got euro figures under a column headed GBP, which is the
 * kind of wrong that reads as authoritative: the reader has no reason to
 * distrust a column header, and the figures underneath look right.
 */
function lineColumns(t: Translator, currency: string): TableColumn[] {
  return [
    { key: 'description', header: t('portal.bills.lines.description') },
    { key: 'code', header: t('portal.bills.lines.code'), mono: true },
    { key: 'quantity', header: t('portal.bills.lines.quantity'), numeric: true },
    { key: 'amount', header: t('portal.bills.lines.amount', { currency }), align: 'right' },
  ];
}

interface StatementDetailProps {
  statement: Statement;
  api: PortalApi;
  onClose: () => void;
}

function StatementDetail({ statement, api, onClose }: Readonly<StatementDetailProps>) {
  const t = useTranslator();
  const [confirming, setConfirming] = useState(false);
  const pay = useAction((id: string) => api.payStatement(id));
  const receipt: Receipt | undefined = pay.value;

  /* Deliberately does not re-read the statement list. A reload would drop this view and
     take the receipt with it, and a receipt that vanishes the instant it is issued is the
     one thing a patient will want to go back to. The list refreshes on the way out. */
  const confirmPay = async () => {
    await pay.run(statement.id);
    setConfirming(false);
  };

  const rows = statement.lines.map((line) => ({
    id: line.id,
    description: line.description,
    code: line.code,
    quantity: line.quantity,
    amount: <Money value={line.amount} />,
  }));

  return (
    <Card
      overline={t('portal.bills.statement.overline', { reference: statement.reference })}
      title={t('portal.bills.statement.title', { date: formatDate(t, statement.issuedOn) })}
    >
      <Table
        caption={t('portal.bills.lines.caption', { reference: statement.reference })}
        columns={lineColumns(t, statement.total.currency)}
        rows={rows}
      />

      <p className="portal-table-note">
        {t('portal.bills.lines.note', { currency: statement.total.currency })}
      </p>

      <div className="portal-total-row">
        <p className="portal-total-row__label">{t('portal.bills.statement.total')}</p>
        <Money showCode value={statement.total} />
      </div>

      <div className="portal-total-row">
        <p className="portal-total-row__label">{t('portal.bills.statement.stillToPay')}</p>
        <Money showCode value={statement.balance} />
      </div>

      {receipt ? (
        <output className="portal-confirmation">
          <p className="portal-confirmation__title">{t('portal.bills.receipt.title')}</p>
          {/* One message rather than a sentence built round a rendered <Money>.
              The figure was a component in the middle of prose, which fixed
              where the amount sits and made the rest of the sentence four
              fragments either side of it. */}
          <p className="or-small">
            {t('portal.bills.receipt.body', {
              amount: formatMoney(t, receipt.amount),
              paidOn: formatDateTime(t, receipt.paidOn),
              cardLast4: receipt.cardLast4,
              reference: receipt.id,
            })}
          </p>
        </output>
      ) : null}

      {pay.status === 'failed' ? (
        <p className="portal-record__meta" role="alert">
          {t('portal.bills.pay.failed')}
        </p>
      ) : null}

      <div className="portal-actions">
        {statement.status === 'due' && receipt === undefined ? (
          <Button iconLeft="credit-card" onClick={() => setConfirming(true)}>
            {t('portal.bills.pay.action')}
          </Button>
        ) : null}
        <Button variant="secondary" iconLeft="arrow-left" onClick={onClose}>
          {t('portal.bills.back')}
        </Button>
      </div>

      {confirming ? (
        <Modal
          open
          title={t('portal.bills.payDialog.title')}
          /* `formatMoneyWithCode` rather than the code and a fixed-point number
             glued together, which is what this said. That spelled every amount
             `GBP 42.50`: no symbol, no grouping, and a full stop for a decimal
             separator in front of a reader whose language writes a comma. The
             figure a payment dialog names is the one figure on the screen that
             has to be unmistakable. */
          description={t('portal.bills.payDialog.description', {
            amount: formatMoneyWithCode(t, statement.balance),
          })}
          onClose={() => setConfirming(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirming(false)}>
                {t('portal.bills.payDialog.notNow')}
              </Button>
              <Button onClick={confirmPay}>{t('portal.bills.payDialog.confirm')}</Button>
            </>
          }
        />
      ) : null}
    </Card>
  );
}

export function BillsScreen({ api = getPortalApi() }: Readonly<BillsScreenProps>) {
  const t = useTranslator();
  const load = useCallback(() => api.getStatements(), [api]);
  const { state, reload } = useAsync(load);
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <>
      <PageHeader
        overline={t('portal.bills.overline')}
        title={t('portal.bills.title')}
        lede={t('portal.bills.lede')}
      />

      <AsyncBoundary
        state={state}
        loadingKey="portal.bills.async.loading"
        errorKey="portal.bills.async.error"
        onRetry={reload}
        isEmpty={(statements) => statements.length === 0}
        empty={
          <EmptyState
            icon="receipt"
            title={t('portal.bills.empty.title')}
            message={t('portal.bills.empty.message')}
          />
        }
      >
        {(statements) => {
          const open = statements.find((statement) => statement.id === openId);

          if (open) {
            return (
              <StatementDetail
                api={api}
                key={open.id}
                onClose={() => {
                  setOpenId(null);
                  reload();
                }}
                statement={open}
              />
            );
          }

          return (
            <div className="portal-stack">
              {statements.map((statement) => (
                <Card
                  key={statement.id}
                  overline={t('portal.bills.statement.overline', {
                    reference: statement.reference,
                  })}
                  title={t('portal.bills.statement.title', {
                    date: formatDate(t, statement.issuedOn),
                  })}
                >
                  <dl className="portal-data-list">
                    <div className="portal-data-list__row">
                      <dt className="portal-data-list__term">
                        {t('portal.bills.statement.status')}
                      </dt>
                      <dd className="portal-data-list__value">
                        <Badge tone={STATUS_TONE[statement.status]}>
                          {t(STATUS_LABEL_KEYS[statement.status])}
                        </Badge>
                      </dd>
                    </div>
                    <div className="portal-data-list__row">
                      <dt className="portal-data-list__term">
                        {t('portal.bills.statement.dueBy')}
                      </dt>
                      <dd className="portal-data-list__value">{formatDate(t, statement.dueOn)}</dd>
                    </div>
                    <div className="portal-data-list__row">
                      <dt className="portal-data-list__term">
                        {t('portal.bills.statement.stillToPay')}
                      </dt>
                      <dd className="portal-data-list__value">
                        <Money showCode value={statement.balance} />
                      </dd>
                    </div>
                  </dl>

                  <div className="portal-actions">
                    <Button
                      iconLeft="receipt"
                      variant={statement.status === 'due' ? 'primary' : 'secondary'}
                      onClick={() => setOpenId(statement.id)}
                    >
                      {t('portal.bills.statement.open')}
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          );
        }}
      </AsyncBoundary>
    </>
  );
}
