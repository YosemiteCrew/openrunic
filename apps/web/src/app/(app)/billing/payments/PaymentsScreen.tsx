'use client';

import { Badge, Button, Card, Input, Radio, Select, VitalStat } from '@openrunic/ui';
import { useCallback, useId, useMemo, useReducer, useState } from 'react';
import type { ReactElement } from 'react';

import {
  allocatedLines,
  ALLOCATION_HINTS,
  ALLOCATION_STATE_LABELS,
  AllocationTable,
  allocationState,
  allocationStateName,
  Money,
  Receipt,
  ToastDock,
  useToasts,
} from '@/components/billing';
import type { OpenItem } from '@/components/billing';
import { ScreenCommands } from '@/components/command';
import type { Command } from '@/components/command';
import { clinicNow } from '@/components/schedule/clock';
import { AppShell } from '@/components/shell';
import { AsyncBoundary, isEmptyList } from '@/components/state';
import { usePayments, useStatements } from '@/lib/api';
import type { BillingClient, Payment, PaymentMethodKind, StatementAccount } from '@/lib/api';
import { formatDate, formatMoney, formatMrn, formatName } from '@/lib/format';

import { EMPTY_TENDER, reduceTender } from './tender';

/**
 * BL-02 checkout payment and BL-06 allocation, on one desk.
 *
 * The remainder is the screen's most prominent number and it is never hidden:
 * a payment cannot be taken while a cent of it has no visit against it, and the
 * counter says how much is left rather than leaving the desk to do the
 * subtraction. That single rule is the whole difference from the batch-payment
 * screen this replaces.
 *
 * Card on file and a card keyed at the desk are deliberately different choices
 * rather than one "card" option: one carries consent already given, the other
 * does not, and a desk should never be unsure which one it just used.
 *
 * The metric: a copay collected in three interactions. Choose the method,
 * allocate oldest first, take the payment.
 */

const TAKEN_BY = 'Ada Nwosu';

interface MethodChoice {
  kind: PaymentMethodKind;
  label: string;
  /** Why this choice exists, in one line. Never a tooltip. */
  hint: string;
}

const METHODS: MethodChoice[] = [
  {
    kind: 'CARD_ON_FILE',
    label: 'Card on file',
    hint: 'Charges the card the patient has already consented to.',
  },
  {
    kind: 'CARD_MANUAL',
    label: 'Card keyed at the desk',
    hint: 'One-off card, nothing stored.',
  },
  { kind: 'CASH', label: 'Cash', hint: 'Counted into the drawer.' },
  { kind: 'CHECK', label: 'Check', hint: 'Record the check number on the receipt.' },
];

export interface PaymentsScreenProps {
  /** Injectable data client. Tests drive the empty and error states with it. */
  client?: BillingClient;
}

/**
 * The day's takings, newest first, each one a way back to its receipt.
 *
 * Its own component because it reads nothing from the tender: it is the record
 * of payments already taken, and mixing it into the desk made both harder to
 * follow.
 */
