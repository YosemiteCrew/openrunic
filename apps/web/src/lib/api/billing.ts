'use client';

import { queryKey, useApiQuery } from './hooks';
import type { AsyncState } from './hooks';
import {
  filterClaims,
  filterFeeSheets,
  filterPayments,
  filterRemittances,
  filterStatements,
  MOCK_CLAIMS,
  MOCK_FEE_SHEETS,
  MOCK_PAYMENTS,
  MOCK_REMITTANCES,
  MOCK_STATEMENT_ACCOUNTS,
} from './mock/billing';
import { paginate } from './pagination';
import type { ListResponse, PaginationQuery, PatientName } from './types';

/**
 * Billing and the revenue cycle.
 *
 * `apps/api` serves claims, payments, remittances, statements, charges and
 * coverage, and the transitions these screens drive are on {@link ApiClient}
 * already. What is missing is the mapping from those payloads into the view
 * types below. The fee sheet and the payer directory are the exceptions:
 * neither has a segment. So this module is the seam that lets the five billing
 * screens exist meanwhile: the same
 * {@link AsyncState} shape the rest of the data layer returns, the same
 * injectable-client convention as `HookOptions`, and fixtures that live in the
 * one mock module rather than a parallel one. When the aggregates land, the
 * types below move to `types.ts`, `createBillingClient` becomes an HTTP client,
 * and no screen changes.
 *
 * It is deliberately read-only. Writes are not faked anywhere in this data
 * layer, because a fixture that accepts writes teaches a screen to trust state
 * the server never saw; the billing screens hold their edits in their own state
 * and say so.
 *
 * Five list reads and no detail reads, also on purpose: every billing surface
 * is a worklist whose detail opens over the list it came from, so the claim
 * drawer, the ERA panel, the statement preview and the receipt all read the row
 * that is already on screen rather than fetching it twice.
 */

/**
 * The seven states a claim moves through, in lifecycle order. The order is
 * load-bearing: the workbench's filter chips, the ageing strip and the detail
 * stepper all read it, so a new state is added here and nowhere else.
 */
export const CLAIM_STATUSES = [
  'CAPTURED',
  'SCRUBBED',
  'SUBMITTED',
  'ACKNOWLEDGED',
  'PAID',
  'DENIED',
  'REBILLED',
] as const;

export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

/** Where a fee sheet is in the capture-to-claim handover. */
export const FEE_SHEET_STATUSES = ['OPEN', 'READY', 'BILLED'] as const;

export type FeeSheetStatus = (typeof FEE_SHEET_STATUSES)[number];

/** AR ageing buckets, the industry-standard four. */
export const AGEING_BUCKETS = ['CURRENT', 'DAYS_31_60', 'DAYS_61_90', 'DAYS_91_PLUS'] as const;

export type AgeingBucket = (typeof AGEING_BUCKETS)[number];

/** The dunning ladder. `NONE` means no statement has gone out yet. */
export const DUNNING_STAGES = [
  'NONE',
  'FIRST_NOTICE',
  'SECOND_NOTICE',
  'FINAL_NOTICE',
  'COLLECTIONS',
] as const;

export type DunningStage = (typeof DUNNING_STAGES)[number];

/** How money arrived. Card-on-file is distinguished from a keyed card on purpose. */
export const PAYMENT_METHODS = ['CARD_ON_FILE', 'CARD_MANUAL', 'CASH', 'CHECK'] as const;

export type PaymentMethodKind = (typeof PAYMENT_METHODS)[number];

/**
 * Just enough patient to render a billing row. Billing surfaces are lists of
 * money against people, and a workbench that had to fetch a patient per row
 * would be a workbench nobody could scroll.
 */
export interface BillingPatientRef {
  id: string;
  mrn: string;
  name: PatientName;
}

export interface PayerRef {
  id: string;
  name: string;
  /** X12 payer id. Rendered in `.or-mono`. */
  payerId: string;
}

/** An ICD-10 diagnosis available to justify a charge line. */
export interface ChargeDiagnosis {
  code: string;
  display: string;
}

