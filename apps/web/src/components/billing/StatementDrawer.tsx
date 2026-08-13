'use client';

import { Badge, Button, Table } from '@openrunic/ui';
import type { TableColumn } from '@openrunic/ui';
import type { ReactElement, ReactNode } from 'react';

import type { StatementAccount } from '@/lib/api';
import { formatDate, formatMoney, formatMrn, formatName, NOT_RECORDED } from '@/lib/format';

import { BUCKET_LABELS, DUNNING_LABELS, nextDunningStage, statementTotals } from './billing';
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
 * biller reads it here: it is the sentence the patient will receive.
 */

const LEDGER_COLUMNS: TableColumn[] = [
  { key: 'serviceDate', header: 'Visit' },
  { key: 'description', header: 'Description' },
  { key: 'charges', header: 'Charges', numeric: true },
  { key: 'insurancePaid', header: 'Insurance paid', numeric: true },
  { key: 'adjustments', header: 'Adjustments', numeric: true },
  { key: 'outstanding', header: 'Your share', numeric: true },
];

const RUN_COLUMNS: TableColumn[] = [
  { key: 'patient', header: 'Patient' },
  { key: 'balance', header: 'Balance', numeric: true },
  { key: 'bucket', header: 'Oldest balance' },
  { key: 'escalation', header: 'Dunning stage' },
  { key: 'delivery', header: 'Delivery' },
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
}: StatementDrawerProps): ReactElement | null {
  if (!open || accounts.length === 0) return null;

  const single = accounts.length === 1 ? accounts[0] : null;

  if (single) {
    const totals = statementTotals(single.lines);
    const rows = single.lines.map((line): Record<string, ReactNode> => ({
      id: line.id,
      serviceDate: formatDate(line.serviceDate),
      description: line.description,
      charges: <Money amount={line.charges} currency={single.currency} />,
      insurancePaid: <Money amount={line.insurancePaid} currency={single.currency} />,
      adjustments: <Money amount={line.adjustments} currency={single.currency} />,
      outstanding: <Money amount={line.outstanding} currency={single.currency} />,
    }));

    return (
      <Drawer
        open
        title={`Statement for ${formatName(single.patient.name)}`}
        subtitle={
          <>
            <span className="or-mono">{formatMrn(single.patient.mrn)}</span>
            {', '}
            {DUNNING_LABELS[single.dunningStage].toLowerCase()}, {single.statementsSent} sent
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
              {texted.has(single.id) ? 'Link sent' : 'Send text-to-pay link'}
            </Button>
            <Button iconLeft="mail" onClick={() => onSend([single])}>
              Send statement
            </Button>
          </>
        }
      >
        <div className="or-statement">
          <p className="or-body-lg or-statement__sentence">
            Your insurance paid{' '}
            {formatMoney(totals.insurancePaid, { currency: single.currency }).text}. Your share is{' '}
            {formatMoney(totals.outstanding, { currency: single.currency }).text}.
          </p>

          <Table caption="Statement lines" columns={LEDGER_COLUMNS} rows={rows} />

          <dl className="or-totals">
            <div className="or-totals__row">
              <dt>Charges</dt>
              <dd>
                <Money amount={totals.charges} currency={single.currency} />
              </dd>
            </div>
            <div className="or-totals__row">
              <dt>Insurance paid</dt>
              <dd>
                <Money amount={totals.insurancePaid} currency={single.currency} />
              </dd>
            </div>
            <div className="or-totals__row">
              <dt>Balance due</dt>
              <dd>
                <Money amount={totals.outstanding} currency={single.currency} emphasis />
              </dd>
            </div>
          </dl>

          <section aria-labelledby="statement-collection">
            <h3 id="statement-collection" className="or-h3">
              How this can be paid
            </h3>
            <ul className="or-fact-list">
              <li>
                <span className="or-fact-list__term">Mobile</span>
                <span>{single.mobile ?? NOT_RECORDED}</span>
                {texted.has(single.id) ? <Badge tone="success">Link sent</Badge> : null}
              </li>
              <li>
                <span className="or-fact-list__term">Card on file</span>
                <span>
                  {single.cardOnFile ? 'Consent on record, card may be charged' : 'No card on file'}
                </span>
              </li>
              <li>
                <span className="or-fact-list__term">Payment plan</span>
                <span>
                  {single.paymentPlan
                    ? `${formatMoney(single.paymentPlan.instalmentAmount, { currency: single.currency }).text} a month, ${single.paymentPlan.instalmentsPaid} of ${single.paymentPlan.instalmentsTotal} paid`
                    : 'No plan'}
                </span>
              </li>
              <li>
                <span className="or-fact-list__term">Last statement</span>
                <span>
                  {single.lastStatementAt ? formatDate(single.lastStatementAt) : 'None sent'}
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
    bucket: BUCKET_LABELS[account.bucket],
    escalation: (
      <span className="or-escalation">
        <span className="or-small">{DUNNING_LABELS[account.dunningStage]}</span>
        <span aria-hidden="true">to</span>
        <Badge tone="neutral">{DUNNING_LABELS[nextDunningStage(account.dunningStage)]}</Badge>
      </span>
    ),
    delivery: account.mobile ? 'Portal and text' : 'Print',
  }));

  return (
    <Drawer
      open
      title="Statement run"
      subtitle={`${accounts.length} accounts, ${formatMoney(total, { currency: 'USD' }).text} in total`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button iconLeft="mail" onClick={() => onSend(accounts)}>
            Send {accounts.length} statements
          </Button>
        </>
      }
    >
      <p className="or-body">
        Each account moves to the dunning stage shown. Accounts with a mobile number receive a
        text-to-pay link alongside the statement; the rest are printed.
      </p>
      <Table caption="Accounts in this run" columns={RUN_COLUMNS} rows={rows} />
    </Drawer>
  );
}
