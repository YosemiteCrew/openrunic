import type { StatusTone } from '@openrunic/ui';

import type {
  AgeingBucket,
  ChargeLine,
  Claim,
  ClaimStatus,
  DunningStage,
  FeeSheet,
  PaymentAllocation,
  Remittance,
  RemittanceLine,
  StatementAccount,
  StatementLine,
} from '@/lib/api';
import { formatMoney } from '@/lib/format';

/**
 * The revenue cycle's arithmetic and its judgements, in one pure module.
 *
 * Everything a billing screen decides about money lives here rather than inside
 * a component: whether a fee sheet may be marked ready, how old a claim is in
 * its state, whether an 835 line matches what was expected, which ageing bucket
 * a balance belongs to, and how much of a payment is still unallocated. That
 * split is deliberate. These are the calculations a biller is trusting, so they
 * are unit-tested against fixtures rather than exercised only through a render,
 * and two screens can never disagree about the same number.
 *
 * Every function is pure and takes its "now" explicitly, so a workbench looks
 * identical in a test, a screenshot and a demo.
 */

/* -------------------------------------------------------------------------- */
/* Fee sheet (BL-01)                                                           */
/* -------------------------------------------------------------------------- */

export interface FeeSheetTotals {
  /** Charge lines that count, deleted ones excluded. */
  activeLines: number;
  units: number;
  /** Sum of unit fee times units, in major units. */
  charges: number;
  copayDue: number;
  copayCollected: number;
  /** What the payer will be asked for once the copay is taken off. */
  expectedFromPayer: number;
}

/** A line's own money. Deleted lines are worth zero, and say so on screen. */
export function lineCharge(line: ChargeLine): number {
  return line.deleted ? 0 : line.unitFee * line.units;
}

export function feeSheetTotals(sheet: FeeSheet, lines: readonly ChargeLine[]): FeeSheetTotals {
  const active = lines.filter((line) => !line.deleted);
  const charges = active.reduce((total, line) => total + lineCharge(line), 0);
  return {
    activeLines: active.length,
    units: active.reduce((total, line) => total + line.units, 0),
    charges,
    copayDue: sheet.copayDue,
    copayCollected: sheet.copayCollected,
    expectedFromPayer: Math.max(charges - sheet.copayCollected, 0),
  };
}

/**
 * The pointer letter a visit diagnosis carries: A, B, C, D, exactly as it does
 * on a claim form. It is what visually ties a charge line to the diagnosis
 * justifying it without relying on colour or on a hover, and a biller who has
 * ever seen a CMS-1500 already knows how to read it.
 */
export function diagnosisPointer(index: number): string {
  return String.fromCharCode(65 + (index % 26));
}

/** A charge added from the picker, with nothing justified yet: the honest start. */
export function newChargeLine(
  code: { code: string; display: string; fee: number },
  sequence: number
): ChargeLine {
  return {
    id: `added-${code.code}-${sequence}`,
    code: code.code,
    display: code.display,
    modifiers: [],
    units: 1,
    unitFee: code.fee,
    justifiedBy: [],
    deleted: false,
  };
}

export type ScrubSeverity =
  /** Must be cleared before the sheet can be marked ready. */
  | 'BLOCKING'
  /** Must be read, does not stop the handover. */
  | 'ADVISORY';

export interface ScrubFinding {
  id: string;
  severity: ScrubSeverity;
  /** What is wrong and what to change, in the biller register. */
  message: string;
  /** The line the finding is about, so the panel can point at a row. */
  lineId: string | null;
}

/**
 * Every reason this sheet cannot go to the claim pipeline yet.
 *
 * An unjustified line blocks: a charge with no diagnosis behind it cannot be
 * submitted at all, and the OpenEMR fee sheet's habit of letting one through
 * silently is exactly what this screen exists to end. An exhausted prior
 * authorisation does not block, because it is the payer's answer rather than a
 * defect in the claim, and the biller may still decide to bill it; it is
 * surfaced where the money is captured so the decision is deliberate.
 */
