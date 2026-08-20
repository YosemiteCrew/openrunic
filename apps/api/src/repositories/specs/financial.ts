import type {
  ChargeItemInput,
  ClaimCreateInput,
  ClaimLineInput,
  ClaimStatusChangeInput,
  CoverageInput,
  PaymentAllocationInput,
  PaymentCreateInput,
  RemittanceInput,
  RemittanceLineInput,
  StatementInput,
} from '@openrunic/database';

import {
  childBatch,
  comparable,
  inWindow,
  jsonColumn,
  windowFilter,
  type BaseQuery,
  type ChildBatch,
  type CollectionSpec,
  type JsonColumnValue,
  type RowContext,
  type Writable,
} from '../collection.js';
import type { PrismaModelName, Row, ScopedRow } from '../rows.js';

/**
 * The revenue cycle: eligibility, charges, claims, money and statements.
 *
 * Three of these aggregates are composite, and that is the load-bearing fact
 * about this file. A claim without its lines has a total that lies, a payment
 * without its allocations is money that arrived and went nowhere, and a
 * remittance without its service lines is an unreadable advice. All three write
 * their children in the parent's transaction through {@link ChildBatch}, so
 * none of those half-written states exists for even the width of a request.
 *
 * Money is integer cents throughout. Nothing here accepts an instrument: card
 * handling lives entirely behind the payments adapter, and the only thing these
 * models ever hold is that adapter's opaque reference.
 */

/* ---------------------------------------------------------------- row unions */

export type CoverageRank = Row<'Coverage'>['rank'];
export type CoverageStatus = Row<'Coverage'>['status'];
export type ChargeItemStatus = Row<'ChargeItem'>['status'];
export type ClaimStatus = Row<'Claim'>['status'];
export type ClaimFrequency = Row<'Claim'>['frequency'];
export type PaymentSource = Row<'Payment'>['source'];
export type PaymentMethod = Row<'Payment'>['method'];
export type PaymentStatus = Row<'Payment'>['status'];
export type RemittanceStatus = Row<'Remittance'>['status'];
export type StatementStatus = Row<'Statement'>['status'];
export type StatementDelivery = Row<'Statement'>['deliveredVia'];

/**
 * Column defaults, mirrored by hand from `schema.prisma`.
 *
 * Postgres applies these at runtime; the in-memory repository has no Postgres,
 * so it applies them from here, exactly as `repositories/defaults.ts` does for
 * the core aggregates. Keeping one copy per column is what stops the suite from
 * passing against a default the database does not actually have.
 */
const COVERAGE_DEFAULTS = {
  rank: 'PRIMARY',
  status: 'ACTIVE',
  subscriberRelationshipCode: 'self',
  acceptAssignment: true,
} satisfies Partial<Writable<'Coverage'>>;

const CHARGE_ITEM_DEFAULTS = {
  codeSystem: 'http://www.ama-assn.org/go/cpt',
  units: 1,
  status: 'OPEN',
} satisfies Partial<Writable<'ChargeItem'>>;

const CLAIM_DEFAULTS = {
  status: 'DRAFT',
  frequency: 'ORIGINAL',
  totalChargedCents: 0,
  totalPaidCents: 0,
  totalAdjustedCents: 0,
  patientResponsibilityCents: 0,
} satisfies Partial<Writable<'Claim'>>;

const CLAIM_LINE_DEFAULTS = {
  codeSystem: 'http://www.ama-assn.org/go/cpt',
  units: 1,
  paidCents: 0,
  adjustedCents: 0,
} satisfies Partial<Writable<'ClaimLine'>>;

const PAYMENT_DEFAULTS = {
  source: 'PATIENT',
  method: 'CARD',
  status: 'PENDING',
  currency: 'USD',
} satisfies Partial<Writable<'Payment'>>;

const REMITTANCE_DEFAULTS = {
  status: 'RECEIVED',
  totalPaidCents: 0,
  exceptionCount: 0,
} satisfies Partial<Writable<'Remittance'>>;

const REMITTANCE_LINE_DEFAULTS = {
  chargedCents: 0,
  allowedCents: 0,
  paidCents: 0,
  patientResponsibilityCents: 0,
  matched: false,
} satisfies Partial<Writable<'RemittanceLine'>>;

const STATEMENT_DEFAULTS = {
  status: 'DRAFT',
  // Zero notices, because none has been sent. This used to be 1, which claimed
  // a notice for every statement ever created, including ones still in draft.
  dunningCycle: 0,
} satisfies Partial<Writable<'Statement'>>;

/**
 * The columns a patch mentions.
 *
 * An absent key stays absent rather than becoming null, because "not mentioned"
 * and "clear this column" are different requests and only one of them was made.
 * Written once here rather than ten times below: every patch type in this file
 * is a flat record of optional columns, so there is nothing per-aggregate left
 * to decide.
 *
 * The assertion at the end is the price of that: filtering a record loses the
 * association between the keys and the model, and no signature can express
 * "the same object, minus its undefined values". Each call site names its own
 * model, and the patch types are declared column by column against `Writable`,
 * so what the assertion restores was already checked one line up.
 */
function mentionedColumns<M extends PrismaModelName>(
  patch: Record<string, unknown>
): Partial<Writable<M>> {
  const data: Record<string, unknown> = {};
  for (const [column, value] of Object.entries(patch)) {
    if (value !== undefined) data[column] = value;
  }
  return data as Partial<Writable<M>>;
}

/** Facts worth carrying on a write event: the state, and how it moved. */
function statusMetadata(
  status: string,
  before: { status: string } | null,
  created: Record<string, unknown>
): Record<string, unknown> {
  if (before === null) return { status, ...created };
  return before.status === status ? {} : { statusFrom: before.status, statusTo: status };
}

/* ------------------------------------------------------------------ coverage */

export interface CoverageListQuery extends BaseQuery {
  patientId?: string;
  payerId?: string;
  rank?: CoverageRank;
  status?: CoverageStatus;
  sort: 'rank' | 'effectiveFrom' | 'createdAt';
}

