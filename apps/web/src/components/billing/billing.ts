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
 *
 * Nothing here holds a word a person reads. Where a decision has a name - a
 * claim's state, an ageing band, what a variance was - the name is a catalogue
 * key and the screen looks it up. That is what keeps this module pure: a
 * sentence written here would be written in one language, and this module has
 * no way of knowing which language the reader is in. The keys are literal maps
 * rather than templates built from the value, so the next person to rename a
 * state can find every place it is named by searching for it.
 *
 * The catalogue drift test does not see them: its scanner reads a literal
 * translator call and a property whose name ends in `Key`, and a key held as
 * the value of a state in a `Record` is neither. So every map below is checked
 * against the catalogue in `__tests__/billing.test.ts` instead, which is the
 * one place that can enumerate them.
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
  return String.fromCodePoint(65 + (index % 26));
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
  /**
   * Catalogue key for what is wrong and what to change, in the biller register.
   *
   * A key rather than the sentence, because this module is pure and has no
   * translator: the words belong to whoever is reading the scrub panel, and a
   * sentence baked in here would be English on a Spanish screen.
   *
   * Null on the one finding whose text this module did not write - see
   * `message` below.
   */
  messageKey: string | null;
  /** Placeholder values for `messageKey`. */
  messageValues?: Readonly<Record<string, string | number>>;
  /**
   * Text that arrived from the API rather than from the catalogue, which today
   * is the payer's own prior-authorisation warning. It is rendered in the words
   * it came in: translating a payer's sentence in the interface would put a
   * second, diverging wording on something the payer will be quoted back.
   *
   * Null whenever `messageKey` carries the words, which is every other finding.
   */
  message: string | null;
  /** The line the finding is about, so the panel can point at a row. */
  lineId: string | null;
}

/**
 * Every reason this sheet cannot go to the claim pipeline yet.
 *
 * An unjustified line blocks: a charge with no diagnosis behind it cannot be
 * submitted at all, and the legacy fee sheet's habit of letting one through
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
      messageKey: 'billing.scrub.finding.noCharges',
      message: null,
      lineId: null,
    });
  }

  for (const line of active) {
    if (line.justifiedBy.length === 0) {
      findings.push({
        id: `unjustified-${line.id}`,
        severity: 'BLOCKING',
        messageKey: 'billing.scrub.finding.unjustified',
        messageValues: { code: line.code },
        message: null,
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
        messageKey: 'billing.scrub.finding.duplicate',
        messageValues: { code: line.code },
        message: null,
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
      messageKey: 'billing.scrub.finding.copay',
      messageValues: { amount: outstanding.text },
      message: null,
      lineId: null,
    });
  }

  if (sheet.authWarning) {
    findings.push({
      id: 'auth',
      severity: 'ADVISORY',
      // The payer's own wording, so it is passed through rather than keyed.
      messageKey: null,
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

/**
 * The catalogue key for each state's name.
 *
 * A literal map rather than a key built from the status at the call site. A
 * template such as `billing.claimStatus.${status}` is invisible to a search,
 * which means it is invisible to whoever has to find it the day a state is
 * renamed and one screen starts rendering its key.
 */
export const CLAIM_STATUS_LABEL_KEYS: Record<ClaimStatus, string> = {
  CAPTURED: 'billing.claimStatus.captured',
  SCRUBBED: 'billing.claimStatus.scrubbed',
  SUBMITTED: 'billing.claimStatus.submitted',
  ACKNOWLEDGED: 'billing.claimStatus.acknowledged',
  PAID: 'billing.claimStatus.paid',
  DENIED: 'billing.claimStatus.denied',
  REBILLED: 'billing.claimStatus.rebilled',
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
  /**
   * Catalogue key for the word beside the number. Always rendered: age is never
   * a colour on its own.
   */
  labelKey: string;
}

/**
 * How worried to be about a claim's age. Thresholds are the ones a small
 * practice's biller works to: a fortnight is normal payer turnaround, a month
 * is late, sixty days is money at risk.
 */
export function ageingState(days: number): AgeingState {
  if (days >= 60) return { days, tone: 'danger', labelKey: 'billing.claimAge.over60' };
  if (days >= 30) return { days, tone: 'danger', labelKey: 'billing.claimAge.over30' };
  if (days >= 14) return { days, tone: 'neutral', labelKey: 'billing.claimAge.ageing' };
  return { days, tone: 'success', labelKey: 'billing.claimAge.onTrack' };
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
  /** Catalogue key for the band's range, as the strip prints it. */
  labelKey: string;
  count: number;
  amount: number;
  tone: StatusTone;
}

/**
 * Which ageing band a claim of this age falls in, oldest band first so the
 * boundaries read in the same order as the labels above.
 */
function ageingBandIndex(days: number): number {
  if (days >= 60) return 3;
  if (days >= 30) return 2;
  if (days >= 14) return 1;
  return 0;
}