export function scrubFeeSheet(sheet: FeeSheet, lines: readonly ChargeLine[]): ScrubFinding[] {
  const findings: ScrubFinding[] = [];
  const active = lines.filter((line) => !line.deleted);

  if (active.length === 0) {
    findings.push({
      id: 'no-charges',
      severity: 'BLOCKING',
      message: 'No charges captured. Add at least one code before marking this visit ready.',
      lineId: null,
    });
  }

  for (const line of active) {
    if (line.justifiedBy.length === 0) {
      findings.push({
        id: `unjustified-${line.id}`,
        severity: 'BLOCKING',
        message: `${line.code} has no diagnosis linked. Link one from the visit diagnoses.`,
        lineId: line.id,
      });
    }
  }

  const seen = new Set<string>();
  for (const line of active) {
    if (seen.has(line.code) && line.modifiers.length === 0) {
      findings.push({
        id: `duplicate-${line.id}`,
        severity: 'ADVISORY',
        message: `${line.code} appears more than once without a modifier. Add 59 or merge the lines.`,
        lineId: line.id,
      });
    }
    seen.add(line.code);
  }

  if (sheet.copayDue > sheet.copayCollected) {
    const outstanding = formatMoney(sheet.copayDue - sheet.copayCollected, {
      currency: sheet.currency,
    });
    findings.push({
      id: 'copay-outstanding',
      severity: 'ADVISORY',
      message: `Copay of ${outstanding.text} is not collected. Take it at checkout or bill it to the patient.`,
      lineId: null,
    });
  }

  if (sheet.authWarning) {
    findings.push({
      id: 'auth',
      severity: 'ADVISORY',
      message: sheet.authWarning,
      lineId: null,
    });
  }

  return findings;
}

export function blockingFindings(findings: readonly ScrubFinding[]): ScrubFinding[] {
  return findings.filter((finding) => finding.severity === 'BLOCKING');
}

/* -------------------------------------------------------------------------- */
/* Claims (BL-03, BL-04)                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Status tone. Terracotta is never used here: it is the action colour, and a
 * claim state is not an action. Everything in flight is neutral hazelnut, paid
 * is olive, and only the two states a biller must work are danger.
 */
export const CLAIM_STATUS_TONE: Record<ClaimStatus, StatusTone> = {
  CAPTURED: 'neutral',
  SCRUBBED: 'neutral',
  SUBMITTED: 'neutral',
  ACKNOWLEDGED: 'neutral',
  PAID: 'success',
  DENIED: 'danger',
  REBILLED: 'neutral',
};

export const CLAIM_STATUS_LABELS: Record<ClaimStatus, string> = {
  CAPTURED: 'Captured',
  SCRUBBED: 'Scrubbed',
  SUBMITTED: 'Submitted',
  ACKNOWLEDGED: 'Acknowledged',
  PAID: 'Paid',
  DENIED: 'Denied',
  REBILLED: 'Rebilled',
};

/** Whole days the claim has sat in its current state. */
export function claimAgeDays(claim: Claim, now: string | Date): number {
  const since = new Date(claim.statusSince).getTime();
  const end = (now instanceof Date ? now : new Date(now)).getTime();
  if (Number.isNaN(since) || Number.isNaN(end)) return 0;
  return Math.max(Math.floor((end - since) / 86_400_000), 0);
}

export interface AgeingState {
  days: number;
  tone: StatusTone;
  /** Always rendered beside the number: age is never a colour on its own. */
  label: string;
}

/**
 * How worried to be about a claim's age. Thresholds are the ones a small
 * practice's biller works to: a fortnight is normal payer turnaround, a month
 * is late, sixty days is money at risk.
 */
export function ageingState(days: number): AgeingState {
  if (days >= 60) return { days, tone: 'danger', label: 'Over 60 days' };
  if (days >= 30) return { days, tone: 'danger', label: 'Over 30 days' };
  if (days >= 14) return { days, tone: 'neutral', label: 'Ageing' };
  return { days, tone: 'success', label: 'On track' };
}

export function claimCounts(claims: readonly Claim[]): Record<ClaimStatus, number> {
  const counts: Record<ClaimStatus, number> = {
    CAPTURED: 0,
    SCRUBBED: 0,
    SUBMITTED: 0,
    ACKNOWLEDGED: 0,
    PAID: 0,
    DENIED: 0,
    REBILLED: 0,
  };
  for (const claim of claims) counts[claim.status] += 1;
  return counts;
}

export interface AgeingBand {
  key: string;
  label: string;
  count: number;
  amount: number;
  tone: StatusTone;
}

/** The strip above the workbench: how much money is sitting where, by age. */
export function claimAgeingBands(claims: readonly Claim[], now: string | Date): AgeingBand[] {
  const bands: AgeingBand[] = [
    { key: 'fresh', label: '0 to 13 days', count: 0, amount: 0, tone: 'success' },
    { key: 'ageing', label: '14 to 29 days', count: 0, amount: 0, tone: 'neutral' },
    { key: 'late', label: '30 to 59 days', count: 0, amount: 0, tone: 'danger' },
    { key: 'stale', label: '60 days and over', count: 0, amount: 0, tone: 'danger' },
  ];

  for (const claim of claims) {
    const days = claimAgeDays(claim, now);
    const index = days >= 60 ? 3 : days >= 30 ? 2 : days >= 14 ? 1 : 0;
    const band = bands[index];
    if (!band) continue;
    band.count += 1;
    band.amount += claim.billed - claim.paid;
  }

  return bands;
}