/** A CPT/HCPCS code the picker can add, and the panel it is grouped under. */
export interface ProcedureCode {
  code: string;
  display: string;
  /** Fee at the sheet's price level, in major units. */
  fee: number;
  /** Admin-configured shortcut panel, or null for search-only codes. */
  panel: string | null;
}

/** One charge on the fee sheet. */
export interface ChargeLine {
  id: string;
  code: string;
  display: string;
  /** CPT modifiers, e.g. `25`, `59`. */
  modifiers: string[];
  units: number;
  /** Fee per unit at this sheet's price level, in major units. */
  unitFee: number;
  /**
   * ICD-10 codes justifying this line. Empty is the unjustified state, which is
   * shown on the line and blocks mark-ready; it is never silently tolerated.
   */
  justifiedBy: string[];
  /** Struck through and excluded from totals, retained for audit, restorable. */
  deleted: boolean;
}

/** Mirrors the fee sheet the charge-capture screen reads. */
export interface FeeSheet {
  id: string;
  encounterId: string;
  patient: BillingPatientRef;
  providerName: string;
  facilityId: string;
  /** ISO instant of the visit. */
  serviceDate: string;
  visitType: string;
  status: FeeSheetStatus;
  /** Copay owed for this visit, in major units. */
  copayDue: number;
  copayCollected: number;
  currency: string;
  /** The visit's diagnoses, in the order they were recorded. Justify sources. */
  diagnoses: ChargeDiagnosis[];
  lines: ChargeLine[];
  /** The codes the picker searches, panels included. Delivered with the sheet. */
  catalog: ProcedureCode[];
  /** Prior authorisation warning for this visit, when one applies. */
  authWarning: string | null;
}

/** A named scrub failure. Blocks submission until it is cleared. */
export interface ClaimScrubError {
  code: string;
  /** Plain-language, biller register: what is wrong and what to change. */
  message: string;
  /** Where the fix lives, so the row links into the fee sheet. */
  fixHref: string;
}

/** One transition in a claim's life. Every state change leaves one. */
export interface ClaimEvent {
  id: string;
  at: string;
  label: string;
  detail: string | null;
  actor: string;
  /** The state the claim entered, or null for a note that changed nothing. */
  status: ClaimStatus | null;
}

export interface ClaimServiceLine {
  id: string;
  code: string;
  display: string;
  modifiers: string[];
  units: number;
  billed: number;
  allowed: number | null;
  paid: number | null;
  adjustment: number | null;
  patientResponsibility: number | null;
}

/** One row of the claim workbench, and the whole claim behind it. */
export interface Claim {
  id: string;
  claimNumber: string;
  patient: BillingPatientRef;
  payer: PayerRef;
  /** Date of service, ISO instant. */
  serviceDate: string;
  submittedAt: string | null;
  status: ClaimStatus;
  /** When the claim entered its current state. Ageing is measured from here. */
  statusSince: string;
  billed: number;
  paid: number;
  patientResponsibility: number;
  currency: string;
  scrubErrors: ClaimScrubError[];
  /** Payer denial code, e.g. `CO-16`. */
  denialCode: string | null;
  /** The denial in plain language, alongside the code rather than instead of it. */
  denialReason: string | null;
  /** The claim this one replaces, for rebill lineage. */
  rebilledFromId: string | null;
  lines: ClaimServiceLine[];
  events: ClaimEvent[];
}

/** How an 835 service line landed. Exceptions are the only rows a human works. */
export const REMITTANCE_LINE_STATES = ['AUTO_POSTED', 'EXCEPTION'] as const;

export type RemittanceLineState = (typeof REMITTANCE_LINE_STATES)[number];

export interface RemittanceLine {
  id: string;
  claimId: string;
  claimNumber: string;
  patient: BillingPatientRef;
  code: string;
  display: string;
  billed: number;
  allowed: number;
  paid: number;
  adjustment: number;
  patientResponsibility: number;
  /** What the claim expected from this payer, so variance is computable. */
  expectedPaid: number;
  state: RemittanceLineState;
  /** Why a human is needed. Null on an auto-posted line. */
  exceptionReason: string | null;
  /** CARC/RARC code carried through from the 835. */
  adjustmentCode: string | null;
  /** Set when the balance cascades to a secondary payer. */
  secondaryPayerName: string | null;
}

