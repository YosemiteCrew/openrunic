'use client';

import { Badge, Button, Table } from '@openrunic/ui';
import type { ReactElement, ReactNode } from 'react';

import type { StatementAccount } from '@/lib/api';
import { formatDate, formatMoney, formatMrn, formatName } from '@/lib/format';
import { useTranslator } from '@/lib/i18n/messages';

import {
  BUCKET_LABEL_KEYS,
  DUNNING_LABEL_KEYS,
  nextDunningStage,
  statementTotals,
} from './billing';
import { translateColumns } from './columns';
import type { KeyedColumn } from './columns';
import { Drawer } from './Drawer';
import { Money } from './Money';

/**
 * The statement preview, in both the shapes a biller needs it.
 *
 * One account is a real statement: the visits behind the balance, what
 * insurance did, what is left, and the two ways to collect it. A run is the
 * same preview at batch scale, showing exactly which dunning stage each account
 * escalates to before anything is sent, because a final notice going to the
 * wrong person is not undoable.
 *
 * The patient-facing sentence is written in the portal register even though a
 * biller reads it here: it is the sentence the patient will receive. It is one
 * message with both amounts as placeholders rather than three fragments joined
 * at render, because "your insurance paid X, your share is Y" does not keep its
 * order across languages and a sentence assembled from pieces cannot be
 * translated at all.
 */

const LEDGER_COLUMNS: readonly KeyedColumn[] = [
  { key: 'serviceDate', headerKey: 'billing.statementDrawer.ledger.visit' },
  { key: 'description', headerKey: 'billing.statementDrawer.ledger.description' },
  { key: 'charges', headerKey: 'billing.statementDrawer.ledger.charges', numeric: true },
  {
    key: 'insurancePaid',
    headerKey: 'billing.statementDrawer.ledger.insurancePaid',
    numeric: true,
  },
  { key: 'adjustments', headerKey: 'billing.statementDrawer.ledger.adjustments', numeric: true },
  { key: 'outstanding', headerKey: 'billing.statementDrawer.ledger.outstanding', numeric: true },
];

const RUN_COLUMNS: readonly KeyedColumn[] = [
  { key: 'patient', headerKey: 'billing.statementDrawer.run.patient' },
  { key: 'balance', headerKey: 'billing.statementDrawer.run.balance', numeric: true },
  { key: 'bucket', headerKey: 'billing.statementDrawer.run.bucket' },
  { key: 'escalation', headerKey: 'billing.statementDrawer.run.escalation' },
  { key: 'delivery', headerKey: 'billing.statementDrawer.run.delivery' },
];

export interface StatementDrawerProps {
  /** One account previews a statement; several previews a run. */
  accounts: readonly StatementAccount[];
  open: boolean;
  onClose: () => void;
  onSend: (accounts: readonly StatementAccount[]) => void;
  onTextToPay: (account: StatementAccount) => void;
  /** Accounts a link has already been sent to in this session. */
  texted: ReadonlySet<string>;
}