export type CoveragePatchInput = {
  rank?: CoverageRank;
  status?: CoverageStatus;
  memberId?: string;
  groupNumber?: string;
  planName?: string;
  subscriberRelationshipCode?: string;
  subscriberGivenName?: string;
  subscriberFamilyName?: string;
  subscriberBirthDate?: Date;
  effectiveFrom?: Date;
  effectiveTo?: Date;
  copayCents?: number;
  deductibleCents?: number;
  acceptAssignment?: boolean;
};

export const coverageSpec: CollectionSpec<
  'Coverage',
  CoverageInput,
  CoveragePatchInput,
  CoverageListQuery
> = {
  model: 'Coverage',
  targetType: 'Coverage',
  action: 'coverage',
  patientColumn: 'patientId',
  compartment: { column: 'patientId' },

  newRow(input: CoverageInput): Writable<'Coverage'> {
    return {
      patientId: input.patientId,
      payerId: input.payerId,
      rank: input.rank ?? COVERAGE_DEFAULTS.rank,
      status: input.status ?? COVERAGE_DEFAULTS.status,
      memberId: input.memberId,
      groupNumber: input.groupNumber ?? null,
      planName: input.planName ?? null,
      subscriberRelationshipCode:
        input.subscriberRelationshipCode ?? COVERAGE_DEFAULTS.subscriberRelationshipCode,
      subscriberGivenName: input.subscriberGivenName ?? null,
      subscriberFamilyName: input.subscriberFamilyName ?? null,
      subscriberBirthDate: input.subscriberBirthDate ?? null,
      effectiveFrom: input.effectiveFrom ?? null,
      effectiveTo: input.effectiveTo ?? null,
      copayCents: input.copayCents ?? null,
      deductibleCents: input.deductibleCents ?? null,
      acceptAssignment: input.acceptAssignment ?? COVERAGE_DEFAULTS.acceptAssignment,
    };
  },

  patchData(patch: CoveragePatchInput): Partial<Writable<'Coverage'>> {
    return mentionedColumns<'Coverage'>(patch);
  },

  matches(row: ScopedRow<'Coverage'>, query: CoverageListQuery): boolean {
    if (query.patientId !== undefined && row.patientId !== query.patientId) return false;
    if (query.payerId !== undefined && row.payerId !== query.payerId) return false;
    if (query.rank !== undefined && row.rank !== query.rank) return false;
    return query.status === undefined || row.status === query.status;
  },

  where(query: CoverageListQuery) {
    return {
      ...(query.patientId === undefined ? {} : { patientId: query.patientId }),
      ...(query.payerId === undefined ? {} : { payerId: query.payerId }),
      ...(query.rank === undefined ? {} : { rank: query.rank }),
      ...(query.status === undefined ? {} : { status: query.status }),
    };
  },

  sortValue(row: ScopedRow<'Coverage'>, sort: CoverageListQuery['sort']): number | string {
    if (sort === 'effectiveFrom') return comparable(row.effectiveFrom);
    if (sort === 'createdAt') return row.createdAt.getTime();
    return row.rank;
  },

  orderBy(query: CoverageListQuery) {
    const { order } = query;
    if (query.sort === 'effectiveFrom') return [{ effectiveFrom: order }, { id: 'asc' as const }];
    if (query.sort === 'createdAt') return [{ createdAt: order }, { id: 'asc' as const }];
    return [{ rank: order }, { id: 'asc' as const }];
  },

  writeMetadata(
    row: ScopedRow<'Coverage'>,
    before: ScopedRow<'Coverage'> | null
  ): Record<string, unknown> {
    return statusMetadata(row.status, before, { rank: row.rank });
  },
};

/* ------------------------------------------------------------------- charges */

export interface ChargeItemListQuery extends BaseQuery {
  patientId?: string;
  encounterId?: string;
  facilityId?: string;
  status?: ChargeItemStatus;
  /** Inclusive lower bound on `serviceDate`. */
  from?: Date;
  /** Exclusive upper bound on `serviceDate`. */
  to?: Date;
  sort: 'serviceDate' | 'totalPriceCents' | 'createdAt';
}

export type ChargeItemPatchInput = {
  code?: string;
  codeSystem?: string;
  display?: string;
  modifiers?: string[];
  units?: number;
  unitPriceCents?: number;
  totalPriceCents?: number;
  diagnosisPointers?: number[];
  renderingProviderId?: string;
  supervisingProviderId?: string;
  placeOfServiceCode?: string;
  serviceDate?: Date;
  status?: ChargeItemStatus;
  voidReason?: string;
  voidedById?: string;
};

export const chargeItemSpec: CollectionSpec<
  'ChargeItem',
  ChargeItemInput,
  ChargeItemPatchInput,
  ChargeItemListQuery
