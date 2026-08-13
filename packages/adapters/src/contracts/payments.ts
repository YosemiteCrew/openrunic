import { z } from 'zod';

import type { Adapter, AdapterResult, CapabilityContract } from './core.js';
import { adapterConfigBase, isoDateTime, moneyMinorUnits, opaqueRef } from './core.js';

/**
 * The money seam: authorising, capturing and refunding patient payments, and
 * keeping a card on file for a plan.
 *
 * No operation here accepts a card number. Card data is collected by the
 * processor's own hosted field and reaches us only as a reference, so the
 * bytes that would put a practice inside a card-data audit never enter the
 * application at all. An adapter that needed a primary account number would be
 * the wrong shape for this seam, not a special case of it.
 *
 * A decline is an output status, not an error: the call succeeded, and the
 * front desk needs the decline code to decide what to ask for next.
 */

/** Semver of this seam. */
export const PAYMENTS_CONTRACT_VERSION = '1.0.0';

/** Terminal-ish states of an authorisation. `declined` is a normal business answer. */
export const authorizationStatus = z.enum(['authorized', 'declined']);

/** Inferred shape of {@link authorizationStatus}. */
export type AuthorizationStatus = z.infer<typeof authorizationStatus>;

const authorizeInput = z.strictObject({
  /**
   * Caller-supplied key that makes a retry safe. Required, not optional,
   * because a timeout on a money call is exactly when a retry happens.
   */
  idempotencyKey: z.string().min(8).max(128),
  amountMinorUnits: moneyMinorUnits.positive(),
  /** ISO 4217 alphabetic code. */
  currency: z.string().length(3),
  /** A processor token from a hosted field or a stored card, never a card number. */
  cardReference: opaqueRef,
  patientRef: opaqueRef.optional(),
  /** Short code that appears on the cardholder's statement. */
  descriptorCode: z.string().min(1).max(22).optional(),
});

const authorizationResult = z.strictObject({
  authorizationRef: opaqueRef,
  status: authorizationStatus,
  /** Present only on `declined`; the processor's own code, for the front desk script. */
  declineCode: z.string().min(1).max(64).optional(),
  amountMinorUnits: moneyMinorUnits,
  currency: z.string().length(3),
  authorizedAt: isoDateTime,
});

const captureInput = z.strictObject({
  authorizationRef: opaqueRef,
  /** May be less than the authorised amount when a line was voided between authorisation and checkout. */
  amountMinorUnits: moneyMinorUnits.positive(),
  idempotencyKey: z.string().min(8).max(128),
});

const captureResult = z.strictObject({
  paymentRef: opaqueRef,
  authorizationRef: opaqueRef,
  amountMinorUnits: moneyMinorUnits,
  currency: z.string().length(3),
  capturedAt: isoDateTime,
});

const refundInput = z.strictObject({
  paymentRef: opaqueRef,
  amountMinorUnits: moneyMinorUnits.positive(),
  idempotencyKey: z.string().min(8).max(128),
  reasonCode: z.string().min(1).max(64).optional(),
});

const refundResult = z.strictObject({
  refundRef: opaqueRef,
  paymentRef: opaqueRef,
  amountMinorUnits: moneyMinorUnits,
  currency: z.string().length(3),
  refundedAt: isoDateTime,
});

const storeCardOnFileInput = z.strictObject({
  patientRef: opaqueRef,
  /** Single-use processor token from the hosted field. */
  cardReference: opaqueRef,
  /** The consent record proving the patient agreed to storage. The seam records it, the service proves it. */
  consentRef: opaqueRef,
});

const storedCard = z.strictObject({
  cardOnFileRef: opaqueRef,
  /** Coded card network from the processor. Display only, and never matched on. */
  brandCode: z.string().min(1).max(32),
  /** Last four digits, the only card digits that may exist on our side. */
  last4: z.string().regex(/^[0-9]{4}$/),
  expiryMonth: z.int().min(1).max(12),
  expiryYear: z.int().min(2000).max(2100),
  storedAt: isoDateTime,
});