export function StatementDrawer({
  accounts,
  open,
  onClose,
  onSend,
  onTextToPay,
  texted,
}: Readonly<StatementDrawerProps>): ReactElement | null {
  const t = useTranslator();

  if (!open || accounts.length === 0) return null;

  const single = accounts.length === 1 ? accounts[0] : null;

  if (single) {
    const totals = statementTotals(single.lines);
    const rows = single.lines.map((line): Record<string, ReactNode> => ({
      id: line.id,
      serviceDate: formatDate(t, line.serviceDate),
      description: line.description,
      charges: <Money amount={line.charges} currency={single.currency} />,
      insurancePaid: <Money amount={line.insurancePaid} currency={single.currency} />,
      adjustments: <Money amount={line.adjustments} currency={single.currency} />,
      outstanding: <Money amount={line.outstanding} currency={single.currency} />,
    }));

    return (
      <Drawer
        open
        title={t('billing.statementDrawer.title', { name: formatName(single.patient.name) })}
        subtitle={
          <>
            <span className="or-mono">{formatMrn(single.patient.mrn)}</span>
            {', '}
            {t('billing.statementDrawer.subtitle', {
              stage: t(DUNNING_LABEL_KEYS[single.dunningStage]).toLowerCase(),
              sent: single.statementsSent,
            })}
          </>
        }
        onClose={onClose}
        footer={
          <>
            <Button
              variant="secondary"
              iconLeft="smartphone"
              disabled={single.mobile === null || texted.has(single.id)}
              onClick={() => onTextToPay(single)}
            >
              {texted.has(single.id)
                ? t('billing.statementDrawer.linkSent')
                : t('billing.statementDrawer.sendLink')}
            </Button>
            <Button iconLeft="mail" onClick={() => onSend([single])}>
              {t('billing.statementDrawer.send')}
            </Button>
          </>
        }
      >
        <div className="or-statement">
          <p className="or-body-lg or-statement__sentence">
            {t('billing.statementDrawer.sentence', {
              insurance: formatMoney(t, totals.insurancePaid, { currency: single.currency }).text,
              share: formatMoney(t, totals.outstanding, { currency: single.currency }).text,
            })}
          </p>

          <Table
            caption={t('billing.statementDrawer.linesCaption')}
            columns={translateColumns(LEDGER_COLUMNS, t)}
            rows={rows}
          />

          <dl className="or-totals">
            <div className="or-totals__row">
              <dt>{t('billing.statementDrawer.totals.charges')}</dt>
              <dd>
                <Money amount={totals.charges} currency={single.currency} />
              </dd>
            </div>
            <div className="or-totals__row">
              <dt>{t('billing.statementDrawer.totals.insurancePaid')}</dt>
              <dd>
                <Money amount={totals.insurancePaid} currency={single.currency} />
              </dd>
            </div>
            <div className="or-totals__row">
              <dt>{t('billing.statementDrawer.totals.balanceDue')}</dt>
              <dd>
                <Money amount={totals.outstanding} currency={single.currency} emphasis />
              </dd>
            </div>
          </dl>

          <section aria-labelledby="statement-collection">
            <h3 id="statement-collection" className="or-h3">
              {t('billing.statementDrawer.collection')}
            </h3>
            <ul className="or-fact-list">
              <li>
                <span className="or-fact-list__term">{t('billing.statementDrawer.mobile')}</span>
                <span>{single.mobile ?? t('common.notRecorded')}</span>
                {texted.has(single.id) ? (
                  <Badge tone="success">{t('billing.statementDrawer.linkSent')}</Badge>
                ) : null}
              </li>
              <li>
                <span className="or-fact-list__term">
                  {t('billing.statementDrawer.cardOnFile')}
                </span>
                <span>
                  {single.cardOnFile
                    ? t('billing.statementDrawer.cardConsent')
                    : t('billing.statementDrawer.noCard')}
                </span>
              </li>
              <li>
                <span className="or-fact-list__term">
                  {t('billing.statementDrawer.paymentPlan')}
                </span>
                <span>
                  {single.paymentPlan
                    ? t('billing.statementDrawer.plan', {
                        amount: formatMoney(t, single.paymentPlan.instalmentAmount, {
                          currency: single.currency,
                        }).text,
                        paid: single.paymentPlan.instalmentsPaid,
                        total: single.paymentPlan.instalmentsTotal,
                      })
                    : t('billing.statementDrawer.noPlan')}
                </span>
              </li>
              <li>
                <span className="or-fact-list__term">
                  {t('billing.statementDrawer.lastStatement')}
                </span>
                <span>
                  {single.lastStatementAt
                    ? formatDate(t, single.lastStatementAt)
                    : t('billing.statementDrawer.noneSent')}
                </span>
              </li>
            </ul>
          </section>
        </div>
      </Drawer>
    );
  }

  const total = accounts.reduce((sum, account) => sum + account.balance, 0);
  const rows = accounts.map((account): Record<string, ReactNode> => ({
    id: account.id,
    patient: formatName(account.patient.name, 'listing'),
    balance: <Money amount={account.balance} currency={account.currency} />,
    bucket: t(BUCKET_LABEL_KEYS[account.bucket]),
    escalation: (
      <span className="or-escalation">
        <span className="or-small">{t(DUNNING_LABEL_KEYS[account.dunningStage])}</span>
        <span aria-hidden="true">{t('billing.statementDrawer.escalatesTo')}</span>
        <Badge tone="neutral">
          {t(DUNNING_LABEL_KEYS[nextDunningStage(account.dunningStage)])}
        </Badge>
      </span>
    ),
    delivery: account.mobile
      ? t('billing.statementDrawer.delivery.portalAndText')
      : t('billing.statementDrawer.delivery.print'),
  }));

  return (
    <Drawer
      open
      title={t('billing.statementDrawer.runTitle')}
      subtitle={t('billing.statementDrawer.runSubtitle', {
        count: accounts.length,
        total: formatMoney(t, total, { currency: 'USD' }).text,
      })}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('billing.statementDrawer.cancel')}
          </Button>
          <Button iconLeft="mail" onClick={() => onSend(accounts)}>
            {t('billing.statementDrawer.sendCount', { count: accounts.length })}
          </Button>
        </>
      }
    >
      <p className="or-body">{t('billing.statementDrawer.runBody')}</p>
      <Table
        caption={t('billing.statementDrawer.runCaption')}
        columns={translateColumns(RUN_COLUMNS, t)}
        rows={rows}
      />
    </Drawer>
  );
}