> = {
  model: 'ChargeItem',
  targetType: 'ChargeItem',
  action: 'charge',
  patientColumn: 'patientId',
  facilityColumn: 'facilityId',
  encounterColumn: 'encounterId',
  compartment: { column: 'patientId' },

  newRow(input: ChargeItemInput): Writable<'ChargeItem'> {
    return {
      facilityId: input.facilityId,
      encounterId: input.encounterId,
      patientId: input.patientId,
      code: input.code,
      codeSystem: input.codeSystem ?? CHARGE_ITEM_DEFAULTS.codeSystem,
      display: input.display,
      modifiers: [...(input.modifiers ?? [])],
      units: input.units ?? CHARGE_ITEM_DEFAULTS.units,
      unitPriceCents: input.unitPriceCents,
      totalPriceCents: input.totalPriceCents,
      diagnosisPointers: [...(input.diagnosisPointers ?? [])],
      renderingProviderId: input.renderingProviderId,
      supervisingProviderId: input.supervisingProviderId ?? null,
      placeOfServiceCode: input.placeOfServiceCode ?? null,
      serviceDate: input.serviceDate,
      status: input.status ?? CHARGE_ITEM_DEFAULTS.status,
      voidReason: input.voidReason ?? null,
      // Who voided it is stamped from the acting principal by the void route,
      // never taken from a request body.
      voidedById: null,
    };
  },

  patchData(patch: ChargeItemPatchInput): Partial<Writable<'ChargeItem'>> {
    return mentionedColumns<'ChargeItem'>(patch);
  },

  matches(row: ScopedRow<'ChargeItem'>, query: ChargeItemListQuery): boolean {
    if (query.patientId !== undefined && row.patientId !== query.patientId) return false;
    if (query.encounterId !== undefined && row.encounterId !== query.encounterId) return false;
    if (query.facilityId !== undefined && row.facilityId !== query.facilityId) return false;
    if (query.status !== undefined && row.status !== query.status) return false;
    return inWindow(row.serviceDate, query.from, query.to);
  },

  where(query: ChargeItemListQuery) {
    const serviceDate = windowFilter(query.from, query.to);
    return {
      ...(query.patientId === undefined ? {} : { patientId: query.patientId }),
      ...(query.encounterId === undefined ? {} : { encounterId: query.encounterId }),
      ...(query.facilityId === undefined ? {} : { facilityId: query.facilityId }),
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(serviceDate === undefined ? {} : { serviceDate }),
    };
  },

  sortValue(row: ScopedRow<'ChargeItem'>, sort: ChargeItemListQuery['sort']): number {
    if (sort === 'totalPriceCents') return row.totalPriceCents;
    if (sort === 'createdAt') return row.createdAt.getTime();
    return row.serviceDate.getTime();
  },

  orderBy(query: ChargeItemListQuery) {
    const { order } = query;
    if (query.sort === 'totalPriceCents')
      return [{ totalPriceCents: order }, { id: 'asc' as const }];
    if (query.sort === 'createdAt') return [{ createdAt: order }, { id: 'asc' as const }];
    return [{ serviceDate: order }, { id: 'asc' as const }];
  },

  writeMetadata(
    row: ScopedRow<'ChargeItem'>,
    before: ScopedRow<'ChargeItem'> | null
  ): Record<string, unknown> {
    return statusMetadata(row.status, before, {
      code: row.code,
      totalPriceCents: row.totalPriceCents,
    });
  },
};

/* -------------------------------------------------------------------- claims */

export interface ClaimListQuery extends BaseQuery {
  patientId?: string;
  payerId?: string;
  encounterId?: string;
  status?: ClaimStatus;
  /** Which instant the window applies to. A claim has two that matter. */
  window: 'createdAt' | 'submittedAt';
  from?: Date;
  to?: Date;
  sort: 'createdAt' | 'submittedAt' | 'totalChargedCents';
}

export type ClaimPatchInput = {
  coverageId?: string;
  payerId?: string;
  frequency?: ClaimFrequency;
  diagnosisCodes?: string[];
  totalChargedCents?: number;
  totalPaidCents?: number;
  totalAdjustedCents?: number;
  patientResponsibilityCents?: number;
  controlNumbers?: JsonColumnValue;
  snapshot?: JsonColumnValue;
  statusReason?: string;
  /** Set by the transition routes only; the amend route cannot reach it. */
  status?: ClaimStatus;
  submittedAt?: Date;
  acknowledgedAt?: Date;
  adjudicatedAt?: Date;
};

/**
 * What the claim was charged for, in cents.
 *
 * A claim whose lines arrive in a second request is a claim whose total lies
 * for as long as the gap lasts, so the total is derived from the lines the
 * create carries unless the caller states one explicitly.
 */
function claimChargedTotal(input: ClaimCreateInput): number {
  return (
    input.totalChargedCents ?? input.lines.reduce((total, line) => total + line.chargedCents, 0)
  );
}

/**
 * The claim list windows on exactly one timestamp: `submittedAt` when the
 * caller asks for it, `createdAt` otherwise. Kept as a named function rather
 * than an inline ternary chain, because "no window at all" and "which column"
 * are two separate decisions and reading them as one nested expression is how
 * the wrong column gets filtered.
 */
function claimWindow(query: ClaimListQuery) {
  const stamp = windowFilter(query.from, query.to);
  if (stamp === undefined) return {};
  if (query.window === 'submittedAt') return { submittedAt: stamp };
  return { createdAt: stamp };
}

export const claimSpec: CollectionSpec<'Claim', ClaimCreateInput, ClaimPatchInput, ClaimListQuery> =
  {
    model: 'Claim',
    targetType: 'Claim',
    action: 'claim',
    patientColumn: 'patientId',
    encounterColumn: 'encounterId',
    compartment: { column: 'patientId' },

    newRow(input: ClaimCreateInput): Writable<'Claim'> {
      return {
        patientId: input.patientId,
        encounterId: input.encounterId,
        coverageId: input.coverageId,
        payerId: input.payerId,
        status: input.status ?? CLAIM_DEFAULTS.status,
        frequency: input.frequency ?? CLAIM_DEFAULTS.frequency,
        diagnosisCodes: [...input.diagnosisCodes],
        totalChargedCents: claimChargedTotal(input),
        totalPaidCents: CLAIM_DEFAULTS.totalPaidCents,
        totalAdjustedCents: CLAIM_DEFAULTS.totalAdjustedCents,
        patientResponsibilityCents: CLAIM_DEFAULTS.patientResponsibilityCents,
        secondaryOfId: input.secondaryOfId ?? null,
        priorClaimId: input.priorClaimId ?? null,
        controlNumbers: jsonColumn(input.controlNumbers ?? {}),
        snapshot: jsonColumn(input.snapshot ?? {}),
        statusReason: null,
        // The lifecycle stamps belong to the transitions that mean them, so a
        // claim created in a later status still has to move through submit to
        // acquire a submission time it can be held to.
        submittedAt: null,
        acknowledgedAt: null,
        adjudicatedAt: null,
      };
    },

    childRows(
      input: ClaimCreateInput,
      parent: ScopedRow<'Claim'>,
      context: RowContext
    ): ChildBatch[] {
      return [
        childBatch(
          'ClaimLine',
          input.lines.map((line) => ({
            id: context.nextId(),
            ...claimLineColumns({ ...line, claimId: parent.id }),
          }))
        ),
      ];
    },

    patchData(patch: ClaimPatchInput): Partial<Writable<'Claim'>> {
      return mentionedColumns<'Claim'>(patch);
    },

    matches(row: ScopedRow<'Claim'>, query: ClaimListQuery): boolean {
      if (query.patientId !== undefined && row.patientId !== query.patientId) return false;
      if (query.payerId !== undefined && row.payerId !== query.payerId) return false;
      if (query.encounterId !== undefined && row.encounterId !== query.encounterId) return false;
      if (query.status !== undefined && row.status !== query.status) return false;
      const stamp = query.window === 'submittedAt' ? row.submittedAt : row.createdAt;
      return inWindow(stamp, query.from, query.to);
    },

    where(query: ClaimListQuery) {
      const windowed = claimWindow(query);
      return {
        ...(query.patientId === undefined ? {} : { patientId: query.patientId }),
        ...(query.payerId === undefined ? {} : { payerId: query.payerId }),
        ...(query.encounterId === undefined ? {} : { encounterId: query.encounterId }),
        ...(query.status === undefined ? {} : { status: query.status }),
        ...windowed,
      };
    },

    sortValue(row: ScopedRow<'Claim'>, sort: ClaimListQuery['sort']): number | string {
      if (sort === 'submittedAt') return comparable(row.submittedAt);
      if (sort === 'totalChargedCents') return row.totalChargedCents;
      return row.createdAt.getTime();
    },

    orderBy(query: ClaimListQuery) {
      const { order } = query;
      if (query.sort === 'submittedAt') return [{ submittedAt: order }, { id: 'asc' as const }];
      if (query.sort === 'totalChargedCents') {
        return [{ totalChargedCents: order }, { id: 'asc' as const }];
      }
      return [{ createdAt: order }, { id: 'asc' as const }];
    },

    writeMetadata(
      row: ScopedRow<'Claim'>,
      before: ScopedRow<'Claim'> | null
    ): Record<string, unknown> {
      return statusMetadata(row.status, before, {
        payerId: row.payerId,
        totalChargedCents: row.totalChargedCents,
      });
    },
  };