/**
 * The steps this claim's life is expected to have, so the detail stepper can
 * show what has happened and what is still owed without pretending a denied
 * claim was ever going to be paid.
 */
export function claimLifecycle(status: ClaimStatus): ClaimStatus[] {
  const spine: ClaimStatus[] = ['CAPTURED', 'SCRUBBED', 'SUBMITTED', 'ACKNOWLEDGED'];
  if (status === 'DENIED') return [...spine, 'DENIED'];
  if (status === 'REBILLED') return [...spine, 'DENIED', 'REBILLED'];
  return [...spine, 'PAID'];
}

export interface BulkAction {
  id: string;
  /** Names the verb and its object, per the voice rules. */
  label: string;
  /** What the toast says once it has run. */
  done: string;
  /** The state the selected claims move to. */
  next: ClaimStatus;
}

/**
 * The bulk actions a state earns. A claim carrying scrub errors is excluded by
 * the caller rather than here, so the button is never offered for work that
 * would fail.
 */
export function bulkActionsFor(status: ClaimStatus): BulkAction[] {
  if (status === 'CAPTURED') {
    return [{ id: 'scrub', label: 'Scrub selected claims', done: 'Scrubbed', next: 'SCRUBBED' }];
  }
  if (status === 'SCRUBBED') {
    return [
      { id: 'submit', label: 'Submit selected claims', done: 'Submitted', next: 'SUBMITTED' },
    ];
  }
  if (status === 'DENIED') {
    return [
      {
        id: 'rebill',
        label: 'Correct and rebill selected claims',
        done: 'Rebilled',
        next: 'REBILLED',
      },
    ];
  }
  return [];
}

/** A claim carrying scrub errors cannot move on, and the row says why. */
export function isBlockedByScrub(claim: Claim): boolean {
  return claim.scrubErrors.length > 0;
}

/* -------------------------------------------------------------------------- */
/* Remittance (BL-05)                                                          */
/* -------------------------------------------------------------------------- */

export interface Variance {
  /** Paid minus expected, in major units. Negative means underpaid. */
  amount: number;
  tone: StatusTone;
  /** "Underpaid", "Matched", "Overpaid". Rendered next to the number, always. */
  label: string;
}

/**
 * The one number a remittance workbench exists for: did this line pay what the
 * claim expected. It is labelled rather than tinted, because a biller scanning
 * forty lines reads the word and only then the colour.
 */
export function lineVariance(line: RemittanceLine): Variance {
  const amount = line.paid - line.expectedPaid;
  if (amount === 0) return { amount, tone: 'success', label: 'Matched' };
  if (amount < 0) return { amount, tone: 'danger', label: 'Underpaid' };
  return { amount, tone: 'neutral', label: 'Overpaid' };
}

export interface RemittanceSummary {
  lines: number;
  autoPosted: number;
  exceptions: number;
  /** Whole percent of lines that posted without a human. */
  autoPostedPercent: number;
  paid: number;
  patientResponsibility: number;
}

export function remittanceSummary(remittance: Remittance): RemittanceSummary {
  const lines = remittance.lines.length;
  const exceptions = remittance.lines.filter((line) => line.state === 'EXCEPTION').length;
  const autoPosted = lines - exceptions;
  return {
    lines,
    autoPosted,
    exceptions,
    autoPostedPercent: lines === 0 ? 0 : Math.round((autoPosted / lines) * 100),
    paid: remittance.lines.reduce((total, line) => total + line.paid, 0),
    patientResponsibility: remittance.lines.reduce(
      (total, line) => total + line.patientResponsibility,
      0
    ),
  };
}

/** How an exception was cleared. Each one is an auditable disposition. */
export type ExceptionResolution = 'ACCEPTED' | 'ADJUSTED' | 'TRANSFERRED' | 'FLAGGED';

export const RESOLUTION_LABELS: Record<ExceptionResolution, string> = {
  ACCEPTED: 'Accepted as paid',
  ADJUSTED: 'Adjusted off',
  TRANSFERRED: 'Transferred to patient',
  FLAGGED: 'Flagged for appeal',
};

/* -------------------------------------------------------------------------- */
/* Statements and AR (BL-07, BL-08)                                            */
/* -------------------------------------------------------------------------- */

export const BUCKET_LABELS: Record<AgeingBucket, string> = {
  CURRENT: '0 to 30 days',
  DAYS_31_60: '31 to 60 days',
  DAYS_61_90: '61 to 90 days',
  DAYS_91_PLUS: '91 days and over',
};

export const BUCKET_ORDER: readonly AgeingBucket[] = [
  'CURRENT',
  'DAYS_31_60',
  'DAYS_61_90',
  'DAYS_91_PLUS',
];

