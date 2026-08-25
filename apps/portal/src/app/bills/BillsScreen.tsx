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

import { useCallback, useState } from 'react';
import { Badge, Button, Card, EmptyState, Modal, Table } from '@openrunic/ui';
import type { BadgeTone, TableColumn } from '@openrunic/ui';
import { AsyncBoundary } from '@/components/AsyncBoundary';
import { Money } from '@/components/Money';
import { PageHeader } from '@/components/PageHeader';
import { getPortalApi } from '@/lib/api';
import type { PortalApi, Receipt, Statement, StatementStatus } from '@/lib/api/types';
import { useTranslator } from '@/lib/i18n/messages';
import { formatDate, formatDateTime } from '@/lib/format';
import { useAction, useAsync } from '@/lib/useAsync';

export interface BillsScreenProps {
  api?: PortalApi;
}

const STATUS_LABEL: Record<StatementStatus, string> = {
  due: 'Due',
  paid: 'Paid',
  credit: 'In credit',
};

/* Terracotta is for actions, so a status badge never wears it. */
const STATUS_TONE: Record<StatementStatus, BadgeTone> = {
  due: 'neutral',
  paid: 'success',
  credit: 'success',
};

const LINE_COLUMNS: TableColumn[] = [
  { key: 'description', header: 'What it was for' },
  { key: 'code', header: 'Code', mono: true },
  { key: 'quantity', header: 'Quantity', numeric: true },
  { key: 'amount', header: 'Amount (GBP)', align: 'right' },
];

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
      overline={`Statement ${statement.reference}`}
      title={`Issued ${formatDate(t, statement.issuedOn)}`}
    >
      <Table
        caption={`Charges on statement ${statement.reference}`}
        columns={LINE_COLUMNS}
        rows={rows}
      />

      <p className="portal-table-note">
        Amounts are in pounds sterling. A figure marked credit is money owed back to you.
      </p>

      <div className="portal-total-row">
        <p className="portal-total-row__label">Total</p>
        <Money showCode value={statement.total} />
      </div>

      <div className="portal-total-row">
        <p className="portal-total-row__label">Still to pay</p>
        <Money showCode value={statement.balance} />
      </div>

      {receipt ? (
        <output className="portal-confirmation">
          <p className="portal-confirmation__title">Payment received</p>
          <p className="or-small">
            You paid <Money value={receipt.amount} /> on {formatDateTime(t, receipt.paidOn)} with
            the card ending {receipt.cardLast4}. Your receipt reference is {receipt.id}. Keep it if
            you need to query the payment.
          </p>
        </output>
      ) : null}

      {pay.status === 'failed' ? (
        <p className="portal-record__meta" role="alert">
          The payment did not go through and you have not been charged. Check your connection, then
          try again.
        </p>
      ) : null}

      <div className="portal-actions">
        {statement.status === 'due' && receipt === undefined ? (
          <Button iconLeft="credit-card" onClick={() => setConfirming(true)}>
            Pay this statement
          </Button>
        ) : null}
        <Button variant="secondary" iconLeft="arrow-left" onClick={onClose}>
          Back to your statements
        </Button>
      </div>

      {confirming ? (
        <Modal
          open
          title="Pay this statement?"
          description={`This takes ${statement.balance.currency} ${(statement.balance.amountMinor / 100).toFixed(2)} from the card the practice holds for you. Payments cannot be reversed from this portal. To get the money back you would have to ask the practice for a refund.`}
          onClose={() => setConfirming(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirming(false)}>
                Not now
              </Button>
              <Button onClick={confirmPay}>Pay now</Button>
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
        overline="Your account"
        title="Bills"
        lede="Every statement the practice has issued, what each charge was for, and how to pay."
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
            title="You have no statements."
            message="When the practice bills you for a visit, the statement appears here."
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
                  overline={`Statement ${statement.reference}`}
                  title={`Issued ${formatDate(t, statement.issuedOn)}`}
                >
                  <dl className="portal-data-list">
                    <div className="portal-data-list__row">
                      <dt className="portal-data-list__term">Status</dt>
                      <dd className="portal-data-list__value">
                        <Badge tone={STATUS_TONE[statement.status]}>
                          {STATUS_LABEL[statement.status]}
                        </Badge>
                      </dd>
                    </div>
                    <div className="portal-data-list__row">
                      <dt className="portal-data-list__term">Due by</dt>
                      <dd className="portal-data-list__value">{formatDate(t, statement.dueOn)}</dd>
                    </div>
                    <div className="portal-data-list__row">
                      <dt className="portal-data-list__term">Still to pay</dt>
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
                      See what this was for
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