/* --------------------------------------------------------------- claim lines */

export interface ClaimLineListQuery extends BaseQuery {
  /**
   * Every line for a set of claims, in one query.
   *
   * The FHIR boundary projects a page of Claims with their lines, and asking
   * per claim is one round trip per row - fine against three fixtures, and
   * quietly quadratic on a payer's page of fifty. `claimId` stays for the
   * single-claim routes, which read better with it.
   */
  claimIds?: readonly string[];

  claimId?: string;
  chargeItemId?: string;
  sort: 'sequence' | 'chargedCents' | 'createdAt';
}

export type ClaimLineCreateInput = ClaimLineInput & { claimId: string };

export type ClaimLinePatchInput = {
  allowedCents?: number;
  paidCents?: number;
  adjustedCents?: number;
  statusReason?: string;
};

/** Shared by the line's own spec and by the claim that writes lines with it. */
function claimLineColumns(input: ClaimLineCreateInput): Writable<'ClaimLine'> {
  return {
    claimId: input.claimId,
    chargeItemId: input.chargeItemId,
    sequence: input.sequence,
    code: input.code,
    codeSystem: input.codeSystem ?? CLAIM_LINE_DEFAULTS.codeSystem,
    modifiers: [...(input.modifiers ?? [])],
    units: input.units ?? CLAIM_LINE_DEFAULTS.units,
    chargedCents: input.chargedCents,
    allowedCents: input.allowedCents ?? null,
    paidCents: input.paidCents ?? CLAIM_LINE_DEFAULTS.paidCents,
    adjustedCents: input.adjustedCents ?? CLAIM_LINE_DEFAULTS.adjustedCents,
    diagnosisPointers: [...(input.diagnosisPointers ?? [])],
    serviceDateFrom: input.serviceDateFrom,
    serviceDateTo: input.serviceDateTo ?? null,
    statusReason: input.statusReason ?? null,
  };
}

export const claimLineSpec: CollectionSpec<
  'ClaimLine',
  ClaimLineCreateInput,
  ClaimLinePatchInput,
  ClaimLineListQuery
> = {
  model: 'ClaimLine',
  targetType: 'ClaimLine',
  action: 'claimLine',
  // A line reaches a chart only through its claim, and this layer performs no
  // join, so a compartment-restricted principal is refused the table wholesale
  // rather than served one nobody narrowed.
  compartment: 'closed',

  newRow(input: ClaimLineCreateInput): Writable<'ClaimLine'> {
    return claimLineColumns(input);
  },

  patchData(patch: ClaimLinePatchInput): Partial<Writable<'ClaimLine'>> {
    return mentionedColumns<'ClaimLine'>(patch);
  },

  matches(row: ScopedRow<'ClaimLine'>, query: ClaimLineListQuery): boolean {
    if (query.claimId !== undefined && row.claimId !== query.claimId) return false;
    // An empty list means "no claims", not "every claim". The distinction
    // matters because a page with no rows would otherwise widen to the whole
    // table, which is the opposite of what the caller asked for.
    if (query.claimIds !== undefined && !query.claimIds.includes(row.claimId)) return false;
    return query.chargeItemId === undefined || row.chargeItemId === query.chargeItemId;
  },

  where(query: ClaimLineListQuery) {
    return {
      ...(query.claimId === undefined ? {} : { claimId: query.claimId }),
      ...(query.claimIds === undefined ? {} : { claimId: { in: [...query.claimIds] } }),
      ...(query.chargeItemId === undefined ? {} : { chargeItemId: query.chargeItemId }),
    };
  },

  sortValue(row: ScopedRow<'ClaimLine'>, sort: ClaimLineListQuery['sort']): number {
    if (sort === 'chargedCents') return row.chargedCents;
    if (sort === 'createdAt') return row.createdAt.getTime();
    return row.sequence;
  },

  orderBy(query: ClaimLineListQuery) {
    const { order } = query;
    if (query.sort === 'chargedCents') return [{ chargedCents: order }, { id: 'asc' as const }];
    if (query.sort === 'createdAt') return [{ createdAt: order }, { id: 'asc' as const }];
    return [{ sequence: order }, { id: 'asc' as const }];
  },

  uniqueBy: {
    where: (input: ClaimLineCreateInput) => ({
      claimId: input.claimId,
      sequence: input.sequence,
    }),
    matches: (row: ScopedRow<'ClaimLine'>, input: ClaimLineCreateInput) =>
      row.claimId === input.claimId && row.sequence === input.sequence,
    message: (input: ClaimLineCreateInput) =>
      `Line ${input.sequence} already exists on that claim.`,
  },
};

/* ------------------------------------------------------- claim status history */

