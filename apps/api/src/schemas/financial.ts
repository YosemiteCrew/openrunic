import {
  CHARGE_ITEM_STATUSES,
  CLAIM_FREQUENCIES,
  CLAIM_STATUSES,
  COVERAGE_RANKS,
  COVERAGE_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_SOURCES,
  PAYMENT_STATUSES,
  REMITTANCE_STATUSES,
  STATEMENT_DELIVERIES,
  STATEMENT_STATUSES,
  claimStatusChangeInput,
} from '@openrunic/database';
import { z } from 'zod';

import { jsonColumn, readJsonObject } from '../repositories/collection.js';
import type { ScopedRow } from '../repositories/rows.js';
import type {
  ChargeItemListQuery,
  ChargeItemPatchInput,
  ClaimListQuery,
  ClaimPatchInput,
  CoverageListQuery,
  CoveragePatchInput,
  PaymentListQuery,
  PaymentPatchInput,
  RemittanceListQuery,
  RemittancePatchInput,
  StatementListQuery,
  StatementPatchInput,
} from '../repositories/specs/financial.js';

import { paginationQueryFields, sortOrderField } from './pagination.js';
import { parseLocalDate, toDateOnly } from './patients.js';

/**
 * The wire contract for the revenue cycle.
 *
 * Every list query is a `strictObject`, so `?payorId=…` is a 400 rather than an
 * unfiltered sweep of the practice's accounts receivable. Every DTO is a schema
 * with its TypeScript type inferred from it, so the published spec and the
 * handler's return type cannot describe different objects. And money is an
 * integer number of cents in every direction: no schema here parses or emits a
 * float, and none of them has a field that could hold an instrument number.
 */

/* ------------------------------------------------------------------- pieces */

/** A `@db.Date` column on the wire: a calendar date with no time and no zone. */
const dateOnlyField = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
const instantField = z.iso.datetime({ offset: true });
const shortTextField = z.string().min(1).max(256);
const codeField = z.string().min(1).max(64);
const storageKeyField = z.string().min(1).max(1024);
/** A JSON object column, as it serializes. Bare scalars and arrays are refused. */
const jsonObjectField = z.record(z.string(), z.unknown());
/** X12 CAS group codes, the only adjustment groups 835 uses. */
const adjustmentGroupField = z.enum(['CO', 'CR', 'OA', 'PI', 'PR']);

/** A patch that mentions nothing is a request that asks for nothing. */
function changesSomething(value: object): boolean {
  return Object.keys(value).length > 0;
}

