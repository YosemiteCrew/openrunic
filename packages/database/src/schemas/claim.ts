import { z } from 'zod';

import { CHARGE_ITEM_STATUSES, CLAIM_FREQUENCIES, CLAIM_STATUSES } from '../enums.js';
import {
  cents,
  code,
  codeSystem,
  display,
  jsonObject,
  localDate,
  positiveCents,
  shortText,
  timestamp,
  uuid,
} from './common.js';

/**
 * Claim aggregate: the fee-sheet charges, the claim built from them, its lines
 * and its lifecycle transitions.
 *
 * `diagnosisPointers` are 1-based indices into the claim's `diagnosisCodes`
 * list, which is what 837P SV107 expects and what the fee sheet calls
 * "justify". They are validated as 1-12 here; that they point at a diagnosis
 * that actually exists is checked by the scrubber, which is the only place that
 * can see the charge and the claim together.
 */

const diagnosisPointers = z.array(z.int().min(1).max(12)).max(4);
/** CPT modifiers: at most four per line in 837P SV101-3 through SV101-6. */
const modifiers = z.array(z.string().length(2)).max(4);

export const chargeItemInput = z
  .strictObject({
    facilityId: uuid,
    encounterId: uuid,
    patientId: uuid,
    code,
    codeSystem: codeSystem.optional(),
    display,
    modifiers: modifiers.optional(),
    units: z.number().positive().finite().optional(),
    unitPriceCents: positiveCents,
    totalPriceCents: positiveCents,
    diagnosisPointers: diagnosisPointers.optional(),
    renderingProviderId: uuid,
    supervisingProviderId: uuid.optional(),
    placeOfServiceCode: z.string().min(1).max(4).optional(),
    serviceDate: localDate,
    status: z.enum(CHARGE_ITEM_STATUSES).optional(),
    voidReason: shortText.optional(),
  })
  .refine((value) => value.status !== 'VOIDED' || value.voidReason !== undefined, {
    message: 'a voided charge must record why',
    path: ['voidReason'],
  });

export const claimLineInput = z.strictObject({
  chargeItemId: uuid,
  sequence: z.int().min(1).max(50),
  code,
  codeSystem: codeSystem.optional(),
  modifiers: modifiers.optional(),
  units: z.number().positive().finite().optional(),
  chargedCents: positiveCents,
  allowedCents: positiveCents.optional(),
  paidCents: positiveCents.optional(),
  adjustedCents: cents.optional(),
  diagnosisPointers: diagnosisPointers.optional(),
  serviceDateFrom: localDate,
  serviceDateTo: localDate.optional(),
  statusReason: shortText.optional(),
});

export const claimCreateInput = z
  .strictObject({
    patientId: uuid,
    encounterId: uuid,
    coverageId: uuid,
    payerId: uuid,
    status: z.enum(CLAIM_STATUSES).optional(),
    frequency: z.enum(CLAIM_FREQUENCIES).optional(),
    /** Ordered; ChargeItem.diagnosisPointers index into this list, 1-based. */
    diagnosisCodes: z.array(code).min(1).max(12),
    totalChargedCents: positiveCents.optional(),
    secondaryOfId: uuid.optional(),
    priorClaimId: uuid.optional(),
    controlNumbers: jsonObject.optional(),
    /** The as-built 837P payload, so a resubmission is byte-reproducible. */
    snapshot: jsonObject.optional(),
    lines: z.array(claimLineInput).min(1).max(50),
  })
  .refine((value) => value.frequency !== 'REPLACEMENT' || value.priorClaimId !== undefined, {
    message: 'a replacement claim must name the claim it replaces',
    path: ['priorClaimId'],
  })
  .refine(
    (value) => new Set(value.lines.map((line) => line.sequence)).size === value.lines.length,
    { message: 'claim line sequences must be unique', path: ['lines'] }
  )
  .refine(
    (value) =>
      value.lines.every((line) =>
        (line.diagnosisPointers ?? []).every((pointer) => pointer <= value.diagnosisCodes.length)
      ),
    {
      message: 'a diagnosis pointer references a diagnosis the claim does not carry',
      path: ['lines'],
    }
  );

export const claimStatusChangeInput = z.strictObject({
  claimId: uuid,
  status: z.enum(CLAIM_STATUSES),
  occurredAt: timestamp.optional(),
  /** What caused the transition. */
  source: z.enum(['system', '999', '277', '835', 'user']),
  detail: jsonObject.optional(),
});

export type ChargeItemInput = z.infer<typeof chargeItemInput>;
export type ClaimLineInput = z.infer<typeof claimLineInput>;
export type ClaimCreateInput = z.infer<typeof claimCreateInput>;
export type ClaimStatusChangeInput = z.infer<typeof claimStatusChangeInput>;