export interface ClaimStatusHistoryListQuery extends BaseQuery {
  claimId?: string;
  status?: ClaimStatus;
  sort: 'occurredAt' | 'createdAt';
}

export type ClaimStatusHistoryCreateInput = ClaimStatusChangeInput & { byUserId?: string };

/** History is append-only, so nothing is patchable. */
export type ClaimStatusHistoryPatchInput = Record<string, never>;

export const claimStatusHistorySpec: CollectionSpec<
  'ClaimStatusHistory',
  ClaimStatusHistoryCreateInput,
  ClaimStatusHistoryPatchInput,
  ClaimStatusHistoryListQuery
> = {
  model: 'ClaimStatusHistory',
  targetType: 'ClaimStatusHistory',
  action: 'claimStatus',
  // Same reasoning as ClaimLine: the chart is two joins away and this layer
  // performs neither, so the fail-closed reading is the right one.
  compartment: 'closed',

  newRow(
    input: ClaimStatusHistoryCreateInput,
    context: RowContext
  ): Writable<'ClaimStatusHistory'> {
    return {
      claimId: input.claimId,
      status: input.status,
      occurredAt: input.occurredAt ?? context.now,
      source: input.source,
      detail: jsonColumn(input.detail),
      byUserId: input.byUserId ?? null,
    };
  },

  patchData(): Partial<Writable<'ClaimStatusHistory'>> {
    // A transition that was recorded happened, and a record of it that can be
    // edited is not a record of anything.
    return {};
  },

  matches(row: ScopedRow<'ClaimStatusHistory'>, query: ClaimStatusHistoryListQuery): boolean {
    if (query.claimId !== undefined && row.claimId !== query.claimId) return false;
    return query.status === undefined || row.status === query.status;
  },

  where(query: ClaimStatusHistoryListQuery) {
    return {
      ...(query.claimId === undefined ? {} : { claimId: query.claimId }),
      ...(query.status === undefined ? {} : { status: query.status }),
    };
  },

  sortValue(
    row: ScopedRow<'ClaimStatusHistory'>,
    sort: ClaimStatusHistoryListQuery['sort']
  ): number {
    return sort === 'createdAt' ? row.createdAt.getTime() : row.occurredAt.getTime();
  },

  orderBy(query: ClaimStatusHistoryListQuery) {
    const { order } = query;
    if (query.sort === 'createdAt') return [{ createdAt: order }, { id: 'asc' as const }];
    return [{ occurredAt: order }, { id: 'asc' as const }];
  },

  writeMetadata(row: ScopedRow<'ClaimStatusHistory'>): Record<string, unknown> {
    return { claimId: row.claimId, status: row.status, source: row.source };
  },
};

/* ------------------------------------------------------------------ payments */

export interface PaymentListQuery extends BaseQuery {
  patientId?: string;
  payerId?: string;
  remittanceId?: string;
  status?: PaymentStatus;
  source?: PaymentSource;
  /** Inclusive lower bound on `receivedAt`. */
  from?: Date;
  /** Exclusive upper bound on `receivedAt`. */
  to?: Date;
  sort: 'receivedAt' | 'amountCents' | 'createdAt';
}

/**
 * The wire contract plus the one column only the server may set.
 *
 * `postedById` is deliberately absent from `paymentCreateInput`: who posted a
 * payment is the acting principal, and a body that could name someone else
 * would make the ledger's attribution a client-supplied string.
 */
export type PaymentCreateData = PaymentCreateInput & { postedById?: string };

export type PaymentPatchInput = {
  payerId?: string;
  remittanceId?: string;
  source?: PaymentSource;
  method?: PaymentMethod;
  status?: PaymentStatus;
  amountCents?: number;
  currency?: string;
  reference?: string;
  adapterRef?: string;
  receivedAt?: Date;
  postedAt?: Date;
  postedById?: string;
  note?: string;
};

export const paymentSpec: CollectionSpec<
  'Payment',
  PaymentCreateData,
  PaymentPatchInput,
  PaymentListQuery
> = {
  model: 'Payment',
  targetType: 'Payment',
  action: 'payment',
  patientColumn: 'patientId',
  // `patientId` is nullable here, because a payer's cheque is money that
  // arrived before anyone decided whose balance it clears. A portal token still
  // narrows on it, which means such a payment is invisible to the portal until
  // it is allocated, and that is the correct answer.
  compartment: { column: 'patientId' },

  newRow(input: PaymentCreateData, context: RowContext): Writable<'Payment'> {
    const status = input.status ?? PAYMENT_DEFAULTS.status;
    // A payment that arrives already posted was posted at a moment, and the
    // remittance-posting route is the only caller that creates one that way.
    const posted = status === 'POSTED';
    return {
      patientId: input.patientId ?? null,
      payerId: input.payerId ?? null,
      remittanceId: input.remittanceId ?? null,
      source: input.source,
      method: input.method,
      status,
      amountCents: input.amountCents,
      currency: input.currency ?? PAYMENT_DEFAULTS.currency,
      reference: input.reference ?? null,
      adapterRef: input.adapterRef ?? null,
      receivedAt: input.receivedAt ?? context.now,
      postedAt: posted ? context.now : null,
      postedById: posted ? (input.postedById ?? null) : null,
      note: input.note ?? null,
    };
  },

  childRows(
    input: PaymentCreateData,
    parent: ScopedRow<'Payment'>,
    context: RowContext
  ): ChildBatch[] {
    return [
      childBatch(
        'PaymentAllocation',
        (input.allocations ?? []).map((allocation) => ({
          id: context.nextId(),
          ...paymentAllocationColumns({ ...allocation, paymentId: parent.id }, context),
        }))
      ),
    ];
  },

  patchData(patch: PaymentPatchInput): Partial<Writable<'Payment'>> {
    return mentionedColumns<'Payment'>(patch);
  },

  matches(row: ScopedRow<'Payment'>, query: PaymentListQuery): boolean {
    if (query.patientId !== undefined && row.patientId !== query.patientId) return false;
    if (query.payerId !== undefined && row.payerId !== query.payerId) return false;
    if (query.remittanceId !== undefined && row.remittanceId !== query.remittanceId) return false;
    if (query.status !== undefined && row.status !== query.status) return false;
    if (query.source !== undefined && row.source !== query.source) return false;
    return inWindow(row.receivedAt, query.from, query.to);
  },

  where(query: PaymentListQuery) {
    const receivedAt = windowFilter(query.from, query.to);
    return {
      ...(query.patientId === undefined ? {} : { patientId: query.patientId }),
      ...(query.payerId === undefined ? {} : { payerId: query.payerId }),
      ...(query.remittanceId === undefined ? {} : { remittanceId: query.remittanceId }),
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.source === undefined ? {} : { source: query.source }),
      ...(receivedAt === undefined ? {} : { receivedAt }),
    };
  },

  sortValue(row: ScopedRow<'Payment'>, sort: PaymentListQuery['sort']): number {
    if (sort === 'amountCents') return row.amountCents;
    if (sort === 'createdAt') return row.createdAt.getTime();
    return row.receivedAt.getTime();
  },

  orderBy(query: PaymentListQuery) {
    const { order } = query;
    if (query.sort === 'amountCents') return [{ amountCents: order }, { id: 'asc' as const }];
    if (query.sort === 'createdAt') return [{ createdAt: order }, { id: 'asc' as const }];
    return [{ receivedAt: order }, { id: 'asc' as const }];
  },

  writeMetadata(
    row: ScopedRow<'Payment'>,
    before: ScopedRow<'Payment'> | null
  ): Record<string, unknown> {
    return statusMetadata(row.status, before, {
      amountCents: row.amountCents,
      source: row.source,
    });
  },
};