function isoOrNull(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

function dateOnlyOrNull(value: Date | null): string | null {
  return value === null ? null : toDateOnly(value);
}

/** A JSON column as an object, or null when it holds anything else. */
function jsonOrNull(value: unknown): Record<string, unknown> | null {
  return readJsonObject(value) ?? null;
}

export type CoverageRow = ScopedRow<'Coverage'>;
export type ChargeItemRow = ScopedRow<'ChargeItem'>;
export type ClaimRow = ScopedRow<'Claim'>;
export type ClaimLineRow = ScopedRow<'ClaimLine'>;
export type ClaimStatusHistoryRow = ScopedRow<'ClaimStatusHistory'>;
export type PaymentRow = ScopedRow<'Payment'>;
export type PaymentAllocationRow = ScopedRow<'PaymentAllocation'>;
export type RemittanceRow = ScopedRow<'Remittance'>;
export type RemittanceLineRow = ScopedRow<'RemittanceLine'>;
export type StatementRow = ScopedRow<'Statement'>;

/* ------------------------------------------------------------------ coverage */

export const coverageListQuerySchema = z.strictObject({
  ...paginationQueryFields,
  patientId: z.uuid().optional(),
  payerId: z.uuid().optional(),
  rank: z.enum(COVERAGE_RANKS).optional(),
  status: z.enum(COVERAGE_STATUSES).optional(),
  sort: z.enum(['rank', 'effectiveFrom', 'createdAt']).default('rank'),
  order: sortOrderField,
});

export type CoverageListQueryInput = z.infer<typeof coverageListQuerySchema>;

export function toCoverageListQuery(input: CoverageListQueryInput): CoverageListQuery {
  return {
    page: input.page,
    pageSize: input.pageSize,
    ...(input.patientId === undefined ? {} : { patientId: input.patientId }),
    ...(input.payerId === undefined ? {} : { payerId: input.payerId }),
    ...(input.rank === undefined ? {} : { rank: input.rank }),
    ...(input.status === undefined ? {} : { status: input.status }),
    sort: input.sort,
    order: input.order,
  };
}

/**
 * The coverage patch contract.
 *
 * `patientId` and `payerId` are absent: a policy recorded against the wrong
 * chart or the wrong payer is a policy entered in error, and correcting it by
 * moving the row would leave every claim already built from it pointing at
 * something that no longer describes what was billed.
 */
export const coverageUpdateSchema = z
  .strictObject({
    rank: z.enum(COVERAGE_RANKS).optional(),
    status: z.enum(COVERAGE_STATUSES).optional(),
    memberId: z.string().min(1).max(64).optional(),
    groupNumber: z.string().min(1).max(64).optional(),
    planName: shortTextField.optional(),
    subscriberRelationshipCode: codeField.optional(),
    subscriberGivenName: z.string().min(1).max(128).optional(),
    subscriberFamilyName: z.string().min(1).max(128).optional(),
    subscriberBirthDate: dateOnlyField.optional(),
    effectiveFrom: dateOnlyField.optional(),
    effectiveTo: dateOnlyField.optional(),
    copayCents: z.int().nonnegative().optional(),
    deductibleCents: z.int().nonnegative().optional(),
    acceptAssignment: z.boolean().optional(),
  })
  .refine(changesSomething, { message: 'the patch must change at least one field' })
  .refine(
    (value) =>
      value.effectiveFrom === undefined ||
      value.effectiveTo === undefined ||
      value.effectiveTo >= value.effectiveFrom,
    { message: 'effectiveTo must not precede effectiveFrom', path: ['effectiveTo'] }
  );

export type CoverageUpdateBody = z.infer<typeof coverageUpdateSchema>;

export function toCoveragePatchInput(body: CoverageUpdateBody): CoveragePatchInput {
  return {
    ...(body.rank === undefined ? {} : { rank: body.rank }),
    ...(body.status === undefined ? {} : { status: body.status }),
    ...(body.memberId === undefined ? {} : { memberId: body.memberId }),
    ...(body.groupNumber === undefined ? {} : { groupNumber: body.groupNumber }),
    ...(body.planName === undefined ? {} : { planName: body.planName }),
    ...(body.subscriberRelationshipCode === undefined
      ? {}
      : { subscriberRelationshipCode: body.subscriberRelationshipCode }),
    ...(body.subscriberGivenName === undefined
      ? {}
      : { subscriberGivenName: body.subscriberGivenName }),
    ...(body.subscriberFamilyName === undefined
      ? {}
      : { subscriberFamilyName: body.subscriberFamilyName }),
    ...(body.subscriberBirthDate === undefined
      ? {}
      : { subscriberBirthDate: parseLocalDate(body.subscriberBirthDate) }),
    ...(body.effectiveFrom === undefined
      ? {}
      : { effectiveFrom: parseLocalDate(body.effectiveFrom) }),
    ...(body.effectiveTo === undefined ? {} : { effectiveTo: parseLocalDate(body.effectiveTo) }),
    ...(body.copayCents === undefined ? {} : { copayCents: body.copayCents }),
    ...(body.deductibleCents === undefined ? {} : { deductibleCents: body.deductibleCents }),
    ...(body.acceptAssignment === undefined ? {} : { acceptAssignment: body.acceptAssignment }),
  };
}

export const coverageDtoSchema = z.strictObject({
  id: z.uuid(),
  patientId: z.uuid(),
  payerId: z.uuid(),
  rank: z.enum(COVERAGE_RANKS),
  status: z.enum(COVERAGE_STATUSES),
  memberId: z.string(),
  groupNumber: z.string().nullable(),
  planName: z.string().nullable(),
  subscriber: z.strictObject({
    relationshipCode: z.string(),
    givenName: z.string().nullable(),
    familyName: z.string().nullable(),
    /** `YYYY-MM-DD`. A date of birth has no time and no timezone. */
    birthDate: z.string().nullable(),
  }),
  effectiveFrom: z.string().nullable(),
  effectiveTo: z.string().nullable(),
  copayCents: z.int().nullable(),
  deductibleCents: z.int().nullable(),
  acceptAssignment: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type CoverageDto = z.infer<typeof coverageDtoSchema>;

export function toCoverageDto(row: CoverageRow): CoverageDto {
  return {
    id: row.id,
    patientId: row.patientId,
    payerId: row.payerId,
    rank: row.rank,
    status: row.status,
    memberId: row.memberId,
    groupNumber: row.groupNumber,
    planName: row.planName,
    subscriber: {
      relationshipCode: row.subscriberRelationshipCode,
      givenName: row.subscriberGivenName,
      familyName: row.subscriberFamilyName,
      birthDate: dateOnlyOrNull(row.subscriberBirthDate),
    },
    effectiveFrom: dateOnlyOrNull(row.effectiveFrom),
    effectiveTo: dateOnlyOrNull(row.effectiveTo),
    copayCents: row.copayCents,
    deductibleCents: row.deductibleCents,
    acceptAssignment: row.acceptAssignment,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const eligibilityCheckSchema = z.strictObject({ serviceDate: dateOnlyField });

export type EligibilityCheckBody = z.infer<typeof eligibilityCheckSchema>;

/**
 * The answer a local eligibility determination can give.
 *
 * `determination` is `local` and only `local`, and it is on the wire rather
 * than only in the prose because a caller has to be able to tell this apart
 * from a real 270/271 exchange without reading the documentation. What this
 * answers is whether the stored policy covers the service date, and what the
 * plan says the patient owes; it is not a payer's word for anything.
 */
export const eligibilityResultSchema = z.strictObject({
  coverageId: z.uuid(),
  patientId: z.uuid(),
  payerId: z.uuid(),
  serviceDate: z.string(),
  eligible: z.boolean(),
  rank: z.enum(COVERAGE_RANKS),
  status: z.enum(COVERAGE_STATUSES),
  planName: z.string().nullable(),
  memberId: z.string(),
  copayCents: z.int().nullable(),
  deductibleCents: z.int().nullable(),
  /** Empty exactly when `eligible` is true. */
  reasons: z.array(z.string()),
  determination: z.literal('local'),
  determinedAt: z.string(),
});

export type EligibilityResult = z.infer<typeof eligibilityResultSchema>;

/* ------------------------------------------------------------------- charges */

export const chargeListQuerySchema = z.strictObject({
  ...paginationQueryFields,
  patientId: z.uuid().optional(),
  encounterId: z.uuid().optional(),
  facilityId: z.uuid().optional(),
  status: z.enum(CHARGE_ITEM_STATUSES).optional(),
  /** Inclusive lower bound on `serviceDate`. */
  from: dateOnlyField.optional(),
  /** Exclusive upper bound on `serviceDate`, so one day is `[day, next day)`. */
  to: dateOnlyField.optional(),
  sort: z.enum(['serviceDate', 'totalPriceCents', 'createdAt']).default('serviceDate'),
  order: sortOrderField,
});

export type ChargeListQueryInput = z.infer<typeof chargeListQuerySchema>;

export function toChargeListQuery(input: ChargeListQueryInput): ChargeItemListQuery {
  return {
    page: input.page,
    pageSize: input.pageSize,
    ...(input.patientId === undefined ? {} : { patientId: input.patientId }),
    ...(input.encounterId === undefined ? {} : { encounterId: input.encounterId }),
    ...(input.facilityId === undefined ? {} : { facilityId: input.facilityId }),
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(input.from === undefined ? {} : { from: parseLocalDate(input.from) }),
    ...(input.to === undefined ? {} : { to: parseLocalDate(input.to) }),
    sort: input.sort,
    order: input.order,
  };
}

/**
 * The charge patch contract.
 *
 * `status` is absent on purpose: a charge leaves OPEN by being billed or by
 * being voided, and both of those are transitions with their own rules. A patch
 * that could set `VOIDED` would be a way to void a charge without recording why
 * or who, which is the one thing the void route exists to prevent.
 */
export const chargeUpdateSchema = z
  .strictObject({
    code: codeField.optional(),
    codeSystem: z.string().min(1).max(255).optional(),
    display: z.string().min(1).max(512).optional(),
    modifiers: z.array(z.string().length(2)).max(4).optional(),
    units: z.number().positive().finite().optional(),
    unitPriceCents: z.int().nonnegative().optional(),
    totalPriceCents: z.int().nonnegative().optional(),
    diagnosisPointers: z.array(z.int().min(1).max(12)).max(4).optional(),
    renderingProviderId: z.uuid().optional(),
    supervisingProviderId: z.uuid().optional(),
    placeOfServiceCode: z.string().min(1).max(4).optional(),
    serviceDate: dateOnlyField.optional(),
  })
  .refine(changesSomething, { message: 'the patch must change at least one field' });

export type ChargeUpdateBody = z.infer<typeof chargeUpdateSchema>;

export function toChargePatchInput(body: ChargeUpdateBody): ChargeItemPatchInput {
  return {
    ...(body.code === undefined ? {} : { code: body.code }),
    ...(body.codeSystem === undefined ? {} : { codeSystem: body.codeSystem }),
    ...(body.display === undefined ? {} : { display: body.display }),
    ...(body.modifiers === undefined ? {} : { modifiers: [...body.modifiers] }),
    ...(body.units === undefined ? {} : { units: body.units }),
    ...(body.unitPriceCents === undefined ? {} : { unitPriceCents: body.unitPriceCents }),
    ...(body.totalPriceCents === undefined ? {} : { totalPriceCents: body.totalPriceCents }),
    ...(body.diagnosisPointers === undefined
      ? {}
      : { diagnosisPointers: [...body.diagnosisPointers] }),
    ...(body.renderingProviderId === undefined
      ? {}
      : { renderingProviderId: body.renderingProviderId }),
    ...(body.supervisingProviderId === undefined
      ? {}
      : { supervisingProviderId: body.supervisingProviderId }),
    ...(body.placeOfServiceCode === undefined
      ? {}
      : { placeOfServiceCode: body.placeOfServiceCode }),
    ...(body.serviceDate === undefined ? {} : { serviceDate: parseLocalDate(body.serviceDate) }),
  };
}

/** Voiding requires a reason, mirroring the refinement in `chargeItemInput`. */
export const chargeVoidSchema = z.strictObject({ voidReason: shortTextField });

export type ChargeVoidBody = z.infer<typeof chargeVoidSchema>;

export const chargeDtoSchema = z.strictObject({
  id: z.uuid(),
  facilityId: z.uuid(),
  encounterId: z.uuid(),
  patientId: z.uuid(),
  code: z.string(),
  codeSystem: z.string(),
  display: z.string(),
  modifiers: z.array(z.string()),
  units: z.number(),
  unitPriceCents: z.int(),
  totalPriceCents: z.int(),
  diagnosisPointers: z.array(z.int()),
  renderingProviderId: z.uuid(),
  supervisingProviderId: z.uuid().nullable(),
  placeOfServiceCode: z.string().nullable(),
  /** `YYYY-MM-DD`. A service date is a calendar day, never an instant. */
  serviceDate: z.string(),
  status: z.enum(CHARGE_ITEM_STATUSES),
  voidReason: z.string().nullable(),
  voidedById: z.uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type ChargeDto = z.infer<typeof chargeDtoSchema>;

export function toChargeDto(row: ChargeItemRow): ChargeDto {
  return {
    id: row.id,
    facilityId: row.facilityId,
    encounterId: row.encounterId,
    patientId: row.patientId,
    code: row.code,
    codeSystem: row.codeSystem,
    display: row.display,
    modifiers: [...row.modifiers],
    units: row.units,
    unitPriceCents: row.unitPriceCents,
    totalPriceCents: row.totalPriceCents,
    diagnosisPointers: [...row.diagnosisPointers],
    renderingProviderId: row.renderingProviderId,
    supervisingProviderId: row.supervisingProviderId,
    placeOfServiceCode: row.placeOfServiceCode,
    serviceDate: toDateOnly(row.serviceDate),
    status: row.status,
    voidReason: row.voidReason,
    voidedById: row.voidedById,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/* -------------------------------------------------------------------- claims */

export const claimListQuerySchema = z.strictObject({
  ...paginationQueryFields,
  patientId: z.uuid().optional(),
  payerId: z.uuid().optional(),
  encounterId: z.uuid().optional(),
  status: z.enum(CLAIM_STATUSES).optional(),
  /** Which instant `from` and `to` bound. A claim has two that matter. */
  window: z.enum(['createdAt', 'submittedAt']).default('createdAt'),
  from: instantField.optional(),
  to: instantField.optional(),
  sort: z.enum(['createdAt', 'submittedAt', 'totalChargedCents']).default('createdAt'),
  order: sortOrderField,
});

export type ClaimListQueryInput = z.infer<typeof claimListQuerySchema>;

export function toClaimListQuery(input: ClaimListQueryInput): ClaimListQuery {
  return {
    page: input.page,
    pageSize: input.pageSize,
    ...(input.patientId === undefined ? {} : { patientId: input.patientId }),
    ...(input.payerId === undefined ? {} : { payerId: input.payerId }),
    ...(input.encounterId === undefined ? {} : { encounterId: input.encounterId }),
    ...(input.status === undefined ? {} : { status: input.status }),
    window: input.window,
    ...(input.from === undefined ? {} : { from: new Date(input.from) }),
    ...(input.to === undefined ? {} : { to: new Date(input.to) }),
    sort: input.sort,
    order: input.order,
  };
}

/**
 * The claim patch contract.
 *
 * `status` is absent because every claim status move is a transition with a
 * table behind it and a history row in front of it. `patientId` and
 * `encounterId` are absent because a claim built against the wrong visit is
 * voided and rebuilt, not edited into a different one.
 */
export const claimUpdateSchema = z
  .strictObject({
    coverageId: z.uuid().optional(),
    payerId: z.uuid().optional(),
    frequency: z.enum(CLAIM_FREQUENCIES).optional(),
    diagnosisCodes: z.array(codeField).min(1).max(12).optional(),
    totalChargedCents: z.int().nonnegative().optional(),
    totalPaidCents: z.int().nonnegative().optional(),
    totalAdjustedCents: z.int().optional(),
    patientResponsibilityCents: z.int().nonnegative().optional(),
    controlNumbers: jsonObjectField.optional(),
    snapshot: jsonObjectField.optional(),
    statusReason: shortTextField.optional(),
  })
  .refine(changesSomething, { message: 'the patch must change at least one field' });

export type ClaimUpdateBody = z.infer<typeof claimUpdateSchema>;

export function toClaimPatchInput(body: ClaimUpdateBody): ClaimPatchInput {
  return {
    ...(body.coverageId === undefined ? {} : { coverageId: body.coverageId }),
    ...(body.payerId === undefined ? {} : { payerId: body.payerId }),
    ...(body.frequency === undefined ? {} : { frequency: body.frequency }),
    ...(body.diagnosisCodes === undefined ? {} : { diagnosisCodes: [...body.diagnosisCodes] }),
    ...(body.totalChargedCents === undefined ? {} : { totalChargedCents: body.totalChargedCents }),
    ...(body.totalPaidCents === undefined ? {} : { totalPaidCents: body.totalPaidCents }),
    ...(body.totalAdjustedCents === undefined
      ? {}
      : { totalAdjustedCents: body.totalAdjustedCents }),
    ...(body.patientResponsibilityCents === undefined
      ? {}
      : { patientResponsibilityCents: body.patientResponsibilityCents }),
    ...(body.controlNumbers === undefined
      ? {}
      : { controlNumbers: jsonColumn(body.controlNumbers) }),
    ...(body.snapshot === undefined ? {} : { snapshot: jsonColumn(body.snapshot) }),
    ...(body.statusReason === undefined ? {} : { statusReason: body.statusReason }),
  };
}

/** What a scrub or a submit may record alongside the move. */
export const claimTransitionSchema = z.strictObject({
  statusReason: shortTextField.optional(),
  detail: jsonObjectField.optional(),
});

export type ClaimTransitionBody = z.infer<typeof claimTransitionSchema>;

/**
 * An adjudication outcome arriving from an acknowledgement, a status response,
 * a remittance or a person.
 *
 * The vocabulary for `source` comes from `claimStatusChangeInput` rather than
 * being restated, so what the API accepts and what the seed and the CLI accept
 * cannot drift. `claimId` is dropped: the path already said which claim, and a
 * body that could name a different one is a body that can be wrong.
 */
export const claimStatusChangeBodySchema = claimStatusChangeInput
  .omit({ claimId: true })
  .extend({ statusReason: shortTextField.optional() });

export type ClaimStatusChangeBody = z.infer<typeof claimStatusChangeBodySchema>;

export const claimDtoSchema = z.strictObject({
  id: z.uuid(),
  patientId: z.uuid(),
  encounterId: z.uuid(),
  coverageId: z.uuid(),
  payerId: z.uuid(),
  status: z.enum(CLAIM_STATUSES),
  frequency: z.enum(CLAIM_FREQUENCIES),
  diagnosisCodes: z.array(z.string()),
  totals: z.strictObject({
    chargedCents: z.int(),
    paidCents: z.int(),
    adjustedCents: z.int(),
    patientResponsibilityCents: z.int(),
  }),
  secondaryOfId: z.uuid().nullable(),
  priorClaimId: z.uuid().nullable(),
  controlNumbers: jsonObjectField.nullable(),
  snapshot: jsonObjectField.nullable(),
  statusReason: z.string().nullable(),
  submittedAt: z.string().nullable(),
  acknowledgedAt: z.string().nullable(),
  adjudicatedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type ClaimDto = z.infer<typeof claimDtoSchema>;

export function toClaimDto(row: ClaimRow): ClaimDto {
  return {
    id: row.id,
    patientId: row.patientId,
    encounterId: row.encounterId,
    coverageId: row.coverageId,
    payerId: row.payerId,
    status: row.status,
    frequency: row.frequency,
    diagnosisCodes: [...row.diagnosisCodes],
    totals: {
      chargedCents: row.totalChargedCents,
      paidCents: row.totalPaidCents,
      adjustedCents: row.totalAdjustedCents,
      patientResponsibilityCents: row.patientResponsibilityCents,
    },
    secondaryOfId: row.secondaryOfId,
    priorClaimId: row.priorClaimId,
    controlNumbers: jsonOrNull(row.controlNumbers),
    snapshot: jsonOrNull(row.snapshot),
    statusReason: row.statusReason,
    submittedAt: isoOrNull(row.submittedAt),
    acknowledgedAt: isoOrNull(row.acknowledgedAt),
    adjudicatedAt: isoOrNull(row.adjudicatedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const claimLineDtoSchema = z.strictObject({
  id: z.uuid(),
  claimId: z.uuid(),
  chargeItemId: z.uuid(),
  sequence: z.int(),
  code: z.string(),
  codeSystem: z.string(),
  modifiers: z.array(z.string()),
  units: z.number(),
  chargedCents: z.int(),
  allowedCents: z.int().nullable(),
  paidCents: z.int(),
  adjustedCents: z.int(),
  diagnosisPointers: z.array(z.int()),
  serviceDateFrom: z.string(),
  serviceDateTo: z.string().nullable(),
  statusReason: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type ClaimLineDto = z.infer<typeof claimLineDtoSchema>;

export function toClaimLineDto(row: ClaimLineRow): ClaimLineDto {
  return {
    id: row.id,
    claimId: row.claimId,
    chargeItemId: row.chargeItemId,
    sequence: row.sequence,
    code: row.code,
    codeSystem: row.codeSystem,
    modifiers: [...row.modifiers],
    units: row.units,
    chargedCents: row.chargedCents,
    allowedCents: row.allowedCents,
    paidCents: row.paidCents,
    adjustedCents: row.adjustedCents,
    diagnosisPointers: [...row.diagnosisPointers],
    serviceDateFrom: toDateOnly(row.serviceDateFrom),
    serviceDateTo: dateOnlyOrNull(row.serviceDateTo),
    statusReason: row.statusReason,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const claimStatusHistoryDtoSchema = z.strictObject({
  id: z.uuid(),
  claimId: z.uuid(),
  status: z.enum(CLAIM_STATUSES),
  occurredAt: z.string(),
  source: z.string(),
  detail: jsonObjectField.nullable(),
  byUserId: z.uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type ClaimStatusHistoryDto = z.infer<typeof claimStatusHistoryDtoSchema>;

export function toClaimStatusHistoryDto(row: ClaimStatusHistoryRow): ClaimStatusHistoryDto {
  return {
    id: row.id,
    claimId: row.claimId,
    status: row.status,
    occurredAt: row.occurredAt.toISOString(),
    source: row.source,
    detail: jsonOrNull(row.detail),
    byUserId: row.byUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/* ------------------------------------------------------------------ payments */

export const paymentListQuerySchema = z.strictObject({
  ...paginationQueryFields,
  patientId: z.uuid().optional(),
  payerId: z.uuid().optional(),
  remittanceId: z.uuid().optional(),
  status: z.enum(PAYMENT_STATUSES).optional(),
  source: z.enum(PAYMENT_SOURCES).optional(),
  /** Inclusive lower bound on `receivedAt`. */
  from: instantField.optional(),
  /** Exclusive upper bound on `receivedAt`. */
  to: instantField.optional(),
  sort: z.enum(['receivedAt', 'amountCents', 'createdAt']).default('receivedAt'),
  order: sortOrderField,
});

export type PaymentListQueryInput = z.infer<typeof paymentListQuerySchema>;

export function toPaymentListQuery(input: PaymentListQueryInput): PaymentListQuery {
  return {
    page: input.page,
    pageSize: input.pageSize,
    ...(input.patientId === undefined ? {} : { patientId: input.patientId }),
    ...(input.payerId === undefined ? {} : { payerId: input.payerId }),
    ...(input.remittanceId === undefined ? {} : { remittanceId: input.remittanceId }),
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(input.source === undefined ? {} : { source: input.source }),
    ...(input.from === undefined ? {} : { from: new Date(input.from) }),
    ...(input.to === undefined ? {} : { to: new Date(input.to) }),
    sort: input.sort,
    order: input.order,
  };
}

/**
 * The payment patch contract.
 *
 * `amountCents` is absent: money that arrived arrived, and correcting the
 * figure is a reversal plus a new payment, not an edit that would silently
 * change what a posted allocation was drawn from. `status` is absent because
 * posting, voiding and refunding are transitions.
 */
export const paymentUpdateSchema = z
  .strictObject({
    patientId: z.uuid().optional(),
    payerId: z.uuid().optional(),
    remittanceId: z.uuid().optional(),
    method: z.enum(PAYMENT_METHODS).optional(),
    /** Cheque number or EFT trace number, never an instrument number. */
    reference: z.string().min(1).max(64).optional(),
    adapterRef: z.string().min(1).max(128).optional(),
    receivedAt: instantField.optional(),
    note: shortTextField.optional(),
  })
  .refine(changesSomething, { message: 'the patch must change at least one field' });

export type PaymentUpdateBody = z.infer<typeof paymentUpdateSchema>;

export function toPaymentPatchInput(body: PaymentUpdateBody): PaymentPatchInput {
  return {
    ...(body.patientId === undefined ? {} : { patientId: body.patientId }),
    ...(body.payerId === undefined ? {} : { payerId: body.payerId }),
    ...(body.remittanceId === undefined ? {} : { remittanceId: body.remittanceId }),
    ...(body.method === undefined ? {} : { method: body.method }),
    ...(body.reference === undefined ? {} : { reference: body.reference }),
    ...(body.adapterRef === undefined ? {} : { adapterRef: body.adapterRef }),
    ...(body.receivedAt === undefined ? {} : { receivedAt: new Date(body.receivedAt) }),
    ...(body.note === undefined ? {} : { note: body.note }),
  };
}

/** What a post, a void or a refund may record alongside the move. */
export const paymentTransitionSchema = z.strictObject({ note: shortTextField.optional() });

export type PaymentTransitionBody = z.infer<typeof paymentTransitionSchema>;

export const paymentDtoSchema = z.strictObject({
  id: z.uuid(),
  patientId: z.uuid().nullable(),
  payerId: z.uuid().nullable(),
  remittanceId: z.uuid().nullable(),
  source: z.enum(PAYMENT_SOURCES),
  method: z.enum(PAYMENT_METHODS),
  status: z.enum(PAYMENT_STATUSES),
  amountCents: z.int(),
  currency: z.string(),
  reference: z.string().nullable(),
  /** The payments adapter's opaque reference. Never an instrument detail. */
  adapterRef: z.string().nullable(),
  receivedAt: z.string(),
  postedAt: z.string().nullable(),
  postedById: z.uuid().nullable(),
  note: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type PaymentDto = z.infer<typeof paymentDtoSchema>;

export function toPaymentDto(row: PaymentRow): PaymentDto {
  return {
    id: row.id,
    patientId: row.patientId,
    payerId: row.payerId,
    remittanceId: row.remittanceId,
    source: row.source,
    method: row.method,
    status: row.status,
    amountCents: row.amountCents,
    currency: row.currency,
    reference: row.reference,
    adapterRef: row.adapterRef,
    receivedAt: row.receivedAt.toISOString(),
    postedAt: isoOrNull(row.postedAt),
    postedById: row.postedById,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const paymentAllocationDtoSchema = z.strictObject({
  id: z.uuid(),
  paymentId: z.uuid(),
  patientId: z.uuid(),
  claimId: z.uuid().nullable(),
  claimLineId: z.uuid().nullable(),
  chargeItemId: z.uuid().nullable(),
  /** Signed: a refund or a reversal allocates a negative amount. */
  amountCents: z.int(),
  adjustmentGroupCode: adjustmentGroupField.nullable(),
  adjustmentReasonCode: z.string().nullable(),
  appliedAt: z.string(),
  note: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type PaymentAllocationDto = z.infer<typeof paymentAllocationDtoSchema>;

export function toPaymentAllocationDto(row: PaymentAllocationRow): PaymentAllocationDto {
  return {
    id: row.id,
    paymentId: row.paymentId,
    patientId: row.patientId,
    claimId: row.claimId,
    claimLineId: row.claimLineId,
    chargeItemId: row.chargeItemId,
    amountCents: row.amountCents,
    adjustmentGroupCode: adjustmentGroupField.safeParse(row.adjustmentGroupCode).data ?? null,
    adjustmentReasonCode: row.adjustmentReasonCode,
    appliedAt: row.appliedAt.toISOString(),
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/* --------------------------------------------------------------- remittances */

export const remittanceListQuerySchema = z.strictObject({
  ...paginationQueryFields,
  payerId: z.uuid().optional(),
  status: z.enum(REMITTANCE_STATUSES).optional(),
  /** Inclusive lower bound on `receivedAt`. */
  from: instantField.optional(),
  /** Exclusive upper bound on `receivedAt`. */
  to: instantField.optional(),
  sort: z.enum(['receivedAt', 'totalPaidCents', 'createdAt']).default('receivedAt'),
  order: sortOrderField,
});

export type RemittanceListQueryInput = z.infer<typeof remittanceListQuerySchema>;

export function toRemittanceListQuery(input: RemittanceListQueryInput): RemittanceListQuery {
  return {
    page: input.page,
    pageSize: input.pageSize,
    ...(input.payerId === undefined ? {} : { payerId: input.payerId }),
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(input.from === undefined ? {} : { from: new Date(input.from) }),
    ...(input.to === undefined ? {} : { to: new Date(input.to) }),
    sort: input.sort,
    order: input.order,
  };
}

/** `status` and `exceptionCount` are what parsing and posting concluded. */
export const remittanceUpdateSchema = z
  .strictObject({
    checkOrEftNumber: z.string().min(1).max(64).optional(),
    totalPaidCents: z.int().nonnegative().optional(),
    paidAt: instantField.optional(),
    rawStorageKey: storageKeyField.optional(),
    parsed: jsonObjectField.optional(),
  })
  .refine(changesSomething, { message: 'the patch must change at least one field' });

export type RemittanceUpdateBody = z.infer<typeof remittanceUpdateSchema>;

export function toRemittancePatchInput(body: RemittanceUpdateBody): RemittancePatchInput {
  return {
    ...(body.checkOrEftNumber === undefined ? {} : { checkOrEftNumber: body.checkOrEftNumber }),
    ...(body.totalPaidCents === undefined ? {} : { totalPaidCents: body.totalPaidCents }),
    ...(body.paidAt === undefined ? {} : { paidAt: new Date(body.paidAt) }),
    ...(body.rawStorageKey === undefined ? {} : { rawStorageKey: body.rawStorageKey }),
    ...(body.parsed === undefined ? {} : { parsed: jsonColumn(body.parsed) }),
  };
}

export const remittanceDtoSchema = z.strictObject({
  id: z.uuid(),
  payerId: z.uuid(),
  status: z.enum(REMITTANCE_STATUSES),
  checkOrEftNumber: z.string().nullable(),
  totalPaidCents: z.int(),
  receivedAt: z.string(),
  paidAt: z.string().nullable(),
  rawStorageKey: z.string().nullable(),
  parsed: jsonObjectField.nullable(),
  /** Lines parsing could not match. Each one is somebody's work. */
  exceptionCount: z.int(),
  postedAt: z.string().nullable(),
  postedById: z.uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type RemittanceDto = z.infer<typeof remittanceDtoSchema>;

export function toRemittanceDto(row: RemittanceRow): RemittanceDto {
  return {
    id: row.id,
    payerId: row.payerId,
    status: row.status,
    checkOrEftNumber: row.checkOrEftNumber,
    totalPaidCents: row.totalPaidCents,
    receivedAt: row.receivedAt.toISOString(),
    paidAt: isoOrNull(row.paidAt),
    rawStorageKey: row.rawStorageKey,
    parsed: jsonOrNull(row.parsed),
    exceptionCount: row.exceptionCount,
    postedAt: isoOrNull(row.postedAt),
    postedById: row.postedById,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const remittanceLineDtoSchema = z.strictObject({
  id: z.uuid(),
  remittanceId: z.uuid(),
  claimId: z.uuid().nullable(),
  claimLineId: z.uuid().nullable(),
  sequence: z.int(),
  payerControlNumber: z.string().nullable(),
  code: z.string().nullable(),
  chargedCents: z.int(),
  allowedCents: z.int(),
  paidCents: z.int(),
  patientResponsibilityCents: z.int(),
  adjustmentGroupCode: adjustmentGroupField.nullable(),
  adjustmentReasonCode: z.string().nullable(),
  remarkCodes: z.array(z.string()),
  serviceDateFrom: z.string().nullable(),
  matched: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type RemittanceLineDto = z.infer<typeof remittanceLineDtoSchema>;

export function toRemittanceLineDto(row: RemittanceLineRow): RemittanceLineDto {
  return {
    id: row.id,
    remittanceId: row.remittanceId,
    claimId: row.claimId,
    claimLineId: row.claimLineId,
    sequence: row.sequence,
    payerControlNumber: row.payerControlNumber,
    code: row.code,
    chargedCents: row.chargedCents,
    allowedCents: row.allowedCents,
    paidCents: row.paidCents,
    patientResponsibilityCents: row.patientResponsibilityCents,
    adjustmentGroupCode: adjustmentGroupField.safeParse(row.adjustmentGroupCode).data ?? null,
    adjustmentReasonCode: row.adjustmentReasonCode,
    remarkCodes: [...row.remarkCodes],
    serviceDateFrom: dateOnlyOrNull(row.serviceDateFrom),
    matched: row.matched,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Parsing takes no arguments: what it concludes, it concludes from the lines. */
export const remittanceParseSchema = z.strictObject({});

export type RemittanceParseBody = z.infer<typeof remittanceParseSchema>;

export const remittanceParseResultSchema = z.strictObject({
  remittance: remittanceDtoSchema,
  lineCount: z.int(),
  matchedCount: z.int(),
  /** Unmatched lines. They become work rather than being silently dropped. */
  exceptionCount: z.int(),
});

export type RemittanceParseResult = z.infer<typeof remittanceParseResultSchema>;

export const remittancePostSchema = z.strictObject({
  /** How the money actually arrived. An advice is usually settled by EFT. */
  method: z.enum(PAYMENT_METHODS).optional(),
});

export type RemittancePostBody = z.infer<typeof remittancePostSchema>;

export const remittancePostResultSchema = z.strictObject({
  remittance: remittanceDtoSchema,
  payment: paymentDtoSchema,
  allocationCount: z.int(),
  allocatedCents: z.int(),
  /** Lines that could not be applied. Posting says so rather than hiding it. */
  skippedLineCount: z.int(),
});

export type RemittancePostResult = z.infer<typeof remittancePostResultSchema>;

/* ---------------------------------------------------------------- statements */

export const statementListQuerySchema = z.strictObject({
  ...paginationQueryFields,
  patientId: z.uuid().optional(),
  status: z.enum(STATEMENT_STATUSES).optional(),
  dunningCycle: z.coerce.number().int().min(1).max(12).optional(),
  /** Inclusive lower bound on `generatedAt`. */
  from: instantField.optional(),
  /** Exclusive upper bound on `generatedAt`. */
  to: instantField.optional(),
  sort: z.enum(['generatedAt', 'balanceCents', 'createdAt']).default('generatedAt'),
  order: sortOrderField,
});

export type StatementListQueryInput = z.infer<typeof statementListQuerySchema>;

export function toStatementListQuery(input: StatementListQueryInput): StatementListQuery {
  return {
    page: input.page,
    pageSize: input.pageSize,
    ...(input.patientId === undefined ? {} : { patientId: input.patientId }),
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(input.dunningCycle === undefined ? {} : { dunningCycle: input.dunningCycle }),
    ...(input.from === undefined ? {} : { from: new Date(input.from) }),
    ...(input.to === undefined ? {} : { to: new Date(input.to) }),
    sort: input.sort,
    order: input.order,
  };
}

/** Delivery and the pay link belong to the send route, so they are not here. */
export const statementUpdateSchema = z
  .strictObject({
    balanceCents: z.int().optional(),
    dunningCycle: z.int().min(1).max(12).optional(),
    periodStart: dateOnlyField.optional(),
    periodEnd: dateOnlyField.optional(),
    pdfStorageKey: storageKeyField.optional(),
  })
  .refine(changesSomething, { message: 'the patch must change at least one field' })
  .refine(
    (value) =>
      value.periodStart === undefined ||
      value.periodEnd === undefined ||
      value.periodEnd >= value.periodStart,
    { message: 'periodEnd must not precede periodStart', path: ['periodEnd'] }
  );

export type StatementUpdateBody = z.infer<typeof statementUpdateSchema>;

export function toStatementPatchInput(body: StatementUpdateBody): StatementPatchInput {
  return {
    ...(body.balanceCents === undefined ? {} : { balanceCents: body.balanceCents }),
    ...(body.dunningCycle === undefined ? {} : { dunningCycle: body.dunningCycle }),
    ...(body.periodStart === undefined ? {} : { periodStart: parseLocalDate(body.periodStart) }),
    ...(body.periodEnd === undefined ? {} : { periodEnd: parseLocalDate(body.periodEnd) }),
    ...(body.pdfStorageKey === undefined ? {} : { pdfStorageKey: body.pdfStorageKey }),
  };
}

export const statementGenerateSchema = z.strictObject({
  balanceCents: z.int().optional(),
  pdfStorageKey: storageKeyField.optional(),
});

export type StatementGenerateBody = z.infer<typeof statementGenerateSchema>;

/** A pay link must expire, mirroring the refinement in `statementInput`. */
export const statementSendSchema = z
  .strictObject({
    deliveredVia: z.enum(STATEMENT_DELIVERIES),
    payLinkToken: z.string().min(32).max(128).optional(),
    payLinkExpiresAt: instantField.optional(),
  })
  .refine((value) => value.payLinkToken === undefined || value.payLinkExpiresAt !== undefined, {
    message: 'a pay link must expire',
    path: ['payLinkExpiresAt'],
  });

export type StatementSendBody = z.infer<typeof statementSendSchema>;

/**
 * Advancing the dunning cycle.
 *
 * The body carries no cycle number. Which notice this is comes from the row and
 * the practice's policy, and letting a caller name it would let a retrying job
 * or a double click place a patient anywhere on the schedule.
 */
export const statementNoticeSchema = z.strictObject({
  deliveredVia: z.enum(STATEMENT_DELIVERIES),
  balanceCents: z.int().optional(),
});

export type StatementNoticeBody = z.infer<typeof statementNoticeSchema>;

/** Agreeing not to chase, for a stated reason, until a stated date. */
export const statementHoldSchema = z.strictObject({
  // Required, and the reason is in `payment.ts`: a hold with no reason is
  // indistinguishable from a mistake a month later, and the person who has to
  // justify it is not the person who set it.
  reason: z.string().min(1).max(500),
  until: instantField,
});

export type StatementHoldBody = z.infer<typeof statementHoldSchema>;

/** Giving up on a real debt. */
export const statementWriteOffSchema = z.strictObject({
  reason: z.string().min(1).max(500),
});

export type StatementWriteOffBody = z.infer<typeof statementWriteOffSchema>;

/**
 * One line of the collections worklist.
 *
 * `action` is what the practice's policy says to do, not what the row says
 * happened. It is computed on read rather than stored, because a stored
 * decision goes stale the moment a payment lands and a worklist that tells a
 * biller to chase somebody who paid yesterday is worse than no worklist.
 */
export const collectionsWorklistEntrySchema = z.strictObject({
  statementId: z.uuid(),
  patientId: z.uuid(),
  balanceCents: z.int(),
  daysOverdue: z.int(),
  bucket: z.enum(['current', '1-30', '31-60', '61-90', '90+']),
  noticesSent: z.int(),
  lastNoticeAt: z.string().nullable(),
  action: z.enum(['wait', 'notice', 'write-off', 'escalate', 'held', 'settled']),
  /** When `action` is `wait` or `held`, the date it is waiting for. */
  actionableAt: z.string().nullable(),
});

export type CollectionsWorklistEntry = z.infer<typeof collectionsWorklistEntrySchema>;

/**
 * Narrowing the worklist to one kind of work.
 *
 * No paging. The list is bounded by how many statements a practice has out at
 * once, and a biller working a queue wants the whole queue: a page-two link on
 * a list that reorders itself as payments land is a way to skip rows.
 */
export const collectionsWorklistQuerySchema = z.strictObject({
  action: z.enum(['wait', 'notice', 'write-off', 'escalate', 'held', 'settled']).optional(),
});

/**
 * The statement, minus its pay-link token.
 *
 * The token is a single-use bearer credential for a payment page, so emitting
 * it would turn a list of statements into a list of ways to pay other people's
 * bills. What a caller actually needs to render is whether a link exists and
 * when it stops working, and those are both here.
 */
export const statementDtoSchema = z.strictObject({
  id: z.uuid(),
  patientId: z.uuid(),
  status: z.enum(STATEMENT_STATUSES),
  balanceCents: z.int(),
  dunningCycle: z.int(),
  lastNoticeAt: z.string().nullable(),
  holdUntil: z.string().nullable(),
  holdReason: z.string().nullable(),
  closedReason: z.string().nullable(),
  periodStart: z.string().nullable(),
  periodEnd: z.string().nullable(),
  generatedAt: z.string(),
  deliveredVia: z.enum(STATEMENT_DELIVERIES).nullable(),
  deliveredAt: z.string().nullable(),
  pdfStorageKey: z.string().nullable(),
  payLinkSet: z.boolean(),
  payLinkExpiresAt: z.string().nullable(),
  paidAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type StatementDto = z.infer<typeof statementDtoSchema>;

export function toStatementDto(row: StatementRow): StatementDto {
  return {
    id: row.id,
    patientId: row.patientId,
    status: row.status,
    balanceCents: row.balanceCents,
    dunningCycle: row.dunningCycle,
    lastNoticeAt: isoOrNull(row.lastNoticeAt),
    holdUntil: isoOrNull(row.holdUntil),
    holdReason: row.holdReason,
    closedReason: row.closedReason,
    periodStart: dateOnlyOrNull(row.periodStart),
    periodEnd: dateOnlyOrNull(row.periodEnd),
    generatedAt: row.generatedAt.toISOString(),
    deliveredVia: row.deliveredVia,
    deliveredAt: isoOrNull(row.deliveredAt),
    pdfStorageKey: row.pdfStorageKey,
    payLinkSet: row.payLinkToken !== null,
    payLinkExpiresAt: isoOrNull(row.payLinkExpiresAt),
    paidAt: isoOrNull(row.paidAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