/** The strip above the workbench: how much money is sitting where, by age. */
export function claimAgeingBands(claims: readonly Claim[], now: string | Date): AgeingBand[] {
  const bands: AgeingBand[] = [
    { key: 'fresh', labelKey: 'billing.ageingBand.fresh', count: 0, amount: 0, tone: 'success' },
    { key: 'ageing', labelKey: 'billing.ageingBand.ageing', count: 0, amount: 0, tone: 'neutral' },
    { key: 'late', labelKey: 'billing.ageingBand.late', count: 0, amount: 0, tone: 'danger' },
    { key: 'stale', labelKey: 'billing.ageingBand.stale', count: 0, amount: 0, tone: 'danger' },
  ];

  for (const claim of claims) {
    const days = claimAgeDays(claim, now);
    const band = bands[ageingBandIndex(days)];
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
  /** Catalogue key for the label, which names the verb and its object. */
  labelKey: string;
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
    return [{ id: 'scrub', labelKey: 'billing.bulkAction.scrub', next: 'SCRUBBED' }];
  }
  if (status === 'SCRUBBED') {
    return [{ id: 'submit', labelKey: 'billing.bulkAction.submit', next: 'SUBMITTED' }];
  }
  if (status === 'DENIED') {
    return [{ id: 'rebill', labelKey: 'billing.bulkAction.rebill', next: 'REBILLED' }];
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
  /**
   * Catalogue key for "Underpaid", "Matched" or "Overpaid". Rendered next to
   * the number, always.
   */
  labelKey: string;
}

/**
 * The one number a remittance workbench exists for: did this line pay what the
 * claim expected. It is labelled rather than tinted, because a biller scanning
 * forty lines reads the word and only then the colour.
 */
export function lineVariance(line: RemittanceLine): Variance {
  const amount = line.paid - line.expectedPaid;
  if (amount === 0) return { amount, tone: 'success', labelKey: 'billing.variance.matched' };
  if (amount < 0) return { amount, tone: 'danger', labelKey: 'billing.variance.underpaid' };
  return { amount, tone: 'neutral', labelKey: 'billing.variance.overpaid' };
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

export const RESOLUTION_LABEL_KEYS: Record<ExceptionResolution, string> = {
  ACCEPTED: 'billing.resolution.accepted',
  ADJUSTED: 'billing.resolution.adjusted',
  TRANSFERRED: 'billing.resolution.transferred',
  FLAGGED: 'billing.resolution.flagged',
};

/* -------------------------------------------------------------------------- */
/* Statements and AR (BL-07, BL-08)                                            */
/* -------------------------------------------------------------------------- */

export const BUCKET_LABEL_KEYS: Record<AgeingBucket, string> = {
  CURRENT: 'billing.bucket.current',
  DAYS_31_60: 'billing.bucket.days3160',
  DAYS_61_90: 'billing.bucket.days6190',
  DAYS_91_PLUS: 'billing.bucket.days91Plus',
};

export const BUCKET_ORDER: readonly AgeingBucket[] = [
  'CURRENT',
  'DAYS_31_60',
  'DAYS_61_90',
  'DAYS_91_PLUS',
];

/**
 * The state word beside a bucket's amount. It says the same thing the tone
 * does, in words, so the tint is never the only signal on the AR strip.
 */
export const BUCKET_STATE_LABEL_KEYS: Record<AgeingBucket, string> = {
  CURRENT: 'billing.bucketState.onTrack',
  DAYS_31_60: 'billing.bucketState.ageing',
  DAYS_61_90: 'billing.bucketState.chase',
  DAYS_91_PLUS: 'billing.bucketState.chase',
};

export function bucketTone(bucket: AgeingBucket): StatusTone {
  if (bucket === 'DAYS_91_PLUS') return 'danger';
  if (bucket === 'DAYS_61_90') return 'danger';
  if (bucket === 'DAYS_31_60') return 'neutral';
  return 'success';
}

export const DUNNING_LABEL_KEYS: Record<DunningStage, string> = {
  NONE: 'billing.dunning.none',
  FIRST_NOTICE: 'billing.dunning.firstNotice',
  SECOND_NOTICE: 'billing.dunning.secondNotice',
  FINAL_NOTICE: 'billing.dunning.finalNotice',
  COLLECTIONS: 'billing.dunning.collections',
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

/**
 * The visits this payment actually paid something towards.
 *
 * A zero-allocated visit is not part of the payment and must not appear on the
 * receipt: a receipt listing a visit it paid nothing on is a receipt a patient
 * reads as settled.
 */
export function allocatedLines(
  items: readonly OpenItem[],
  allocations: Readonly<Record<string, number>>
): PaymentAllocation[] {
  const lines: PaymentAllocation[] = [];
  for (const item of items) {
    const allocated = allocations[item.visitId] ?? 0;
    if (allocated > 0) {
      lines.push({
        id: `${item.visitId}-alloc`,
        visitId: item.visitId,
        serviceDate: item.serviceDate,
        description: item.description,
        outstanding: item.outstanding,
        allocated,
      });
    }
  }
  return lines;
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

/**
 * Which of the three allocation states a payment is in, as one word.
 *
 * `balanced` and `over` are independent booleans on {@link AllocationState},
 * which invites every caller to re-derive the third state ("neither, so it is
 * short") with its own chain of conditions. Naming it once means the chip and
 * the button hint can never disagree about what the same payment is doing.
 */
export type AllocationStateName = 'over' | 'balanced' | 'short';

export function allocationStateName(state: AllocationState): AllocationStateName {
  if (state.over) return 'over';
  if (state.balanced) return 'balanced';
  return 'short';
}

/** Catalogue keys for the chip beside the running total. */
export const ALLOCATION_STATE_LABEL_KEYS: Record<AllocationStateName, string> = {
  over: 'billing.allocationState.over',
  balanced: 'billing.allocationState.balanced',
  short: 'billing.allocationState.short',
};

/**
 * Catalogue keys for the line under the Take payment button: why it is
 * disabled, or that it is ready.
 */
export const ALLOCATION_HINT_KEYS: Record<AllocationStateName, string> = {
  over: 'billing.allocationHint.over',
  balanced: 'billing.allocationHint.balanced',
  short: 'billing.allocationHint.short',
};

/** Turns a saved payment's allocations back into the rows a receipt renders. */
export function receiptRows(allocations: readonly PaymentAllocation[]): PaymentAllocation[] {
  return [...allocations].sort((a, b) => a.serviceDate.localeCompare(b.serviceDate));
}