/* -------------------------------------------------------- payment allocations */

export interface PaymentAllocationListQuery extends BaseQuery {
  paymentId?: string;
  patientId?: string;
  claimId?: string;
  sort: 'appliedAt' | 'amountCents' | 'createdAt';
}

export type PaymentAllocationCreateInput = PaymentAllocationInput & { paymentId: string };

/** Ledger entries do not change; a reversal is a new, negative allocation. */
export type PaymentAllocationPatchInput = { note?: string };

function paymentAllocationColumns(
  input: PaymentAllocationCreateInput,
  context: RowContext
): Writable<'PaymentAllocation'> {
  return {
    paymentId: input.paymentId,
    patientId: input.patientId,
    claimId: input.claimId ?? null,
    claimLineId: input.claimLineId ?? null,
    chargeItemId: input.chargeItemId ?? null,
    amountCents: input.amountCents,
    adjustmentGroupCode: input.adjustmentGroupCode ?? null,
    adjustmentReasonCode: input.adjustmentReasonCode ?? null,
    appliedAt: input.appliedAt ?? context.now,
    note: input.note ?? null,
  };
}

export const paymentAllocationSpec: CollectionSpec<
  'PaymentAllocation',
  PaymentAllocationCreateInput,
  PaymentAllocationPatchInput,
  PaymentAllocationListQuery
> = {
  model: 'PaymentAllocation',
  targetType: 'PaymentAllocation',
  action: 'paymentAllocation',
  patientColumn: 'patientId',
  compartment: { column: 'patientId' },

  newRow(input: PaymentAllocationCreateInput, context: RowContext): Writable<'PaymentAllocation'> {
    return paymentAllocationColumns(input, context);
  },

  patchData(patch: PaymentAllocationPatchInput): Partial<Writable<'PaymentAllocation'>> {
    return mentionedColumns<'PaymentAllocation'>(patch);
  },

  matches(row: ScopedRow<'PaymentAllocation'>, query: PaymentAllocationListQuery): boolean {
    if (query.paymentId !== undefined && row.paymentId !== query.paymentId) return false;
    if (query.patientId !== undefined && row.patientId !== query.patientId) return false;
    return query.claimId === undefined || row.claimId === query.claimId;
  },

  where(query: PaymentAllocationListQuery) {
    return {
      ...(query.paymentId === undefined ? {} : { paymentId: query.paymentId }),
      ...(query.patientId === undefined ? {} : { patientId: query.patientId }),
      ...(query.claimId === undefined ? {} : { claimId: query.claimId }),
    };
  },

  sortValue(row: ScopedRow<'PaymentAllocation'>, sort: PaymentAllocationListQuery['sort']): number {
    if (sort === 'amountCents') return row.amountCents;
    if (sort === 'createdAt') return row.createdAt.getTime();
    return row.appliedAt.getTime();
  },

  orderBy(query: PaymentAllocationListQuery) {
    const { order } = query;
    if (query.sort === 'amountCents') return [{ amountCents: order }, { id: 'asc' as const }];
    if (query.sort === 'createdAt') return [{ createdAt: order }, { id: 'asc' as const }];
    return [{ appliedAt: order }, { id: 'asc' as const }];
  },

  writeMetadata(row: ScopedRow<'PaymentAllocation'>): Record<string, unknown> {
    return { paymentId: row.paymentId, amountCents: row.amountCents };
  },
};

/* --------------------------------------------------------------- remittances */

export interface RemittanceListQuery extends BaseQuery {
  payerId?: string;
  status?: RemittanceStatus;
  /** Inclusive lower bound on `receivedAt`. */
  from?: Date;
  /** Exclusive upper bound on `receivedAt`. */
  to?: Date;
  sort: 'receivedAt' | 'totalPaidCents' | 'createdAt';
}

export type RemittancePatchInput = {
  status?: RemittanceStatus;
  checkOrEftNumber?: string;
  totalPaidCents?: number;
  receivedAt?: Date;
  paidAt?: Date;
  rawStorageKey?: string;
  parsed?: JsonColumnValue;
  exceptionCount?: number;
  postedAt?: Date;
  postedById?: string;
};

/**
 * What the advice says it paid, in cents.
 *
 * Same reasoning as a claim's charged total: an advice that carries its service
 * lines and a zero total is an advice that disagrees with itself, and the
 * posting step reads this number.
 */
function remittancePaidTotal(input: RemittanceInput): number {
  if (input.totalPaidCents !== undefined) return input.totalPaidCents;
  return (input.lines ?? []).reduce((total, line) => total + (line.paidCents ?? 0), 0);
}

export const remittanceSpec: CollectionSpec<
  'Remittance',
  RemittanceInput,
  RemittancePatchInput,
  RemittanceListQuery
