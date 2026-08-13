import { z } from 'zod';

import {
  PAYMENT_METHODS,
  PAYMENT_SOURCES,
  PAYMENT_STATUSES,
  REMITTANCE_STATUSES,
  STATEMENT_DELIVERIES,
  STATEMENT_STATUSES,
} from '../enums.js';
import {
  cents,
  code,
  jsonObject,
  localDate,
  positiveCents,
  shortText,
  timestamp,
  uuid,
} from './common.js';

/**
 * Payment aggregate: money in, where it was applied, the remittance it arrived
 * on, and the statement that asked for it.
 *
 * Nothing here accepts a card number, a bank account, or any other instrument
 * detail. Card handling lives entirely behind the `payments` adapter, and all
 * this model ever stores is the gateway's opaque reference.
 */

export const paymentAllocationInput = z
  .strictObject({
    patientId: uuid,
    claimId: uuid.optional(),
    claimLineId: uuid.optional(),
    chargeItemId: uuid.optional(),
    /** Signed: a refund or a reversal allocates a negative amount. */
    amountCents: cents,
    /** X12 CAS group code when this allocation is a contractual write-off. */
    adjustmentGroupCode: z.enum(['CO', 'CR', 'OA', 'PI', 'PR']).optional(),
    /** X12 CARC reason code. */
    adjustmentReasonCode: code.optional(),
    appliedAt: timestamp.optional(),
    note: shortText.optional(),
  })
  .refine(
    (value) =>
      value.claimId !== undefined ||
      value.claimLineId !== undefined ||
      value.chargeItemId !== undefined,
    { message: 'an allocation must target a claim, a claim line or a charge' }
  )
  .refine((value) => value.amountCents !== 0, {
    message: 'a zero allocation records nothing; omit it',
    path: ['amountCents'],
  });

export const paymentCreateInput = z
  .strictObject({
    patientId: uuid.optional(),
    payerId: uuid.optional(),
    remittanceId: uuid.optional(),
    source: z.enum(PAYMENT_SOURCES),
    method: z.enum(PAYMENT_METHODS),
    status: z.enum(PAYMENT_STATUSES).optional(),
    amountCents: cents,
    /** ISO 4217. */
    currency: z.string().length(3).optional(),
    /** Cheque number or EFT trace number, never an instrument number. */
    reference: z.string().min(1).max(64).optional(),
    /** Opaque gateway reference from the payments adapter. */
    adapterRef: z.string().min(1).max(128).optional(),
    receivedAt: timestamp.optional(),
    note: shortText.optional(),
    allocations: z.array(paymentAllocationInput).max(500).optional(),
  })
  .refine((value) => value.patientId !== undefined || value.payerId !== undefined, {
    message: 'a payment must come from a patient or a payer',
  })
  .refine((value) => value.source !== 'PAYER_ERA' || value.remittanceId !== undefined, {
    message: 'an ERA payment must name the remittance it was posted from',
    path: ['remittanceId'],
  })
  .refine(
    (value) =>
      value.allocations === undefined ||
      value.allocations.reduce((total, entry) => total + entry.amountCents, 0) <= value.amountCents,
    { message: 'allocations must not exceed the payment amount', path: ['allocations'] }
  );

export const remittanceLineInput = z.strictObject({
  claimId: uuid.optional(),
  claimLineId: uuid.optional(),
  sequence: z.int().nonnegative(),
  /** Payer's claim control number from CLP01; the matching key. */
  payerControlNumber: z.string().min(1).max(64).optional(),
  code: code.optional(),
  chargedCents: positiveCents.optional(),
  allowedCents: positiveCents.optional(),
  paidCents: positiveCents.optional(),
  patientResponsibilityCents: positiveCents.optional(),
  adjustmentGroupCode: z.enum(['CO', 'CR', 'OA', 'PI', 'PR']).optional(),
  adjustmentReasonCode: code.optional(),
  /** X12 RARC remark codes. */
  remarkCodes: z.array(code).max(16).optional(),
  serviceDateFrom: localDate.optional(),
  matched: z.boolean().optional(),
});

export const remittanceInput = z
  .strictObject({
    payerId: uuid,
    status: z.enum(REMITTANCE_STATUSES).optional(),
    checkOrEftNumber: z.string().min(1).max(64).optional(),
    totalPaidCents: positiveCents.optional(),
    receivedAt: timestamp.optional(),
    paidAt: timestamp.optional(),
    rawStorageKey: z.string().min(1).max(1024).optional(),
    parsed: jsonObject.optional(),
    lines: z.array(remittanceLineInput).max(5000).optional(),
  })
  .refine(
    (value) =>
      value.lines === undefined ||
      new Set(value.lines.map((line) => line.sequence)).size === value.lines.length,
    { message: 'remittance line sequences must be unique', path: ['lines'] }
  );

export const statementInput = z
  .strictObject({
    patientId: uuid,
    status: z.enum(STATEMENT_STATUSES).optional(),
    balanceCents: cents,
    dunningCycle: z.int().min(1).max(12).optional(),
    periodStart: localDate.optional(),
    periodEnd: localDate.optional(),
    generatedAt: timestamp.optional(),
    deliveredVia: z.enum(STATEMENT_DELIVERIES).optional(),
    pdfStorageKey: z.string().min(1).max(1024).optional(),
    /** Pay-link token. Opaque, single-use, rotated on every regeneration. */
    payLinkToken: z.string().min(32).max(128).optional(),
    payLinkExpiresAt: timestamp.optional(),
  })
  .refine(
    (value) => !value.periodStart || !value.periodEnd || value.periodEnd >= value.periodStart,
    {
      message: 'periodEnd must not precede periodStart',
      path: ['periodEnd'],
    }
  )
  .refine((value) => value.payLinkToken === undefined || value.payLinkExpiresAt !== undefined, {
    message: 'a pay link must expire',
    path: ['payLinkExpiresAt'],
  });

export type PaymentAllocationInput = z.infer<typeof paymentAllocationInput>;
export type PaymentCreateInput = z.infer<typeof paymentCreateInput>;
export type RemittanceLineInput = z.infer<typeof remittanceLineInput>;
export type RemittanceInput = z.infer<typeof remittanceInput>;
export type StatementInput = z.infer<typeof statementInput>;
