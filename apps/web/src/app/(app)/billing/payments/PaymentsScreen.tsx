'use client';

import type { Translator } from '@openrunic/i18n';
import { Badge, Button, Card, Input, Radio, Select, VitalStat } from '@openrunic/ui';
import { useCallback, useId, useMemo, useReducer, useState } from 'react';
import type { ReactElement } from 'react';

import {
  allocatedLines,
  ALLOCATION_HINT_KEYS,
  ALLOCATION_STATE_LABEL_KEYS,
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
import { searchWords } from '@/lib/i18n/counted';
import { useTranslator } from '@/lib/i18n/messages';

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
  /** Catalogue key for the choice's name. */
  labelKey: string;
  /** Catalogue key for why this choice exists, in one line. Never a tooltip. */
  hintKey: string;
}

const METHODS: readonly MethodChoice[] = [
  {
    kind: 'CARD_ON_FILE',
    labelKey: 'billing.payments.method.cardOnFile',
    hintKey: 'billing.payments.method.cardOnFileHint',
  },
  {
    kind: 'CARD_MANUAL',
    labelKey: 'billing.payments.method.cardManual',
    hintKey: 'billing.payments.method.cardManualHint',
  },
  {
    kind: 'CASH',
    labelKey: 'billing.payments.method.cash',
    hintKey: 'billing.payments.method.cashHint',
  },
  {
    kind: 'CHECK',
    labelKey: 'billing.payments.method.check',
    hintKey: 'billing.payments.method.checkHint',
  },
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
 *
 * `payment.method.label` renders as it was recorded. It is what the payment
 * says about itself - "Visa ending 4242" from the processor, or the words the
 * desk chose at the time - and a list that renames a method after the fact no
 * longer matches the receipt beside it.
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
  const t = useTranslator();

  return (
    <Card overline={t('billing.payments.recentOverline')} title={t('billing.payments.recentTitle')}>
      <AsyncBoundary
        state={state}
        subject={t('billing.payments.recentSubject')}
        isEmpty={isEmptyList}
        loadingVariant="text"
        loadingRows={4}
        empty={{
          title: t('billing.payments.recent.empty.title'),
          message: t('billing.payments.recent.empty.message'),
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
                      {formatMoney(t, payment.amount, { currency: payment.currency }).text}
                    </span>
                    <span className="or-caption">{formatDate(t, payment.takenAt, 'dense')}</span>
                  </span>
                  {payment.status === 'REVERSED' ? (
                    <Badge tone="danger">{t('billing.payments.reversed')}</Badge>
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
  const t = useTranslator();

  return (
    <Card
      overline={t('billing.payments.method.overline')}
      title={t('billing.payments.method.title')}
    >
      <fieldset className="or-method-set">
        <legend className="or-visually-hidden">{t('billing.payments.method.legend')}</legend>
        {METHODS.map((candidate) => (
          <Radio
            key={candidate.kind}
            name={methodName}
            label={t(candidate.labelKey)}
            hint={t(candidate.hintKey)}
            value={candidate.kind}
            checked={method === candidate.kind}
            onChange={() => onMethodChange(candidate.kind)}
          />
        ))}
      </fieldset>

      {method === 'CHECK' ? (
        <Input
          label={t('billing.payments.checkNumber')}
          mono
          value={reference}
          onChange={(event) => onReferenceChange(event.target.value)}
        />
      ) : null}

      {cardOnFileUnavailable ? (
        <p className="or-small or-billing__hint" role="alert">
          {t('billing.payments.noCardAlert', { name: patientName })}
        </p>
      ) : null}
    </Card>
  );
}

/**
 * Who is paying, and how much.
 *
 * The patient and the amount sit together because choosing a different patient
 * clears the amount and the allocation with it - see `tender.ts` for why that
 * is one reducer action rather than three settings. Keeping both controls in
 * one component is what makes that coupling visible.
 */
function PayerCard({
  accounts,
  account,
  amountId,
  amountText,
  onSelectAccount,
  onAmountChange,
}: Readonly<{
  accounts: readonly StatementAccount[];
  account: StatementAccount;
  amountId: string;
  amountText: string;
  onSelectAccount: (id: string) => void;
  onAmountChange: (text: string) => void;
}>): ReactElement {
  const t = useTranslator();

  return (
    <Card overline={t('billing.payments.payer')} title={t('billing.payments.whoIsPaying')}>
      <div className="or-field-row">
        <Select
          label={t('billing.payments.patient')}
          options={accounts.map((candidate) => ({
            value: candidate.id,
            label: `${formatName(candidate.patient.name, 'listing')} ${
              formatMoney(t, candidate.balance, { currency: candidate.currency }).text
            }`,
          }))}
          value={account.id}
          onChange={(event) => onSelectAccount(event.target.value)}
        />
        <Input
          id={amountId}
          label={t('billing.payments.amount')}
          type="number"
          mono
          value={amountText}
          /* A numeric example rather than words. The field is
             `type="number"`, whose value is plain digits and a dot
             whatever the reader's language, so the shape of the hint
             does not change with them either. What they type here is
             a value; what they read back on the ledger is formatted,
             and the two are allowed to look different. */
          placeholder="0.00"
          onChange={(event) => onAmountChange(event.target.value)}
        />
      </div>

      <div className="or-visit-header">
        <span className="or-mono">{formatMrn(account.patient.mrn)}</span>
        <span className="or-small">
          {t('billing.payments.balance', {
            amount: formatMoney(t, account.balance, { currency: account.currency }).text,
          })}
        </span>
        {account.cardOnFile ? (
          <Badge tone="success">{t('billing.payments.cardOnFileBadge')}</Badge>
        ) : (
          <Badge tone="neutral" icon="minus">
            {t('billing.payments.noCardBadge')}
          </Badge>
        )}
      </div>
    </Card>
  );
}

/**
 * What the payment is being put against, and what is left over.
 *
 * The remainder is the most prominent number here and is never hidden: a
 * payment cannot be taken while a cent of it has no visit against it, and the
 * counter says how much is left rather than leaving the desk to subtract. That
 * rule is the whole difference from the batch-payment screen this replaces, so
 * the figure and the table that feeds it belong in one component.
 */
function AllocationCard({
  account,
  state,
  openItems,
  allocations,
  onAllocateOldest,
  onClearAllocation,
  onAllocationChange,
}: Readonly<{
  account: StatementAccount;
  state: ReturnType<typeof allocationState>;
  openItems: readonly OpenItem[];
  allocations: Readonly<Record<string, number>>;
  onAllocateOldest: () => void;
  onClearAllocation: () => void;
  onAllocationChange: (visitId: string, value: number) => void;
}>): ReactElement {
  const t = useTranslator();

  return (
    <Card
      overline={t('billing.payments.allocationOverline')}
      title={t('billing.payments.allocationTitle')}
      footer={
        <div className="or-remainder">
          <VitalStat
            label={t('billing.payments.unallocated')}
            value={
              formatMoney(t, state.unallocated, {
                currency: account.currency,
                negativeLabel: 'credit',
              }).text
            }
            state={state.balanced ? 'success' : 'danger'}
            stateLabel={t(ALLOCATION_STATE_LABEL_KEYS[allocationStateName(state)])}
          />
          <Money amount={state.allocated} currency={account.currency} />
        </div>
      }
    >
      <div className="or-field-row">
        <Button variant="secondary" iconLeft="wand-sparkles" onClick={onAllocateOldest}>
          {t('billing.payments.allocateOldest')}
        </Button>
        <Button variant="ghost" onClick={onClearAllocation}>
          {t('billing.payments.clearAllocation')}
        </Button>
      </div>

      {openItems.length === 0 ? (
        <p className="or-body">
          {t('billing.payments.noOpenVisits', {
            name: formatName(account.patient.name),
          })}
        </p>
      ) : (
        <AllocationTable
          items={openItems}
          currency={account.currency}
          allocations={allocations}
          onChange={onAllocationChange}
        />
      )}
    </Card>
  );
}

/**
 * What the receipt will say the money arrived as.
 *
 * Recorded on the payment at the moment it is taken, in the language the desk
 * was working in, because the receipt has to keep saying what the desk saw when
 * it took the money rather than re-deciding later.
 */
function methodLabel(
  method: PaymentMethodKind,
  reference: string,
  chosen: MethodChoice | undefined,
  translate: Translator
): string {
  if (method === 'CHECK' && reference) {
    return translate('billing.payments.checkReference', { reference });
  }
  return translate(chosen?.labelKey ?? 'billing.payments.method.unknown');
}

export function PaymentsScreen({ client }: Readonly<PaymentsScreenProps>): ReactElement {
  const t = useTranslator();
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
        label: methodLabel(method, reference, chosen, t),
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
      title: t('billing.payments.toast.taken', {
        amount: formatMoney(t, payment.amount, { currency: payment.currency }).text,
      }),
      message: t('billing.payments.toast.takenMessage', { number: payment.receiptNumber }),
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
    t,
  ]);

  const deliver = useCallback(
    (payment: Payment, channel: 'print' | 'email') => {
      toasts.push({
        tone: 'success',
        title:
          channel === 'print'
            ? t('billing.payments.toast.printed')
            : t('billing.payments.toast.emailed'),
        message: t('billing.payments.toast.receiptRef', { number: payment.receiptNumber }),
      });
    },
    [toasts, t]
  );

  const commands = useMemo<Command[]>(
    () => [
      {
        id: 'billing.payments.amount',
        group: 'actions',
        label: t('billing.payments.command.amount'),
        keywords: searchWords(t('billing.payments.command.amount.keywords')),
        icon: 'credit-card',
        perform: () => document.getElementById(amountId)?.focus(),
      },
      {
        id: 'billing.payments.allocate',
        group: 'actions',
        label: t('billing.payments.command.allocate'),
        keywords: searchWords(t('billing.payments.command.allocate.keywords')),
        icon: 'wand-sparkles',
        perform: allocateOldestFirst,
      },
      {
        id: 'billing.payments.receipt',
        group: 'actions',
        label: t('billing.payments.command.receipt'),
        keywords: searchWords(t('billing.payments.command.receipt.keywords')),
        icon: 'receipt',
        perform: () => {
          const last = taken[0] ?? recent[0] ?? null;
          setReceipt(last);
        },
      },
    ],
    [amountId, allocateOldestFirst, taken, recent, t]
  );

  const history = [...taken, ...recent];

  return (
    <AppShell
      title={t('billing.payments.title')}
      description={t('billing.payments.description')}
      actions={
        <div className="or-billing__action">
          <Button
            iconLeft="check"
            disabled={!state.balanced || cardOnFileUnavailable}
            onClick={takePayment}
          >
            {t('billing.payments.take')}
          </Button>
          <p className="or-caption or-billing__action-hint">
            {cardOnFileUnavailable
              ? t('billing.payments.noCardHint')
              : t(ALLOCATION_HINT_KEYS[allocationStateName(state)])}
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
        subject={t('billing.payments.subject')}
        isEmpty={isEmptyList}
        loadingRows={5}
        empty={{
          title: t('billing.payments.empty.title'),
          message: t('billing.payments.empty.message'),
          icon: 'credit-card',
          action: <Button href="/schedule">{t('billing.payments.empty.action')}</Button>,
        }}
      >
        {() =>
          account ? (
            <>
              <PayerCard
                accounts={accounts}
                account={account}
                amountId={amountId}
                amountText={amountText}
                onSelectAccount={selectAccount}
                onAmountChange={(text) => dispatch({ type: 'setAmount', text })}
              />

              <MethodPanel
                methodName={methodName}
                method={method}
                reference={reference}
                patientName={formatName(account.patient.name)}
                cardOnFileUnavailable={cardOnFileUnavailable}
                onMethodChange={(next) => dispatch({ type: 'setMethod', method: next })}
                onReferenceChange={(next) => dispatch({ type: 'setReference', reference: next })}
              />

              <AllocationCard
                account={account}
                state={state}
                openItems={openItems}
                allocations={allocations}
                onAllocateOldest={allocateOldestFirst}
                onClearAllocation={() =>
                  dispatch({ type: 'allocateOldestFirst', amount: 0, items: [] })
                }
                onAllocationChange={setAllocation}
              />
            </>
          ) : null
        }
      </AsyncBoundary>

      <Receipt payment={receipt} onClose={() => setReceipt(null)} onDeliver={deliver} />
      <ToastDock toasts={toasts.toasts} onDismiss={toasts.dismiss} />
    </AppShell>
  );
}