export const REMITTANCE_STATUSES = ['POSTING', 'POSTED', 'EXCEPTIONS'] as const;

export type RemittanceStatus = (typeof REMITTANCE_STATUSES)[number];

/** One 835 remittance advice. */
export interface Remittance {
  id: string;
  /** Check or EFT trace number. Rendered in `.or-mono`. */
  reference: string;
  payer: PayerRef;
  receivedAt: string;
  paymentAmount: number;
  currency: string;
  method: 'EFT' | 'CHECK';
  status: RemittanceStatus;
  lines: RemittanceLine[];
}

/** One visit's worth of patient responsibility on a statement. */
export interface StatementLine {
  id: string;
  visitId: string;
  serviceDate: string;
  description: string;
  charges: number;
  insurancePaid: number;
  adjustments: number;
  patientResponsibility: number;
  /** Still owed after any patient payments against this visit. */
  outstanding: number;
}

export interface PaymentPlan {
  instalmentAmount: number;
  instalmentsPaid: number;
  instalmentsTotal: number;
}

/** One patient's AR position: the statements screen row and its ledger. */
export interface StatementAccount {
  id: string;
  patient: BillingPatientRef;
  balance: number;
  currency: string;
  /** Balance split by age. The four always sum to `balance`. */
  ageing: Record<AgeingBucket, number>;
  /** The oldest bucket carrying money. Drives the row's state label. */
  bucket: AgeingBucket;
  lastPaymentAt: string | null;
  lastPaymentAmount: number | null;
  statementsSent: number;
  lastStatementAt: string | null;
  dunningStage: DunningStage;
  paymentPlan: PaymentPlan | null;
  /** Mobile number for text-to-pay, or null when none is on record. */
  mobile: string | null;
  cardOnFile: boolean;
  lines: StatementLine[];
}

export interface PaymentMethodRef {
  kind: PaymentMethodKind;
  /** What the desk says out loud: "Visa ending 4242", "Cash". */
  label: string;
  last4: string | null;
  /** When the patient consented to the card being kept. Null for one-off methods. */
  consentAt: string | null;
}

/** Money from one payment applied to one visit. */
export interface PaymentAllocation {
  id: string;
  visitId: string;
  serviceDate: string;
  description: string;
  /** Owed on that visit before this payment. */
  outstanding: number;
  allocated: number;
}

export const PAYMENT_STATUSES = ['CAPTURED', 'QUEUED', 'REVERSED'] as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** A patient payment and its receipt. */
export interface Payment {
  id: string;
  receiptNumber: string;
  patient: BillingPatientRef;
  takenAt: string;
  takenBy: string;
  amount: number;
  currency: string;
  method: PaymentMethodRef;
  status: PaymentStatus;
  allocations: PaymentAllocation[];
}

export interface FeeSheetListQuery extends PaginationQuery {
  patientId?: string;
  status?: FeeSheetStatus;
  /** `YYYY-MM-DD`, matched against the service date in the clinic's zone. */
  serviceDate?: string;
}

export interface ClaimListQuery extends PaginationQuery {
  status?: ClaimStatus;
  payerId?: string;
  patientId?: string;
  /** Free text over claim number, patient name and MRN. */
  q?: string;
  sort?: 'statusSince' | 'serviceDate' | 'billed';
  order?: 'asc' | 'desc';
}

export interface RemittanceListQuery extends PaginationQuery {
  payerId?: string;
  status?: RemittanceStatus;
}

export interface StatementListQuery extends PaginationQuery {
  bucket?: AgeingBucket;
  dunningStage?: DunningStage;
  q?: string;
  /** Lower bound on the balance, so a run can skip trivial amounts. */
  minBalance?: number;
}

export interface PaymentListQuery extends PaginationQuery {
  patientId?: string;
  method?: PaymentMethodKind;
  q?: string;
}

/* -------------------------------------------------------------------------- */
/* Client                                                                      */
/* -------------------------------------------------------------------------- */