const createPaymentPlanInput = z.strictObject({
  patientRef: opaqueRef,
  cardOnFileRef: opaqueRef,
  totalMinorUnits: moneyMinorUnits.positive(),
  installmentMinorUnits: moneyMinorUnits.positive(),
  installments: z.int().positive().max(60),
  /** Calendar date of the first charge; time of day is the processor's business. */
  firstChargeOn: z.iso.date(),
});

const paymentPlan = z.strictObject({
  planRef: opaqueRef,
  status: z.enum(['active', 'completed', 'cancelled']),
  remainingMinorUnits: moneyMinorUnits,
  installmentsRemaining: z.int().nonnegative(),
  nextChargeOn: z.iso.date(),
  createdAt: isoDateTime,
});

/** Configuration for a payments adapter. */
export const paymentsConfig = z.strictObject({
  ...adapterConfigBase.shape,
  merchantId: z.string().min(1).max(64),
  /** Default currency for this merchant account, ISO 4217 alphabetic. */
  currency: z.string().length(3),
});

/** Inferred shape of {@link paymentsConfig}. */
export type PaymentsConfig = z.infer<typeof paymentsConfig>;

/** Optional features a payments vendor may implement. */
export const PAYMENTS_FEATURES = [
  'card_on_file',
  'payment_plans',
  'refunds',
  'card_present',
] as const;

/** Input of `authorize`. */
export type AuthorizeInput = z.infer<typeof authorizeInput>;
/** Output of `authorize`. */
export type AuthorizationResult = z.infer<typeof authorizationResult>;
/** Input of `capture`. */
export type CaptureInput = z.infer<typeof captureInput>;
/** Output of `capture`. */
export type CaptureResult = z.infer<typeof captureResult>;
/** Input of `refund`. */
export type RefundInput = z.infer<typeof refundInput>;
/** Output of `refund`. */
export type RefundResult = z.infer<typeof refundResult>;
/** Input of `storeCardOnFile`. */
export type StoreCardOnFileInput = z.infer<typeof storeCardOnFileInput>;
/** Output of `storeCardOnFile`. */
export type StoredCard = z.infer<typeof storedCard>;
/** Input of `createPaymentPlan`. */
export type CreatePaymentPlanInput = z.infer<typeof createPaymentPlanInput>;
/** Output of `createPaymentPlan`. */
export type PaymentPlan = z.infer<typeof paymentPlan>;

/** The payments seam as data. */
export const PAYMENTS_CONTRACT = {
  capability: 'payments',
  contractVersion: PAYMENTS_CONTRACT_VERSION,
  config: paymentsConfig,
  features: PAYMENTS_FEATURES,
  operations: {
    authorize: { input: authorizeInput, output: authorizationResult },
    capture: { input: captureInput, output: captureResult },
    refund: { input: refundInput, output: refundResult },
    storeCardOnFile: { input: storeCardOnFileInput, output: storedCard },
    createPaymentPlan: { input: createPaymentPlanInput, output: paymentPlan },
  },
} as const satisfies CapabilityContract;

/** Everything a payments vendor must implement. */
export interface PaymentsAdapter extends Adapter<PaymentsConfig> {
  authorize(input: AuthorizeInput): Promise<AdapterResult<AuthorizationResult>>;
  capture(input: CaptureInput): Promise<AdapterResult<CaptureResult>>;
  /** Requires the `refunds` feature. */
  refund(input: RefundInput): Promise<AdapterResult<RefundResult>>;
  /** Requires the `card_on_file` feature. */
  storeCardOnFile(input: StoreCardOnFileInput): Promise<AdapterResult<StoredCard>>;
  /** Requires the `payment_plans` feature. */
  createPaymentPlan(input: CreatePaymentPlanInput): Promise<AdapterResult<PaymentPlan>>;
}