export function bucketTone(bucket: AgeingBucket): StatusTone {
  if (bucket === 'DAYS_91_PLUS') return 'danger';
  if (bucket === 'DAYS_61_90') return 'danger';
  if (bucket === 'DAYS_31_60') return 'neutral';
  return 'success';
}

export const DUNNING_LABELS: Record<DunningStage, string> = {
  NONE: 'No statement sent',
  FIRST_NOTICE: 'First notice',
  SECOND_NOTICE: 'Second notice',
  FINAL_NOTICE: 'Final notice',
  COLLECTIONS: 'With collections',
};

/** The next stage a statement run would move this account to. */
export function nextDunningStage(stage: DunningStage): DunningStage {
  if (stage === 'NONE') return 'FIRST_NOTICE';
  if (stage === 'FIRST_NOTICE') return 'SECOND_NOTICE';
  if (stage === 'SECOND_NOTICE') return 'FINAL_NOTICE';
  if (stage === 'FINAL_NOTICE') return 'COLLECTIONS';
  return 'COLLECTIONS';
}

export interface ArSummary {
  total: number;
  buckets: Record<AgeingBucket, number>;
  accounts: number;
}

export function arSummary(accounts: readonly StatementAccount[]): ArSummary {
  const buckets: Record<AgeingBucket, number> = {
    CURRENT: 0,
    DAYS_31_60: 0,
    DAYS_61_90: 0,
    DAYS_91_PLUS: 0,
  };

  for (const account of accounts) {
    for (const bucket of BUCKET_ORDER) buckets[bucket] += account.ageing[bucket];
  }

  return {
    total: buckets.CURRENT + buckets.DAYS_31_60 + buckets.DAYS_61_90 + buckets.DAYS_91_PLUS,
    buckets,
    accounts: accounts.length,
  };
}

/** What the statement itself owes: charges, what insurance did, what is left. */
export function statementTotals(lines: readonly StatementLine[]): {
  charges: number;
  insurancePaid: number;
  adjustments: number;
  outstanding: number;
} {
  return {
    charges: lines.reduce((total, line) => total + line.charges, 0),
    insurancePaid: lines.reduce((total, line) => total + line.insurancePaid, 0),
    adjustments: lines.reduce((total, line) => total + line.adjustments, 0),
    outstanding: lines.reduce((total, line) => total + line.outstanding, 0),
  };
}

/* -------------------------------------------------------------------------- */
/* Payments (BL-02, BL-06)                                                     */
/* -------------------------------------------------------------------------- */

/** Cents, so a float sum of major units cannot leave a 0.004 remainder. */
function cents(value: number): number {
  return Math.round(value * 100);
}

export function allocatedTotal(allocations: Readonly<Record<string, number>>): number {
  const total = Object.values(allocations).reduce((sum, value) => sum + cents(value), 0);
  return total / 100;
}

/**
 * What is left of the payment. The screen's most prominent number, because the
 * batch this replaces hid it and let mistakes through.
 */
export function unallocated(amount: number, allocations: Readonly<Record<string, number>>): number {
  return (cents(amount) - cents(allocatedTotal(allocations))) / 100;
}

export interface OpenItem {
  visitId: string;
  serviceDate: string;
  description: string;
  outstanding: number;
}

/**
 * Oldest visit first until the money runs out, which is how a practice applies
 * a patient payment when the patient has not said otherwise. It never
 * over-allocates a visit and never allocates more than the payment.
 */
export function autoAllocate(amount: number, items: readonly OpenItem[]): Record<string, number> {
  const ordered = [...items].sort((a, b) => a.serviceDate.localeCompare(b.serviceDate));
  const allocations: Record<string, number> = {};
  let remaining = cents(Math.max(amount, 0));

  for (const item of ordered) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, cents(item.outstanding));
    if (take <= 0) continue;
    allocations[item.visitId] = take / 100;
    remaining -= take;
  }

  return allocations;
}

export interface AllocationState {
  allocated: number;
  unallocated: number;
  /** True only when every cent has a visit against it. */
  balanced: boolean;
  /** More allocated than taken: always an error, never merely a warning. */
  over: boolean;
}

export function allocationState(
  amount: number,
  allocations: Readonly<Record<string, number>>
): AllocationState {
  const allocated = allocatedTotal(allocations);
  const left = unallocated(amount, allocations);
  return {
    allocated,
    unallocated: left,
    balanced: cents(left) === 0 && cents(amount) > 0,
    over: cents(left) < 0,
  };
}

/** Turns a saved payment's allocations back into the rows a receipt renders. */
export function receiptRows(allocations: readonly PaymentAllocation[]): PaymentAllocation[] {
  return [...allocations].sort((a, b) => a.serviceDate.localeCompare(b.serviceDate));
}