/** The read surface the five billing screens share. */
export interface BillingClient {
  readonly mode: 'live' | 'mock';
  feeSheets: (query?: FeeSheetListQuery) => Promise<ListResponse<FeeSheet>>;
  claims: (query?: ClaimListQuery) => Promise<ListResponse<Claim>>;
  remittances: (query?: RemittanceListQuery) => Promise<ListResponse<Remittance>>;
  statements: (query?: StatementListQuery) => Promise<ListResponse<StatementAccount>>;
  payments: (query?: PaymentListQuery) => Promise<ListResponse<Payment>>;
}

export interface BillingData {
  feeSheets?: readonly FeeSheet[];
  claims?: readonly Claim[];
  remittances?: readonly Remittance[];
  statements?: readonly StatementAccount[];
  payments?: readonly Payment[];
}

/**
 * A fixture-backed client. Pass `data` to narrow what a screen sees, which is
 * how a test drives the empty state without a second code path through the
 * screen.
 */
export function createBillingClient(data: BillingData = {}): BillingClient {
  const feeSheets = data.feeSheets ?? MOCK_FEE_SHEETS;
  const claims = data.claims ?? MOCK_CLAIMS;
  const remittances = data.remittances ?? MOCK_REMITTANCES;
  const statements = data.statements ?? MOCK_STATEMENT_ACCOUNTS;
  const payments = data.payments ?? MOCK_PAYMENTS;

  return {
    mode: 'mock',
    feeSheets: (query = {}) =>
      Promise.resolve(paginate(filterFeeSheets(feeSheets, query), query.page, query.pageSize)),
    claims: (query = {}) =>
      Promise.resolve(paginate(filterClaims(claims, query), query.page, query.pageSize)),
    remittances: (query = {}) =>
      Promise.resolve(paginate(filterRemittances(remittances, query), query.page, query.pageSize)),
    statements: (query = {}) =>
      Promise.resolve(paginate(filterStatements(statements, query), query.page, query.pageSize)),
    payments: (query = {}) =>
      Promise.resolve(paginate(filterPayments(payments, query), query.page, query.pageSize)),
  };
}

/** The client every billing screen reads through. */
export const billing: BillingClient = createBillingClient();

/* -------------------------------------------------------------------------- */
/* Hooks                                                                       */
/* -------------------------------------------------------------------------- */

export interface BillingHookOptions {
  /** Injectable for tests and stories. Defaults to the app's `billing` client. */
  client?: BillingClient;
  enabled?: boolean;
}

export function useFeeSheets(
  query: FeeSheetListQuery = {},
  options: BillingHookOptions = {}
): AsyncState<ListResponse<FeeSheet>> {
  const client = options.client ?? billing;
  return useApiQuery(queryKey('billing.feeSheets', { ...query }), () => client.feeSheets(query), {
    enabled: options.enabled,
  });
}

export function useClaims(
  query: ClaimListQuery = {},
  options: BillingHookOptions = {}
): AsyncState<ListResponse<Claim>> {
  const client = options.client ?? billing;
  return useApiQuery(queryKey('billing.claims', { ...query }), () => client.claims(query), {
    enabled: options.enabled,
  });
}

export function useRemittances(
  query: RemittanceListQuery = {},
  options: BillingHookOptions = {}
): AsyncState<ListResponse<Remittance>> {
  const client = options.client ?? billing;
  return useApiQuery(
    queryKey('billing.remittances', { ...query }),
    () => client.remittances(query),
    { enabled: options.enabled }
  );
}

export function useStatements(
  query: StatementListQuery = {},
  options: BillingHookOptions = {}
): AsyncState<ListResponse<StatementAccount>> {
  const client = options.client ?? billing;
  return useApiQuery(queryKey('billing.statements', { ...query }), () => client.statements(query), {
    enabled: options.enabled,
  });
}

export function usePayments(
  query: PaymentListQuery = {},
  options: BillingHookOptions = {}
): AsyncState<ListResponse<Payment>> {
  const client = options.client ?? billing;
  return useApiQuery(queryKey('billing.payments', { ...query }), () => client.payments(query), {
    enabled: options.enabled,
  });
}