> = {
  model: 'Remittance',
  targetType: 'Remittance',
  action: 'remittance',
  // An advice is the practice's document, not a chart entry: it names a payer
  // and a cheque, and it reaches a patient only through the claims its lines
  // match. A portal user has no business reading it, so the fail-closed
  // reading is also the correct one.
  compartment: 'closed',

  newRow(input: RemittanceInput, context: RowContext): Writable<'Remittance'> {
    return {
      payerId: input.payerId,
      status: input.status ?? REMITTANCE_DEFAULTS.status,
      checkOrEftNumber: input.checkOrEftNumber ?? null,
      totalPaidCents: remittancePaidTotal(input),
      receivedAt: input.receivedAt ?? context.now,
      paidAt: input.paidAt ?? null,
      rawStorageKey: input.rawStorageKey ?? null,
      parsed: jsonColumn(input.parsed),
      // The exception count is what parsing concluded, so it stays at the
      // schema default until the parse step has actually looked at the lines.
      exceptionCount: REMITTANCE_DEFAULTS.exceptionCount,
      postedAt: null,
      postedById: null,
    };
  },

  childRows(
    input: RemittanceInput,
    parent: ScopedRow<'Remittance'>,
    context: RowContext
  ): ChildBatch[] {
    return [
      childBatch(
        'RemittanceLine',
        (input.lines ?? []).map((line) => ({
          id: context.nextId(),
          ...remittanceLineColumns({ ...line, remittanceId: parent.id }),
        }))
      ),
    ];
  },

  patchData(patch: RemittancePatchInput): Partial<Writable<'Remittance'>> {
    return mentionedColumns<'Remittance'>(patch);
  },

  matches(row: ScopedRow<'Remittance'>, query: RemittanceListQuery): boolean {
    if (query.payerId !== undefined && row.payerId !== query.payerId) return false;
    if (query.status !== undefined && row.status !== query.status) return false;
    return inWindow(row.receivedAt, query.from, query.to);
  },

  where(query: RemittanceListQuery) {
    const receivedAt = windowFilter(query.from, query.to);
    return {
      ...(query.payerId === undefined ? {} : { payerId: query.payerId }),
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(receivedAt === undefined ? {} : { receivedAt }),
    };
  },

  sortValue(row: ScopedRow<'Remittance'>, sort: RemittanceListQuery['sort']): number {
    if (sort === 'totalPaidCents') return row.totalPaidCents;
    if (sort === 'createdAt') return row.createdAt.getTime();
    return row.receivedAt.getTime();
  },

  orderBy(query: RemittanceListQuery) {
    const { order } = query;
    if (query.sort === 'totalPaidCents') return [{ totalPaidCents: order }, { id: 'asc' as const }];
    if (query.sort === 'createdAt') return [{ createdAt: order }, { id: 'asc' as const }];
    return [{ receivedAt: order }, { id: 'asc' as const }];
  },

  writeMetadata(
    row: ScopedRow<'Remittance'>,
    before: ScopedRow<'Remittance'> | null
  ): Record<string, unknown> {
    return statusMetadata(row.status, before, {
      payerId: row.payerId,
      totalPaidCents: row.totalPaidCents,
    });
  },
};

/* ---------------------------------------------------------- remittance lines */

export interface RemittanceLineListQuery extends BaseQuery {
  remittanceId?: string;
  claimId?: string;
  matched?: boolean;
  sort: 'sequence' | 'paidCents' | 'createdAt';
}

export type RemittanceLineCreateInput = RemittanceLineInput & { remittanceId: string };

/** Matching an exception line to a claim is the work parsing leaves behind. */
export type RemittanceLinePatchInput = {
  claimId?: string;
  claimLineId?: string;
  matched?: boolean;
};

function remittanceLineColumns(input: RemittanceLineCreateInput): Writable<'RemittanceLine'> {
  return {
    remittanceId: input.remittanceId,
    claimId: input.claimId ?? null,
    claimLineId: input.claimLineId ?? null,
    sequence: input.sequence,
    payerControlNumber: input.payerControlNumber ?? null,
    code: input.code ?? null,
    chargedCents: input.chargedCents ?? REMITTANCE_LINE_DEFAULTS.chargedCents,
    allowedCents: input.allowedCents ?? REMITTANCE_LINE_DEFAULTS.allowedCents,
    paidCents: input.paidCents ?? REMITTANCE_LINE_DEFAULTS.paidCents,
    patientResponsibilityCents:
      input.patientResponsibilityCents ?? REMITTANCE_LINE_DEFAULTS.patientResponsibilityCents,
    adjustmentGroupCode: input.adjustmentGroupCode ?? null,
    adjustmentReasonCode: input.adjustmentReasonCode ?? null,
    remarkCodes: [...(input.remarkCodes ?? [])],
    serviceDateFrom: input.serviceDateFrom ?? null,
    matched: input.matched ?? REMITTANCE_LINE_DEFAULTS.matched,
  };
}

export const remittanceLineSpec: CollectionSpec<
  'RemittanceLine',
  RemittanceLineCreateInput,
  RemittanceLinePatchInput,
  RemittanceLineListQuery