function RecentPayments({
  state,
  history,
  onOpenReceipt,
}: Readonly<{
  state: ReturnType<typeof usePayments>;
  history: readonly Payment[];
  onOpenReceipt: (payment: Payment) => void;
}>): ReactElement {
  return (
    <Card overline="Payments" title="Recent">
      <AsyncBoundary
        state={state}
        subject="recent payments"
        isEmpty={isEmptyList}
        loadingVariant="text"
        loadingRows={4}
        empty={{
          title: 'No payments yet',
          message: 'Payments taken at the desk appear here with their receipts.',
          icon: 'receipt',
        }}
      >
        {() => (
          <ul className="or-era-list">
            {history.map((payment) => (
              <li key={payment.id}>
                <button
                  type="button"
                  className="or-era-list__button"
                  onClick={() => onOpenReceipt(payment)}
                >
                  <span className="or-era-list__payer">
                    {formatName(payment.patient.name, 'listing')}
                  </span>
                  <span className="or-mono or-caption">{payment.receiptNumber}</span>
                  <span className="or-era-list__meta">
                    <span className="or-mono">
                      {formatMoney(payment.amount, { currency: payment.currency }).text}
                    </span>
                    <span className="or-caption">{formatDate(payment.takenAt, 'dense')}</span>
                  </span>
                  {payment.status === 'REVERSED' ? (
                    <Badge tone="danger">Reversed</Badge>
                  ) : (
                    <Badge tone="neutral" icon="minus">
                      {payment.method.label}
                    </Badge>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </AsyncBoundary>
    </Card>
  );
}

/**
 * How the money is arriving.
 *
 * Card on file and a card keyed at the desk are separate choices on purpose:
 * one carries consent already given and the other does not, and a desk should
 * never be unsure which it just used. When the patient has no card on file the
 * screen says so in a live region rather than disabling the option silently.
 */
function MethodPanel({
  methodName,
  method,
  reference,
  patientName,
  cardOnFileUnavailable,
  onMethodChange,
  onReferenceChange,
}: Readonly<{
  methodName: string;
  method: PaymentMethodKind;
  reference: string;
  patientName: string;
  cardOnFileUnavailable: boolean;
  onMethodChange: (method: PaymentMethodKind) => void;
  onReferenceChange: (reference: string) => void;
}>): ReactElement {
  return (
    <Card overline="Method" title="How it is being paid">
      <fieldset className="or-method-set">
        <legend className="or-visually-hidden">Payment method</legend>
        {METHODS.map((candidate) => (
          <Radio
            key={candidate.kind}
            name={methodName}
            label={candidate.label}
            hint={candidate.hint}
            value={candidate.kind}
            checked={method === candidate.kind}
            onChange={() => onMethodChange(candidate.kind)}
          />
        ))}
      </fieldset>

      {method === 'CHECK' ? (
        <Input
          label="Check number"
          mono
          value={reference}
          onChange={(event) => onReferenceChange(event.target.value)}
        />
      ) : null}

      {cardOnFileUnavailable ? (
        <p className="or-small or-billing__hint" role="alert">
          {patientName} has no card on file. Key the card at the desk, or take cash or a check.
        </p>
      ) : null}
    </Card>
  );
}

export function PaymentsScreen({ client }: Readonly<PaymentsScreenProps>): ReactElement {
  const accountsState = useStatements({ pageSize: 100 }, { client });
  const paymentsState = usePayments({ pageSize: 50 }, { client });

  const accounts = useMemo(() => accountsState.data?.data ?? [], [accountsState.data]);
  const recent = useMemo(() => paymentsState.data?.data ?? [], [paymentsState.data]);

  /* One tender rather than five settings: see `tender.ts` for why choosing a
     different patient has to clear the amount and the allocation with it. */
  const [tender, dispatch] = useReducer(reduceTender, EMPTY_TENDER);
  const { accountId, amountText, method, reference, allocations } = tender;
  const [taken, setTaken] = useState<Payment[]>([]);
  const [receipt, setReceipt] = useState<Payment | null>(null);
  const toasts = useToasts();
  const amountId = useId();
  const methodName = useId();

  const account: StatementAccount | null =
    accounts.find((candidate) => candidate.id === accountId) ?? accounts[0] ?? null;

  const openItems = useMemo<OpenItem[]>(() => {
    if (!account) return [];
    const open: OpenItem[] = [];
    for (const line of account.lines) {
      if (line.outstanding > 0) {
        open.push({
          visitId: line.visitId,
          serviceDate: line.serviceDate,
          description: line.description,
          outstanding: line.outstanding,
        });
      }
    }
    return open;
  }, [account]);

  const amount = Number.parseFloat(amountText);
  const safeAmount = Number.isFinite(amount) && amount > 0 ? amount : 0;
  const state = allocationState(safeAmount, allocations);
  const chosen = METHODS.find((candidate) => candidate.kind === method) ?? METHODS[0];
  const cardOnFileUnavailable = method === 'CARD_ON_FILE' && account?.cardOnFile === false;

  const selectAccount = useCallback((id: string) => {
    dispatch({ type: 'selectAccount', accountId: id });
  }, []);

  const allocateOldestFirst = useCallback(() => {
    dispatch({ type: 'allocateOldestFirst', amount: safeAmount, items: openItems });
  }, [safeAmount, openItems]);

  const setAllocation = useCallback((visitId: string, value: number) => {
    dispatch({ type: 'allocate', visitId, value });
  }, []);

  const takePayment = useCallback(() => {
    if (!account || !state.balanced || cardOnFileUnavailable) return;

    const now = clinicNow().toISOString();
    const payment: Payment = {
      id: `taken-${taken.length + 1}`,
      receiptNumber: `RCP-7042${taken.length + 1}`,
      patient: account.patient,
      takenAt: now,
      takenBy: TAKEN_BY,
      amount: safeAmount,
      currency: account.currency,
      method: {
        kind: method,
        label:
          method === 'CHECK' && reference ? `Check ${reference}` : (chosen?.label ?? 'Payment'),
        last4: null,
        consentAt: method === 'CARD_ON_FILE' ? now : null,
      },
      status: 'CAPTURED',
      allocations: allocatedLines(openItems, allocations),
    };

    setTaken((current) => [payment, ...current]);
    setReceipt(payment);
    dispatch({ type: 'captured' });
    toasts.push({
      tone: 'success',
      title: `${formatMoney(payment.amount, { currency: payment.currency }).text} taken`,
      message: `Receipt ${payment.receiptNumber} is ready to print or email.`,
    });
  }, [
    account,
    state.balanced,
    cardOnFileUnavailable,
    taken.length,
    safeAmount,
    method,
    reference,
    chosen,
    openItems,
    allocations,
    toasts,
  ]);

  const deliver = useCallback(
    (payment: Payment, channel: 'print' | 'email') => {
      toasts.push({
        tone: 'success',
        title: channel === 'print' ? 'Receipt sent to the printer' : 'Receipt emailed',
        message: `Receipt ${payment.receiptNumber}.`,
      });
    },
    [toasts]
  );

  const commands = useMemo<Command[]>(
    () => [
      {
        id: 'billing.payments.amount',
        group: 'actions',
        label: 'Take a payment',
        keywords: ['collect', 'copay', 'card', 'cash', 'check'],
        icon: 'credit-card',
        perform: () => document.getElementById(amountId)?.focus(),
      },
      {
        id: 'billing.payments.allocate',
        group: 'actions',
        label: 'Allocate this payment oldest visit first',
        keywords: ['allocate', 'apply', 'remainder', 'split'],
        icon: 'wand-sparkles',
        perform: allocateOldestFirst,
      },
      {
        id: 'billing.payments.receipt',
        group: 'actions',
        label: 'Open the last receipt',
        keywords: ['receipt', 'reprint', 'print'],
        icon: 'receipt',
        perform: () => {
          const last = taken[0] ?? recent[0] ?? null;
          setReceipt(last);
        },
      },
    ],
    [amountId, allocateOldestFirst, taken, recent]
  );

  const history = [...taken, ...recent];

  return (
    <AppShell
      title="Payments"
      description="Take a payment, apply it to the visits it pays for, and issue the receipt."
      actions={
        <div className="or-billing__action">
          <Button
            iconLeft="check"
            disabled={!state.balanced || cardOnFileUnavailable}
            onClick={takePayment}
          >
            Take payment
          </Button>
          <p className="or-caption or-billing__action-hint">
            {cardOnFileUnavailable
              ? 'This patient has no card on file. Choose another method.'
              : ALLOCATION_HINTS[allocationStateName(state)]}
          </p>
        </div>
      }
      rightRail={
        <RecentPayments state={paymentsState} history={history} onOpenReceipt={setReceipt} />
      }
    >
      <ScreenCommands commands={commands} />

      <AsyncBoundary
        state={accountsState}
        subject="patient balances"
        isEmpty={isEmptyList}
        loadingRows={5}
        empty={{
          title: 'No balances to collect',
          message: 'Nothing is outstanding. A copay taken at check-in appears here on the day.',
          icon: 'credit-card',
          action: <Button href="/schedule">Go to the schedule</Button>,
        }}
      >
        {() =>
          account ? (
            <>
              <Card overline="Payer" title="Who is paying">
                <div className="or-field-row">
                  <Select
                    label="Patient"
                    options={accounts.map((candidate) => ({
                      value: candidate.id,
                      label: `${formatName(candidate.patient.name, 'listing')} ${
                        formatMoney(candidate.balance, { currency: candidate.currency }).text
                      }`,
                    }))}
                    value={account.id}
                    onChange={(event) => selectAccount(event.target.value)}
                  />
                  <Input
                    id={amountId}
                    label="Amount"
                    type="number"
                    mono
                    value={amountText}
                    placeholder="0.00"
                    onChange={(event) => dispatch({ type: 'setAmount', text: event.target.value })}
                  />
                </div>

                <div className="or-visit-header">
                  <span className="or-mono">{formatMrn(account.patient.mrn)}</span>
                  <span className="or-small">
                    Balance {formatMoney(account.balance, { currency: account.currency }).text}
                  </span>
                  {account.cardOnFile ? (
                    <Badge tone="success">Card on file, consent on record</Badge>
                  ) : (
                    <Badge tone="neutral" icon="minus">
                      No card on file
                    </Badge>
                  )}
                </div>
              </Card>

              <MethodPanel
                methodName={methodName}
                method={method}
                reference={reference}
                patientName={formatName(account.patient.name)}
                cardOnFileUnavailable={cardOnFileUnavailable}
                onMethodChange={(next) => dispatch({ type: 'setMethod', method: next })}
                onReferenceChange={(next) => dispatch({ type: 'setReference', reference: next })}
              />

              <Card
                overline="Allocation"
                title="Which visits this pays"
                footer={
                  <div className="or-remainder">
                    <VitalStat
                      label="Unallocated"
                      value={
                        formatMoney(state.unallocated, {
                          currency: account.currency,
                          negativeLabel: 'Credit',
                        }).text
                      }
                      state={state.balanced ? 'success' : 'danger'}
                      stateLabel={ALLOCATION_STATE_LABELS[allocationStateName(state)]}
                    />
                    <Money amount={state.allocated} currency={account.currency} />
                  </div>
                }
              >
                <div className="or-field-row">
                  <Button
                    variant="secondary"
                    iconLeft="wand-sparkles"
                    onClick={allocateOldestFirst}
                  >
                    Allocate oldest first
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => dispatch({ type: 'allocateOldestFirst', amount: 0, items: [] })}
                  >
                    Clear allocation
                  </Button>
                </div>

                {openItems.length === 0 ? (
                  <p className="or-body">
                    {formatName(account.patient.name)} has no open visits. Take the payment as a
                    credit from the statements screen.
                  </p>
                ) : (
                  <AllocationTable
                    items={openItems}
                    currency={account.currency}
                    allocations={allocations}
                    onChange={setAllocation}
                  />
                )}
              </Card>
            </>
          ) : null
        }
      </AsyncBoundary>

      <Receipt payment={receipt} onClose={() => setReceipt(null)} onDeliver={deliver} />
      <ToastDock toasts={toasts.toasts} onDismiss={toasts.dismiss} />
    </AppShell>
  );
}
