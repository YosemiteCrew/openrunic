import { ok } from '@openrunic/types';

import type { AdapterResult } from '../contracts/core.js';
import { PAYMENTS_CONTRACT } from '../contracts/payments.js';
import type {
  AuthorizationResult,
  AuthorizeInput,
  CaptureInput,
  CaptureResult,
  CreatePaymentPlanInput,
  PaymentPlan,
  PaymentsAdapter,
  PaymentsConfig,
  RefundInput,
  RefundResult,
  StoreCardOnFileInput,
  StoredCard,
} from '../contracts/payments.js';
import type { MockAdapterOptions } from './harness.js';
import { MockAdapterBase } from './harness.js';
import { randomInt, randomPick } from './random.js';

/**
 * An in-process card processor.
 *
 * It models the sequence money actually moves in - authorise, then capture,
 * then refund - because the bugs worth catching live in the transitions:
 * capturing more than was authorised, refunding twice, capturing an
 * authorisation that was never granted. Each of those is a state error here
 * with its own reason code, so the fee sheet and the ledger can be tested
 * against them without a sandbox merchant account.
 *
 * No card number reaches this class, in a mock any more than in production.
 * `cardReference` is a token, and the four digits it returns are generated, not
 * derived from anything.
 */

/** Above this amount the mock declines, so the declined path is reachable without special configuration. */
const DECLINE_THRESHOLD_MINOR_UNITS = 500_000;

const SYNTHETIC_NETWORKS = ['synthetic_network_a', 'synthetic_network_b'] as const;

interface AuthorizationState {
  readonly amountMinorUnits: number;
  readonly currency: string;
  captured: boolean;
}

interface PaymentState {
  readonly authorizationRef: string;
  readonly amountMinorUnits: number;
  readonly currency: string;
  refundedMinorUnits: number;
}

/** The deterministic payments mock. */
export class MockPaymentsAdapter
  extends MockAdapterBase<PaymentsConfig>
  implements PaymentsAdapter
{
  private readonly authorizations = new Map<string, AuthorizationState>();
  private readonly payments = new Map<string, PaymentState>();
  private readonly cards = new Set<string>();

  constructor(options: MockAdapterOptions = {}) {
    super(PAYMENTS_CONTRACT, options);
  }

  authorize(input: AuthorizeInput): Promise<AdapterResult<AuthorizationResult>> {
    return this.runOperation<AuthorizationResult>('authorize', [input.idempotencyKey], () => {
      const authorizationRef = this.mintRef('auth');
      const authorizedAt = this.nowIso();
      if (input.amountMinorUnits > DECLINE_THRESHOLD_MINOR_UNITS) {
        // A decline is an answer, not a failure: the front desk needs the code
        // to know whether to ask for another card or to split the payment.
        return ok({
          authorizationRef,
          status: 'declined',
          declineCode: 'limit_exceeded',
          amountMinorUnits: input.amountMinorUnits,
          currency: input.currency,
          authorizedAt,
        });
      }
      this.authorizations.set(authorizationRef, {
        amountMinorUnits: input.amountMinorUnits,
        currency: input.currency,
        captured: false,
      });
      return ok({
        authorizationRef,
        status: 'authorized',
        amountMinorUnits: input.amountMinorUnits,
        currency: input.currency,
        authorizedAt,
      });
    });
  }

  capture(input: CaptureInput): Promise<AdapterResult<CaptureResult>> {
    return this.runOperation<CaptureResult>('capture', [input.authorizationRef], () => {
      const authorization = this.authorizations.get(input.authorizationRef);
      if (authorization === undefined) {
        return this.reject('capture', 'unknown_authorization');
      }
      if (authorization.captured) {
        return this.reject('capture', 'already_captured');
      }
      if (input.amountMinorUnits > authorization.amountMinorUnits) {
        return this.reject('capture', 'capture_exceeds_authorization');
      }
      authorization.captured = true;
      const paymentRef = this.mintRef('pay');
      this.payments.set(paymentRef, {
        authorizationRef: input.authorizationRef,
        amountMinorUnits: input.amountMinorUnits,
        currency: authorization.currency,
        refundedMinorUnits: 0,
      });
      return ok({
        paymentRef,
        authorizationRef: input.authorizationRef,
        amountMinorUnits: input.amountMinorUnits,
        currency: authorization.currency,
        capturedAt: this.nowIso(),
      });
    });
  }

  refund(input: RefundInput): Promise<AdapterResult<RefundResult>> {
    const gate = this.featureGate('refund', 'refunds');
    if (gate !== undefined) {
      return Promise.resolve(gate);
    }
    return this.runOperation<RefundResult>('refund', [input.paymentRef], () => {
      const payment = this.payments.get(input.paymentRef);
      if (payment === undefined) {
        return this.reject('refund', 'unknown_payment');
      }
      const remaining = payment.amountMinorUnits - payment.refundedMinorUnits;
      if (input.amountMinorUnits > remaining) {
        return this.reject('refund', 'refund_exceeds_payment');
      }
      payment.refundedMinorUnits += input.amountMinorUnits;
      return ok({
        refundRef: this.mintRef('ref'),
        paymentRef: input.paymentRef,
        amountMinorUnits: input.amountMinorUnits,
        currency: payment.currency,
        refundedAt: this.nowIso(),
      });
    });
  }

  storeCardOnFile(input: StoreCardOnFileInput): Promise<AdapterResult<StoredCard>> {
    const gate = this.featureGate('storeCardOnFile', 'card_on_file');
    if (gate !== undefined) {
      return Promise.resolve(gate);
    }
    return this.runOperation<StoredCard>('storeCardOnFile', [input.consentRef], () => {
      const cardOnFileRef = this.mintRef('cof');
      this.cards.add(cardOnFileRef);
      return ok({
        cardOnFileRef,
        brandCode: randomPick(this.nextRandom, SYNTHETIC_NETWORKS),
        last4: String(randomInt(this.nextRandom, 10_000)).padStart(4, '0'),
        expiryMonth: randomInt(this.nextRandom, 12) + 1,
        expiryYear: 2029 + randomInt(this.nextRandom, 3),
        storedAt: this.nowIso(),
      });
    });
  }

  createPaymentPlan(input: CreatePaymentPlanInput): Promise<AdapterResult<PaymentPlan>> {
    const gate = this.featureGate('createPaymentPlan', 'payment_plans');
    if (gate !== undefined) {
      return Promise.resolve(gate);
    }
    return this.runOperation<PaymentPlan>('createPaymentPlan', [input.cardOnFileRef], () => {
      if (!this.cards.has(input.cardOnFileRef)) {
        return this.reject('createPaymentPlan', 'unknown_card_reference');
      }
      if (input.installmentMinorUnits * input.installments !== input.totalMinorUnits) {
        // A plan whose instalments do not sum to the balance leaves a residue
        // nobody owns, which surfaces months later as an unexplained balance.
        return this.reject('createPaymentPlan', 'plan_does_not_balance');
      }
      return ok({
        planRef: this.mintRef('plan'),
        status: 'active',
        remainingMinorUnits: input.totalMinorUnits,
        installmentsRemaining: input.installments,
        nextChargeOn: input.firstChargeOn,
        createdAt: this.nowIso(),
      });
    });
  }
}