> = {
  model: 'RemittanceLine',
  targetType: 'RemittanceLine',
  action: 'remittanceLine',
  // Closed for the same reason its parent is, and more sharply: an unmatched
  // line names no claim at all, so there is nothing to narrow it by.
  compartment: 'closed',

  newRow(input: RemittanceLineCreateInput): Writable<'RemittanceLine'> {
    return remittanceLineColumns(input);
  },

  patchData(patch: RemittanceLinePatchInput): Partial<Writable<'RemittanceLine'>> {
    return mentionedColumns<'RemittanceLine'>(patch);
  },

  matches(row: ScopedRow<'RemittanceLine'>, query: RemittanceLineListQuery): boolean {
    if (query.remittanceId !== undefined && row.remittanceId !== query.remittanceId) return false;
    if (query.claimId !== undefined && row.claimId !== query.claimId) return false;
    return query.matched === undefined || row.matched === query.matched;
  },

  where(query: RemittanceLineListQuery) {
    return {
      ...(query.remittanceId === undefined ? {} : { remittanceId: query.remittanceId }),
      ...(query.claimId === undefined ? {} : { claimId: query.claimId }),
      ...(query.matched === undefined ? {} : { matched: query.matched }),
    };
  },

  sortValue(row: ScopedRow<'RemittanceLine'>, sort: RemittanceLineListQuery['sort']): number {
    if (sort === 'paidCents') return row.paidCents;
    if (sort === 'createdAt') return row.createdAt.getTime();
    return row.sequence;
  },

  orderBy(query: RemittanceLineListQuery) {
    const { order } = query;
    if (query.sort === 'paidCents') return [{ paidCents: order }, { id: 'asc' as const }];
    if (query.sort === 'createdAt') return [{ createdAt: order }, { id: 'asc' as const }];
    return [{ sequence: order }, { id: 'asc' as const }];
  },

  uniqueBy: {
    where: (input: RemittanceLineCreateInput) => ({
      remittanceId: input.remittanceId,
      sequence: input.sequence,
    }),
    matches: (row: ScopedRow<'RemittanceLine'>, input: RemittanceLineCreateInput) =>
      row.remittanceId === input.remittanceId && row.sequence === input.sequence,
    message: (input: RemittanceLineCreateInput) =>
      `Line ${input.sequence} already exists on that remittance.`,
  },
};

/* ---------------------------------------------------------------- statements */

export interface StatementListQuery extends BaseQuery {
  patientId?: string;
  status?: StatementStatus;
  dunningCycle?: number;
  /** Inclusive lower bound on `generatedAt`. */
  from?: Date;
  /** Exclusive upper bound on `generatedAt`. */
  to?: Date;
  sort: 'generatedAt' | 'balanceCents' | 'createdAt';
}

export type StatementPatchInput = {
  status?: StatementStatus;
  balanceCents?: number;
  dunningCycle?: number;
  periodStart?: Date;
  periodEnd?: Date;
  generatedAt?: Date;
  deliveredVia?: StatementDelivery;
  deliveredAt?: Date;
  pdfStorageKey?: string;
  payLinkToken?: string;
  payLinkExpiresAt?: Date;
  paidAt?: Date;
  lastNoticeAt?: Date;
  holdUntil?: Date;
  holdReason?: string;
  closedReason?: string;
};

export const statementSpec: CollectionSpec<
  'Statement',
  StatementInput,
  StatementPatchInput,
  StatementListQuery
> = {
  model: 'Statement',
  targetType: 'Statement',
  action: 'statement',
  patientColumn: 'patientId',
  compartment: { column: 'patientId' },

  newRow(input: StatementInput, context: RowContext): Writable<'Statement'> {
    return {
      patientId: input.patientId,
      status: input.status ?? STATEMENT_DEFAULTS.status,
      balanceCents: input.balanceCents,
      dunningCycle: input.dunningCycle ?? STATEMENT_DEFAULTS.dunningCycle,
      periodStart: input.periodStart ?? null,
      periodEnd: input.periodEnd ?? null,
      generatedAt: input.generatedAt ?? context.now,
      deliveredVia: input.deliveredVia ?? null,
      // Delivery is what the send route records; a statement nobody has sent
      // has not been delivered, whatever channel it was authored for.
      deliveredAt: null,
      pdfStorageKey: input.pdfStorageKey ?? null,
      payLinkToken: input.payLinkToken ?? null,
      payLinkExpiresAt: input.payLinkExpiresAt ?? null,
      paidAt: null,
      // Set by the notice route, not at creation, for the same reason as
      // `deliveredAt`: a statement nobody has chased has no notice date.
      lastNoticeAt: input.lastNoticeAt ?? null,
      holdUntil: input.holdUntil ?? null,
      holdReason: input.holdReason ?? null,
      closedReason: input.closedReason ?? null,
    };
  },

  patchData(patch: StatementPatchInput): Partial<Writable<'Statement'>> {
    return mentionedColumns<'Statement'>(patch);
  },

  matches(row: ScopedRow<'Statement'>, query: StatementListQuery): boolean {
    if (query.patientId !== undefined && row.patientId !== query.patientId) return false;
    if (query.status !== undefined && row.status !== query.status) return false;
    if (query.dunningCycle !== undefined && row.dunningCycle !== query.dunningCycle) return false;
    return inWindow(row.generatedAt, query.from, query.to);
  },

  where(query: StatementListQuery) {
    const generatedAt = windowFilter(query.from, query.to);
    return {
      ...(query.patientId === undefined ? {} : { patientId: query.patientId }),
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.dunningCycle === undefined ? {} : { dunningCycle: query.dunningCycle }),
      ...(generatedAt === undefined ? {} : { generatedAt }),
    };
  },

  sortValue(row: ScopedRow<'Statement'>, sort: StatementListQuery['sort']): number {
    if (sort === 'balanceCents') return row.balanceCents;
    if (sort === 'createdAt') return row.createdAt.getTime();
    return row.generatedAt.getTime();
  },

  orderBy(query: StatementListQuery) {
    const { order } = query;
    if (query.sort === 'balanceCents') return [{ balanceCents: order }, { id: 'asc' as const }];
    if (query.sort === 'createdAt') return [{ createdAt: order }, { id: 'asc' as const }];
    return [{ generatedAt: order }, { id: 'asc' as const }];
  },

  writeMetadata(
    row: ScopedRow<'Statement'>,
    before: ScopedRow<'Statement'> | null
  ): Record<string, unknown> {
    return statusMetadata(row.status, before, {
      balanceCents: row.balanceCents,
      dunningCycle: row.dunningCycle,
      // On the audit trail because a hold and a write-off are the two decisions
      // a practice has to be able to justify afterwards, and both are answers to
      // "why was this patient not billed".
      ...(row.holdUntil === null ? {} : { holdUntil: row.holdUntil.toISOString() }),
      ...(row.closedReason === null ? {} : { closedReason: row.closedReason }),
    });
  },
};

export const financialSpecs = {
  coverages: coverageSpec,
  charges: chargeItemSpec,
  claims: claimSpec,
  claimLines: claimLineSpec,
  claimStatusHistory: claimStatusHistorySpec,
  payments: paymentSpec,
  paymentAllocations: paymentAllocationSpec,
  remittances: remittanceSpec,
  remittanceLines: remittanceLineSpec,
  statements: statementSpec,
} as const;
