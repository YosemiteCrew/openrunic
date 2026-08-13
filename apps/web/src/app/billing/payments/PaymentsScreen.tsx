'use client';

import { Badge, Button, Card, Input, Radio, Select, VitalStat } from '@openrunic/ui';
import { useCallback, useId, useMemo, useState } from 'react';
import type { ReactElement } from 'react';

import {
  AllocationTable,
  allocationState,
  autoAllocate,
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

export function PaymentsScreen({ client }: PaymentsScreenProps = {}): ReactElement {
  const accountsState = useStatements({ pageSize: 100 }, { client });
  const paymentsState = usePayments({ pageSize: 50 }, { client });

  const accounts = useMemo(() => accountsState.data?.data ?? [], [accountsState.data]);
  const recent = useMemo(() => paymentsState.data?.data ?? [], [paymentsState.data]);

  const [accountId, setAccountId] = useState<string | null>(null);
  const [amountText, setAmountText] = useState('');
  const [method, setMethod] = useState<PaymentMethodKind>('CARD_ON_FILE');
  const [reference, setReference] = useState('');
  const [allocations, setAllocations] = useState<Record<string, number>>({});
  const [taken, setTaken] = useState<Payment[]>([]);
  const [receipt, setReceipt] = useState<Payment | null>(null);
  const toasts = useToasts();
  const amountId = useId();
  const methodName = useId();

  const account: StatementAccount | null =
    accounts.find((candidate) => candidate.id === accountId) ?? accounts[0] ?? null;

  const openItems = useMemo<OpenItem[]>(() => {
    if (!account) return [];
    return account.lines
      .filter((line) => line.outstanding > 0)
      .map((line) => ({
        visitId: line.visitId,
        serviceDate: line.serviceDate,
        description: line.description,
        outstanding: line.outstanding,
      }));
  }, [account]);

  const amount = Number.parseFloat(amountText);
  const safeAmount = Number.isFinite(amount) && amount > 0 ? amount : 0;
  const state = allocationState(safeAmount, allocations);
  const chosen = METHODS.find((candidate) => candidate.kind === method) ?? METHODS[0];
  const cardOnFileUnavailable = method === 'CARD_ON_FILE' && account?.cardOnFile === false;

  const selectAccount = useCallback((id: string) => {
    setAccountId(id);
    setAllocations({});
    setAmountText('');
  }, []);

  const allocateOldestFirst = useCallback(() => {
    setAllocations(autoAllocate(safeAmount, openItems));
  }, [safeAmount, openItems]);

  const setAllocation = useCallback((visitId: string, value: number) => {
    setAllocations((current) => ({
      ...current,
      [visitId]: Number.isFinite(value) ? Math.max(value, 0) : 0,
    }));
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
      allocations: openItems
        .filter((item) => (allocations[item.visitId] ?? 0) > 0)
        .map((item) => ({
          id: `${item.visitId}-alloc`,
          visitId: item.visitId,
          serviceDate: item.serviceDate,
          description: item.description,
          outstanding: item.outstanding,
          allocated: allocations[item.visitId] ?? 0,
        })),
    };

    setTaken((current) => [payment, ...current]);
    setReceipt(payment);
    setAllocations({});
    setAmountText('');
    setReference('');
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
              : state.over
                ? 'More is allocated than is being taken.'
                : state.balanced
                  ? 'Every amount is applied to a visit.'
                  : 'Allocate the whole payment before taking it.'}
          </p>
        </div>
      }
      rightRail={
        <Card overline="Payments" title="Recent">
          <AsyncBoundary
            state={paymentsState}
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
                      onClick={() => setReceipt(payment)}
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
                    onChange={(event) => setAmountText(event.target.value)}
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
                      onChange={() => setMethod(candidate.kind)}
                    />
                  ))}
                </fieldset>

                {method === 'CHECK' ? (
                  <Input
                    label="Check number"
                    mono
                    value={reference}
                    onChange={(event) => setReference(event.target.value)}
                  />
                ) : null}

                {cardOnFileUnavailable ? (
                  <p className="or-small or-billing__hint" role="alert">
                    {formatName(account.patient.name)} has no card on file. Key the card at the
                    desk, or take cash or a check.
                  </p>
                ) : null}
              </Card>

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
                      stateLabel={
                        state.balanced
                          ? 'Fully allocated'
                          : state.over
                            ? 'Over-allocated'
                            : 'Still to allocate'
                      }
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
                  <Button variant="ghost" onClick={() => setAllocations({})}>
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
